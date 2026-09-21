import json
import requests

def run_baseline_evaluation():
    with open("golden_set.json", "r", encoding="utf-8") as f:
        golden_set = json.load(f)
    
    baseline_items = [item for item in golden_set if item.get("category") == "original_twelve"]
    
    correct_count = 0
    total = len(baseline_items)
    
    for item in baseline_items:
        question = item["question"]
        expected = item.get("expected_section")
        
        payload = {"question": question, "use_retrieval": False}
        
        try:
            response = requests.post("http://127.0.0.1:8000/api/search", json=payload, timeout=10)
            data = response.json()
            reply = data.get("reply", "")
            
            if expected and expected.lower() in reply.lower():
                correct_count += 1
        except Exception as e:
            print(f"Error on question {item['id']}: {e}")
            
    print(f"Baseline Score: {correct_count}/{total} ({(correct_count/total)*100:.1f}%)")

if __name__ == "__main__":
    run_baseline_evaluation()