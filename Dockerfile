FROM python:3.11-slim

WORKDIR /app

# Install system dependencies if needed
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy other python files or app directories if your code imports them
COPY ingest.py diff_check.py ./ 

EXPOSE 7860

COPY app/ ./app/
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}