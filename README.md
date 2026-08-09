# 🎥 Video-Mind AI

> **Ask questions about any YouTube video, view video summaries, and extract key takeaways with grounded AI answers and timestamped citations.**

[![React](https://img.shields.io/badge/Frontend-React_19-blue.svg)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-emerald.svg)](https://fastapi.tiangolo.com/)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)

---

## 🚀 Features

- **Flexible YouTube Input**: Supports raw Video IDs (`Gfr50f6ZBvo`), standard URLs (`https://www.youtube.com/watch?v=Gfr50f6ZBvo`), and short links (`https://youtu.be/Gfr50f6ZBvo`).
- **Persistent FAISS Storage**: Automatically saves FAISS index files (`index.faiss`, `index.pkl`) to local `faiss_indexes/VIDEO_ID/`. Re-loads instantly on subsequent questions without re-downloading transcripts or re-generating embeddings.
- **Timestamp Citations**: Preserves transcript start times and generates clickable source links (`https://www.youtube.com/watch?v=VIDEO_ID&t=SECONDS`) for direct playback.
- **Grounded AI Q&A**: Uses Google Gemini (`gemini-2.5-flash`) constrained strictly to transcript context with LangChain LCEL.
- **Video Summarization**: One-click structured summaries covering Overview, Main Concepts, Important Points, and Conclusion.
- **Key Takeaways**: Extracts 5–10 concise, grounded takeaways as bullet points.
- **Modern UI & REST API**: React frontend connected to FastAPI endpoints with CORS middleware and zero stack traces exposed to users.

---

## 📁 Project Structure

```text
Video_Mind_AI/
│
├── backend/
│   ├── main.py             # FastAPI app with CORS & REST endpoints
│   ├── rag_pipeline.py     # FAISS vector store, LCEL chains (Q&A, Summary, Takeaways)
│   ├── youtube_utils.py    # URL parsing, timestamp formatters & transcript fetcher
│   ├── .env                # Gemini API key (GOOGLE_API_KEY)
│   └── __init__.py
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   │   └── api.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── faiss_indexes/
│   └── .gitkeep            # Persistent FAISS store (ignored in git)
│
├── README.md               # Documentation
├── requirements.txt        # Dependencies (FastAPI, Uvicorn, LangChain, FAISS, Gemini)
└── .gitignore              # Git ignore rules
```

---

## 🔧 Architecture & Workflow

```mermaid
graph TD
    A[React Frontend (port 5173)] -->|POST /api/video/load| B[FastAPI Backend (port 8000)]
    B -->|youtube_utils.extract_video_id| C[11-char Video ID]
    C -->|Check Disk| D{FAISS Index Exists in faiss_indexes/VIDEO_ID?}
    
    D -->|Yes| E[Load FAISS Index from Disk]
    D -->|No| F[Fetch Transcript Snippets + Timestamps]
    F --> G[RecursiveCharacterTextSplitter Chunks]
    G --> H[HuggingFace Embeddings]
    H --> I[Build & Save FAISS Index]
    
    E --> J[Retriever + Gemini 2.5 Flash]
    I --> J

    A -->|POST /api/ask| J --> K[Answer + Timestamp Citations JSON]
    A -->|POST /api/summarize| J --> L[Structured Summary JSON]
    A -->|POST /api/key-takeaways| J --> M[Key Takeaways JSON]
```

---

## 📦 Quick Start & How to Run

### 1. Backend Setup (FastAPI)

```bash
# Navigate to backend directory
cd backend

# Create virtual environment and install dependencies
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

pip install -r ../requirements.txt

# Set your Gemini API Key in .env
# GOOGLE_API_KEY="your_gemini_api_key"

# Run FastAPI Server
python -m uvicorn main:app --reload
```

The FastAPI backend will start on **`http://localhost:8000`**.

### 2. Frontend Setup (React)

```bash
# Open a new terminal and navigate to frontend directory
cd frontend

# Install Node dependencies
npm install

# Run Vite dev server
npm run dev
```

The React frontend will start on **`http://localhost:5173`**.

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | React 19 + TypeScript + Vite + TailwindCSS |
| **Backend API** | FastAPI + Uvicorn |
| **LLM** | Google Gemini (`gemini-2.5-flash`) |
| **Embeddings** | HuggingFace (`sentence-transformers/all-MiniLM-L6-v2`) |
| **Vector Store** | FAISS (`faiss-cpu`) |
| **Framework** | LangChain & LCEL |

---

## 👨‍💻 Author

**Rohith Gowda K**
- GitHub: [@rohithgowda18](https://github.com/rohithgowda18)
- Email: rohithgowdak18@gmail.com




