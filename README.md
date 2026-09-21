# Meridian RAG Assistant & Evaluation Gate (`rag-eval-gate`)

An enterprise-grade Retrieval-Augmented Generation (RAG) assistant featuring automated evaluation pipelines, strict CI/CD quality gates, and production operational runbooks.

---

## 1. Project Overview & Architecture
This repository implements a modular RAG pipeline designed to ingest structured documents, run vector similarity searches via ChromaDB/pgvector, and evaluate responses against strict grounding and correctness criteria.

* **Backend**: FastAPI, LangChain, Sentence-Transformers
* **Vector Store**: ChromaDB / PostgreSQL (pgvector)
* **Evaluation Framework**: Custom offline subset benchmarking & Ragas-style metrics
* **CI/CD Quality Gate**: GitHub Actions automated validation

---

## 2. Repository Structure
```text
meridian-assistant/
├── .github/
│   └── workflows/
│       └── eval.yml             # Automated CI/CD evaluation gate workflow
├── app/                         # Next.js frontend & API routes
│   ├── api/
│   ├── data/
│   ├── globals.css
│   ├── layout.tsx
│   ├── main.py                  # FastAPI application backend
│   └── page.tsx
├── corpus/                      # Source documents and corpus files
├── lib/                         # Shared utilities and helper modules
├── reference/
│   └── meridian-handbook-reference.md
├── scripts/
│   └── ingest.ts                # Document ingestion and preprocessing script
├── tests/                       # Automated test suite (Vitest)
│   ├── db.test.ts
│   ├── groq.test.ts
│   ├── prompt.test.ts
│   └── questions.ts
├── venv/                        # Local Python virtual environment
├── .env.local                   # Local environment variables
├── .gitignore
├── app.py                       # Application entry point
├── diff_check.py                # PDF extraction diff verification script
├── eval.py                      # Evaluation engine and test suite runner
├── fix_reference.py             # Reference parsing helper script
├── golden_set.json              # 59-case evaluation golden set
├── ingest.py                    # Python ingestion and chunking pipeline
├── next.config.ts
├── package.json
├── README.md                    # Project documentation, operations, and runbook
├── requirements.txt             # Python dependencies
├── run_baseline.py              # Option C baseline evaluation script
├── test_search.py               # Vector search testing utility
└── thresholds.yaml              # Configured quality gates with metric justifications
```
---

## 3. Getting Started & Local Setup

**A. Clone the repository:**

``` bash
git clone [https://github.com/Aswathi846/rag-eval-gate.git](https://github.com/Aswathi846/rag-eval-gate.git)
cd rag-eval-gate
```

**B. Create and activate a virtual environment:**

``` bash
python -m venv venv
# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1
```
Install dependencies:
```bash
pip install -r requirements.txt
```
**C. Run the local evaluation suite:**

``` bash
python eval.py --offline --fail-under-config thresholds.yaml
```
---

## 4. Part 6: The CI/CD Evaluation Gate
The evaluation pipeline is split into a fast offline subset that runs on every push and pull request. Quality thresholds are defined in thresholds.yaml to block merges if accuracy, recall, or groundedness regress.

* **Red Action**: Triggered when a metric breaches the configured threshold, causing a non-zero exit code (exit 1) and failing the workflow.
* **Green Action**: Confirmed passing when all evaluation scores clear the thresholds.yaml baseline.

---

## 5. Part 7: Operate It — Operations & Production Runbook
#### A. Performance, Cost, & Load Test Report
Evaluated via 50 sequential upload requests sent to the FastAPI backend (`POST /documents`):
* **p50 Latency (Median):** 200.05 ms (Typical end-to-end response time for document ingestion processing).
* **p95 Latency (Tail):** 246.30 ms (Tail latency under heavier payload conditions).
* **Error Rate:** 0% (Verified stable API connectivity and handling across all 50 requests).

#### B. Cost Calculation (List Prices):
* Based on Groq high-speed model pricing ( ≈ $0.05 / M input tokens, ≈ $0.08 / M output tokens).
* Assuming 500 input tokens and 150 output tokens per request across 50 requests (25,000 input tokens, 7,500 output tokens).
* Total Estimated Cost: $0.0018 (less than a fraction of a cent).

#### C. Cold Start Penalty

* **Cold Start Latency (First request after 1+ hour idle)**: 3,200 ms (Accounts for container spin-up overhead, connection pool initialization, and memory allocation).
* **Warm Latency (Subsequent requests)**: 450 ms
* **Penalty Delta**: ≈ 2,750 ms overhead on initial cold invocations.

#### D. Production Monitoring Signals & Alert Thresholds
* **p95 Request Latency**: Alert if p95 response time exceeds 3,000 ms over a rolling 5-minute window (indicates search bottlenecks or throttling).
* **Error Rate (HTTP 5xx / Timeouts)**: Alert if HTTP 5xx errors or gateway timeouts exceed 2% of total traffic over a 10-minute window.
* **Retrieval Groundedness / CI Quality Score**: Alert if automated regression metrics drop below configured CI baseline thresholds.

#### E. Production Runbook Entry: Vector Database Connection Pool Exhaustion
* **What Breaks:** The FastAPI backend loses connectivity or times out querying the vector database, causing HTTP 500 Internal Server Errors on search endpoints.
* **How You Would Notice:** Spike in error rates on the API monitoring dashboard and log entries matching `psycopg2.OperationalError: connection timeout` or pool exhaustion warnings.
* **First Response Action:**
    1. **Check Database Health:** Navigate to the database hosting dashboard to inspect active connections, CPU utilization, and storage limits.
    2. **Verify Credentials & Network:** Confirm environment variables (`DATABASE_URL`) and security group rules are properly configured.
    3. **Mitigate & Restart:** Scale connection limits if saturated, restart the FastAPI container service, and monitor the health endpoint until error rates drop to zero.

  ---
