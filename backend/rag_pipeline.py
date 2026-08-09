import os
import re
from functools import lru_cache
from typing import List, Dict, Any, Tuple

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
    snippets: List[Dict[str, Any]], video_id: str
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


def get_faiss_index_path(video_id: str) -> str:
    """Get the local directory path for storing/loading a video's FAISS index."""
    return os.path.join(FAISS_INDEXES_DIR, video_id)


def save_faiss_index(vector_store: FAISS, video_id: str) -> str:
    """Save FAISS index locally to faiss_indexes/VIDEO_ID/."""
    index_path = get_faiss_index_path(video_id)
    os.makedirs(index_path, exist_ok=True)
    vector_store.save_local(index_path)
    return index_path


def load_faiss_index(video_id: str) -> FAISS:
    """Load existing local FAISS index for a given video ID if present."""
    index_path = get_faiss_index_path(video_id)
    if os.path.exists(index_path) and os.path.isdir(index_path):
        index_file = os.path.join(index_path, "index.faiss")
        if os.path.exists(index_file):
            embedding = load_embedding_model()
            return FAISS.load_local(
                index_path,
                embedding,
                allow_dangerous_deserialization=True,
            )
    return None


def build_or_load_faiss_index(
    snippets: List[Dict[str, Any]], video_id: str
) -> FAISS:
    """Load existing FAISS index from disk or build and save a new index."""
    # 1. Try loading existing local FAISS index
    existing_store = load_faiss_index(video_id)
    if existing_store is not None:
        return existing_store

    # 2. Build new index if not already present
    if not snippets:
        raise ValueError("Cannot build FAISS index without transcript snippets.")

    chunks = create_documents_from_snippets(snippets, video_id)
    if not chunks:
        raise ValueError("Failed to generate document chunks from transcript.")

    embedding = load_embedding_model()
    vector_store = FAISS.from_documents(chunks, embedding)

    # 3. Save newly created index for future instant reuse
    save_faiss_index(vector_store, video_id)

    return vector_store


def format_docs_with_sources(retrieved_docs: List[Document]) -> str:
    """Format retrieved documents into a clean string context with timestamps for LLM prompt."""
    formatted_chunks = []
    for doc in retrieved_docs:
        start_sec = doc.metadata.get("start", 0.0)
        timestamp_str = format_timestamp(start_sec)
        formatted_chunks.append(f"[{timestamp_str}]\n{doc.page_content}")
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


def answer_question(
    vector_store: FAISS, question: str
) -> Tuple[str, List[Dict[str, Any]]]:
    """Run RAG chain to generate answer and return top 3 structured sources using single FAISS retrieval."""
    # 1. Single FAISS retrieval for both Gemini context and sources
    retriever = create_retriever(vector_store, k=6)
    retrieved_docs = retriever.invoke(question)

    # Format retrieved documents as string for LLM prompt context
    context_str = format_docs_with_sources(retrieved_docs)

    # 2. Invoke Gemini LLM chain with retrieved context
    llm = get_llm()

    PROMPT_TEMPLATE = """\
You are a helpful AI assistant.

Answer ONLY using the provided transcript context.

If the answer is not available in the transcript, say:
"I could not find the answer in the transcript."

Do not use outside knowledge.
Do not invent information.

Context:
{context}

Question:
{question}

Answer:"""

    prompt = PromptTemplate(
        template=PROMPT_TEMPLATE,
        input_variables=["context", "question"],
    )

    chain = prompt | llm | StrOutputParser()
    answer = chain.invoke({"context": context_str, "question": question})

    # 3. Format top 3 structured sources for API response
    sources = []
    for doc in retrieved_docs[:3]:
        vid = doc.metadata.get("video_id", "")
        start_sec = float(doc.metadata.get("start", 0.0))
        short_excerpt = clean_and_truncate_excerpt(doc.page_content, max_chars=180)

        sources.append({
            "timestamp": int(start_sec),
            "formatted_timestamp": format_timestamp(start_sec),
            "text": short_excerpt,
            "url": create_youtube_timestamp_url(vid, start_sec),
        })

    return answer, sources


def summarize_video(vector_store: FAISS) -> str:
    """Generate a concise, transcript-grounded structured video summary."""
    retriever = create_retriever(vector_store, k=10)
    retrieved_docs = retriever.invoke("Overview of main concepts, key points, and overall conclusion of this video")

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


def generate_key_takeaways(vector_store: FAISS) -> List[str]:
    """Generate 5–7 short, one-sentence transcript-grounded key takeaways."""
    retriever = create_retriever(vector_store, k=10)
    retrieved_docs = retriever.invoke("Important key insights, takeaways, and lessons from the video")

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
