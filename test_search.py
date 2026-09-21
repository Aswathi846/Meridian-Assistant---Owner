import os
import psycopg2
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

load_dotenv('.env.local')

# 1. Load local 384-dim model
model = SentenceTransformer('all-MiniLM-L6-v2')

# 2. Query embedding
query = 'How do I report a lost or stolen card?'
query_embedding = model.encode(query).tolist()

# 3. Search Neon pgvector
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()

search_sql = """
    SELECT section, content, 1 - (embedding <=> %s::vector) AS similarity
    FROM chunks
    ORDER BY embedding <=> %s::vector
    LIMIT 3;
"""
cur.execute(search_sql, (str(query_embedding), str(query_embedding)))
results = cur.fetchall()

print(f"QUERY: {query}\n" + "-" * 50)
for section, content, score in results:
  print(f"[{section}] (Similarity: {score:.4f})\n{content}\n")

cur.close()
conn.close()