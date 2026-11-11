"use client";

/**
 * Global UI state for panels and forms, so any screen (or the assistant)
 * can open an enquiry, a job, or a form without prop-drilling.
 */
import * as React from "react";
import type { FormPrefill } from "@/lib/assistant/types";

interface UIState {
  enquiryId: string | null;
  jobId: string | null;
  form: FormPrefill | null;
  assistantOpen: boolean;
}

interface UIValue extends UIState {
  openEnquiry(id: string): void;
  openJob(id: string): void;
  openForm(prefill: FormPrefill): void;
  closeEnquiry(): void;
  closeJob(): void;
  closeForm(): void;
  setAssistantOpen(open: boolean): void;
}

const UIContext = React.createContext<UIValue | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<UIState>({ enquiryId: null, jobId: null, form: null, assistantOpen: false });
  const value = React.useMemo<UIValue>(
    () => ({
      ...state,
      openEnquiry: (id) => setState((s) => ({ ...s, enquiryId: id, jobId: null })),
      openJob: (id) => setState((s) => ({ ...s, jobId: id, enquiryId: null })),
      openForm: (form) => setState((s) => ({ ...s, form })),
      closeEnquiry: () => setState((s) => ({ ...s, enquiryId: null })),
      closeJob: () => setState((s) => ({ ...s, jobId: null })),
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
