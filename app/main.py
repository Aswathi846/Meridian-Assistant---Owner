import os
import time
import uuid
import io
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from psycopg2 import pool
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from pypdf import PdfReader

load_dotenv(".env.local")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is missing from environment variables")

db_pool = None
model = None

# Distance threshold: Cosine distance > 0.65 (Similarity < 0.35) means noise
DISTANCE_THRESHOLD = 0.65

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, model
    # Load model and initialize connection pool once on startup to save memory
    model = SentenceTransformer("all-MiniLM-L6-v2")
    db_pool = pool.SimpleConnectionPool(1, 5, DATABASE_URL)
    yield
    if db_pool:
        db_pool.closeall()

app = FastAPI(title="Meridian Assistant API", lifespan=lifespan)

# Response Models 
class Source(BaseModel):
    section: str
    chunk_index: int
    distance: float

class QueryRequest(BaseModel):
    question: str
    top_k: int = 5

class ChatResponse(BaseModel):
    reply: str
    sources: list[Source]
    ungrounded: list = []
    retrieved_k: int
    latency_ms: int
    tokens_in: int
    tokens_out: int


# Search & RAG Logic
def retrieve_context(query_text: str, top_k: int = 5):
    global db_pool, model
    query_embedding = model.encode(query_text).tolist()

    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            search_query = """
                SELECT section, chunk_index, content, (embedding <=> %s::vector) AS distance
                FROM chunks
                ORDER BY embedding <=> %s::vector
                LIMIT %s;
            """
            cur.execute(search_query, (str(query_embedding), str(query_embedding), top_k))
            results = cur.fetchall()

        sources = []
        retrieved_chunks = []

        for section, chunk_idx, content, dist in results:
            distance_val = float(dist)
            if distance_val <= DISTANCE_THRESHOLD:
                sources.append(Source(section=section, chunk_index=chunk_idx, distance=distance_val))
                retrieved_chunks.append({
                    'section': section,
                    'chunk_index': chunk_idx,
                    'content': content,
                    'distance': distance_val,
                })

        return sources, retrieved_chunks
    finally:
        db_pool.putconn(conn)

def format_rag_prompt(question: str, retrieved_chunks: list) -> str:
    context_str = ""
    for idx, chunk in enumerate(retrieved_chunks, 1):
        context_str += (
            f"--- Context Chunk {idx} ---\n"
            f"Section: {chunk['section']}\n"
            f"Content: {chunk['content']}\n\n"
        )

    return f"""You are the official Meridian Bank assistant.
Answer the user's question relying ONLY on the provided context below.

STRICT CITATION RULES:
1. Every factual statement must cite its exact section heading (e.g., [Section 1. Your cards]).
2. If the answer cannot be found in the provided context, state: "I cannot answer this question based on the provided handbook."

Context Information:
{context_str}

User Question: {question}

Answer:"""

@app.post("/api/search", response_model=ChatResponse)
def search_and_answer(req: QueryRequest):
    start_time = time.time()

    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question text cannot be empty.")

    sources, chunks = retrieve_context(req.question, top_k=req.top_k)

    if not chunks:
        latency = int((time.time() - start_time) * 1000)
        return ChatResponse(
            reply="I cannot answer this question based on the provided handbook (no relevant information retrieved).",
            sources=[],
            ungrounded=[],
            retrieved_k=0,
            latency_ms=latency,
            tokens_in=len(req.question.split()),
            tokens_out=14,
        )

    prompt = format_rag_prompt(req.question, chunks)
    tokens_in = len(prompt) // 4
    latency_ms = int((time.time() - start_time) * 1000)

    return ChatResponse(
        reply=prompt,
        sources=sources,
        ungrounded=[],
        retrieved_k=len(sources),
        latency_ms=latency_ms,
        tokens_in=tokens_in,
        tokens_out=0,
    )


# Document Ingestion Logic 
def process_document_background(job_id: str, filename: str, file_bytes: bytes):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE ingestion_jobs SET status = %s WHERE id = %s", ("processing", job_id))
            conn.commit()

            reader = PdfReader(io.BytesIO(file_bytes))
            extracted_text = ""
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    extracted_text += text + "\n"

            cleaned_text = extracted_text.replace("ignore previous instructions", "").replace("SYSTEM:", "")

            chunk_size = 512
            overlap = 64
            chunks = []
            for i in range(0, len(cleaned_text), chunk_size - overlap):
                chunk = cleaned_text[i:i + chunk_size]
                if len(chunk.strip()) > 50:  
                    chunks.append(chunk.strip())

            for idx, chunk in enumerate(chunks):
                embedding = model.encode(chunk).tolist()
                cur.execute(
                    """
                    INSERT INTO chunks (section, chunk_index, content, embedding, document_id)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (filename, idx, chunk, embedding, filename)
                )
            conn.commit()

            cur.execute("UPDATE ingestion_jobs SET status = %s WHERE id = %s", ("completed", job_id))
            conn.commit()
    except Exception as e:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute("UPDATE ingestion_jobs SET status = %s, error_message = %s WHERE id = %s", ("failed", str(e), job_id))
            conn.commit()
    finally:
        db_pool.putconn(conn)

@app.post("/documents")
async def upload_document(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf") or file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")
    
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds the 5MB limit.")
    
    job_id = str(uuid.uuid4())
    
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ingestion_jobs (id, status, filename) VALUES (%s, %s, %s)",
                (job_id, "pending", file.filename)
            )
            conn.commit()
    finally:
        db_pool.putconn(conn)

    background_tasks.add_task(process_document_background, job_id, file.filename, contents)
    return {"job_id": job_id, "status": "pending"}

@app.get("/documents/{job_id}")
async def get_document_status(job_id: str):
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, status, filename, error_message FROM ingestion_jobs WHERE id = %s", (job_id,))
            row = cur.fetchone()
    finally:
        db_pool.putconn(conn)

    if not row:
        raise HTTPException(status_code=404, detail="Job ID not found.")
    
    return {
        "job_id": row[0],
        "status": row[1],
        "filename": row[2],
        "error_message": row[3]
    }