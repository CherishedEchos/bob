/**
 * Bob conversation contracts shared by server and client.
 *
 * The server owns everything: it decides what Bob says, which tools run and
 * which actions need approval. The client renders messages, cards and action
 * cards, and sends the user's decision (approve / cancel / undo) back.
 */
import type { PriorityItem } from "@/lib/derive";

export type ActionStatus = "pending" | "executing" | "executed" | "failed" | "cancelled" | "expired" | "undone";
export type ActionCategory = "read" | "internal" | "external";

export interface ActionLine {
  label: string;
  value: string;
  emphasis?: boolean;
}

export type ActionPreview =
  | { kind: "email"; to: string; subject: string; body: string; channelNote?: string }
  | {
      kind: "invoice";
      customer: string;
      job?: string;
      description: string;
      amountsAre: "inclusive" | "exclusive" | "no_vat";
      subtotal: number;
      vat: number;
      vatRate: number;
      total: number;
      dueDate: string;
      ref?: string;
    };

export interface ActionNotice {
  tone: "info" | "warning" | "demo";
  text: string;
}

/** A proposed or completed action, as shown in Bob's confirmation card. */
export interface ActionView {
  id: string;
  tool: string;
  category: ActionCategory;
  title: string;
  lines: ActionLine[];
  preview?: ActionPreview;
  notices: ActionNotice[];
  status: ActionStatus;
  approveLabel: string;
  /** True when executing it would only be simulated (demo integrations). */
  simulated: boolean;
  canUndo: boolean;
  resultMessage?: string;
  error?: string;
  createdAt: string;
  expiresAt: string;
  /** Records to open after it ran (e.g. the new job). */
  links?: { label: string; kind: "job" | "enquiry" | "invoice" | "customer" | "task" | "page"; id: string }[];
}

export type Card =
  | { type: "priorities"; items: PriorityItem[] }
  | { type: "enquiries"; ids: string[] }
  | { type: "jobs"; ids: string[]; show?: "deposit" | "balance" | "progress" }
  | { type: "invoices"; ids: string[] }
  | { type: "tasks"; ids: string[] }
  | { type: "customers"; ids: string[] }
  | { type: "job_detail"; jobId: string }
  | {
      type: "stats";
      title: string;
      period?: string;
      rows: { label: string; value: string; tone?: "default" | "warn" | "good" }[];
      footnote?: string;
    }
  | { type: "warning"; text: string }
  | { type: "draft"; to: string; subject: string; body: string; note?: string };

export type Chip =
  | { kind: "send"; label: string; text: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "open"; label: string; record: "job" | "enquiry" | "invoice" | "customer"; id: string };

export interface BobMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  via?: "voice" | "text";
  cards?: Card[];
  chips?: Chip[];
  action?: ActionView;
  /** Which engine produced it (shown subtly for transparency). */
  engine?: "rules" | "claude";
}

export interface BobTurnResponse {
  conversationId: string;
  messages: BobMessage[];
  /** True if any business record changed — the client refreshes its snapshot. */
  changed: boolean;
}
