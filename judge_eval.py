import json
import numpy as np
from sklearn.metrics import cohen_kappa_score
from pydantic import BaseModel, Field
from collections import Counter

# --- Pydantic Schema ---
class JudgeCriterionScore(BaseModel):
    score: int = Field(..., description="Integer score: 0, 1, or 2")
    reasoning: str = Field(..., description="Detailed explanation for the assigned score")

class JudgeEvaluationOutput(BaseModel):
    grounded: JudgeCriterionScore
    correct: JudgeCriterionScore
    appropriate: JudgeCriterionScore

def load_labels(filepath="human_labels.json"):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return []

# --- D2.4: Human Agreement & Cohen's Kappa Audit ---
def evaluate_judge_agreement(data):
    criteria = ["grounded", "correct", "appropriate"]
    results = {}

    print("=" * 65)
    print(f"{'Criterion':<15} | {'Raw Count / Total':<18} | {'Cohen Kappa':<12}")
    print("-" * 65)

    for criterion in criteria:
        human_scores = [item["human"][criterion] for item in data]
        judge_scores = [item["judge"][criterion] for item in data]

        exact_matches = sum(1 for h, j in zip(human_scores, judge_scores) if h == j)
        total = len(human_scores)

        try:
            kappa = cohen_kappa_score(human_scores, judge_scores, labels=[0, 1, 2])
            if np.isnan(kappa):
                kappa = 1.0 if human_scores == judge_scores else 0.0
        except Exception:
            kappa = 0.0

        results[criterion] = {
            "exact_matches": exact_matches,
            "total": total,
            "kappa": kappa
        }

        print(f"{criterion.capitalize():<15} | {exact_matches}/{total} ({exact_matches/total*100:.1f}%) | {kappa:6.2f}")

    print("=" * 65)
    return results

# --- D2.1: Length Bias Audit ---
def audit_length_bias(judge_func, correct_cases):
    """
    Takes 5 correct answers, pads each with true but irrelevant sentences, 
    and measures score change (Delta).
    """
    print("\n[Audit] Running Length Bias Test...")
    deltas = []
    for case in correct_cases[:5]:
        answer_text = case.get("answer", "The policy outlines the standard operating guidelines and compliance rules.")
        original_score = judge_func(case["question"], case.get("context", ""), answer_text)
        
        padded_answer = answer_text + " Note: The historical fiscal year closes at midnight according to standard general ledger guidelines."
        padded_score = judge_func(case["question"], case.get("context", ""), padded_answer)
        
        delta = padded_score - original_score
        deltas.append(delta)
        print(f"  - Case {case['id']}: Original={original_score}, Padded={padded_score} (Delta: {delta:+d})")
    
    avg_delta = sum(deltas) / len(deltas) if deltas else 0.0
    print(f"👉 Average Length Bias Delta: {avg_delta:+.2f}")
    return avg_delta

# --- D2.2: Position Bias Audit ---
def audit_position_bias(judge_comparison_func, comparison_pairs):
    """
    Runs comparison pairs in both orders (A vs B, then B vs A) 
    to check if the first-listed answer wins more often than chance.
    """
    print("\n[Audit] Running Position Bias Test...")
    first_position_wins = 0
    total_runs = len(comparison_pairs)
    
    if total_runs == 0:
        print("  - No comparison pairs provided for position bias audit.")
        return 0.0

    for pair in comparison_pairs:
        winner_ab = judge_comparison_func(pair['q'], pair['ans_a'], pair['ans_b'])
        winner_ba = judge_comparison_func(pair['q'], pair['ans_b'], pair['ans_a'])
        
        if winner_ab == 'A':
            first_position_wins += 1
        if winner_ba == 'B':
            first_position_wins += 1
            
    position_bias_rate = (first_position_wins / (total_runs * 2)) * 100
    print(f"👉 First-Position Win Rate: {position_bias_rate:.1f}% (Expected ~50.0% if unbiased)")
    return position_bias_rate

# --- D2.3: Self-Preference Bias Audit ---
def audit_self_preference(judge_func, test_cases, model_a_answers, model_b_answers):
    """
    Scores answers written by your model (Model A) and a different model (Model B)
    of matched quality, checking if your model scores consistently higher.
    """
    print("\n[Audit] Running Self-Preference Bias Test...")
    scores_a = []
    scores_b = []
    
    for case, ans_a, ans_b in zip(test_cases[:5], model_a_answers[:5], model_b_answers[:5]):
        score_a = judge_func(case["question"], case.get("context", ""), ans_a)
        score_b = judge_func(case["question"], case.get("context", ""), ans_b)
        scores_a.append(score_a)
        scores_b.append(score_b)
        print(f"  - Case {case['id']}: Model A (Ours)={score_a}, Model B (Other)={score_b}")
        
    avg_a = sum(scores_a) / len(scores_a) if scores_a else 0.0
    avg_b = sum(scores_b) / len(scores_b) if scores_b else 0.0
    delta = avg_a - avg_b
    
    print(f"👉 Average Score - Model A (Ours): {avg_a:.2f}")
    print(f"👉 Average Score - Model B (Other): {avg_b:.2f}")
    print(f"👉 Self-Preference Delta (A - B): {delta:+.2f} (Expected ~0.0 if unbiased)")
    return delta

# --- D2.3: Wobble & Consistency Test ---
def audit_wobble(judge_func, test_cases, runs=5):
    """
    Picks 10 cases and runs the judge 5 times each.
    Reports how many gave the same verdict all 5 times and the spread.
    """
    print(f"\n[Audit] Running Wobble & Consistency Test ({min(len(test_cases), 10)} cases run {runs} times each)...")
    consistent_count = 0
    spread_reports = []

    for case in test_cases[:10]:
        answer_text = case.get("answer", "The policy outlines the standard operating guidelines and compliance rules.")
        run_scores = []
        for _ in range(runs):
            score = judge_func(case["question"], case.get("context", ""), answer_text)
            run_scores.append(score)
            
        unique_scores = set(run_scores)
        if len(unique_scores) == 1:
            consistent_count += 1
        else:
            spread = max(run_scores) - min(run_scores)
            spread_reports.append((case['id'], run_scores, spread))
            print(f"  - Case {case['id']} Wobbled! Scores: {run_scores} (Spread: {spread})")

    print(f"👉 Summary: {consistent_count}/10 cases gave identical verdicts all {runs} times.")
    print(f"👉 Cases with wobble: {len(spread_reports)}")
    return consistent_count, spread_reports

if __name__ == "__main__":
    print("--- 1. Human Agreement & Cohen's Kappa Audit ---")
    data = load_labels("human_labels.json")
    if not data:
        print("Warning: human_labels.json not found or empty. Skipping agreement check.")
    else:
        evaluate_judge_agreement(data)

    # Mock functions for testing the audit suite
    def mock_judge_func(question, context, answer):
        return 2 if len(answer) > 10 else 1

    def mock_comparison_func(q, ans_a, ans_b):
        return 'A' if len(ans_a) >= len(ans_b) else 'B'

    try:
        with open("eval/golden.json", "r", encoding="utf-8") as f:
            golden_cases = json.load(f)
    except FileNotFoundError:
        golden_cases = [{"id": "q1", "question": "Test?", "context": "Context", "answer": "Sample answer text"}]

    print("\n--- 2. Length Bias Audit ---")
    audit_length_bias(mock_judge_func, golden_cases)

    print("\n--- 3. Position Bias Audit ---")
    sample_pairs = [
        {"q": "What is policy X?", "ans_a": "Policy X states that...", "ans_b": "The guidelines for X are..."}
    ]
    audit_position_bias(mock_comparison_func, sample_pairs)

    print("\n--- 4. Self-Preference Bias Audit ---")
    model_a_texts = ["Answer from our model A regarding compliance guidelines."] * 5
    model_b_texts = ["Answer from alternate model B regarding compliance guidelines."] * 5
    audit_self_preference(mock_judge_func, golden_cases, model_a_texts, model_b_texts)

    print("\n--- 5. Wobble & Consistency Test ---")
    audit_wobble(mock_judge_func, golden_cases, runs=5)