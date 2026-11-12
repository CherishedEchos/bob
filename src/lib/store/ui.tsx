"use client";

/**
 * Global UI state for panels and forms, so any screen (or Bob) can open an
 * enquiry, job, customer or form without prop-drilling.
 */
import * as React from "react";

export type FormPrefill =
  | { form: "job"; values?: Partial<Record<string, string>>; enquiryId?: string; customerId?: string }
  | { form: "payment"; jobId?: string; amount?: number }
  | { form: "reminder"; title?: string; dueDate?: string; customerId?: string; relatedType?: "enquiry" | "job"; relatedId?: string }
  | { form: "enquiry" }
  | { form: "customer" }
  | { form: "invoice"; customerId?: string; jobId?: string; amount?: number }
  | { form: "expense"; jobId?: string }
  | { form: "quote"; customerId?: string; enquiryId?: string; jobId?: string };

interface UIState {
  enquiryId: string | null;
  jobId: string | null;
  customerId: string | null;
  form: FormPrefill | null;
  assistantOpen: boolean;
}

interface UIValue extends UIState {
  openEnquiry(id: string): void;
  openJob(id: string): void;
  openCustomer(id: string): void;
  openForm(prefill: FormPrefill): void;
  closeEnquiry(): void;
  closeJob(): void;
  closeCustomer(): void;
  closeForm(): void;
  setAssistantOpen(open: boolean): void;
}

const UIContext = React.createContext<UIValue | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<UIState>({ enquiryId: null, jobId: null, customerId: null, form: null, assistantOpen: false });
  const value = React.useMemo<UIValue>(
    () => ({
      ...state,
      openEnquiry: (id) => setState((s) => ({ ...s, enquiryId: id, jobId: null, customerId: null, assistantOpen: false })),
      openJob: (id) => setState((s) => ({ ...s, jobId: id, enquiryId: null, customerId: null, assistantOpen: false })),
      openCustomer: (id) => setState((s) => ({ ...s, customerId: id, jobId: null, enquiryId: null, assistantOpen: false })),
      openForm: (form) => setState((s) => ({ ...s, form })),
      closeEnquiry: () => setState((s) => ({ ...s, enquiryId: null })),
      closeJob: () => setState((s) => ({ ...s, jobId: null })),
      closeCustomer: () => setState((s) => ({ ...s, customerId: null })),
      closeForm: () => setState((s) => ({ ...s, form: null })),
      setAssistantOpen: (assistantOpen) => setState((s) => ({ ...s, assistantOpen })),
    }),
    [state],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIValue {
  const ctx = React.useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside <UIProvider>");
  return ctx;
}
