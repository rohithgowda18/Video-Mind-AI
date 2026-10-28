import os
import re
import urllib.request
import threading
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from youtube_utils import (
    extract_video_id,
    validate_video_id,
    fetch_transcript,
    fetch_video_details,
)
from rag_pipeline import (
    build_or_load_faiss_index,
    answer_question,
    summarize_video,
    generate_key_takeaways,
    generate_mindmap,
    generate_quiz,
    load_faiss_index,
    check_faiss_index_exists,
    migrate_faiss_index,
    find_faiss_index_path,
    retrieve_context,
)

# Load environment variables (.env in backend directory or root)
env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=env_path)
load_dotenv()  # Fallback to root .env if present

app = FastAPI(
    title="Video-Mind AI Backend",
    description="FastAPI Backend for YouTube Transcript RAG Q&A with FAISS & Gemini 2.5 Flash",
    version="1.0.0",
)

# Configure CORS for React frontend (local dev & production FRONTEND_URL)
default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

frontend_url = os.environ.get("FRONTEND_URL", "").strip()
if frontend_url:
    # Ensure no trailing slash for exact CORS matching
    frontend_url = frontend_url.rstrip("/")
    if frontend_url not in default_origins:
        default_origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=default_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_INDEXING_STATUS: Dict[str, Dict[str, Any]] = {}
_INDEXING_ACTIVE: set[str] = set()
_INDEXING_LOCK = threading.Lock()


# Request & Response Schemas
class LoadVideoRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048, description="YouTube video URL or 11-char Video ID")
    folder_name: Optional[str] = Field(default=None, max_length=120, description="User-facing library folder name")


class PlaylistImportRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    limit: int = Field(default=50, ge=1, le=100)


class TranscriptSearchRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=500)
    video_ids: List[str] = Field(..., min_length=1, max_length=100)


class ChatHistoryMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Text content")


class AskQuestionRequest(BaseModel):
    video_id: Optional[str] = Field(default=None, description="Backward-compatible single video ID")
    video_ids: Optional[List[str]] = Field(default=None, description="Video IDs for folder context")
    video_titles: Optional[Dict[str, str]] = Field(default=None, description="Titles keyed by video ID")
    question: str = Field(..., description="Question string regarding video transcript")
    history: Optional[List[ChatHistoryMessage]] = Field(default=None, description="Previous conversation turns")


class ActionRequest(BaseModel):
    video_id: Optional[str] = Field(default=None, description="Backward-compatible single video ID")
    video_ids: Optional[List[str]] = Field(default=None, description="Video IDs for folder context")
    video_titles: Optional[Dict[str, str]] = Field(default=None, description="Titles keyed by video ID")


def _requested_video_ids(video_id: Optional[str], video_ids: Optional[List[str]]) -> List[str]:
    ids = video_ids or ([video_id] if video_id else [])
    unique_ids = list(dict.fromkeys(item.strip() for item in ids if item and item.strip()))
    if not unique_ids or any(not validate_video_id(item) for item in unique_ids):
        raise HTTPException(status_code=400, detail="At least one valid YouTube Video ID is required.")
    return unique_ids


def _load_context(
    video_id: Optional[str],
    video_ids: Optional[List[str]],
    video_titles: Optional[Dict[str, str]],
):
    ids = _requested_video_ids(video_id, video_ids)
    contexts = []
    missing = []
    for current_id in ids:
        store = load_faiss_index(current_id)
        if store is None:
            missing.append(current_id)
            continue
        title = (video_titles or {}).get(current_id, f"YouTube Video ({current_id})")
        contexts.append((current_id, store, title))
    if not contexts:
        raise HTTPException(
            status_code=404,
            detail=f"No indexed videos are available. Missing indexes: {', '.join(missing)}",
        )
    return (contexts[0][1] if len(contexts) == 1 and not video_ids else contexts), missing


@app.get("/")
def read_root():
    return {"message": "Video-Mind AI FastAPI service is running."}


@app.get("/api/videos/indexed")
def get_indexed_videos():
    """Return list of video IDs that have existing FAISS indexes on disk."""
    from rag_pipeline import FAISS_INDEXES_DIR
    indexes = []
    if os.path.exists(FAISS_INDEXES_DIR) and os.path.isdir(FAISS_INDEXES_DIR):
        for root, _dirs, _files in os.walk(FAISS_INDEXES_DIR):
            if os.path.basename(root) == "faiss_indexes":
                continue
            if os.path.exists(os.path.join(root, "index.faiss")) and os.path.exists(os.path.join(root, "index.pkl")):
                indexes.append(os.path.basename(root).split("__")[-1])
    return {"videos": indexes}


@app.get("/api/video/status/{video_id}")
def get_video_status(video_id: str):
    if not validate_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid YouTube Video ID.")
    status = _INDEXING_STATUS.get(video_id)
    if status:
        return status
    return {"video_id": video_id, "status": "ready" if check_faiss_index_exists(video_id) else "not_indexed"}


@app.post("/api/playlist/inspect")
def inspect_playlist(req: PlaylistImportRequest):
    """Extract public playlist video IDs without indexing or calling Gemini."""
    if "list=" not in req.url:
        raise HTTPException(status_code=400, detail="Enter a YouTube playlist URL containing a list parameter.")
    try:
        request = urllib.request.Request(req.url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=10) as response:
            html = response.read().decode("utf-8", errors="ignore")
        ids = list(dict.fromkeys(re.findall(r'"videoId":"([A-Za-z0-9_-]{11})"', html)))[:req.limit]
        if not ids:
            raise HTTPException(status_code=422, detail="The playlist is private, unavailable, or could not be read.")
        return {"videos": [{"video_id": video_id, "title": f"YouTube Video ({video_id})"} for video_id in ids], "limited": len(ids) >= req.limit}
    except HTTPException:
        raise
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=502, detail=f"Unable to read this playlist: {error}")


@app.post("/api/search/transcript")
def search_transcript(req: TranscriptSearchRequest):
    ids = _requested_video_ids(None, req.video_ids)
    contexts = []
    missing = []
    for video_id in ids:
        store = load_faiss_index(video_id)
        if store is None:
            missing.append(video_id)
        else:
            contexts.append((video_id, store, f"YouTube Video ({video_id})"))
    if not contexts:
        return {"results": [], "missing_video_ids": missing}
    documents, retrieval_missing = retrieve_context(contexts, req.query, k_per_video=3, limit=20)
    return {
        "results": [
            {
                "video_id": document.metadata.get("video_id", ""),
                "title": document.metadata.get("title", "Unknown video"),
                "timestamp": int(float(document.metadata.get("start", 0))),
                "text": document.page_content[:300],
                "url": f"https://www.youtube.com/watch?v={document.metadata.get('video_id', '')}&t={int(float(document.metadata.get('start', 0)))}",
            }
            for document in documents
        ],
        "missing_video_ids": missing + retrieval_missing,
    }


@app.post("/api/video/load")
def load_video(req: LoadVideoRequest):
    """Extract Video ID, fetch/load transcript, prepare persistent FAISS index, and return metadata."""
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="Please enter a YouTube URL or Video ID.")

    video_id = extract_video_id(req.url)
    if not video_id or not validate_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or Video ID.")

    with _INDEXING_LOCK:
        if video_id in _INDEXING_ACTIVE:
            raise HTTPException(status_code=409, detail="This video is already being indexed.")
        _INDEXING_ACTIVE.add(video_id)
    _INDEXING_STATUS[video_id] = {"video_id": video_id, "status": "processing"}
    try:
        # Fetch title before choosing a readable persistent path.
        title, thumbnail_url = fetch_video_details(video_id)

        # 1. Reuse an existing index, migrating legacy ID-only storage when possible.
        if check_faiss_index_exists(video_id):
            index_path = migrate_faiss_index(video_id, req.folder_name, title)
        else:
            # Fetch transcript and build new FAISS index only if not present
            snippets = fetch_transcript(video_id)
            build_or_load_faiss_index(snippets, video_id, req.folder_name, title)
            index_path = find_faiss_index_path(video_id)

        _INDEXING_STATUS[video_id] = {"video_id": video_id, "status": "ready", "title": title}
        return {
            "success": True,
            "video_id": video_id,
            "title": title,
            "thumbnail_url": thumbnail_url,
            "index_path": os.path.relpath(index_path, os.path.dirname(os.path.dirname(__file__))) if index_path else None,
            "status": "ready",
            "message": "Video processed successfully",
        }
    except (ValueError, RuntimeError) as error:
        message = str(error)
        _INDEXING_STATUS[video_id] = {"video_id": video_id, "status": "failed", "message": message}
        raise HTTPException(status_code=422, detail=message)
    except OSError:
        _INDEXING_STATUS[video_id] = {"video_id": video_id, "status": "failed", "message": "Storage is unavailable."}
        raise HTTPException(status_code=503, detail="Index storage is temporarily unavailable.")
    except Exception:
        _INDEXING_STATUS[video_id] = {"video_id": video_id, "status": "failed", "message": "Video processing failed."}
        raise HTTPException(status_code=500, detail="Video processing failed. Please retry.")
    finally:
        with _INDEXING_LOCK:
            _INDEXING_ACTIVE.discard(video_id)


@app.post("/api/ask")
def ask_question_endpoint(req: AskQuestionRequest):
    """Retrieve relevant FAISS chunks and generate transcript-grounded answer with citations & metrics."""
    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    try:
        ids = _requested_video_ids(req.video_id, req.video_ids)
        if len(ids) == 1 and not req.video_ids:
            video_id = ids[0]
            vector_store = load_faiss_index(video_id)
            if vector_store is None:
                snippets = fetch_transcript(video_id)
                vector_store = build_or_load_faiss_index(snippets, video_id)
        else:
            vector_store, missing = _load_context(req.video_id, req.video_ids, req.video_titles)

        history_payload = [m.model_dump() for m in req.history] if req.history else None
        answer, sources, metrics = answer_question(vector_store, req.question, history_payload)
        if len(ids) > 1:
            metrics["missing_video_ids"] = missing
        return {
            "answer": answer,
            "sources": sources,
            "metrics": metrics,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating answer: {str(e)}")


@app.post("/api/summarize")
def summarize_endpoint(req: ActionRequest):
    """Generate structured summary of the loaded video."""
    try:
        vector_store, _ = _load_action_context(req)
        summary = summarize_video(vector_store)
        return {"summary": summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating summary: {str(e)}")


@app.post("/api/key-takeaways")
def key_takeaways_endpoint(req: ActionRequest):
    """Generate 5-10 bullet point key takeaways from the video context."""
    try:
        vector_store, _ = _load_action_context(req)
        takeaways = generate_key_takeaways(vector_store)
        return {"takeaways": takeaways}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating takeaways: {str(e)}")


@app.post("/api/mindmap")
def mindmap_endpoint(req: ActionRequest):
    """Generate Mermaid.js flowchart code of video concept hierarchy."""
    try:
        vector_store, _ = _load_action_context(req)
        mindmap = generate_mindmap(vector_store)
        return {"mindmap": mindmap}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating mindmap: {str(e)}")


@app.post("/api/quiz")
def quiz_endpoint(req: ActionRequest):
    """Generate interactive multiple choice quiz questions based on transcript."""
    try:
        vector_store, _ = _load_action_context(req)
        quiz = generate_quiz(vector_store)
        return {"quiz": quiz}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating quiz: {str(e)}")


def _load_action_context(req: ActionRequest):
    ids = _requested_video_ids(req.video_id, req.video_ids)
    if len(ids) == 1 and not req.video_ids:
        video_id = ids[0]
        vector_store = load_faiss_index(video_id)
        if vector_store is None:
            snippets = fetch_transcript(video_id)
            vector_store = build_or_load_faiss_index(snippets, video_id)
        return vector_store, []
    return _load_context(req.video_id, req.video_ids, req.video_titles)



if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
