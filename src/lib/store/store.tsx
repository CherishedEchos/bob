"use client";

/**
 * Application store.
 *
 * Every mutation:
 *   1. validates input with zod (same schemas the server will use),
 *   2. applies an immutable change,
 *   3. appends an audit entry (shown as "Recent activity"),
 *   4. persists via the Repository.
 * Mutations return a Result so callers (forms, assistant) only report success
 * when the change has genuinely been recorded.
 */
import * as React from "react";
import type {
  ActivityEntry,
  AppData,
  AppUser,
  Enquiry,
  EnquiryStatus,
  Job,
  JobStatus,
  Note,
  Payment,
  Reminder,
} from "@/lib/types";
import { createRepository, type Repository } from "@/lib/data/repository";
import {
  enquiryInputSchema,
  jobInputSchema,
  noteInputSchema,
  paymentInputSchema,
  reminderInputSchema,
  toFieldErrors,
  type FieldErrors,
} from "@/lib/validation";
import { ENQUIRY_STATUS_LABEL, JOB_STATUS_LABEL, PAYMENT_TYPE_LABEL, jobFinance } from "@/lib/derive";
import { gbp, uid } from "@/lib/utils";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export const DEMO_USERS: AppUser[] = [
  { id: "user_owner", displayName: "Owner", role: "owner" },
  { id: "user_office", displayName: "Office", role: "admin" },
];

type EnquiryPatch = Partial<Pick<Enquiry, "priority" | "followUpDate" | "draftReply">>;
type JobPatch = Partial<Pick<Job, "nextAction" | "startDate" | "depositDueDate">>;

export interface StoreActions {
  createEnquiry(input: unknown): Result<Enquiry>;
  updateEnquiry(id: string, patch: EnquiryPatch): Result<Enquiry>;
  setEnquiryStatus(id: string, status: EnquiryStatus): Result<Enquiry>;
  addEnquiryNote(id: string, text: string): Result<Note>;
  saveDraftReply(id: string, text: string): Result<Enquiry>;
  markEnquiryReplied(id: string): Result<Enquiry>;
  createJob(input: unknown): Result<Job>;
  updateJob(id: string, patch: JobPatch): Result<Job>;
  setJobStatus(id: string, status: JobStatus): Result<Job>;
  addJobNote(id: string, text: string): Result<Note>;
  recordPayment(input: unknown): Result<{ payment: Payment; job: Job; statusAdvanced: boolean }>;
  logPaymentChased(jobId: string): Result<Job>;
  createReminder(input: unknown): Result<Reminder>;
  toggleReminder(id: string): Result<Reminder>;
  deleteReminder(id: string): Result<Reminder>;
  resetDemo(): Promise<void>;
}

interface StoreValue {
  data: AppData;
  user: AppUser;
  setUser(id: string): void;
  repositoryKind: Repository["kind"];
  actions: StoreActions;
  /** Latest snapshot, for non-React callers (e.g. the assistant engine). */
  getSnapshot(): AppData;
}

const StoreContext = React.createContext<StoreValue | null>(null);

const notFound = (what: string): { ok: false; errors: FieldErrors } => ({
  ok: false,
  errors: { _: `${what} not found` },
});

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const repoRef = React.useRef<Repository | null>(null);
  const dataRef = React.useRef<AppData | null>(null);
  const [data, setData] = React.useState<AppData | null>(null);
  const [userId, setUserId] = React.useState<string>(DEMO_USERS[0].id);
  const user = DEMO_USERS.find((u) => u.id === userId) ?? DEMO_USERS[0];
  const userRef = React.useRef(user);
  userRef.current = user;

  React.useEffect(() => {
    const repo = createRepository();
    repoRef.current = repo;
    let cancelled = false;
    repo.load().then((loaded) => {
      if (cancelled) return;
      dataRef.current = loaded;
      setData(loaded);
    });
    try {
      const saved = window.localStorage.getItem("ninety3.demo.user");
      if (saved && DEMO_USERS.some((u) => u.id === saved)) setUserId(saved);
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const setUser = React.useCallback((id: string) => {
    setUserId(id);
    try {
      window.localStorage.setItem("ninety3.demo.user", id);
    } catch {
      /* ignore */
    }
  }, []);

  const actions = React.useMemo<StoreActions>(() => {
    const now = () => new Date().toISOString();
    const actor = () => userRef.current.displayName;

    /** Apply a change + audit entry atomically, then persist. */
    function commit(mutate: (d: AppData) => AppData, entry?: Omit<ActivityEntry, "id" | "at" | "actor">) {
      const current = dataRef.current;
      if (!current) throw new Error("Store not ready");
      let next = mutate(current);
      if (entry) {
        next = {
          ...next,
          activity: [{ id: uid("act"), at: now(), actor: actor(), ...entry }, ...next.activity].slice(0, 200),
        };
      }
      dataRef.current = next;
      setData(next);
      void repoRef.current?.persist(next);
      return next;
    }

    const getEnquiry = (id: string) => dataRef.current?.enquiries.find((e) => e.id === id);
    const getJob = (id: string) => dataRef.current?.jobs.find((j) => j.id === id);
    const replaceEnquiry = (d: AppData, e: Enquiry): AppData => ({
      ...d,
      enquiries: d.enquiries.map((x) => (x.id === e.id ? e : x)),
    });
    const replaceJob = (d: AppData, j: Job): AppData => ({ ...d, jobs: d.jobs.map((x) => (x.id === j.id ? j : x)) });

    const makeNote = (text: string): Note => ({ id: uid("note"), text, createdAt: now(), author: actor() });

    return {
      createEnquiry(input) {
        const parsed = enquiryInputSchema.safeParse(input);
        if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
        const v = parsed.data;
        const enquiry: Enquiry = {
          id: uid("enq"),
          customerName: v.customerName,
          email: v.email || undefined,
          phone: v.phone || undefined,
          instagramHandle: v.instagramHandle || undefined,
          source: v.source,
          title: v.title,
          description: v.description,
          location: v.location,
          receivedAt: now(),
          status: "new",
          priority: v.priority,
          notes: [],
          followUpDate: v.followUpDate || undefined,
          suggestedReply: `Hi ${v.customerName.split(" ")[0]},\n\nThanks for getting in touch about the ${v.title.toLowerCase()}. Could you send over a few photos and rough measurements? Then we can arrange a time to come and have a look.\n\nThanks,\nNinety3`,
        };
        commit((d) => ({ ...d, enquiries: [enquiry, ...d.enquiries] }), {
          action: "enquiry.created",
          summary: `Enquiry logged for ${enquiry.customerName} — ${enquiry.title}, ${enquiry.location}`,
          entityType: "enquiry",
          entityId: enquiry.id,
        });
        return { ok: true, value: enquiry };
      },

      updateEnquiry(id, patch) {
        const e = getEnquiry(id);
        if (!e) return notFound("Enquiry");
        const updated = { ...e, ...patch };
        const changed = Object.keys(patch).join(", ").replace("followUpDate", "follow-up date");
        commit((d) => replaceEnquiry(d, updated), {
          action: "enquiry.updated",
          summary: `Updated ${changed} on ${e.customerName}'s enquiry`,
          entityType: "enquiry",
          entityId: id,
        });
        return { ok: true, value: updated };
      },

      setEnquiryStatus(id, status) {
        const e = getEnquiry(id);
        if (!e) return notFound("Enquiry");
        if (e.status === status) return { ok: true, value: e };
        const updated: Enquiry = {
          ...e,
          status,
          lastContactAt: status === "replied" ? now() : e.lastContactAt,
        };
        commit((d) => replaceEnquiry(d, updated), {
          action: "enquiry.status_changed",
          summary: `${e.customerName}'s enquiry moved to ${ENQUIRY_STATUS_LABEL[status]}`,
          entityType: "enquiry",
          entityId: id,
        });
        return { ok: true, value: updated };
      },

      addEnquiryNote(id, text) {
        const e = getEnquiry(id);
        if (!e) return notFound("Enquiry");
        const parsed = noteInputSchema.safeParse({ text });
        if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
        const note = makeNote(parsed.data.text);
        commit((d) => replaceEnquiry(d, { ...e, notes: [note, ...e.notes] }), {
          action: "enquiry.note_added",
          summary: `Note added to ${e.customerName}'s enquiry`,
          entityType: "enquiry",
          entityId: id,
        });
        return { ok: true, value: note };
      },

      saveDraftReply(id, text) {
        const e = getEnquiry(id);
        if (!e) return notFound("Enquiry");
        const parsed = noteInputSchema.safeParse({ text });
        if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
        const updated = { ...e, draftReply: parsed.data.text };
        commit((d) => replaceEnquiry(d, updated), {
          action: "enquiry.draft_saved",
          summary: `Draft reply saved for ${e.customerName} (not sent)`,
          entityType: "enquiry",
          entityId: id,
        });
        return { ok: true, value: updated };
      },

      markEnquiryReplied(id) {
        const e = getEnquiry(id);
        if (!e) return notFound("Enquiry");
        const updated: Enquiry = {
          ...e,
          status: e.status === "new" || e.status === "awaiting_reply" ? "replied" : e.status,
          lastContactAt: now(),
        };
        commit((d) => replaceEnquiry(d, updated), {
          action: "enquiry.marked_replied",
          summary: `${e.customerName} marked as replied to`,
          entityType: "enquiry",
          entityId: id,
        });
        return { ok: true, value: updated };
      },

      createJob(input) {
        const parsed = jobInputSchema.safeParse(input);
        if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
        const v = parsed.data;
        const job: Job = {
          id: uid("job"),
          customerName: v.customerName,
          customerPhone: v.customerPhone || undefined,
          customerEmail: v.customerEmail || undefined,
          title: v.title,
          description: v.description,
          location: v.location,
          kind: inferJobKind(v.title + " " + v.description),
          quotedValue: v.quotedValue,
          depositRequired: v.depositRequired,
          status: v.status,
          startDate: v.startDate || undefined,
          depositDueDate: v.depositDueDate || undefined,
          nextAction: v.nextAction || undefined,
          notes: [],
          enquiryId: v.enquiryId,
          createdAt: now(),
        };
        commit(
          (d) => {
            let next: AppData = { ...d, jobs: [job, ...d.jobs] };
            if (v.enquiryId) {
              next = {
                ...next,
                enquiries: next.enquiries.map((e) =>
                  e.id === v.enquiryId ? { ...e, status: "won" as const, jobId: job.id } : e,
                ),
              };
            }
            return next;
          },
          {
            action: "job.created",
            summary: `Job added: ${job.title} for ${job.customerName}, ${job.location} (${gbp(job.quotedValue)})`,
            entityType: "job",
            entityId: job.id,
          },
        );
        return { ok: true, value: job };
      },

      updateJob(id, patch) {
        const j = getJob(id);
        if (!j) return notFound("Job");
        const updated = { ...j, ...patch };
        commit((d) => replaceJob(d, updated), {
          action: "job.updated",
          summary: `Updated ${j.customerName}'s ${j.title.toLowerCase()}`,
          entityType: "job",
          entityId: id,
        });
        return { ok: true, value: updated };
      },

      setJobStatus(id, status) {
        const j = getJob(id);
        if (!j) return notFound("Job");
        if (j.status === status) return { ok: true, value: j };
        const updated = { ...j, status };
        commit((d) => replaceJob(d, updated), {
          action: "job.status_changed",
          summary: `${j.customerName}'s ${j.title.toLowerCase()} moved to ${JOB_STATUS_LABEL[status]}`,
          entityType: "job",
          entityId: id,
        });
        return { ok: true, value: updated };
      },

      addJobNote(id, text) {
        const j = getJob(id);
        if (!j) return notFound("Job");
        const parsed = noteInputSchema.safeParse({ text });
        if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
        const note = makeNote(parsed.data.text);
        commit((d) => replaceJob(d, { ...j, notes: [note, ...j.notes] }), {
          action: "job.note_added",
          summary: `Note added to ${j.customerName}'s ${j.title.toLowerCase()}`,
          entityType: "job",
          entityId: id,
        });
        return { ok: true, value: note };
      },

      recordPayment(input) {
        const parsed = paymentInputSchema.safeParse(input);
        if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
        const v = parsed.data;
        const j = getJob(v.jobId);
        if (!j) return notFound("Job");
        const before = jobFinance(j, dataRef.current!.payments);
        if (v.amount > before.balance + 0.001) {
          return {
            ok: false,
            errors: { amount: `That's more than the ${gbp(before.balance)} left to pay on this job` },
          };
        }
        const payment: Payment = {
          id: uid("pay"),
          jobId: v.jobId,
          amount: v.amount,
          type: v.type,
          method: v.method,
          receivedAt: v.receivedAt,
          reference: v.reference || undefined,
          recordedBy: actor(),
          recordedAt: now(),
        };
        let statusAdvanced = false;
        let job = j;
        const next = commit(
          (d) => {
            const payments = [payment, ...d.payments];
            const after = jobFinance(j, payments);
            if (j.status === "awaiting_deposit" && after.depositOutstanding === 0) {
              statusAdvanced = true;
              job = { ...j, status: "scheduled" };
            }
            return { ...replaceJob(d, job), payments };
          },
          {
            action: "payment.recorded",
            summary: `${gbp(payment.amount)} ${PAYMENT_TYPE_LABEL[payment.type].toLowerCase()} recorded for ${j.customerName} — ${j.title}`,
            entityType: "job",
            entityId: j.id,
          },
        );
        job = next.jobs.find((x) => x.id === j.id) ?? job;
        return { ok: true, value: { payment, job, statusAdvanced } };
      },

      logPaymentChased(jobId) {
        const j = getJob(jobId);
        if (!j) return notFound("Job");
        const updated = { ...j, lastChasedAt: now() };
        commit((d) => replaceJob(d, updated), {
          action: "payment.chased",
          summary: `Payment chased with ${j.customerName} — ${j.title}`,
          entityType: "job",
          entityId: jobId,
        });
        return { ok: true, value: updated };
      },

      createReminder(input) {
        const parsed = reminderInputSchema.safeParse(input);
        if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
        const reminder: Reminder = {
          id: uid("rem"),
          ...parsed.data,
          done: false,
          createdAt: now(),
          createdBy: actor(),
        };
        commit((d) => ({ ...d, reminders: [reminder, ...d.reminders] }), {
          action: "reminder.created",
          summary: `Reminder set: ${reminder.title}`,
          entityType: "reminder",
          entityId: reminder.id,
        });
        return { ok: true, value: reminder };
      },

      toggleReminder(id) {
        const r = dataRef.current?.reminders.find((x) => x.id === id);
        if (!r) return notFound("Reminder");
        const updated = { ...r, done: !r.done };
        commit(
          (d) => ({ ...d, reminders: d.reminders.map((x) => (x.id === id ? updated : x)) }),
          {
            action: updated.done ? "reminder.completed" : "reminder.reopened",
            summary: `${updated.done ? "Done" : "Reopened"}: ${r.title}`,
            entityType: "reminder",
            entityId: id,
          },
        );
        return { ok: true, value: updated };
      },

      deleteReminder(id) {
        const r = dataRef.current?.reminders.find((x) => x.id === id);
        if (!r) return notFound("Reminder");
        commit((d) => ({ ...d, reminders: d.reminders.filter((x) => x.id !== id) }), {
          action: "reminder.deleted",
          summary: `Reminder removed: ${r.title}`,
          entityType: "reminder",
          entityId: id,
        });
        return { ok: true, value: r };
      },

      async resetDemo() {
        const repo = repoRef.current;
        if (!repo) return;
        const fresh = await repo.reset();
        dataRef.current = fresh;
        setData(fresh);
      },
    };
  }, []);

  const getSnapshot = React.useCallback(() => dataRef.current!, []);

  if (!data) return <SplashScreen />;

  return (
    <StoreContext.Provider
      value={{ data, user, setUser, repositoryKind: repoRef.current?.kind ?? "local-demo", actions, getSnapshot }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreValue {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

export function inferJobKind(text: string): Job["kind"] {
  const t = text.toLowerCase();
  if (/kitchen/.test(t)) return "kitchen";
  if (/loft|dormer/.test(t)) return "loft";
  if (/wardrobe|alcove|cupboard|storage/.test(t)) return "wardrobes";
  if (/extension|build|garage/.test(t)) return "extension";
  if (/deck/.test(t)) return "decking";
  if (/stair|banister|balustrade/.test(t)) return "staircase";
  return "general";
}

function SplashScreen() {
  return (
    <div className="bg-app flex min-h-dvh items-center justify-center">
      <div className="relative size-16">
        <div className="absolute inset-0 animate-ping-slow rounded-full bg-copper-500/40" />
        <div className="relative size-16 rounded-full bg-copper-500/20 ring-1 ring-copper-400/50" />
      </div>
      <span className="sr-only">Loading Ninety3 Assistant</span>
    </div>
  );
}
