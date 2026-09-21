import os
import re
import psycopg2
import pypdf
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

# Load database credentials from .env.local
load_dotenv('.env.local')

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is missing from .env.local")

# Load local 384-dimensional CPU embedding model (Option D requirement)
print("Loading embedding model (all-MiniLM-L6-v2)...")
model = SentenceTransformer('all-MiniLM-L6-v2')


def extract_and_clean_pdf(pdf_path: str) -> str:
    """Extracts raw text from the PDF and strips header/footer noise identified in diff_check."""
    reader = pypdf.PdfReader(pdf_path)
    raw_text = ""
    for page in reader.pages:
        raw_text += (page.extract_text() or "") + "\n"

    # 1. Strip running headers and footers
    text = re.sub(
        r'Meridian Bank plc\s*\n\s*Customer Information Handbook.*?\n',
        '',
        raw_text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r'Valid from 1 March 2026\. Supersedes Edition 3\.\n',
        '',
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r'Page \d+.*?\n', '', text, flags=re.IGNORECASE)

    # 2. Clean whitespace and non-breaking space artifacts (\xa0)
    text = text.replace('\xa0', ' ')
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


def chunk_by_sections(text: str, chunk_size=512, overlap=64):
    """Splits text into chunks attached to their exact handbook section heading."""
    # Split on numbered section headings (e.g., "1. Your cards", "2. Payments and transfers")
    section_pattern = r'(\n(?=[0-9]+\.\s+[A-Za-z\s]+))'
    segments = re.split(section_pattern, text)

    chunks = []
    current_section = "General Information"

    for seg in segments:
        seg_strip = seg.strip()
        if not seg_strip:
            continue

        # Detect section header
        match = re.match(r'^([0-9]+\.\s+[^\n]+)', seg_strip)
        if match:
            current_section = match.group(1).strip()

        # Sliding window chunking within section
        for i in range(0, len(seg_strip), chunk_size - overlap):
            chunk_content = seg_strip[i : i + chunk_size].strip()
            if len(chunk_content) > 30:  # Skip tiny residual fragments
                chunks.append((current_section, chunk_content))

    return chunks


def run_ingestion():
    pdf_path = "corpus/meridian-handbook.pdf"
    if not os.path.exists(pdf_path):
        print(f"Error: Could not find {pdf_path}. Ensure it exists in corpus/")
        return

    print("Extracting and cleaning PDF content...")
    cleaned_text = extract_and_clean_pdf(pdf_path)

    print("Chunking document by handbook sections...")
    chunks = chunk_by_sections(cleaned_text, chunk_size=512, overlap=64)
    print(f"Total chunks created: {len(chunks)}")

    print("Connecting to Neon Postgres...")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Create pgvector extension & table if missing
    cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
            id BIGSERIAL PRIMARY KEY,
            section TEXT NOT NULL,
            chunk_index INT NOT NULL,
            content TEXT NOT NULL,
            embedding VECTOR(384) NOT NULL,
            UNIQUE (section, chunk_index)
        );
    """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS chunks_embedding_idx
        ON chunks USING hnsw (embedding vector_cosine_ops);
    """
    )

    # Ensure idempotency: clear existing index before re-ingesting
    cur.execute("TRUNCATE TABLE chunks;")

    print("Generating embeddings and writing chunks to pgvector...")
    for idx, (section, content) in enumerate(chunks):
        embedding = model.encode(content).tolist()
        cur.execute(
            """
            INSERT INTO chunks (section, chunk_index, content, embedding)
            VALUES (%s, %s, %s, %s::vector)
            ON CONFLICT (section, chunk_index) DO UPDATE
            SET content = EXCLUDED.content, embedding = EXCLUDED.embedding;
            """,
            (section, idx, content, str(embedding)),
        )

    conn.commit()
    cur.close()
    conn.close()
    print("Successfully ingested meridian-handbook.pdf into Neon!")


if __name__ == "__main__":
    run_ingestion()