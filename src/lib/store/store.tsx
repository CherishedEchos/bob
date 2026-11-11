"use client";

/**
 * Client data store — a thin, server-backed cache.
 *
 * The browser never decides what data it may see: it fetches a snapshot that
 * the server builds for the signed-in user's organisation and role. Every
 * change is a request to the server (validated, permission-checked, audited);
 * the UI only reports success when the server confirms it.
 */
import * as React from "react";
import type { AppUser, EnquiryStatus, JobStatus, Note, OrgConfig, Snapshot, Task } from "@/lib/types";
import type { ActionView } from "@/lib/bob/types";
import type { FieldErrors } from "@/lib/validation";
import { can as roleCan, type Permission } from "@/lib/auth/permissions";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export interface StoreActions {
  createEnquiry(input: unknown): Promise<Result<{ id: string }>>;
  updateEnquiry(id: string, patch: Record<string, unknown>): Promise<Result<unknown>>;
  setEnquiryStatus(id: string, status: EnquiryStatus): Promise<Result<unknown>>;
  addEnquiryNote(id: string, text: string): Promise<Result<Note>>;
  saveDraftReply(id: string, text: string): Promise<Result<unknown>>;
  markEnquiryReplied(id: string): Promise<Result<unknown>>;
  createCustomer(input: unknown): Promise<Result<{ id: string }>>;
  updateCustomer(id: string, input: unknown): Promise<Result<unknown>>;
  addCustomerNote(id: string, text: string): Promise<Result<Note>>;
  createJob(input: unknown): Promise<Result<{ id: string; title: string; customerName: string }>>;
  updateJob(id: string, patch: Record<string, unknown>): Promise<Result<unknown>>;
  setJobStatus(id: string, status: JobStatus): Promise<Result<unknown>>;
  addJobNote(id: string, text: string): Promise<Result<Note>>;
  recordPayment(input: unknown): Promise<Result<{ statusAdvanced: boolean }>>;
  logPaymentChased(jobId: string): Promise<Result<unknown>>;
  createTask(input: unknown): Promise<Result<Task>>;
  setTaskDone(id: string, done: boolean): Promise<Result<Task>>;
  deleteTask(id: string): Promise<Result<Task>>;
  addExpense(input: unknown): Promise<Result<unknown>>;
  removeExpense(id: string): Promise<Result<unknown>>;
  createQuote(input: unknown): Promise<Result<unknown>>;
  setQuoteStatus(id: string, status: string): Promise<Result<unknown>>;
  createInvoiceDraft(input: unknown): Promise<Result<{ id: string; draftRef: string }>>;
  markInvoiceSent(id: string): Promise<Result<unknown>>;
  voidInvoice(id: string): Promise<Result<unknown>>;
  deleteInvoiceDraft(id: string): Promise<Result<unknown>>;
  syncInbox(): Promise<Result<{ created: { id: string; customerName: string }[]; skipped: number; duplicates: number; flagged: { customerName: string }[] }>>;
}

interface StoreValue {
  data: Snapshot;
  user: AppUser;
  org: OrgConfig;
  actions: StoreActions;
  can(p: Permission): boolean;
  refresh(): Promise<void>;
  /** Replace the snapshot (e.g. after a settings change returned one). */
  setSnapshot(s: Snapshot): void;
  /** Ask the server to prepare an approval-gated action (same engine Bob uses). */
  propose(tool: string, args: unknown): Promise<{ ok: true; action: ActionView } | { ok: false; error: string }>;
  decide(id: string, decision: "approve" | "cancel" | "undo", edits?: Record<string, string>): Promise<ActionView | null>;
  getSnapshot(): Snapshot;
}

const StoreContext = React.createContext<StoreValue | null>(null);

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<{ status: number; body: T }> {
  const res = await fetch(path, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: { ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
    window.location.href = "/login";
  }
  let body: T;
  try {
    body = (await res.json()) as T;
  } catch {
    body = { error: "Unexpected response from the server" } as T;
  }
  return { status: res.status, body };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = React.useState<Snapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const dataRef = React.useRef<Snapshot | null>(null);

  const apply = React.useCallback((s: Snapshot) => {
    dataRef.current = s;
    setData(s);
  }, []);

  const refresh = React.useCallback(async () => {
    const r = await api<Snapshot & { error?: string }>("/api/data");
    if (r.status === 200) apply(r.body);
    else setError(r.body.error ?? "Couldn't load your data");
  }, [apply]);

  React.useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const actions = React.useMemo<StoreActions>(() => {
    async function op<T>(name: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
      try {
        const r = await api<{ ok?: boolean; value?: T; error?: string; fieldErrors?: FieldErrors; snapshot?: Snapshot }>("/api/ops", { json: { op: name, args } });
        if (r.body.snapshot) apply(r.body.snapshot);
        if (r.status === 200 && r.body.ok) return { ok: true, value: r.body.value as T };
        return { ok: false, errors: r.body.fieldErrors && Object.keys(r.body.fieldErrors).length ? { ...r.body.fieldErrors, _: r.body.error ?? "" } : { _: r.body.error ?? "Something went wrong" } };
      } catch {
        return { ok: false, errors: { _: "Couldn't reach the server. Nothing was changed." } };
      }
    }
    return {
      createEnquiry: (input) => op("createEnquiry", { input }),
      updateEnquiry: (id, patch) => op("updateEnquiry", { id, patch }),
      setEnquiryStatus: (id, status) => op("setEnquiryStatus", { id, status }),
      addEnquiryNote: (id, text) => op("addEnquiryNote", { id, text }),
      saveDraftReply: (id, text) => op("saveDraftReply", { id, text }),
      markEnquiryReplied: (id) => op("markEnquiryReplied", { id }),
      createCustomer: (input) => op("createCustomer", { input }),
      updateCustomer: (id, input) => op("updateCustomer", { id, input }),
      addCustomerNote: (id, text) => op("addCustomerNote", { id, text }),
      createJob: (input) => op("createJob", { input }),
      updateJob: (id, patch) => op("updateJob", { id, patch }),
      setJobStatus: (id, status) => op("setJobStatus", { id, status }),
      addJobNote: (id, text) => op("addJobNote", { id, text }),
      recordPayment: (input) => op("recordPayment", { input }),
      logPaymentChased: (jobId) => op("logPaymentChased", { jobId }),
      createTask: (input) => op("createTask", { input }),
      setTaskDone: (id, done) => op("setTaskDone", { id, done }),
      deleteTask: (id) => op("deleteTask", { id }),
      addExpense: (input) => op("addExpense", { input }),
      removeExpense: (id) => op("removeExpense", { id }),
      createQuote: (input) => op("createQuote", { input }),
      setQuoteStatus: (id, status) => op("setQuoteStatus", { id, status }),
      createInvoiceDraft: (input) => op("createInvoiceDraft", { input }),
      markInvoiceSent: (id) => op("markInvoiceSent", { id }),
      voidInvoice: (id) => op("voidInvoice", { id }),
      deleteInvoiceDraft: (id) => op("deleteInvoiceDraft", { id }),
      syncInbox: () => op("syncInbox"),
    };
  }, [apply]);

  const propose = React.useCallback(async (tool: string, args: unknown) => {
    const r = await api<{ action?: ActionView; error?: string }>("/api/bob/actions", { json: { tool, args } });
    if (r.status === 200 && r.body.action) return { ok: true as const, action: r.body.action };
    return { ok: false as const, error: r.body.error ?? "Couldn't prepare that" };
  }, []);

  const decide = React.useCallback(
    async (id: string, decision: "approve" | "cancel" | "undo", edits?: Record<string, string>) => {
      const r = await api<{ action?: ActionView; changed?: boolean }>(`/api/bob/actions/${encodeURIComponent(id)}`, { json: { decision, edits } });
      if (r.body.changed) await refresh();
      return r.body.action ?? null;
    },
    [refresh],
  );

  const getSnapshot = React.useCallback(() => dataRef.current!, []);

  if (!data) return <SplashScreen error={error} onRetry={refresh} />;

  return (
    <StoreContext.Provider
      value={{
        data,
        user: data.user,
        org: data.org,
        actions,
        can: (p) => roleCan(data.user.role, p),
        refresh,
        setSnapshot: apply,
        propose,
        decide,
        getSnapshot,
      }}
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

function SplashScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="bg-app flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="relative size-16">
        <div className="absolute inset-0 animate-ping-slow rounded-full bg-copper-500/40" />
        <div className="relative size-16 rounded-full bg-copper-500/20 ring-1 ring-copper-400/50" />
      </div>
      {error ? (
        <div>
          <p className="text-[15px] text-muted-foreground">{error}</p>
          <button onClick={onRetry} className="mt-3 text-[14px] font-medium text-copper-300 underline">
            Try again
          </button>
        </div>
      ) : (
        <span className="sr-only">Loading Bob</span>
      )}
    </div>
  );
}
