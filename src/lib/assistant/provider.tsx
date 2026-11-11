"use client";

import * as React from "react";
import { useStore } from "@/lib/store/store";
import { uid } from "@/lib/utils";
import { getAssistantEngine } from "./engine";
import { executeAction } from "./executor";
import type { AssistantMessage, AssistantReply, Chip, ConversationMemory, ProposedAction } from "./types";
import { speak } from "@/lib/voice/use-speech";

interface AssistantValue {
  messages: AssistantMessage[];
  thinking: boolean;
  readAloud: boolean;
  setReadAloud(v: boolean): void;
  send(text: string, via?: "voice" | "text"): Promise<void>;
  propose(action: ProposedAction, label: string): void;
  confirm(messageId: string): void;
  cancel(messageId: string): void;
  reset(): void;
}

const AssistantContext = React.createContext<AssistantValue | null>(null);

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { actions, getSnapshot, user } = useStore();
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [thinking, setThinking] = React.useState(false);
  const [readAloud, setReadAloudState] = React.useState(false);
  const memoryRef = React.useRef<ConversationMemory>({});
  const readAloudRef = React.useRef(false);

  const setReadAloud = React.useCallback((v: boolean) => {
    readAloudRef.current = v;
    setReadAloudState(v);
  }, []);

  const pushAssistant = React.useCallback((reply: AssistantReply) => {
    if (reply.memory) memoryRef.current = { ...memoryRef.current, ...reply.memory };
    const msg: AssistantMessage = {
      id: uid("msg"),
      role: "assistant",
      text: reply.text,
      createdAt: new Date().toISOString(),
      cards: reply.cards,
      chips: reply.chips,
      proposal: reply.proposal ? { id: uid("prop"), action: reply.proposal, status: "pending" } : undefined,
    };
    setMessages((m) => [...m, msg]);
    if (readAloudRef.current) speak(reply.text);
  }, []);

  const send = React.useCallback(
    async (text: string, via: "voice" | "text" = "text") => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessages((m) => [
        ...m,
        { id: uid("msg"), role: "user", text: trimmed, createdAt: new Date().toISOString(), via },
      ]);
      setThinking(true);
      try {
        const [reply] = await Promise.all([
          getAssistantEngine().respond(trimmed, {
            data: getSnapshot(),
            userName: user.displayName,
            memory: memoryRef.current,
          }),
          new Promise((r) => setTimeout(r, 450)), // brief, honest "thinking" beat for readability
        ]);
        if (reply.memory) memoryRef.current = reply.memory;
        pushAssistant({ ...reply, memory: undefined });
      } catch {
        pushAssistant({ text: "Sorry, something went wrong on my side. Nothing was changed." });
      } finally {
        setThinking(false);
      }
    },
    [getSnapshot, pushAssistant, user.displayName],
  );

  const propose = React.useCallback(
    (action: ProposedAction, label: string) => {
      const verb =
        action.type === "save_draft"
          ? "Save this draft to the enquiry? It won't be sent to the customer."
          : action.type === "mark_replied"
            ? "Mark this customer as replied to? Only do this once you've actually sent the reply."
            : action.type === "record_payment"
              ? "Just to check before I record it:"
              : action.type === "create_reminder"
                ? "Set this reminder?"
                : "Here's the job — confirm and I'll add it.";
      setMessages((m) => [
        ...m,
        { id: uid("msg"), role: "user", text: label, createdAt: new Date().toISOString(), via: "text" },
      ]);
      pushAssistant({ text: verb, proposal: action });
    },
    [pushAssistant],
  );

  const updateProposal = (messageId: string, patch: Partial<NonNullable<AssistantMessage["proposal"]>>) =>
    setMessages((m) =>
      m.map((msg) => (msg.id === messageId && msg.proposal ? { ...msg, proposal: { ...msg.proposal, ...patch } } : msg)),
    );

  const confirm = React.useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg?.proposal || msg.proposal.status !== "pending") return;
      const result = executeAction(msg.proposal.action, actions);
      if (result.ok) {
        updateProposal(messageId, { status: "confirmed" });
        pushAssistant(result.reply);
        window.setTimeout(() => pushAssistant({ text: "Anything else you want to do?" }), 500);
      } else {
        updateProposal(messageId, { status: "failed", error: result.error });
        pushAssistant({ text: `I couldn't do that: ${result.error}. Nothing was changed.` });
      }
    },
    [messages, actions, pushAssistant],
  );

  const cancel = React.useCallback(
    (messageId: string) => {
      updateProposal(messageId, { status: "cancelled" });
      pushAssistant({ text: "Okay, cancelled. Nothing was changed." });
    },
    [pushAssistant],
  );

  const reset = React.useCallback(() => {
    memoryRef.current = {};
    setMessages([]);
    setThinking(false);
  }, []);

  return (
    <AssistantContext.Provider value={{ messages, thinking, readAloud, setReadAloud, send, propose, confirm, cancel, reset }}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantValue {
  const ctx = React.useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return ctx;
}

export type { Chip };
