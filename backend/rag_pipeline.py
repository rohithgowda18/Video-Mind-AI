import os
import re
import shutil
from functools import lru_cache
from typing import List, Dict, Any, Tuple, Optional, Union

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser

from youtube_utils import format_timestamp, create_youtube_timestamp_url

# Root directory path for persistent FAISS indices
FAISS_INDEXES_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "faiss_indexes")
)


@lru_cache(maxsize=1)
def load_embedding_model() -> HuggingFaceEmbeddings:
    """Cache and return HuggingFace embeddings model."""
    return HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )


def create_documents_from_snippets(
    snippets: List[Dict[str, Any]], video_id: str, video_title: Optional[str] = None,
    folder_name: Optional[str] = None,
) -> List[Document]:
    """
    Combine consecutive YouTube transcript snippets into meaningful chunks (~1200 chars)
    with overlap (~250 chars) while preserving the exact starting timestamp of each chunk
    from the first snippet in the chunk.
    """
    if not snippets:
        return []

    documents = []
    chunk_size = 1200
    overlap_size = 250

    i = 0
    num_snippets = len(snippets)

    while i < num_snippets:
        chunk_snippets = []
        current_len = 0
        start_time = float(snippets[i].get("start", 0.0))

        j = i
        while j < num_snippets:
            snip_text = snippets[j]["text"]
            chunk_snippets.append(snip_text)
            current_len += len(snip_text) + 1
            j += 1
            if current_len >= chunk_size:
                break

        combined_text = " ".join(chunk_snippets)
        total_duration = float(snippets[j - 1].get("start", 0.0)) + float(snippets[j - 1].get("duration", 0.0)) - start_time

        documents.append(
            Document(
                page_content=combined_text,
                metadata={
                    "video_id": video_id,
                    "title": video_title or f"YouTube Video ({video_id})",
                    "folder_name": folder_name or "Uncategorized",
                    "start": start_time,
                    "duration": max(0.0, total_duration),
                },
            )
        )

        if j >= num_snippets:
            break

        # Calculate overlap for the next chunk start index
        overlap_len = 0
        next_i = j
        for k in range(j - 1, i, -1):
            overlap_len += len(snippets[k]["text"]) + 1
            next_i = k
            if overlap_len >= overlap_size:
                break

        i = max(i + 1, next_i)

    return documents


def _safe_path_name(value: str, fallback: str) -> str:
    """Create a readable, filesystem-safe name without allowing path traversal."""
    cleaned = re.sub(r"[^\w\s.-]", "", value or "", flags=re.UNICODE)
    cleaned = re.sub(r"\s+", "-", cleaned.strip())
    return cleaned[:100].strip(".") or fallback


def get_faiss_index_path(
    video_id: str, folder_name: Optional[str] = None, video_title: Optional[str] = None
) -> str:
    """Return readable folder/video storage path while retaining the stable video ID."""
    folder = _safe_path_name(folder_name or "Uncategorized", "Uncategorized")
    title = _safe_path_name(video_title or f"Video-{video_id}", f"Video-{video_id}")
    return os.path.join(FAISS_INDEXES_DIR, folder, f"{title}__{video_id}")


def _is_index_path(path: str) -> bool:
    return os.path.isfile(os.path.join(path, "index.faiss")) and os.path.isfile(
        os.path.join(path, "index.pkl")
    )


def find_faiss_index_path(video_id: str) -> Optional[str]:
    """Find both new hierarchical indexes and legacy ID-only indexes."""
    legacy_path = os.path.join(FAISS_INDEXES_DIR, video_id)
    if _is_index_path(legacy_path):
        return legacy_path
    if not os.path.isdir(FAISS_INDEXES_DIR):
        return None
    suffix = f"__{video_id}"
    for root, _dirs, _files in os.walk(FAISS_INDEXES_DIR):
        if os.path.basename(root).endswith(suffix) and _is_index_path(root):
            return root
    return None


def migrate_faiss_index(
    video_id: str, folder_name: Optional[str], video_title: Optional[str]
) -> Optional[str]:
    """Move a legacy or differently named index into the readable hierarchy."""
    source = find_faiss_index_path(video_id)
    target = get_faiss_index_path(video_id, folder_name, video_title)
    if not source or os.path.abspath(source) == os.path.abspath(target):
        return source
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if not os.path.exists(target):
        shutil.move(source, target)
        return target
    return target


def save_faiss_index(
    vector_store: FAISS, video_id: str, folder_name: Optional[str] = None,
    video_title: Optional[str] = None,
) -> str:
    """Save FAISS index under faiss_indexes/FOLDER/VIDEO_TITLE__VIDEO_ID/."""
    index_path = get_faiss_index_path(video_id, folder_name, video_title)
    os.makedirs(index_path, exist_ok=True)
    vector_store.save_local(index_path)
    return index_path


def check_faiss_index_exists(video_id: str) -> bool:
    """Fast check if FAISS index files exist on disk without loading them into memory."""
    return find_faiss_index_path(video_id) is not None


# In-memory LRU-like cache for loaded FAISS instances to avoid re-reading disk on every single question
_LOADED_VECTOR_STORES: Dict[str, FAISS] = {}


def load_faiss_index(video_id: str) -> Optional[FAISS]:
    """Load existing local FAISS index for a given video ID if present (cached in memory)."""
    if video_id in _LOADED_VECTOR_STORES:
        return _LOADED_VECTOR_STORES[video_id]

    index_path = find_faiss_index_path(video_id)
    if index_path:
        embedding = load_embedding_model()
        store = FAISS.load_local(
            index_path,
            embedding,
            allow_dangerous_deserialization=True,
        )
        stored_name = os.path.basename(index_path)
        stored_title = stored_name.rsplit("__", 1)[0] if "__" in stored_name else None
        stored_folder = os.path.basename(os.path.dirname(index_path))
        for document in store.docstore._dict.values():
            document.metadata.setdefault("title", stored_title or f"YouTube Video ({video_id})")
            document.metadata.setdefault("folder_name", stored_folder)
        _LOADED_VECTOR_STORES[video_id] = store
        return store
    return None


def build_or_load_faiss_index(
    snippets: List[Dict[str, Any]], video_id: str, folder_name: Optional[str] = None,
    video_title: Optional[str] = None,
) -> FAISS:
    """Load existing FAISS index from disk or build and save a new index."""
    # 1. Try loading existing local FAISS index
    existing_store = load_faiss_index(video_id)
    if existing_store is not None:
        return existing_store

    # 2. Build new index if not already present
    if not snippets:
        raise ValueError("Cannot build FAISS index without transcript snippets.")

    chunks = create_documents_from_snippets(snippets, video_id, video_title, folder_name)
    if not chunks:
        raise ValueError("Failed to generate document chunks from transcript.")

    embedding = load_embedding_model()
    vector_store = FAISS.from_documents(chunks, embedding)

    # 3. Save newly created index for future instant reuse
    save_faiss_index(vector_store, video_id, folder_name, video_title)

    return vector_store


def format_docs_with_sources(retrieved_docs: List[Document]) -> str:
    """Format retrieved documents into a clean string context with timestamps for LLM prompt."""
    formatted_chunks = []
    for doc in retrieved_docs:
        start_sec = doc.metadata.get("start", 0.0)
        timestamp_str = format_timestamp(start_sec)
        title = doc.metadata.get("title", "Unknown video")
        video_id = doc.metadata.get("video_id", "")
        formatted_chunks.append(f"[{title} | {video_id} | {timestamp_str}]\n{doc.page_content}")
    return "\n\n".join(formatted_chunks)


def get_llm() -> ChatGoogleGenerativeAI:
    """Initialize Google Gemini LLM instance."""
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set. Please set it in your environment or secrets.")

    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        temperature=0.2,
    )


def create_retriever(vector_store: FAISS, k: int = 6):
    """Create similarity search retriever from vector store."""
    return vector_store.as_retriever(
        search_type="similarity", search_kwargs={"k": k}
    )


VectorStoreContext = Union[FAISS, List[Tuple[str, FAISS, str]]]


def retrieve_context(
    context: VectorStoreContext, query: str, k_per_video: int = 4, limit: int = 8
) -> Tuple[List[Document], List[str]]:
    """Retrieve and rank chunks from one or more existing FAISS stores.

    FAISS scores are distances (lower is more relevant), so candidates are sorted
    by ascending score. Missing stores are reported to the caller.
    """
    if isinstance(context, FAISS):
        return create_retriever(context, k=limit).invoke(query), []

    candidates: List[Tuple[float, Document]] = []
    missing: List[str] = []
    for video_id, store, _title in context:
        try:
            for document, score in store.similarity_search_with_score(query, k=k_per_video):
                document.metadata.setdefault("title", _title)
                candidates.append((float(score), document))
        except (AttributeError, ValueError, RuntimeError):
            missing.append(video_id)

    candidates.sort(key=lambda item: item[0])
    return [document for _score, document in candidates[:limit]], missing


def clean_and_truncate_excerpt(text: str, max_chars: int = 180) -> str:
    """Clean repeated whitespace/newlines and truncate excerpt cleanly to ~180 chars with '...' if needed."""
    # Normalize whitespace
    cleaned = re.sub(r"\s+", " ", text).strip()
    # Remove markdown headers or bullet markers if present
    cleaned = re.sub(r"^[#\*\-•\d\.\)\s]+", "", cleaned).strip()

    if len(cleaned) <= max_chars:
        return cleaned

    # Truncate at word boundary near max_chars
    truncated = cleaned[:max_chars]
    last_space = truncated.rfind(" ")
    if last_space > 100:
        truncated = truncated[:last_space]

    return truncated.rstrip(",.;:") + "..."


import time

def answer_question(
    vector_store: VectorStoreContext, question: str, history: Optional[List[Dict[str, str]]] = None
) -> Tuple[str, List[Dict[str, Any]], Dict[str, Any]]:
    """Run RAG chain with conversational memory and performance metrics (retrieval & inference latency)."""
    t_start = time.perf_counter()

    # 1. Single FAISS retrieval
    retrieved_docs, missing_video_ids = retrieve_context(vector_store, question)
    t_retrieved = time.perf_counter()

    # Format retrieved documents as string for LLM prompt context
    context_str = format_docs_with_sources(retrieved_docs)

    # Format conversational history if present
    history_str = ""
    if history:
        turns = []
        for msg in history[-4:]:  # last 2-4 turns
            role = "User" if msg.get("role") == "user" else "Assistant"
            turns.append(f"{role}: {msg.get('content', '')}")
        history_str = "\n".join(turns)

    # 2. Invoke Gemini LLM chain with retrieved context & history
    llm = get_llm()

    PROMPT_TEMPLATE = """\
You are a helpful AI assistant.

Answer ONLY using the provided transcript context.
If the answer is not available in the transcript, say:
"I could not find the answer in the transcript."

Do not use outside knowledge.
Do not invent information.

Transcript Context:
{context}

Recent Conversation History:
{history}

Current Question:
{question}

Answer:"""

    prompt = PromptTemplate(
        template=PROMPT_TEMPLATE,
        input_variables=["context", "history", "question"],
    )

    chain = prompt | llm | StrOutputParser()
    answer = chain.invoke({
        "context": context_str,
        "history": history_str if history_str else "None",
        "question": question
    })
    t_finished = time.perf_counter()

    # 3. Format top 3 structured sources for API response
    sources = []
    for doc in retrieved_docs[:3]:
        vid = doc.metadata.get("video_id", "")
        start_sec = float(doc.metadata.get("start", 0.0))
        short_excerpt = clean_and_truncate_excerpt(doc.page_content, max_chars=180)

        sources.append({
            "video_id": vid,
            "title": doc.metadata.get("title", f"YouTube Video ({vid})"),
            "timestamp": int(start_sec),
            "formatted_timestamp": format_timestamp(start_sec),
            "text": short_excerpt,
            "url": create_youtube_timestamp_url(vid, start_sec),
        })

    metrics = {
        "retrieval_ms": round((t_retrieved - t_start) * 1000, 1),
        "generation_ms": round((t_finished - t_retrieved) * 1000, 1),
        "total_ms": round((t_finished - t_start) * 1000, 1),
        "chunks_retrieved": len(retrieved_docs),
        "missing_video_ids": missing_video_ids,
    }

    return answer, sources, metrics


def summarize_video(vector_store: VectorStoreContext) -> str:
    """Generate a concise, transcript-grounded structured video summary."""
    retrieved_docs, _ = retrieve_context(
        vector_store, "Overview of main concepts, key points, and overall conclusion of this video",
        k_per_video=5, limit=10,
    )

    context = format_docs_with_sources(retrieved_docs)
    llm = get_llm()

    SUMMARY_PROMPT = """\
You are an expert content summarizer.

Generate a concise summary of the video strictly based on the provided transcript context. Do not invent information or use outside knowledge.

Format:

Overview:
(2-3 concise sentences overview)

Main Concepts:
• (3-5 concise bullet points)

Conclusion:
(1-2 sentences conclusion)

Context:
{context}

Summary:"""

    prompt = PromptTemplate(
        template=SUMMARY_PROMPT,
        input_variables=["context"],
    )

    chain = prompt | llm | StrOutputParser()
    return chain.invoke({"context": context})


def generate_key_takeaways(vector_store: VectorStoreContext) -> List[str]:
    """Generate 5–7 short, one-sentence transcript-grounded key takeaways."""
    retrieved_docs, _ = retrieve_context(
        vector_store, "Important key insights, takeaways, and lessons from the video",
        k_per_video=5, limit=10,
    )

    context = format_docs_with_sources(retrieved_docs)
    llm = get_llm()

    TAKEAWAYS_PROMPT = """\
You are an expert content analyzer.

Generate 5 to 7 concise key takeaways from the video context provided. Each takeaway must be short (ideally one sentence). Do not use outside knowledge.
Format each takeaway on a new line starting with '• '.

Context:
{context}

Key Takeaways:"""

    prompt = PromptTemplate(
        template=TAKEAWAYS_PROMPT,
        input_variables=["context"],
    )

    chain = prompt | llm | StrOutputParser()
    raw_takeaways = chain.invoke({"context": context})

    # Parse bullet points into a clean string array
    takeaways = []
    for line in raw_takeaways.split("\n"):
        line = line.strip()
        if line.startswith("•"):
            line = line.lstrip("•").strip()
        elif re.match(r"^\d+[\.\)]", line):
            line = re.sub(r"^\d+[\.\)]", "", line).strip()
        if line:
            takeaways.append(line)

    return takeaways[:7]


def generate_mindmap(vector_store: VectorStoreContext) -> str:
    """Generate a clean Mermaid.js diagram definition depicting concepts and subtopics."""
    retrieved_docs, _ = retrieve_context(
        vector_store, "Core topics, architecture, components, hierarchy, and workflow",
        k_per_video=5, limit=10,
    )
    context = format_docs_with_sources(retrieved_docs)
    llm = get_llm()

    MINDMAP_PROMPT = """\
You are an expert knowledge architect.
Create a clean, valid Mermaid.js flowchart (graph TD) that outlines the structure of the video topics and relationships.

Rules:
1. ONLY return the mermaid code block syntax. No explanations.
2. Format as:
```mermaid
graph TD
    Root[Main Video Theme] --> Node1[Core Concept 1]
    Root --> Node2[Core Concept 2]
    Node1 --> Sub1[Detail A]
    Node1 --> Sub2[Detail B]
    Node2 --> Sub3[Detail C]
```
3. Keep labels short (max 5-6 words per node), no special characters inside labels except simple words.

Context:
{context}
"""

    prompt = PromptTemplate(template=MINDMAP_PROMPT, input_variables=["context"])
    chain = prompt | llm | StrOutputParser()
    result = chain.invoke({"context": context}).strip()

    # Extract code between ```mermaid and ``` if present
    match = re.search(r"```(?:mermaid)?\s*([\s\S]*?)\s*```", result)
    if match:
        return match.group(1).strip()
    return result


def generate_quiz(vector_store: VectorStoreContext) -> List[Dict[str, Any]]:
    """Generate 3-4 interactive multiple choice questions based on the video transcript."""
    import json
    retrieved_docs, _ = retrieve_context(
        vector_store, "Key concepts, definitions, explanations, and core facts",
        k_per_video=5, limit=10,
    )
    context = format_docs_with_sources(retrieved_docs)
    llm = get_llm()

    QUIZ_PROMPT = """\
You are an expert educator.
Generate 3 to 4 multiple choice questions based STRICTLY on the video context.

Return ONLY a valid JSON list of objects without markdown formatting or commentary.
Schema:
[
  {{
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_index": 0,
    "explanation": "Short 1-sentence explanation of why it is correct based on the video."
  }}
]

Context:
{context}
"""

    prompt = PromptTemplate(template=QUIZ_PROMPT, input_variables=["context"])
    chain = prompt | llm | StrOutputParser()
    raw = chain.invoke({"context": context}).strip()

    # Strip markdown code fencing if model wrapped it
    raw_cleaned = re.sub(r"^```(?:json)?\s*", "", raw)
    raw_cleaned = re.sub(r"\s*```$", "", raw_cleaned)

    try:
        data = json.loads(raw_cleaned)
        if isinstance(data, list):
            return data
    except Exception:
        pass

    return [
        {
            "question": "What is the primary topic of this video?",
            "options": ["General Discussion", "Software Architecture", "Deep Learning", "Technology Overview"],
            "correct_index": 0,
            "explanation": "Generated from video context."
        }
    ]
