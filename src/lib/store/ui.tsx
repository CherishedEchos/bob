"use client";

/**
 * Global UI state for panels and forms, so any screen (or Bob) can open an
 * enquiry, job, customer or form without prop-drilling.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

export type FormPrefill =
  | { form: "job"; values?: Partial<Record<string, string>>; enquiryId?: string; customerId?: string }
  | { form: "payment"; jobId?: string; amount?: number }
  | { form: "reminder"; title?: string; dueDate?: string; customerId?: string; relatedType?: "enquiry" | "job"; relatedId?: string; assignedPersonId?: string }
  | { form: "enquiry" }
  | { form: "customer" }
  | { form: "invoice"; customerId?: string; jobId?: string; amount?: number }
  | { form: "expense"; jobId?: string }
  | { form: "quote"; customerId?: string; enquiryId?: string; jobId?: string }
  | { form: "booking"; bookingId?: string; jobId?: string; date?: string; personIds?: string[]; focus?: "people" }
  | { form: "person"; personId?: string }
  | { form: "material"; jobId?: string; materialId?: string }
  | { form: "bill"; jobId?: string }
  | { form: "merchant"; merchantId?: string };

export type JobTab = "overview" | "schedule" | "tasks" | "materials" | "files" | "handover" | "money";

interface UIState {
  enquiryId: string | null;
  /** Where to take the user inside the enquiry (e.g. straight to the reply). */
  enquiryFocus: "reply" | null;
  jobId: string | null;
  /** Which part of the job profile to show first. */
  jobTab: JobTab;
  customerId: string | null;
  form: FormPrefill | null;
  assistantOpen: boolean;
}

interface UIValue extends UIState {
  openEnquiry(id: string, opts?: { focus?: "reply" }): void;
  openJob(id: string, opts?: { tab?: JobTab }): void;
  openCustomer(id: string): void;
  openForm(prefill: FormPrefill): void;
  closeEnquiry(): void;
  /** Where an inline enquiry (desktop list + detail) should scroll to. */
  setEnquiryFocus(focus: "reply" | null): void;
  closeJob(): void;
  closeCustomer(): void;
  closeForm(): void;
  setAssistantOpen(open: boolean): void;
}

const UIContext = React.createContext<UIValue | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = React.useState<UIState>({ enquiryId: null, enquiryFocus: null, jobId: null, jobTab: "overview", customerId: null, form: null, assistantOpen: false });
  const value = React.useMemo<UIValue>(
    () => ({
      ...state,
      openEnquiry: (id, opts) => setState((s) => ({ ...s, enquiryId: id, enquiryFocus: opts?.focus ?? null, jobId: null, customerId: null, assistantOpen: false })),
      // A job is a full page (/jobs/[id]) so it can be linked, refreshed and shared.
      openJob: (id, opts) => {
        setState((s) => ({ ...s, jobId: null, jobTab: opts?.tab ?? "overview", enquiryId: null, customerId: null, assistantOpen: false }));
        router.push(`/jobs/${encodeURIComponent(id)}${opts?.tab && opts.tab !== "overview" ? `?tab=${opts.tab}` : ""}`);
      },
      openCustomer: (id) => setState((s) => ({ ...s, customerId: id, jobId: null, enquiryId: null, assistantOpen: false })),
      openForm: (form) => setState((s) => ({ ...s, form })),
      closeEnquiry: () => setState((s) => ({ ...s, enquiryId: null })),
      setEnquiryFocus: (enquiryFocus) => setState((s) => ({ ...s, enquiryFocus })),
      closeJob: () => setState((s) => ({ ...s, jobId: null })),
      closeCustomer: () => setState((s) => ({ ...s, customerId: null })),
      closeForm: () => setState((s) => ({ ...s, form: null })),
      setAssistantOpen: (assistantOpen) => setState((s) => ({ ...s, assistantOpen })),
    }),
    [state, router],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIValue {
  const ctx = React.useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
}
