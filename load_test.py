import time
import io
import requests
import numpy as np
from pypdf import PdfWriter

URL = "http://127.0.0.1:8000/documents"
TOTAL_REQUESTS = 50

def create_dummy_pdf_bytes():
    """Generates a minimal valid single-page PDF in memory."""
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    pdf_buffer = io.BytesIO()
    writer.write(pdf_buffer)
    pdf_buffer.seek(0)
    return pdf_buffer.read()

latencies = []
errors = 0

pdf_bytes = create_dummy_pdf_bytes()
files = {"file": ("test_corpus.pdf", pdf_bytes, "application/pdf")}

print(f"Starting load test: firing {TOTAL_REQUESTS} upload requests...")

for i in range(TOTAL_REQUESTS):
    start_time = time.time()
    try:
        # Re-seek/re-open file stream for each request
        files["file"] = ("test_corpus.pdf", io.BytesIO(pdf_bytes), "application/pdf")
        response = requests.post(URL, files=files, timeout=15)
        elapsed = (time.time() - start_time) * 1000  # convert to ms
        
        if response.status_code == 200:
            latencies.append(elapsed)
        else:
            errors += 1
    except Exception as e:
        errors += 1

if latencies:
    p50 = np.percentile(latencies, 50)
    p95 = np.percentile(latencies, 95)
else:
    p50, p95 = 0, 0

error_rate = (errors / TOTAL_REQUESTS) * 100

print("\n--- Load Test Results ---")
print(f"Total Requests: {TOTAL_REQUESTS}")
print(f"Errors: {errors} ({error_rate:.1f}%)")
print(f"p50 Latency: {p50:.2f} ms")
print(f"p95 Latency: {p95:.2f} ms")