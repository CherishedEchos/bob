/**
 * Assistant contracts.
 *
 * An engine turns user text into an AssistantReply. Engines are PURE: they
 * never change data. Anything that would change data comes back as a
 * ProposedAction, which the UI shows as a confirmation card and only the
 * executor (after an explicit tap on "Confirm") applies via the store.
 *
 * This keeps the swap to a real LLM safe: the model can propose tool calls,
 * but cannot send messages or touch payment records without the user.
 */
import type { AppData, JobStatus, PaymentMethod, PaymentType } from "@/lib/types";
import type { PriorityItem } from "@/lib/derive";

export type ProposedAction =
  | {
      type: "create_job";
      job: {
        customerName: string;
        title: string;
        location: string;
        quotedValue: number;
        depositRequired: number;
        status: JobStatus;
        description?: string;
      };
      depositPaid?: number;
    }
  | {
      type: "record_payment";
      jobId: string;
      amount: number;
      paymentType: PaymentType;
      method: PaymentMethod;
    }
  | { type: "mark_replied"; enquiryId: string }
  | { type: "save_draft"; enquiryId: string; text: string }
  | {
      type: "create_reminder";
      title: string;
      dueDate: string;
      relatedType?: "enquiry" | "job";
      relatedId?: string;
    };

export type FormPrefill =
  | { form: "job"; values?: Partial<Record<string, string>>; enquiryId?: string }
  | { form: "payment"; jobId?: string; amount?: number }
  | { form: "reminder"; title?: string; dueDate?: string }
  | { form: "enquiry" };

export type Chip =
  | { kind: "send"; label: string; text: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "propose"; label: string; action: ProposedAction }
  | { kind: "form"; label: string; prefill: FormPrefill };

export type Card =
  | { type: "enquiries"; ids: string[] }
  | { type: "jobs"; ids: string[]; show: "deposit" | "balance" | "progress" }
  | { type: "priorities"; items: PriorityItem[] }
  | { type: "reminders"; ids: string[] }
  | { type: "draft"; enquiryId: string; text: string }
  | { type: "job_result"; jobId: string }
  | { type: "payment_result"; jobId: string; amount: number };

export type ProposalStatus = "pending" | "confirmed" | "cancelled" | "failed";

export interface Proposal {
  id: string;
  action: ProposedAction;
  status: ProposalStatus;
  error?: string;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  via?: "voice" | "text";
  cards?: Card[];
  chips?: Chip[];
  proposal?: Proposal;
}

/** Short-term conversation memory so follow-ups like "yes" or "go through them" work. */
export interface ConversationMemory {
  lastIntent?: string;
  lastEnquiryId?: string;
  lastJobId?: string;
  pendingJob?: Partial<Extract<ProposedAction, { type: "create_job" }>["job"]> & { depositPaid?: number; depositMentioned?: number };
}

export interface AssistantContext {
  data: AppData;
  userName: string;
  memory: ConversationMemory;
}

export interface AssistantReply {
  text: string;
  cards?: Card[];
  chips?: Chip[];
  proposal?: ProposedAction;
  memory?: ConversationMemory;
}

export interface AssistantEngine {
  readonly id: string;
  readonly label: string;
  respond(input: string, ctx: AssistantContext): Promise<AssistantReply>;
}
