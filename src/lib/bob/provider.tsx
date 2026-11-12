"use client";

/**
 * Client side of Bob. It only sends what the user said (typed or spoken) to
 * the server and renders what comes back — all reasoning, tool calls,
 * permissions and approvals happen server-side.
 */
import * as React from "react";
import type { ActionView, BobMessage, BobTurnResponse } from "@/lib/bob/types";
import { api, useStore } from "@/lib/store/store";
import { clearPendingReply, speakReply, spokenSummary, stopSpeaking } from "@/lib/voice/speech-output";

interface BobValue {
  messages: BobMessage[];
  thinking: boolean;
  ready: boolean;
  /** Speak Bob's reply automatically after a voice request. */
  speakReplies: boolean;
  setSpeakReplies(v: boolean): void;
  /** "ok" once Bob has answered; "failed" keeps the caller's text for a retry; "busy" while another request is in flight. */
  send(text: string, via?: "voice" | "text", opts?: { speak?: boolean }): Promise<SendResult>;
  decide(actionId: string, decision: "approve" | "cancel" | "undo", edits?: Record<string, string>): Promise<ActionView | null>;
  newConversation(): Promise<void>;
}

export type SendResult = "ok" | "failed" | "busy";

const BobContext = React.createContext<BobValue | null>(null);
const SPEAK_KEY = "bob.speakVoiceReplies";

export function BobProvider({ children }: { children: React.ReactNode }) {
  const { refresh, decide: storeDecide, org } = useStore();
  const [messages, setMessages] = React.useState<BobMessage[]>([]);
  const [thinking, setThinking] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [speakReplies, setSpeakRepliesState] = React.useState(org.assistant.readAloudDefault ?? true);
  const convRef = React.useRef<string | null>(null);
  const speakRef = React.useRef(speakReplies);
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SPEAK_KEY);
      if (saved !== null) {
        speakRef.current = saved === "1";
        setSpeakRepliesState(saved === "1");
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

  const setSpeakReplies = React.useCallback((v: boolean) => {
    speakRef.current = v;
    setSpeakRepliesState(v);
    if (!v) stopSpeaking();
    try {
      window.localStorage.setItem(SPEAK_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const send = React.useCallback(
    async (text: string, via: "voice" | "text" = "text", opts: { speak?: boolean } = {}): Promise<SendResult> => {
      const trimmed = text.trim();
      if (!trimmed) return "failed";
      if (inFlight.current) return "busy"; // one request at a time — no duplicate submissions
      inFlight.current = true;
      clearPendingReply();
      const tempId = `local_${Date.now()}`;
      setMessages((m) => [...m, { id: tempId, role: "user", text: trimmed, via, createdAt: new Date().toISOString() }]);
      setThinking(true);
      try {
        const r = await api<BobTurnResponse & { error?: string }>("/api/bob/message", {
          json: { text: trimmed, via, conversationId: convRef.current ?? undefined },
        });
        if (r.status !== 200) throw new Error(r.body?.error ?? "Bob couldn't answer");
        convRef.current = r.body.conversationId;
        setMessages((m) => [...m.filter((x) => x.id !== tempId), ...r.body.messages]);
        if (r.body.changed) void refresh();
        // Spoken replies for voice requests (when switched on), or when explicitly asked (Hear today's briefing).
        if (opts.speak || (via === "voice" && speakRef.current)) {
          const last = [...r.body.messages].reverse().find((x) => x.role === "assistant");
          if (last) speakReply(last.id, spokenSummary(r.body.messages, trimmed));
        }
        return "ok";
      } catch (e) {
        // Take the unsent message back out; the caller keeps the text for a retry.
        setMessages((m) => [
          ...m.filter((x) => x.id !== tempId),
          {
            id: `err_${Date.now()}`,
            role: "assistant",
            text: `Sorry — I couldn't get that (${e instanceof Error ? e.message : "connection problem"}). Nothing was changed. Your message is still in the box, so you can try again.`,
            createdAt: new Date().toISOString(),
          },
        ]);
        return "failed";
      } finally {
        inFlight.current = false;
        setThinking(false);
      }
    },
    [refresh],
  );

  const decide = React.useCallback(
    async (actionId: string, decision: "approve" | "cancel" | "undo", edits?: Record<string, string>) => {
      const view = await storeDecide(actionId, decision, edits);
      if (view) setMessages((m) => m.map((msg) => (msg.action?.id === actionId ? { ...msg, action: view } : msg)));
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
    <BobContext.Provider value={{ messages, thinking, ready, speakReplies, setSpeakReplies, send, decide, newConversation }}>{children}</BobContext.Provider>
  );
}

export function useBob(): BobValue {
  const ctx = React.useContext(BobContext);
  if (!ctx) throw new Error("useBob must be used inside <BobProvider>");
  return ctx;
}
