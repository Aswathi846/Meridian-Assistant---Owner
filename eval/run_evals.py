import json
import requests

API_URL = "http://localhost:8000/api/search"  # Adjust if your local port differs

def run_evaluations():
    with open("eval/golden.json", "r") as f:
        golden_set = json.load(f)

    print(f"Loaded {len(golden_set)} test cases from eval/golden.json. Starting evaluation runner...\n")

    results = []
    for case in golden_set:
        case_id = case["id"]
        category = case["category"]
        question = case["question"]
        expected_section = case.get("expected_section")

        print(f"Running [{case_id}] ({category}): {question}")

        try:
            response = requests.post(API_URL, json={"question": question})
            if response.status_code == 200:
                data = response.json()
                reply = data.get("reply", "")
                latency = data.get("latency_ms", 0)
                
                # Basic validation checks
                passed = True
                if expected_section and expected_section not in reply:
                    passed = False

                results.append({
                    "id": case_id,
                    "category": category,
                    "question": question,
                    "passed": passed,
                    "latency_ms": latency,
                    "reply": reply
                })
                print(f"  -> Status: {'PASS' if passed else 'FAIL'} (Latency: {latency}ms)")
            else:
                print(f"  -> HTTP Error: {response.status_code}")
        except Exception as e:
            print(f"  -> Connection Failed: {e}")

    # Summary
    passed_count = sum(1 for r in results if r.get("passed"))
    print(f"\nEvaluation Complete! Passed: {passed_count}/{len(golden_set)}")

if __name__ == "__main__":
    run_evaluations()