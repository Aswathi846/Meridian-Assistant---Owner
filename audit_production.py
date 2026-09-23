import json
import random

def load_json(filepath):
    try:
        with open(filepath, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return []

def audit_production_runs():
    print("=== D4 Production Audit & Distribution Comparison ===")
    
    # Load production logs and golden set
    prod_runs = load_json("production_runs.json")
    golden_set = load_json("golden_set.json")
    
    if not prod_runs:
        print("Error: production_runs.json not found or empty.")
        return
        
    # 1. Sample 20 runs at random (or all if fewer than 20)
    sample_size = min(20, len(prod_runs))
    sampled_runs = random.sample(prod_runs, sample_size)
    print(f"Sampled {sample_size} runs at random from production logs.")
    
    # 2. Extract categories from golden set vs production sample
    golden_categories = set(item.get("category", "Uncategorized") for item in golden_set)
    
    prod_distribution = {}
    for run in sampled_runs:
        cat = run.get("category", "Uncategorized")
        prod_distribution[cat] = prod_distribution.get(cat, 0) + 1
        
    prod_categories = set(prod_distribution.keys())
    
    # 3. Compare distributions group by group
    print("\n--- Production Category Distribution ---")
    for cat, count in prod_distribution.items():
        print(f"  - {cat}: {count} queries")
        
    # 4. Report categories in production absent from golden set
    absent_categories = prod_categories - golden_categories
    print("\n--- Gap Analysis ---")
    if absent_categories:
        print(f"⚠️ Found categories in production ABSENT from golden set: {list(absent_categories)}")
        print("Action Required: Add representative questions from these new categories into your golden set.")
    else:
        print("✓ All production categories are covered in the golden set.")
        
    return absent_categories, sampled_runs

if __name__ == "__main__":
    audit_production_runs()