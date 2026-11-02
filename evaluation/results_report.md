# Video-Mind AI: System Performance & Retrieval Evaluation Report

This report details the empirical performance, retrieval accuracy, and system resource profile of the **Video-Mind AI** RAG pipeline across Academic, Technical, and Conversational video workloads.

## 1. Computational Performance & Resource Profile

- **MiniLM Model Initialization Time:** `825.37 ms` (Loads `all-MiniLM-L6-v2` neural weights into memory on CPU)

| Video Category | Video ID / Title | Chunks | FAISS Index Load Time | Summary Context Retrieval Time | Process Memory (RSS) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Academic** | `a2L8ra2TOMg` (HTML Tutorial - What is HTML (Ed...) | 20 | 262.37 ms | 79.0 ms | 645.7 MB |
| **Technical** | `iX8g4LqF8p8` (7 Authentication Concepts Every ...) | 20 | 4.46 ms | 11.56 ms | 691.6 MB |
| **Conversational** | `Gfr50f6ZBvo` (Demis Hassabis: DeepMind & AI Su...) | 141 | 4.49 ms | 10.91 ms | 693.13 MB |

> **Notes:** Index loading time measures deserializing the persistent FAISS index and docstore from disk into memory. Process memory measures total Resident Set Size (RSS) via `psutil`.

## 2. End-to-End Processing & Latency Breakdown

| Stage / Operation | Component / Function | Measured Latency | Description |
| :--- | :--- | :--- | :--- |
| **1. Embedding Model Loading** | `SentenceTransformer` | **825.37 ms** | One-time cold initialization of PyTorch/MiniLM weights |
| **2. FAISS Index Loading** | `load_chunks_and_faiss()` | **5.30 – 8.22 ms** (warm) | Deserialization of index.faiss + index.pkl from local storage |
| **3. Q&A Context Retrieval** | `semantic_retrieval()` / `retrieve_context()` | **16.0683 ms** | Dense query embedding + FAISS L2 similarity search (K=5) |
| **4. Summary Context Retrieval**| `retrieve_context()` | **16.34 – 22.32 ms** | Multi-topic query embedding + top-10 chunk vector search |
| **5. Q&A Generation** | `answer_question()` (`chain.invoke()`) | **~800 – 1,200 ms** | Gemini 2.5 Flash token generation under prompt guardrails |
| **6. Summary Generation** | `summarize_video()` (`chain.invoke()`) | **~1,200 – 2,500 ms** | Gemini 2.5 Flash synthesis of Overview, Main Concepts & Conclusion |
| **7. Total Q&A Processing Time** | `total_ms = retrieval_ms + generation_ms` | **~820 – 1,230 ms** | Measured end-to-end response time returned to user UI |
| **8. Total Summary Processing Time** | `total_ms = retrieval_ms + generation_ms` | **~1,220 – 2,525 ms** | Measured end-to-end summary time returned by `/api/summarize` |

## 3. Retrieval Accuracy & Latency (MiniLM + FAISS, K=5)

| Evaluation Metric | Measured Value | Scope / Description |
| :--- | :--- | :--- |
| **Overall Precision@5** | **16.67%** | Proportion of retrieved chunks that are relevant (Denominator = 5) |
| **Overall Recall@5** | **45.83%** | Proportion of all relevant chunks successfully retrieved |
| **Exact-Keyword Precision@5** | 16.67% | Precision on questions containing literal transcript terms |
| **Paraphrased Precision@5** | 16.67% | Precision on questions expressed with natural language synonyms |
| **Mean Retrieval Latency** | **16.0683 ms** | Total latency including MiniLM query embedding + FAISS L2 search |
| **Retrieved Context Containment** | **53.25%** | Lexical overlap of reference answer concepts in retrieved context |

## 4. Retrieval Precision by Video Category

| Workload Category | Chunks in Video | Measured Precision@5 |
| :--- | :--- | :--- |
| **Academic** | 20 | **20.00%** |
| **Technical** | 20 | **30.00%** |
| **Conversational** | 141 | **0.00%** |

## 5. Qualitative Human Evaluation Rubric

The evaluation setup maintains a standardized 1-to-5 human scoring rubric in `evaluation/human_eval_template.json` to score:
- **Paragraph Summary Quality**
- **Key Points Quality**
- **Definitions Quality**
- **Chapters & Mindmap Quality**
- **Q&A Accuracy**
