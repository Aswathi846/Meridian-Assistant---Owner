"use client";

/**
 * The frontend.
 *
 * This runs in the browser. It holds the list of messages, sends new ones to
 * the backend at /api/chat, and shows whatever comes back.
 *
 * Notice there is no API key anywhere in this file. There must never be one
 * here, because anyone can read this code in their browser.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ASSISTANT_NAME, GREETING } from "@/config";

type Message = { role: "user" | "assistant"; content: string };

// A simple id so the database can tell one conversation from another.
function newSessionId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(newSessionId);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, sessionId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error ?? "Something went wrong.");
      } else {
        setMessages([...next, { role: "assistant", content: data.reply }]);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col px-4">
      <header className="flex items-center gap-3 border-b border-slate-200 py-4">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ background: "var(--brand)" }}
        >
          M
        </div>
        <div>
          <h1 className="text-[15px] font-semibold text-slate-800">{ASSISTANT_NAME}</h1>
          <p className="text-xs text-slate-500">Meridian Bank &middot; customer service</p>
        </div>
        <Link
          href="/data"
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
        >
          View saved messages
        </Link>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5 text-[15px] text-white"
                  : "max-w-[80%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5 text-[15px] text-slate-800"
              }
              style={m.role === "user" ? { background: "var(--brand)" } : undefined}
            >
              <span className="whitespace-pre-wrap">{m.content}</span>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3">
              <span className="inline-flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 py-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about cards, transfers, the app, or branches..."
            disabled={busy}
            className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] outline-none focus:border-slate-400 disabled:opacity-60"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="rounded-xl px-5 py-3 text-[15px] font-medium text-white disabled:opacity-40"
            style={{ background: "var(--brand)" }}
          >
            Send
          </button>
        </div>
        <p className="pt-2 text-center text-xs text-slate-400">
          A training exercise. Not a real bank.
        </p>
      </div>
    </main>
  );
}
