
import streamlit as st
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import PromptTemplate
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.runnables import RunnableParallel, RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.runnables import RunnableParallel, RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
import os

# Handle API keys for both local and Streamlit Cloud
try:
    if "GOOGLE_API_KEY" in st.secrets:
        os.environ["GOOGLE_API_KEY"] = st.secrets["GOOGLE_API_KEY"]
    else:
        load_dotenv()
except:
    # If secrets.toml doesn't exist, just load from .env file
    load_dotenv()

# Streamlit page config
st.set_page_config(page_title="YouTube RAG", page_icon="🎥")

# Main heading
st.title("🎥 YouTube RAG Chat")

# Input boxes
video_id = st.text_input("Enter YouTube Video ID:", placeholder="e.g., Gfr50f6ZBvo")
question = st.text_input("Enter your question:", placeholder="e.g., Can you summarize the video?")

# Button
if st.button("Get Answer"):
    if video_id and question:
        try:
            with st.spinner("Processing..."):
                # Step 1: Document Ingestion - exactly from your notebook
                try:
                    # If you don't care which language, this returns the "best" one
                    ytt_api = YouTubeTranscriptApi()
                    transcript_list = ytt_api.fetch(video_id, languages=["en"])

                    # Flatten it to plain text
                    transcript = " ".join(chunk.text for chunk in transcript_list)
                except TranscriptsDisabled:
                    st.error("No captions available for this video.")
                    st.stop()

                # Step 2: Text Splitting - exactly from your notebook
                splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
                chunks = splitter.create_documents([transcript])

                # Step 3: Embedding Generation and Vector Store - exactly from your notebook
                embedding = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
                vector_store = FAISS.from_documents(chunks, embedding)

                # Step 4: Retrieval - exactly from your notebook
                retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 4})

                # Step 5: LLM and Prompt Setup - exactly from your notebook
                llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.2)
                prompt = PromptTemplate(
                    template="""
                      You are a helpful assistant.
                      Answer ONLY from the provided transcript context.
                      If the context is insufficient, just say you don't know.

                      {context}
                      Question: {question}
                    """,
                    input_variables = ['context', 'question']
                )

                # Step 6: Chain Building - exactly from your notebook
                def format_docs(retrieved_docs):
                    context_text = "\n\n".join(doc.page_content for doc in retrieved_docs)
                    return context_text

                parallel_chain = RunnableParallel({
                    'context': retriever | RunnableLambda(format_docs),
                    'question': RunnablePassthrough()
                })

                parser = StrOutputParser()
                main_chain = parallel_chain | prompt | llm | parser

                # Step 7: Generation - exactly from your notebook
                answer = main_chain.invoke(question)

            # Display answer
            st.success("Answer:")
            st.write(answer)

        except Exception as e:
            if "API key" in str(e).lower():
                st.error("❌ Google API key error. Please check your API key configuration.")
            elif "quota" in str(e).lower():
                st.error("❌ API quota exceeded. Please try again later.")
            else:
                st.error(f"❌ Error: {str(e)}")
    else:
        st.warning("Please enter both video ID and question.")
