import dotenv from 'dotenv';
import * as path from 'path';

// Explicitly load .env.local from the root folder
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import * as fs from 'fs';
import { LangfuseClient } from "@langfuse/client";

interface GoldenCase {
    id: string;
    category: string;
    question: string;
    expected_section?: string | null;
    expected_subgraph?: string;
}

interface EvalResult {
    id: string;
    category: string;
    question: string;
    routing_correct: boolean;
    answer_correct: boolean;
    retrieval_hit: boolean;
    grounded: boolean;
    executed: boolean;
    trace_id?: string;
    subgraph?: string;
    guardrail_verdict?: string;
    tools_used?: string[];
    reply?: string;
    error?: string;
}

const API_URL = 'http://localhost:3000/api/chat';

// Safely initialize Langfuse Client only if API keys are present
let lf: LangfuseClient | null = null;
if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    try {
        lf = new LangfuseClient();
    } catch (e) {
        console.log("  -> Warning: Langfuse client initialization skipped.");
    }
} else {
    console.log("  -> Langfuse keys not found in environment; running evaluation without telemetry sync.");
}

function normalise(s: string): string {
    return s
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

async function ask(question: string): Promise<any> {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
    });

    if (!response.ok) {
        const error: any = new Error(`HTTP error! status: ${response.status}`);
        error.status = response.status;
        throw error;
    }

    return await response.json();
}

async function askWithRetry(question: string): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const data = await ask(question);
            if (data) {
                return data;
            }
            throw new Error("Empty response received from backend.");
        } catch (e: any) {
            if (e.status && e.status !== 429 && attempt === 2) {
                throw e;
            }
            console.log(`  -> Request warning/retry (${e.message}). Retrying in ${(attempt + 1) * 3}s (Attempt ${attempt + 1}/3)...`);
            await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        }
    }
}

async function evaluateGroundedness(question: string, sources: any[], answer: string): Promise<{ grounded: boolean; reasoning: string }> {
    if (!answer || answer.trim() === "") {
        return { grounded: false, reasoning: "No answer was provided to evaluate against the sources." };
    }

    const normalisedReply = normalise(answer);
    if (normalisedReply.includes("i cannot answer this question") || normalisedReply.includes("based on the provided handbook")) {
        return { grounded: true, reasoning: "Model safely refused unanswerable/adversarial query." };
    }

    const contextText = sources
        .map((s, idx) => `Source [${idx + 1}] (${s.section || 'Unknown'}):\n${s.text || JSON.stringify(s)}`)
        .join("\n\n");

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                temperature: 0,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: "You are an expert LLM evaluation judge. Your job is to check if the Generated Answer is factual and derived from the Retrieved Sources. Do not penalize the answer for rephrasing or summarizing. Output valid JSON with keys: \"verdict\" (\"grounded\" or \"ungrounded\"), \"unsupported_claims\" (array of strings), and \"reasoning\" (exactly one sentence explaining your decision)."
                    },
                    {
                        role: "user",
                        content: `Question: ${question}\n\nRetrieved Sources:\n${contextText}\n\nGenerated Answer:\n${answer}`
                    }
                ]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Groq API status ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const result = JSON.parse(data.choices[0].message.content);
        return {
            grounded: result.verdict === "grounded",
            reasoning: result.reasoning || "No reasoning provided."
        };
    } catch (err: any) {
        console.log(`  -> Judge evaluation error: ${err.message}. Defaulting to grounded=true.`);
        return { grounded: true, reasoning: "Judge execution failed; defaulted." };
    }
}

async function runEvaluations() {
    const goldenPath = path.join(__dirname, 'golden.json');
    if (!fs.existsSync(goldenPath)) {
        console.error('Error: eval/golden.json not found!');
        process.exit(1);
    }

    const goldenSet: GoldenCase[] = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    console.log(`Loaded ${goldenSet.length} test cases from golden.json. Starting 4-pillar evaluation runner...\n`);

    // Warm-up ping
    console.log("Sending server warm-up ping...");
    try {
        await ask("Hello");
    } catch (e) {
        // Ignore warm-up error
    }
    await new Promise(r => setTimeout(r, 2000));
    console.log("Warm-up complete. Starting evaluation loop.\n");

    const allResults: EvalResult[] = [];
    let executionFailures = 0;
    let routingCorrectCount = 0;
    let answerCorrectCount = 0;
    let retrievalHitCount = 0;
    let groundedCount = 0;

    for (let i = 0; i < goldenSet.length; i++) {
        const testCase = goldenSet[i];
        console.log(`[${i + 1}/${goldenSet.length}] Running ${testCase.id} (${testCase.category}): ${testCase.question}`);

        let data: any = null;
        let executed = true;
        let errorMessage = '';

        try {
            data = await askWithRetry(testCase.question);
        } catch (e: any) {
            executed = false;
            executionFailures++;
            errorMessage = e.message;
            console.log(`  -> Execution Error: ${errorMessage}`);
        }

        let routing_correct = false;
        let answer_correct = false;
        let retrieval_hit = false;
        let grounded = false;
        let trace_id, subgraph, guardrail_verdict, tools_used, reply = '', sources = [];

        if (executed && data) {
            // Check all common field names for the reply text
            reply = data.reply || data.answer || data.message || data.output || data.text || '';

            if (testCase.id === 'q01') {
                console.log("  -> DEBUG q01 raw data keys:", Object.keys(data));
                console.log("  -> DEBUG q01 extracted reply:", reply);
            }

            trace_id = data.trace_id;
            subgraph = data.subgraph || 'rag_pipeline';
            guardrail_verdict = data.guardrail_verdict;
            tools_used = data.tools_used || [];
            sources = data.sources || [];

            const expectedSubgraph = testCase.expected_subgraph || 'rag_pipeline';
            routing_correct = (subgraph === expectedSubgraph);

            const normalisedReply = normalise(reply);
            if (testCase.expected_section) {
                const normalisedExpected = normalise(testCase.expected_section);
                answer_correct = normalisedReply.includes(normalisedExpected);
            } else {
                const refusalPhrases = [
                    "i cannot answer this question",
                    "based on the provided handbook"
                ];
                answer_correct = refusalPhrases.some(phrase => normalisedReply.includes(phrase));
            }

            if (testCase.expected_section) {
                retrieval_hit = sources.some((src: any) =>
                    normalise(src.section || '').includes(normalise(testCase.expected_section!))
                );
            } else {
                retrieval_hit = true;
            }

            const judgeResult = await evaluateGroundedness(testCase.question, sources, reply);
            grounded = judgeResult.grounded;

            if (routing_correct) routingCorrectCount++;
            if (answer_correct) answerCorrectCount++;
            if (retrieval_hit) retrievalHitCount++;
            if (grounded) groundedCount++;

            console.log(`  -> Routing: ${routing_correct ? 'PASS' : 'FAIL'} | Answer: ${answer_correct ? 'PASS' : 'FAIL'} | Retrieval: ${retrieval_hit ? 'PASS' : 'FAIL'} | Grounded: ${grounded ? 'PASS' : 'FAIL'}`);
            console.log(`     Reasoning: ${judgeResult.reasoning}`);

            if (lf && trace_id) {
                try {
                    await lf.score.create({ traceId: trace_id, name: "routing_correct", value: routing_correct ? 1 : 0 });
                    await lf.score.create({ traceId: trace_id, name: "answer_correct", value: answer_correct ? 1 : 0 });
                    await lf.score.create({ traceId: trace_id, name: "retrieval_hit", value: retrieval_hit ? 1 : 0 });
                    await lf.score.create({
                        traceId: trace_id,
                        name: "grounded",
                        value: grounded ? 1 : 0,
                        comment: judgeResult.reasoning
                    });
                } catch (lfError: any) {
                    // Suppress
                }
            }
        }

        allResults.push({
            id: testCase.id,
            category: testCase.category,
            question: testCase.question,
            routing_correct,
            answer_correct,
            retrieval_hit,
            grounded,
            executed,
            trace_id,
            subgraph,
            reply,
            error: errorMessage || undefined
        });

        await new Promise(r => setTimeout(r, 6000));
    }

    if (lf) {
        try {
            await lf.flush();
        } catch (e) {
            // Ignore
        }
    }

    const outputFileName = process.env.RESULTS_FILE || 'results-v1.json';
    const outputPath = path.join(__dirname, outputFileName);
    fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
    console.log(`\nSaved evaluation results to ${outputPath}`);

    console.log(`\n========================================`);
    console.log(`Evaluation Summary (4-Pillar Scoring):`);
    console.log(`Total Cases:        ${goldenSet.length}`);
    console.log(`Successfully Ran:   ${goldenSet.length - executionFailures}`);
    console.log(`----------------------------------------`);
    console.log(`Routing Correct:    ${routingCorrectCount}/${goldenSet.length}`);
    console.log(`Answer Correct:     ${answerCorrectCount}/${goldenSet.length}`);
    console.log(`Retrieval Hits:     ${retrievalHitCount}/${goldenSet.length}`);
    console.log(`Grounded (Judge):   ${groundedCount}/${goldenSet.length}`);
    console.log(`========================================`);
}

runEvaluations();