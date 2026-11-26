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
import { BobLogo } from "@/components/brand/logo";
import { toast } from "@/components/ui/toaster";
import type { AppUser, EnquiryStatus, JobStatus, Note, OrgConfig, Snapshot, Task } from "@/lib/types";
import type { ActionView } from "@/lib/bob/types";
import type { FieldErrors } from "@/lib/validation";
import { setWorkspaceTimeZone } from "@/lib/utils";
import { can as roleCan, type Permission } from "@/lib/auth/permissions";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors; code?: string; current?: unknown; clashes?: { kind?: "booking" | "absence"; personId: string; personName: string; jobTitle: string; when: string }[] };

export interface StoreActions {
  createEnquiry(input: unknown): Promise<Result<{ id: string }>>;
  updateEnquiry(id: string, patch: Record<string, unknown>): Promise<Result<unknown>>;
  setEnquiryStatus(id: string, status: EnquiryStatus): Promise<Result<unknown>>;
  addEnquiryNote(id: string, text: string): Promise<Result<Note>>;
  saveDraftReply(id: string, text: string): Promise<Result<unknown>>;
  /** Any /api/ops operation (team, schedule, materials, bills…). */
  run<T = unknown>(name: string, args?: Record<string, unknown>): Promise<Result<T>>;
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
    setWorkspaceTimeZone(s.org.timeZone);
    dataRef.current = s;
    setData(s);
  }, []);

  const refresh = React.useCallback(async () => {
    setError(null);
    const r = await api<Snapshot & { error?: string }>("/api/data").catch(() => ({
      status: 0,
      body: { error: "Bob didn't respond. Check your connection, then try again." } as Snapshot & { error?: string },
    }));
    if (r.status === 200) {
      // Announce enquiries that arrived on their own (website form, inbox) since the last load.
      const before = dataRef.current;
      if (before && before.org.id === r.body.org.id) {
        const known = new Set(before.enquiries.map((e) => e.id));
        const fresh = r.body.enquiries.filter((e) => !known.has(e.id) && e.source !== "manual");
        if (fresh.length === 1) toast(`New ${fresh[0].source === "website" ? "website " : ""}enquiry from ${fresh[0].customerName} — reply drafted`, "success");
        else if (fresh.length > 1) toast(`${fresh.length} new enquiries`, "success");
      }
      apply(r.body);
    } else setError(r.body.error ?? "Couldn't load your data");
  }, [apply]);

  React.useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    // Pick up enquiries that arrive by themselves (website form) while Bob is open.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const actions = React.useMemo<StoreActions>(() => {
    async function op<T>(name: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
      try {
        const r = await api<{ ok?: boolean; value?: T; error?: string; fieldErrors?: FieldErrors; snapshot?: Snapshot; code?: string; clashes?: []; current?: unknown }>("/api/ops", { json: { op: name, args } });
        if (r.body.snapshot) apply(r.body.snapshot);
        if (r.status === 200 && r.body.ok) return { ok: true, value: r.body.value as T };
        const errors = r.body.fieldErrors && Object.keys(r.body.fieldErrors).length ? { ...r.body.fieldErrors, _: r.body.error ?? "" } : { _: r.body.error ?? "Something went wrong" };
        return { ok: false, errors, code: r.body.code, clashes: r.body.clashes, current: r.body.current };
      } catch {
        return { ok: false, errors: { _: "Couldn't reach the server. Nothing was changed." } };
      }
    }
    return {
      run: (name, args) => op(name, args),
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

/** Bob's launch screen: shown only while the workspace genuinely loads (motion is reduced if the user asks). */
function SplashScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="theme-dark flex min-h-dvh flex-col items-center justify-center gap-7 bg-[#141416] px-6 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full bg-[radial-gradient(circle,rgb(243_135_53/0.16),transparent_62%)]" />
      </div>
      <div className="relative animate-fade-up">
        <BobLogo height={54} title="Bob" />
      </div>
      {error ? (
        <div role="alert" className="relative max-w-sm">
          <p className="text-[16px] font-semibold text-white">Couldn&apos;t open the workspace</p>
          <p className="mt-1 text-[15px] text-white/65">{error}</p>
          <button onClick={onRetry} className="mt-4 h-11 rounded-lg bg-primary px-5 text-[15px] font-semibold text-white">
            Try again
          </button>
          <p className="mt-3 text-[13.5px] text-white/50">
            Still stuck? <a href="/login" className="font-medium text-copper-300 underline">Go back to the start</a> and tap Try the demo.
          </p>
        </div>
      ) : (
        <div className="relative flex flex-col items-center gap-3">
          <div className="h-[3px] w-40 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div className="h-full w-1/3 animate-[launch_1.1s_ease-in-out_infinite] rounded-full bg-copper-500" />
          </div>
          <p className="text-[13.5px] font-medium text-white/55" aria-live="polite">
            Opening your workspace…
          </p>
        </div>
      )}
    </div>
  );
}
