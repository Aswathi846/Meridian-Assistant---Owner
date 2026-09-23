import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT, BANK_FACTS } from "@/config";
import { askGroq, GroqError, type ChatMessage } from "@/lib/groq";
import { LangfuseClient } from "@langfuse/client";
import {
  ensureTable,
  saveMessage,
  databaseIsConfigured,
  studentName,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

// Initialize Langfuse client for prompt management
const langfuse = new LangfuseClient();

type Incoming = {
  messages?: { role: string; content: string }[];
  question?: string;
  sessionId?: string;
};

// Helper to pull the most relevant section of BANK_FACTS based on question content
function findRelevantSource(question: string): { section: string; content: string } {
  const q = question.toLowerCase();

  if (q.includes("card") || q.includes("pin") || q.includes("freeze") || q.includes("courier")) {
    return { section: "1. Your cards", content: "CARDS\n- Report a lost or stolen card in the Meridian app under Cards > Freeze card, or by calling 0800 555 0199, which is open 24 hours a day.\n- A replacement debit card arrives in 3 to 5 working days.\n- A replacement can be sent by courier for a fee of 12 pounds.\n- Card PINs can be viewed in the app under Cards > View PIN." };
  }
  if (q.includes("transfer") || q.includes("faster payments") || q.includes("international")) {
    return { section: "2. Payments and transfers", content: "PAYMENTS AND TRANSFERS\n- The daily transfer limit for online and app payments is 25,000 pounds.\n- The limit can be raised temporarily by calling the phone line. It cannot be raised in the app or by an assistant.\n- Faster Payments to other UK banks usually arrive within 2 hours.\n- International transfers take 2 to 4 working days and cost 15 pounds." };
  }
  if (q.includes("overdraft") || q.includes("fee") || q.includes("statement")) {
    return { section: "3. Accounts, overdrafts and fees", content: "ACCOUNTS AND OVERDRAFTS\n- The arranged overdraft fee is 35p per day on any day the account is overdrawn.\n- The unarranged overdraft fee is 6 pounds per day, capped at 60 pounds per calendar month.\n- Overdraft limits are reviewed on request through the app under Accounts > Overdraft." };
  }
  if (q.includes("app") || q.includes("password") || q.includes("face id") || q.includes("fingerprint")) {
    return { section: "4. The Meridian app", content: "THE APP\n- Reset an app password at the sign-in screen using \"Forgotten password\". A one-time code is sent by SMS to the registered mobile number.\n- If the registered mobile number is out of date it must be changed in a branch with photographic identification.\n- The app supports face and fingerprint sign-in on supported devices." };
  }
  if (q.includes("branch") || q.includes("hour") || q.includes("phone") || q.includes("call")) {
    return { section: "5. Branches and contacting us", content: "BRANCHES AND CONTACT\n- Branches open Monday to Friday 09:30 to 16:30, and Saturday 09:30 to 12:30. Branches are closed on Sundays and bank holidays.\n- The general phone line is open Monday to Saturday 08:00 to 20:00.\n- The lost card line on 0800 555 0199 is open 24 hours." };
  }
  if (q.includes("fraud") || q.includes("scam") || q.includes("phishing") || q.includes("email")) {
    return { section: "6. Fraud and security", content: "FRAUD\n- Report suspected fraud immediately on 0800 555 0177.\n- Meridian Bank will never ask for a full password, a PIN, or a one-time code by phone, email or text message." };
  }
  if (q.includes("complaint") || q.includes("ombudsman")) {
    return { section: "7. Complaints", content: "COMPLAINTS\n- Complaints, disputed transactions and chargeback claims." };
  }
  if (q.includes("bereavement") || q.includes("power of attorney")) {
    return { section: "8. Bereavement and power of attorney", content: "BEREAVEMENT AND POWER OF ATTORNEY\n- Closing an account, bereavement, or power of attorney." };
  }
  if (q.includes("business")) {
    return { section: "9. Business accounts", content: "BUSINESS ACCOUNTS\n- Business accounts information." };
  }

  // Default fallback to full bank facts if no specific match
  return { section: "Bank Fact Sheet", content: BANK_FACTS };
}

export async function POST(request: NextRequest) {
  let body: Incoming;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON." }, { status: 400 });
  }

  let history = Array.isArray(body.messages) ? body.messages : [];
  if (history.length === 0 && typeof body.question === "string") {
    history = [{ role: "user", content: body.question }];
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";
  const latest = history[history.length - 1];

  if (!latest || latest.role !== "user" || !latest.content?.trim()) {
    return NextResponse.json({ error: "No user message was sent." }, { status: 400 });
  }

  // Fetch prompt from Langfuse with production label, 5-minute cache, and local fallback
  let activeSystemPrompt = SYSTEM_PROMPT;
  try {
    const prompt = await langfuse.prompt.get("compose-house-style", {
      label: "production",
      cacheTtlSeconds: 300,
      fallback: SYSTEM_PROMPT,
    });
    activeSystemPrompt = prompt.compile({
      BANK_FACTS: BANK_FACTS,
    });
  } catch (err) {
    console.error("Failed to fetch prompt from Langfuse, using fallback:", err);
  }

  const payload: ChatMessage[] = [
    { role: "system", content: activeSystemPrompt },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  let reply: string;
  try {
    reply = await askGroq(payload);
  } catch (error) {
    const status = error instanceof GroqError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Something went wrong talking to the model.";
    console.error("chat route failed:", message);
    return NextResponse.json({ error: message }, { status });
  }

  if (databaseIsConfigured()) {
    try {
      const student = studentName();
      await ensureTable();
      await saveMessage(sessionId, "user", latest.content, student);
      await saveMessage(sessionId, "assistant", reply, student);
    } catch (error) {
      console.error("could not save to the database:", error);
    }
  }

  const matchedSource = findRelevantSource(latest.content);

  return NextResponse.json({
    reply,
    sources: [matchedSource],
    subgraph: "rag_pipeline",
    trace_id: undefined,
  });
}