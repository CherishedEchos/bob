"use client";

/**
 * Dashboard forms — the manual, no-AI way to do everything Bob can do.
 * All validation and permission checks happen again on the server.
 */
import * as React from "react";
import { Check } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI, type FormPrefill } from "@/lib/store/ui";
import {
  ENQUIRY_SOURCES, EXPENSE_CATEGORY_LABEL, JOB_STATUSES, JOB_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, SOURCE_LABEL,
  computeInvoiceTotals, invoiceBalance, jobFinance,
} from "@/lib/derive";
import type { ExpenseCategory, PaymentMethod, PaymentType, VatTreatment } from "@/lib/types";
import type { FieldErrors } from "@/lib/validation";
import { addDaysKey, gbp, todayKey, formatDateInline } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyRow } from "@/components/common/bits";
import { toast } from "@/components/ui/toaster";

const TITLES: Record<FormPrefill["form"], [string, string]> = {
  job: ["New job", "Add the basics now — you can fill in the rest later."],
  payment: ["Record a payment", "Log money you've already received against a job."],
  reminder: ["Set a reminder", "It shows on your overview and Bob mentions it when it's due."],
  enquiry: ["Add an enquiry", "A call, message, email or form that came in. Use made-up details in the demo."],
  customer: ["New customer", "Only add details you actually have."],
  invoice: ["Invoice draft", "Saved as a draft. Nothing is sent from here."],
  expense: ["Add a cost", "Record materials, labour or hire against a job."],
  quote: ["Record a quote", "Log a quote you've sent so Bob can chase it."],
};

export function FormHost() {
  const ui = useUI();
  const form = ui.form;
  return (
    <Dialog open={!!form} onOpenChange={(o) => !o && ui.closeForm()}>
      {form ? (
        <DialogContent title={TITLES[form.form][0]} description={TITLES[form.form][1]}>
          {form.form === "job" ? <JobForm prefill={form} /> : null}
          {form.form === "payment" ? <PaymentForm prefill={form} /> : null}
          {form.form === "reminder" ? <ReminderForm prefill={form} /> : null}
          {form.form === "enquiry" ? <EnquiryForm /> : null}
          {form.form === "customer" ? <CustomerForm /> : null}
          {form.form === "invoice" ? <InvoiceForm prefill={form} /> : null}
          {form.form === "expense" ? <ExpenseForm prefill={form} /> : null}
          {form.form === "quote" ? <QuoteForm prefill={form} /> : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function FormActions({ submitLabel, onCancel, busy }: { submitLabel: string; onCancel: () => void; busy?: boolean }) {
  return (
    <div className="mt-6 flex gap-2">
      <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" className="flex-1" disabled={busy}>
        <Check /> {busy ? "Saving…" : submitLabel}
      </Button>
    </div>
  );
}

function FormError({ errors }: { errors: FieldErrors }) {
  return errors._ ? (
    <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-[14.5px] text-danger-fg ring-1 ring-red-500/25">
      {errors._}
    </p>
  ) : null;
}

type Change = React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;

function useFormState<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof T) => (e: Change) => setValues((s) => ({ ...s, [k]: e.target.value }));
  return { values, setValues, errors, setErrors, busy, setBusy, set };
}

/* ---------------------------------- Job ---------------------------------- */

function JobForm({ prefill }: { prefill: Extract<FormPrefill, { form: "job" }> }) {
  const { actions, data } = useStore();
  const ui = useUI();
  const v = prefill.values ?? {};
  const f = useFormState({
    customerId: prefill.customerId ?? "",
    customerName: v.customerName ?? "",
    customerPhone: v.customerPhone ?? "",
    customerEmail: v.customerEmail ?? "",
    title: v.title ?? "",
    location: v.location ?? "",
    description: v.description ?? "",
    quotedValue: v.quotedValue ?? "",
    depositRequired: v.depositRequired ?? "",
    status: "quoted",
    startDate: "",
    depositDueDate: "",
  });
  const { values, errors, set } = f;
  const quote = parseFloat(values.quotedValue || "0");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = await actions.createJob({
      ...values,
      customerId: values.customerId || undefined,
      depositRequired: values.depositRequired || "0",
      enquiryId: prefill.enquiryId,
    });
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast(`Job added for ${res.value.customerName}`);
    ui.closeForm();
    ui.openJob(res.value.id);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Customer" htmlFor="jf-cust" className="sm:col-span-2">
          <NativeSelect id="jf-cust" value={values.customerId} onChange={set("customerId")}>
            <option value="">New customer…</option>
            {data.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.town ? ` (${c.town})` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {!values.customerId ? (
          <>
            <Field label="Customer name" htmlFor="jf-name" error={errors.customerName} className="sm:col-span-2">
              <Input id="jf-name" value={values.customerName} onChange={set("customerName")} aria-invalid={!!errors.customerName} />
            </Field>
            <Field label="Phone (optional)" htmlFor="jf-phone" error={errors.customerPhone}>
              <Input id="jf-phone" type="tel" value={values.customerPhone} onChange={set("customerPhone")} />
            </Field>
            <Field label="Email (optional)" htmlFor="jf-email" error={errors.customerEmail}>
              <Input id="jf-email" type="email" value={values.customerEmail} onChange={set("customerEmail")} aria-invalid={!!errors.customerEmail} />
            </Field>
          </>
        ) : null}
        <Field label="Job" htmlFor="jf-title" error={errors.title}>
          <Input id="jf-title" value={values.title} onChange={set("title")} placeholder="e.g. Kitchen refit" aria-invalid={!!errors.title} />
        </Field>
        <Field label="Location" htmlFor="jf-loc" error={errors.location}>
          <Input id="jf-loc" value={values.location} onChange={set("location")} placeholder="e.g. Crawley" aria-invalid={!!errors.location} />
        </Field>
        <Field label="Price (£)" htmlFor="jf-quote" error={errors.quotedValue}>
          <Input id="jf-quote" inputMode="decimal" value={values.quotedValue} onChange={set("quotedValue")} placeholder="0" aria-invalid={!!errors.quotedValue} />
        </Field>
        <Field label="Deposit required (£)" htmlFor="jf-dep" error={errors.depositRequired}>
          <Input id="jf-dep" inputMode="decimal" value={values.depositRequired} onChange={set("depositRequired")} placeholder="0" aria-invalid={!!errors.depositRequired} />
          {quote > 0 ? (
            <div className="mt-2 flex gap-1.5">
              {[20, 30, 40].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => f.setValues((s) => ({ ...s, depositRequired: String(Math.round((quote * pct) / 100)) }))}
                  className="rounded-full bg-surface-2 px-2.5 py-1 text-[13px] text-muted-foreground ring-1 ring-line hover:text-foreground"
                >
                  {pct}%
                </button>
              ))}
            </div>
          ) : null}
        </Field>
        <Field label="Status" htmlFor="jf-status">
          <NativeSelect id="jf-status" value={values.status} onChange={set("status")}>
            {JOB_STATUSES.filter((s) => s !== "lost").map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Start date (optional)" htmlFor="jf-start" error={errors.startDate}>
          <Input id="jf-start" type="date" value={values.startDate} onChange={set("startDate")} />
        </Field>
        {parseFloat(values.depositRequired || "0") > 0 ? (
          <Field label="Deposit due (optional)" htmlFor="jf-ddue" error={errors.depositDueDate}>
            <Input id="jf-ddue" type="date" value={values.depositDueDate} onChange={set("depositDueDate")} />
          </Field>
        ) : null}
        <Field label="Description (optional)" htmlFor="jf-desc" className="sm:col-span-2">
          <Textarea id="jf-desc" value={values.description} onChange={set("description")} />
        </Field>
      </div>
      <FormActions submitLabel="Add job" onCancel={ui.closeForm} busy={f.busy} />
    </form>
  );
}

/* -------------------------------- Payment -------------------------------- */

function PaymentForm({ prefill }: { prefill: Extract<FormPrefill, { form: "payment" }> }) {
  const { actions, data } = useStore();
  const ui = useUI();
  const owing = data.jobs.filter((j) => jobFinance(j, data.payments).balance > 0);
  const f = useFormState({
    jobId: prefill.jobId ?? owing[0]?.id ?? "",
    invoiceId: "",
    amount: prefill.amount ? String(prefill.amount) : "",
    type: "deposit",
    method: "bank_transfer",
    receivedAt: todayKey(),
    reference: "",
  });
  const { values, errors, set } = f;
  const [checking, setChecking] = React.useState(false);
  const job = data.jobs.find((j) => j.id === values.jobId);
  const fin = job ? jobFinance(job, data.payments) : null;
  const openInvoices = data.invoices.filter((i) => i.jobId === values.jobId && i.status === "sent");

  React.useEffect(() => {
    if (fin && !values.amount) f.setValues((s) => ({ ...s, type: fin.depositOutstanding > 0 ? "deposit" : "stage" }));
  }, [values.jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checking) return setChecking(true); // explicit second step — payment records are financially significant
    f.setBusy(true);
    const res = await actions.recordPayment({ ...values, invoiceId: values.invoiceId || undefined });
    f.setBusy(false);
    if (!res.ok) {
      setChecking(false);
      return f.setErrors(res.errors);
    }
    toast(`${gbp(parseFloat(values.amount))} recorded${res.value.statusAdvanced ? " — deposit covered, job booked in" : ""}`);
    ui.closeForm();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <Field label="Job" htmlFor="pf-job" error={errors.jobId}>
        <NativeSelect id="pf-job" value={values.jobId} onChange={set("jobId")} disabled={checking}>
          {owing.map((j) => (
            <option key={j.id} value={j.id}>
              {j.customerName} — {j.title}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {fin ? (
        <p className="text-[14px] text-muted-foreground">
          {gbp(fin.balance)} left to pay{fin.depositOutstanding ? ` · deposit outstanding ${gbp(fin.depositOutstanding)}` : ""}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Amount (£)" htmlFor="pf-amt" error={errors.amount}>
          <Input id="pf-amt" inputMode="decimal" value={values.amount} onChange={set("amount")} aria-invalid={!!errors.amount} disabled={checking} />
        </Field>
        <Field label="Received" htmlFor="pf-date" error={errors.receivedAt}>
          <Input id="pf-date" type="date" value={values.receivedAt} onChange={set("receivedAt")} disabled={checking} />
        </Field>
        <Field label="Type" htmlFor="pf-type">
          <NativeSelect id="pf-type" value={values.type} onChange={set("type")} disabled={checking}>
            {(Object.keys(PAYMENT_TYPE_LABEL) as PaymentType[]).map((t) => (
              <option key={t} value={t}>
                {PAYMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Method" htmlFor="pf-method">
          <NativeSelect id="pf-method" value={values.method} onChange={set("method")} disabled={checking}>
            {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {openInvoices.length ? (
          <Field label="Against invoice (optional)" htmlFor="pf-inv" className="col-span-2">
            <NativeSelect id="pf-inv" value={values.invoiceId} onChange={set("invoiceId")} disabled={checking}>
              <option value="">Not linked to an invoice</option>
              {openInvoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number ?? i.draftRef} — {gbp(invoiceBalance(i))} left
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      {checking ? (
        <div className="rounded-2xl bg-copper-500/10 p-3.5 text-[15px] ring-1 ring-copper-500/35">
          Record <strong>{gbp(parseFloat(values.amount || "0"))}</strong> from {job?.customerName} received {formatDateInline(values.receivedAt)}? Only do this once the money is in
          your account.
        </div>
      ) : null}
      <FormActions submitLabel={checking ? "Yes, record it" : "Check payment"} onCancel={checking ? () => setChecking(false) : ui.closeForm} busy={f.busy} />
    </form>
  );
}

/* -------------------------------- Reminder -------------------------------- */

function ReminderForm({ prefill }: { prefill: Extract<FormPrefill, { form: "reminder" }> }) {
  const { actions, data } = useStore();
  const ui = useUI();
  const f = useFormState({ title: prefill.title ?? "", dueDate: prefill.dueDate ?? addDaysKey(1), assignedUserId: "" });
  const { values, errors, set } = f;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = await actions.createTask({
      title: values.title,
      dueDate: values.dueDate,
      customerId: prefill.customerId,
      relatedType: prefill.relatedType,
      relatedId: prefill.relatedId,
      assignedUserId: values.assignedUserId || undefined,
    });
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast(`Reminder set for ${formatDateInline(values.dueDate)}`);
    ui.closeForm();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <Field label="What do you need reminding about?" htmlFor="rf-title" error={errors.title}>
        <Input id="rf-title" value={values.title} onChange={set("title")} autoFocus aria-invalid={!!errors.title} />
      </Field>
      <Field label="When" htmlFor="rf-date" error={errors.dueDate}>
        <Input id="rf-date" type="date" value={values.dueDate} onChange={set("dueDate")} />
        <div className="mt-2 flex gap-1.5">
          {[
            ["Today", 0],
            ["Tomorrow", 1],
            ["Next week", 7],
          ].map(([l, d]) => (
            <button key={l} type="button" onClick={() => f.setValues((s) => ({ ...s, dueDate: addDaysKey(d as number) }))} className="rounded-full bg-surface-2 px-2.5 py-1 text-[13px] text-muted-foreground ring-1 ring-line hover:text-foreground">
              {l}
            </button>
          ))}
        </div>
      </Field>
      {data.members.length > 1 ? (
        <Field label="For" htmlFor="rf-who">
          <NativeSelect id="rf-who" value={values.assignedUserId} onChange={set("assignedUserId")}>
            <option value="">Me</option>
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <FormActions submitLabel="Set reminder" onCancel={ui.closeForm} busy={f.busy} />
    </form>
  );
}

/* -------------------------------- Enquiry -------------------------------- */

function EnquiryForm() {
  const { actions } = useStore();
  const ui = useUI();
  const f = useFormState({ customerName: "", phone: "", email: "", instagramHandle: "", source: "phone", title: "", location: "", description: "", priority: "medium", followUpDate: "" });
  const { values, errors, set } = f;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = await actions.createEnquiry(values);
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast(`Enquiry added for ${values.customerName}`);
    ui.closeForm();
    ui.openEnquiry(res.value.id);
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="ef-name" error={errors.customerName} className="sm:col-span-2">
          <Input id="ef-name" value={values.customerName} onChange={set("customerName")} autoFocus aria-invalid={!!errors.customerName} />
        </Field>
        <Field label="How did it come in?" htmlFor="ef-src">
          <NativeSelect id="ef-src" value={values.source} onChange={set("source")}>
            {ENQUIRY_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Phone" htmlFor="ef-phone" error={errors.phone}>
          <Input id="ef-phone" type="tel" value={values.phone} onChange={set("phone")} aria-invalid={!!errors.phone} />
        </Field>
        <Field label="Email" htmlFor="ef-email" error={errors.email}>
          <Input id="ef-email" type="email" value={values.email} onChange={set("email")} aria-invalid={!!errors.email} />
        </Field>
        <Field label="Instagram" htmlFor="ef-ig">
          <Input id="ef-ig" value={values.instagramHandle} onChange={set("instagramHandle")} placeholder="@handle" />
        </Field>
        <Field label="What's the job?" htmlFor="ef-title" error={errors.title}>
          <Input id="ef-title" value={values.title} onChange={set("title")} placeholder="e.g. Fitted wardrobes" aria-invalid={!!errors.title} />
        </Field>
        <Field label="Where?" htmlFor="ef-loc" error={errors.location}>
          <Input id="ef-loc" value={values.location} onChange={set("location")} aria-invalid={!!errors.location} />
        </Field>
        <Field label="Details" htmlFor="ef-desc" className="sm:col-span-2">
          <Textarea id="ef-desc" value={values.description} onChange={set("description")} />
        </Field>
      </div>
      <FormActions submitLabel="Add enquiry" onCancel={ui.closeForm} busy={f.busy} />
    </form>
  );
}

/* -------------------------------- Customer -------------------------------- */

function CustomerForm() {
  const { actions } = useStore();
  const ui = useUI();
  const f = useFormState({ name: "", phone: "", email: "", town: "", address: "" });
  const { values, errors, set } = f;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = await actions.createCustomer(values);
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast(`${values.name} added`);
    ui.closeForm();
    ui.openCustomer(res.value.id);
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <Field label="Name" htmlFor="cf-name" error={errors.name}>
        <Input id="cf-name" value={values.name} onChange={set("name")} autoFocus aria-invalid={!!errors.name} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Phone" htmlFor="cf-phone" error={errors.phone}>
          <Input id="cf-phone" type="tel" value={values.phone} onChange={set("phone")} />
        </Field>
        <Field label="Email" htmlFor="cf-email" error={errors.email}>
          <Input id="cf-email" type="email" value={values.email} onChange={set("email")} aria-invalid={!!errors.email} />
        </Field>
        <Field label="Town" htmlFor="cf-town">
          <Input id="cf-town" value={values.town} onChange={set("town")} />
        </Field>
        <Field label="Address" htmlFor="cf-addr">
          <Input id="cf-addr" value={values.address} onChange={set("address")} />
        </Field>
      </div>
      <FormActions submitLabel="Add customer" onCancel={ui.closeForm} busy={f.busy} />
    </form>
  );
}

/* -------------------------------- Invoice -------------------------------- */

function InvoiceForm({ prefill }: { prefill: Extract<FormPrefill, { form: "invoice" }> }) {
  const { actions, data, org } = useStore();
  const ui = useUI();
  const terms = org.finance.defaultPaymentTermsDays;
  const f = useFormState({
    customerId: prefill.customerId ?? "",
    jobId: prefill.jobId ?? "",
    description: "",
    amount: prefill.amount ? String(prefill.amount) : "",
    amountsAre: org.finance.vatRegistered === false ? "no_vat" : "",
    vatRate: org.finance.vatRate != null ? String(org.finance.vatRate) : "",
    dueDate: terms ? addDaysKey(terms) : "",
  });
  const { values, errors, set } = f;
  const jobs = data.jobs.filter((j) => j.customerId === values.customerId);
  const job = data.jobs.find((j) => j.id === values.jobId);
  React.useEffect(() => {
    if (job && !values.description) f.setValues((s) => ({ ...s, description: `${job.title}, ${job.location}` }));
  }, [values.jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  const amt = parseFloat(values.amount || "0");
  const preview = values.amountsAre && amt > 0 ? computeInvoiceTotals(amt, values.amountsAre as VatTreatment, values.amountsAre === "no_vat" ? 0 : parseFloat(values.vatRate || "0")) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = await actions.createInvoiceDraft({
      customerId: values.customerId,
      jobId: values.jobId || undefined,
      description: values.description,
      amount: values.amount,
      amountsAre: values.amountsAre || undefined,
      vatRate: values.amountsAre && values.amountsAre !== "no_vat" && values.vatRate ? values.vatRate : undefined,
      dueDate: values.dueDate,
    });
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast(`Draft ${res.value.draftRef} saved — not sent`);
    ui.closeForm();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Customer" htmlFor="if-cust" error={errors.customerId}>
          <NativeSelect id="if-cust" value={values.customerId} onChange={(e) => f.setValues((s) => ({ ...s, customerId: e.target.value, jobId: "" }))}>
            <option value="">Choose…</option>
            {data.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Job (optional)" htmlFor="if-job">
          <NativeSelect id="if-job" value={values.jobId} onChange={set("jobId")} disabled={!values.customerId}>
            <option value="">No job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}, {j.location}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Description" htmlFor="if-desc" error={errors.description} className="sm:col-span-2">
          <Input id="if-desc" value={values.description} onChange={set("description")} aria-invalid={!!errors.description} />
        </Field>
        <Field label="Amount (£)" htmlFor="if-amt" error={errors.amount}>
          <Input id="if-amt" inputMode="decimal" value={values.amount} onChange={set("amount")} aria-invalid={!!errors.amount} />
        </Field>
        <Field label="VAT" htmlFor="if-vat" error={errors.amountsAre} hint={org.finance.vatRegistered === null ? "VAT isn't set up in Settings yet — choose for this invoice." : undefined}>
          <NativeSelect id="if-vat" value={values.amountsAre} onChange={set("amountsAre")} aria-invalid={!!errors.amountsAre}>
            <option value="">Choose…</option>
            {org.finance.vatRegistered !== false ? (
              <>
                <option value="exclusive">Amount is before VAT (plus VAT)</option>
                <option value="inclusive">Amount includes VAT</option>
              </>
            ) : null}
            <option value="no_vat">No VAT</option>
          </NativeSelect>
        </Field>
        {values.amountsAre && values.amountsAre !== "no_vat" && org.finance.vatRate == null ? (
          <Field label="VAT rate (%)" htmlFor="if-rate" hint="Standard UK rate is 20%.">
            <Input id="if-rate" inputMode="decimal" value={values.vatRate} onChange={set("vatRate")} />
          </Field>
        ) : null}
        <Field label="Due date" htmlFor="if-due" error={errors.dueDate}>
          <Input id="if-due" type="date" value={values.dueDate} onChange={set("dueDate")} aria-invalid={!!errors.dueDate} />
        </Field>
      </div>
      {preview ? (
        <div className="rounded-xl bg-surface-2 px-3.5 py-2 ring-1 ring-line">
          <MoneyRow label="Net" value={gbp(preview.subtotal)} />
          {preview.vat ? <MoneyRow label={`VAT ${preview.vatRate}%`} value={gbp(preview.vat)} /> : null}
          <MoneyRow label="Total" value={gbp(preview.total)} strong />
        </div>
      ) : null}
      <FormActions submitLabel="Save draft" onCancel={ui.closeForm} busy={f.busy} />
    </form>
  );
}

/* -------------------------------- Expense -------------------------------- */

function ExpenseForm({ prefill }: { prefill: Extract<FormPrefill, { form: "expense" }> }) {
  const { actions, data } = useStore();
  const ui = useUI();
  const f = useFormState({ jobId: prefill.jobId ?? data.jobs[0]?.id ?? "", amount: "", category: "materials", description: "", incurredOn: todayKey() });
  const { values, errors, set } = f;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = await actions.addExpense(values);
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast(`${gbp(parseFloat(values.amount))} cost added`);
    ui.closeForm();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <Field label="Job" htmlFor="xf-job">
        <NativeSelect id="xf-job" value={values.jobId} onChange={set("jobId")}>
          {data.jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.customerName} — {j.title}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Amount (£)" htmlFor="xf-amt" error={errors.amount}>
          <Input id="xf-amt" inputMode="decimal" value={values.amount} onChange={set("amount")} aria-invalid={!!errors.amount} />
        </Field>
        <Field label="Type" htmlFor="xf-cat">
          <NativeSelect id="xf-cat" value={values.category} onChange={set("category")}>
            {(Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]).map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="What for?" htmlFor="xf-desc" error={errors.description} className="col-span-2">
          <Input id="xf-desc" value={values.description} onChange={set("description")} placeholder="e.g. Timber and fixings" aria-invalid={!!errors.description} />
        </Field>
        <Field label="Date" htmlFor="xf-date">
          <Input id="xf-date" type="date" value={values.incurredOn} onChange={set("incurredOn")} />
        </Field>
      </div>
      <FormActions submitLabel="Add cost" onCancel={ui.closeForm} busy={f.busy} />
    </form>
  );
}

/* --------------------------------- Quote --------------------------------- */

function QuoteForm({ prefill }: { prefill: Extract<FormPrefill, { form: "quote" }> }) {
  const { actions, data } = useStore();
  const ui = useUI();
  const enquiry = data.enquiries.find((e) => e.id === prefill.enquiryId);
  const f = useFormState({ description: enquiry?.title ?? "", amount: "", followUpDate: addDaysKey(7) });
  const { values, errors, set } = f;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    f.setBusy(true);
    const res = await actions.createQuote({ customerId: prefill.customerId, enquiryId: prefill.enquiryId, jobId: prefill.jobId, status: "sent", ...values });
    f.setBusy(false);
    if (!res.ok) return f.setErrors(res.errors);
    toast("Quote recorded — Bob will remind you to chase it");
    ui.closeForm();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormError errors={errors} />
      <Field label="What's it for?" htmlFor="qf-desc" error={errors.description}>
        <Input id="qf-desc" value={values.description} onChange={set("description")} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Amount (£)" htmlFor="qf-amt" error={errors.amount}>
          <Input id="qf-amt" inputMode="decimal" value={values.amount} onChange={set("amount")} aria-invalid={!!errors.amount} />
        </Field>
        <Field label="Chase on" htmlFor="qf-fu">
          <Input id="qf-fu" type="date" value={values.followUpDate} onChange={set("followUpDate")} />
        </Field>
      </div>
      <FormActions submitLabel="Record quote" onCancel={ui.closeForm} busy={f.busy} />
    </form>
  );
}
