import os
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


# Request & Response Schemas
class LoadVideoRequest(BaseModel):
    url: str = Field(..., description="YouTube video URL or 11-char Video ID")


class ChatHistoryMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Text content")


class AskQuestionRequest(BaseModel):
    video_id: str = Field(..., description="11-char YouTube Video ID")
    question: str = Field(..., description="Question string regarding video transcript")
    history: Optional[List[ChatHistoryMessage]] = Field(default=None, description="Previous conversation turns")


class ActionRequest(BaseModel):
    video_id: str = Field(..., description="11-char YouTube Video ID")


@app.get("/")
def read_root():
    return {"message": "Video-Mind AI FastAPI service is running."}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/api/video/load")
def load_video(req: LoadVideoRequest):
    """Extract Video ID, fetch/load transcript, prepare persistent FAISS index, and return metadata."""
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="Please enter a YouTube URL or Video ID.")

    video_id = extract_video_id(req.url)
    if not video_id or not validate_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or Video ID.")

    try:
        # Check if FAISS index already exists on disk
        existing_store = load_faiss_index(video_id)
        if existing_store is None:
            # Fetch transcript and build new FAISS index
            snippets = fetch_transcript(video_id)
            build_or_load_faiss_index(snippets, video_id)
        
        # Fetch title and thumbnail
        title, thumbnail_url = fetch_video_details(video_id)

        return {
            "success": True,
            "video_id": video_id,
            "title": title,
            "thumbnail_url": thumbnail_url,
            "status": "ready",
            "message": "Video processed successfully",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ask")
def ask_question_endpoint(req: AskQuestionRequest):
    """Retrieve relevant FAISS chunks and generate transcript-grounded answer with citations & metrics."""
    if not req.video_id or not req.video_id.strip():
        raise HTTPException(status_code=400, detail="Video ID is required.")
    if not req.question or not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    video_id = req.video_id.strip()
    if not validate_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid YouTube Video ID.")

    try:
        vector_store = load_faiss_index(video_id)
        if vector_store is None:
            # Build index if not existing
            snippets = fetch_transcript(video_id)
            vector_store = build_or_load_faiss_index(snippets, video_id)

        history_payload = [m.model_dump() for m in req.history] if req.history else None
        answer, sources, metrics = answer_question(vector_store, req.question, history_payload)
        return {
            "answer": answer,
            "sources": sources,
            "metrics": metrics,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating answer: {str(e)}")


@app.post("/api/summarize")
def summarize_endpoint(req: ActionRequest):
    """Generate structured summary of the loaded video."""
    if not req.video_id or not req.video_id.strip():
        raise HTTPException(status_code=400, detail="Video ID is required.")

    video_id = req.video_id.strip()
    if not validate_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid YouTube Video ID.")

    try:
        vector_store = load_faiss_index(video_id)
        if vector_store is None:
            snippets = fetch_transcript(video_id)
            vector_store = build_or_load_faiss_index(snippets, video_id)

        summary = summarize_video(vector_store)
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating summary: {str(e)}")


@app.post("/api/key-takeaways")
def key_takeaways_endpoint(req: ActionRequest):
    """Generate 5-10 bullet point key takeaways from the video context."""
    if not req.video_id or not req.video_id.strip():
        raise HTTPException(status_code=400, detail="Video ID is required.")

    video_id = req.video_id.strip()
    if not validate_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid YouTube Video ID.")

    try:
        vector_store = load_faiss_index(video_id)
        if vector_store is None:
            snippets = fetch_transcript(video_id)
            vector_store = build_or_load_faiss_index(snippets, video_id)

        takeaways = generate_key_takeaways(vector_store)
        return {"takeaways": takeaways}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating takeaways: {str(e)}")


@app.post("/api/mindmap")
def mindmap_endpoint(req: ActionRequest):
    """Generate Mermaid.js flowchart code of video concept hierarchy."""
    if not req.video_id or not req.video_id.strip():
        raise HTTPException(status_code=400, detail="Video ID is required.")

    video_id = req.video_id.strip()
    if not validate_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid YouTube Video ID.")

    try:
        vector_store = load_faiss_index(video_id)
        if vector_store is None:
            snippets = fetch_transcript(video_id)
            vector_store = build_or_load_faiss_index(snippets, video_id)

        mindmap = generate_mindmap(vector_store)
        return {"mindmap": mindmap}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating mindmap: {str(e)}")


@app.post("/api/quiz")
def quiz_endpoint(req: ActionRequest):
    """Generate interactive multiple choice quiz questions based on transcript."""
    if not req.video_id or not req.video_id.strip():
        raise HTTPException(status_code=400, detail="Video ID is required.")

    video_id = req.video_id.strip()
    if not validate_video_id(video_id):
        raise HTTPException(status_code=400, detail="Invalid YouTube Video ID.")

    try:
        vector_store = load_faiss_index(video_id)
        if vector_store is None:
            snippets = fetch_transcript(video_id)
            vector_store = build_or_load_faiss_index(snippets, video_id)

        quiz = generate_quiz(vector_store)
        return {"quiz": quiz}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating quiz: {str(e)}")



if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)

