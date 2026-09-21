/**
 * The backend.
 *
 * This runs on the server, not in the browser. That matters: your API key
 * lives here and is never sent to the user.
 *
 * What it does, in order:
 *   1. reads the message the user typed
 *   2. puts your SYSTEM_PROMPT in front of the conversation
 *   3. asks Groq for an answer
 *   4. saves both the question and the answer to the database
 *   5. sends the answer back to the page
 */

import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT } from "@/config";
import { askGroq, GroqError, type ChatMessage } from "@/lib/groq";
import {
  ensureTable,
  saveMessage,
  databaseIsConfigured,
  studentName,
} from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

type Incoming = {
  messages?: { role: string; content: string }[];
  sessionId?: string;
};

export async function POST(request: NextRequest) {
  let body: Incoming;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON." }, { status: 400 });
  }

  const history = Array.isArray(body.messages) ? body.messages : [];
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";

  const latest = history[history.length - 1];
  if (!latest || latest.role !== "user" || !latest.content?.trim()) {
    return NextResponse.json({ error: "No user message was sent." }, { status: 400 });
  }

  // Step 2: your system prompt goes in front of everything the user said.
  const payload: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  let reply: string;
  try {
    reply = await askGroq(payload);
  } catch (error) {
    const status = error instanceof GroqError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Something went wrong talking to the model.";
    console.error("chat route failed:", message);
    return NextResponse.json({ error: message }, { status });
  }

  // Step 4: saving must never break the chat, so failures here are logged only.
  if (databaseIsConfigured()) {
    try {
      // Your STUDENT_NAME is stamped on both rows so you can find them
      // again on the /data page.
      const student = studentName();
      await ensureTable();
      await saveMessage(sessionId, "user", latest.content, student);
      await saveMessage(sessionId, "assistant", reply, student);
    } catch (error) {
      console.error("could not save to the database:", error);
    }
  }

  return NextResponse.json({ reply });
}
