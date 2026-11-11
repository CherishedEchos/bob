/**
 * Applies a confirmed ProposedAction through the store.
 * Success text is built from what the store actually returned — never assumed.
 */
import type { StoreActions } from "@/lib/store/store";
import { PAYMENT_TYPE_LABEL } from "@/lib/derive";
import { gbp, todayKey, firstName, formatDateInline } from "@/lib/utils";
import type { AssistantReply, ProposedAction } from "./types";

export type ExecutionResult = { ok: true; reply: AssistantReply } | { ok: false; error: string };

const firstError = (errors: Record<string, string>) => Object.values(errors)[0] ?? "Something went wrong";

export function executeAction(action: ProposedAction, store: StoreActions): ExecutionResult {
  switch (action.type) {
    case "create_job": {
      const res = store.createJob({ ...action.job, description: action.job.description ?? "" });
      if (!res.ok) return { ok: false, error: firstError(res.errors) };
      const job = res.value;
      if (action.depositPaid && action.depositPaid > 0) {
        const pay = store.recordPayment({
          jobId: job.id,
          amount: action.depositPaid,
          type: "deposit",
          method: "bank_transfer",
          receivedAt: todayKey(),
        });
        if (!pay.ok) {
          return {
            ok: true,
            reply: {
              text: `I've added the job, but couldn't record the deposit: ${firstError(pay.errors)}. You can record it from the job.`,
              cards: [{ type: "job_result", jobId: job.id }],
              memory: { lastJobId: job.id },
            },
          };
        }
      }
      return {
        ok: true,
        reply: {
          text: action.depositPaid ? "Got it. I've added the job and recorded the deposit:" : "Got it. I've added the job:",
          cards: [{ type: "job_result", jobId: job.id }],
          memory: { lastJobId: job.id },
        },
      };
    }
    case "record_payment": {
      const res = store.recordPayment({
        jobId: action.jobId,
        amount: action.amount,
        type: action.paymentType,
        method: action.method,
        receivedAt: todayKey(),
      });
      if (!res.ok) return { ok: false, error: firstError(res.errors) };
      const { job, statusAdvanced } = res.value;
      return {
        ok: true,
        reply: {
          text: `Done — ${gbp(action.amount)} ${PAYMENT_TYPE_LABEL[action.paymentType].toLowerCase()} recorded for ${job.customerName}.${statusAdvanced ? " Deposit's covered, so I've moved the job to Scheduled." : ""}`,
          cards: [{ type: "payment_result", jobId: job.id, amount: action.amount }],
          memory: { lastJobId: job.id },
        },
      };
    }
    case "mark_replied": {
      const res = store.markEnquiryReplied(action.enquiryId);
      if (!res.ok) return { ok: false, error: firstError(res.errors) };
      return { ok: true, reply: { text: `Marked ${firstName(res.value.customerName)} as replied to.`, memory: { lastEnquiryId: res.value.id } } };
    }
    case "save_draft": {
      const res = store.saveDraftReply(action.enquiryId, action.text);
      if (!res.ok) return { ok: false, error: firstError(res.errors) };
      return {
        ok: true,
        reply: { text: `Saved the draft on ${firstName(res.value.customerName)}'s enquiry. It hasn't been sent.`, memory: { lastEnquiryId: res.value.id } },
      };
    }
    case "create_reminder": {
      const res = store.createReminder({
        title: action.title,
        dueDate: action.dueDate,
        relatedType: action.relatedType,
        relatedId: action.relatedId,
      });
      if (!res.ok) return { ok: false, error: firstError(res.errors) };
      return {
        ok: true,
        reply: { text: `Reminder set for ${formatDateInline(res.value.dueDate)}: "${res.value.title}".` },
      };
    }
  }
}
