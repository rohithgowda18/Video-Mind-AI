import os
import streamlit as st
from dotenv import load_dotenv

from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import (
    RunnableParallel,
    RunnablePassthrough,
    RunnableLambda,
)
from langchain_core.output_parsers import StrOutputParser

# ============================================
# LOAD API KEY
# ============================================

load_dotenv()

if "GOOGLE_API_KEY" in st.secrets:
    os.environ["GOOGLE_API_KEY"] = st.secrets["GOOGLE_API_KEY"]

# ============================================
# STREAMLIT CONFIG
# ============================================

st.set_page_config(page_title="Video-Mind AI", page_icon="🎥")

st.title("🎥 Video-Mind AI")

# ============================================
# INPUTS
# ============================================

video_id = st.text_input(
    "Enter YouTube Video ID", placeholder="e.g. Gfr50f6ZBvo"
)
question = st.text_input(
    "Ask a question", placeholder="e.g. What is DeepMind?"
)


# ============================================
# CACHE EMBEDDING MODEL
# ============================================

@st.cache_resource
def load_embedding_model():
    return HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )


def format_docs(retrieved_docs):
    return "\n\n".join(doc.page_content for doc in retrieved_docs)


# ============================================
# BUTTON & RAG PIPELINE
# ============================================

if st.button("Get Answer"):
    if not video_id or not question:
        st.warning("Please enter both Video ID and Question.")
        st.stop()

    try:
        with st.spinner("Processing..."):
            # ============================================
            # FETCH TRANSCRIPT
            # ============================================
            try:
                ytt_api = YouTubeTranscriptApi()
                transcript_list = ytt_api.fetch(video_id, languages=["en"])
                transcript = " ".join(
                    chunk.text.strip()
                    for chunk in transcript_list
                    if chunk.text.strip()
                )
            except TranscriptsDisabled:
                st.error("No captions available for this video.")
                st.stop()

            # ============================================
            # TEXT SPLITTING
            # ============================================
            splitter = RecursiveCharacterTextSplitter(
                chunk_size=1000, chunk_overlap=200
            )
            chunks = splitter.create_documents([transcript])

            # ============================================
            # EMBEDDINGS + VECTOR STORE
            # ============================================
            embedding = load_embedding_model()
            vector_store = FAISS.from_documents(chunks, embedding)

            # ============================================
            # RETRIEVER
            # ============================================
            retriever = vector_store.as_retriever(
                search_type="similarity", search_kwargs={"k": 4}
            )

            # ============================================
            # LLM
            # ============================================
            llm = ChatGoogleGenerativeAI(
                model="gemini-2.5-flash", temperature=0.2
            )

            # ============================================
            # PROMPT TEMPLATE
            # ============================================
            PROMPT_TEMPLATE = """\
You are a helpful AI assistant.

Answer ONLY using the provided transcript context.
If the answer is not available in the transcript, say:
"I could not find the answer in the transcript."

Context:
{context}

Question:
{question}

Answer:"""

            prompt = PromptTemplate(
                template=PROMPT_TEMPLATE,
                input_variables=["context", "question"],
            )

            # ============================================
            # LCEL CHAIN PIPELINE
            # ============================================
            parallel_chain = RunnableParallel(
                context=retriever | RunnableLambda(format_docs),
                question=RunnablePassthrough(),
            )

            parser = StrOutputParser()
            main_chain = parallel_chain | prompt | llm | parser

            # ============================================
            # GENERATE & DISPLAY ANSWER
            # ============================================
            answer = main_chain.invoke(question)

            st.success("Answer")
            st.write(answer)

    except Exception as e:
        st.error(f"Error: {str(e)}")