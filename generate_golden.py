import json
import os

# Ensure eval directory exists
os.makedirs("eval", exist_ok=True)

# Load existing golden_set.json
with open("golden_set.json", "r", encoding="utf-8") as f:
    cases = json.load(f)

# Transform categories to standard group names
formatted_cases = []
for case in cases:
    cat = case.get("category", "")
    # Map original_twelve to original, otherwise keep category as group
    group_name = "original" if cat == "original_twelve" else cat
    
    formatted_case = {
        "id": case["id"],
        "group": group_name,
        "question": case["question"],
        "expected_section": case.get("expected_section")
    }
    formatted_cases.append(formatted_case)

# Save to eval/golden.json
with open("eval/golden.json", "w", encoding="utf-8") as f:
    json.dump(formatted_cases, f, indent=4)

print(f"Successfully updated eval/golden.json with {len(formatted_cases)} cases and explicit group fields!")