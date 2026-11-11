"use client";

/**
 * Client side of Bob. It only sends what the user said (typed or spoken) to
 * the server and renders what comes back — all reasoning, tool calls,
 * permissions and approvals happen server-side.
 */
import * as React from "react";
import type { ActionView, BobMessage, BobTurnResponse } from "@/lib/bob/types";
import { api, useStore } from "@/lib/store/store";
import { speak } from "@/lib/voice/use-speech";

interface BobValue {
  messages: BobMessage[];
  thinking: boolean;
  ready: boolean;
  readAloud: boolean;
  setReadAloud(v: boolean): void;
  send(text: string, via?: "voice" | "text"): Promise<void>;
  decide(actionId: string, decision: "approve" | "cancel" | "undo", edits?: Record<string, string>): Promise<ActionView | null>;
  newConversation(): Promise<void>;
}

const BobContext = React.createContext<BobValue | null>(null);

export function BobProvider({ children }: { children: React.ReactNode }) {
  const { refresh, decide: storeDecide, org } = useStore();
  const [messages, setMessages] = React.useState<BobMessage[]>([]);
  const [thinking, setThinking] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [readAloud, setReadAloudState] = React.useState(org.assistant.readAloudDefault);
  const convRef = React.useRef<string | null>(null);
  const readAloudRef = React.useRef(readAloud);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("bob.readAloud");
      if (saved !== null) {
        readAloudRef.current = saved === "1";
        setReadAloudState(saved === "1");
      }
    } catch {
      /* storage unavailable */
    }
    void api<{ conversationId: string | null; messages: BobMessage[] }>("/api/bob/conversation").then((r) => {
      if (r.status === 200) {
        convRef.current = r.body.conversationId;
        setMessages(r.body.messages ?? []);
      }
      setReady(true);
    });
  }, []);

  const setReadAloud = React.useCallback((v: boolean) => {
    readAloudRef.current = v;
    setReadAloudState(v);
    try {
      window.localStorage.setItem("bob.readAloud", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const send = React.useCallback(
    async (text: string, via: "voice" | "text" = "text") => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const tempId = `local_${Date.now()}`;
      setMessages((m) => [...m, { id: tempId, role: "user", text: trimmed, via, createdAt: new Date().toISOString() }]);
      setThinking(true);
      try {
        const r = await api<BobTurnResponse & { error?: string }>("/api/bob/message", {
          json: { text: trimmed, via, conversationId: convRef.current ?? undefined },
        });
        if (r.status !== 200) throw new Error(r.body.error ?? "Bob couldn't answer");
        convRef.current = r.body.conversationId;
        setMessages((m) => [...m.filter((x) => x.id !== tempId), ...r.body.messages]);
        if (r.body.changed) void refresh();
        if (readAloudRef.current) speak(r.body.messages.filter((x) => x.role === "assistant").map((x) => x.text || x.action?.resultMessage || "").join(" "));
      } catch (e) {
        setMessages((m) => [
          ...m,
          {
            id: `err_${Date.now()}`,
            role: "assistant",
            text: `Sorry — ${e instanceof Error ? e.message : "something went wrong"}. Nothing was changed.`,
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [refresh],
  );

  const decide = React.useCallback(
    async (actionId: string, decision: "approve" | "cancel" | "undo", edits?: Record<string, string>) => {
      const view = await storeDecide(actionId, decision, edits);
      if (view) setMessages((m) => m.map((msg) => (msg.action?.id === actionId ? { ...msg, action: view } : msg)));
      if (view && readAloudRef.current && view.resultMessage && decision !== "cancel") speak(view.resultMessage);
      return view;
    },
    [storeDecide],
  );

  const newConversation = React.useCallback(async () => {
    const r = await api<{ conversationId: string }>("/api/bob/conversation", { method: "POST" });
    convRef.current = r.body.conversationId ?? null;
    setMessages([]);
  }, []);

  return (
    <BobContext.Provider value={{ messages, thinking, ready, readAloud, setReadAloud, send, decide, newConversation }}>{children}</BobContext.Provider>
  );
}

export function useBob(): BobValue {
  const ctx = React.useContext(BobContext);
  if (!ctx) throw new Error("useBob must be used inside <BobProvider>");
  return ctx;
}
