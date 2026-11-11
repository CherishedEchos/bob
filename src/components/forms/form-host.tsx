"use client";

import * as React from "react";
import { ArrowLeft, Check } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { useUI } from "@/lib/store/ui";
import type { FormPrefill } from "@/lib/assistant/types";
import { JOB_STATUSES, JOB_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_TYPE_LABEL, jobFinance } from "@/lib/derive";
import type { PaymentMethod, PaymentType } from "@/lib/types";
import type { FieldErrors } from "@/lib/validation";
import { addDaysKey, cn, formatDateKey, gbp, todayKey, formatDateInline } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

export function FormHost() {
  const ui = useUI();
  const form = ui.form;
  const titles: Record<FormPrefill["form"], [string, string]> = {
    job: ["New job", "Add the basics now — you can fill in the rest later."],
    payment: ["Record a payment", "Log money you've received against a job."],
    reminder: ["Set a reminder", "It'll show on your overview when it's due."],
    enquiry: ["Log an enquiry", "Capture a phone call or message that came in."],
  };
  return (
    <Dialog open={!!form} onOpenChange={(o) => !o && ui.closeForm()}>
      {form ? (
        <DialogContent title={titles[form.form][0]} description={titles[form.form][1]}>
          {form.form === "job" ? <JobForm prefill={form} /> : null}
          {form.form === "payment" ? <PaymentForm prefill={form} /> : null}
          {form.form === "reminder" ? <ReminderForm prefill={form} /> : null}
          {form.form === "enquiry" ? <EnquiryForm /> : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function FormActions({ submitLabel, onCancel }: { submitLabel: string; onCancel: () => void }) {
  return (
    <div className="mt-6 flex gap-2">
      <Button variant="secondary" className="flex-1" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" className="flex-1">
        <Check /> {submitLabel}
      </Button>
    </div>
  );
}

/* ---------------------------------- Job ---------------------------------- */

function JobForm({ prefill }: { prefill: Extract<FormPrefill, { form: "job" }> }) {
  const { actions } = useStore();
  const ui = useUI();
  const v = prefill.values ?? {};
  const [values, setValues] = React.useState({
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
    nextAction: "",
  });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((s) => ({ ...s, [k]: e.target.value }));

  const quote = parseFloat(values.quotedValue || "0");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = actions.createJob({ ...values, depositRequired: values.depositRequired || "0", enquiryId: prefill.enquiryId });
    if (!res.ok) return setErrors(res.errors);
    toast(`Job added for ${res.value.customerName}`);
    ui.closeForm();
    ui.openJob(res.value.id);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Customer name" htmlFor="jf-name" error={errors.customerName} className="sm:col-span-2">
          <Input id="jf-name" value={values.customerName} onChange={set("customerName")} aria-invalid={!!errors.customerName} autoFocus={!values.customerName} />
        </Field>
        <Field label="Job" htmlFor="jf-title" error={errors.title}>
          <Input id="jf-title" value={values.title} onChange={set("title")} placeholder="e.g. Kitchen refit" aria-invalid={!!errors.title} />
        </Field>
        <Field label="Location" htmlFor="jf-loc" error={errors.location}>
          <Input id="jf-loc" value={values.location} onChange={set("location")} placeholder="e.g. Crawley" aria-invalid={!!errors.location} />
        </Field>
        <Field label="Quoted value (£)" htmlFor="jf-quote" error={errors.quotedValue}>
          <Input id="jf-quote" inputMode="decimal" value={values.quotedValue} onChange={set("quotedValue")} placeholder="0" aria-invalid={!!errors.quotedValue} />
        </Field>
        <Field
          label="Deposit required (£)"
          htmlFor="jf-dep"
          error={errors.depositRequired}
          hint={quote > 0 && !values.depositRequired ? undefined : undefined}
        >
          <Input id="jf-dep" inputMode="decimal" value={values.depositRequired} onChange={set("depositRequired")} placeholder="0" aria-invalid={!!errors.depositRequired} />
          {quote > 0 ? (
            <div className="mt-2 flex gap-1.5">
              {[20, 30, 40].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setValues((s) => ({ ...s, depositRequired: String(Math.round((quote * pct) / 100)) }))}
                  className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[12px] text-muted-foreground ring-1 ring-white/10 hover:text-foreground"
                >
                  {pct}%
                </button>
              ))}
            </div>
          ) : null}
        </Field>
        <Field label="Status" htmlFor="jf-status">
          <NativeSelect id="jf-status" value={values.status} onChange={set("status")}>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Start date" htmlFor="jf-start" error={errors.startDate}>
          <Input id="jf-start" type="date" value={values.startDate} onChange={set("startDate")} />
        </Field>
        <Field label="Phone" htmlFor="jf-phone">
          <Input id="jf-phone" type="tel" value={values.customerPhone} onChange={set("customerPhone")} />
        </Field>
        <Field label="Email" htmlFor="jf-email" error={errors.customerEmail}>
          <Input id="jf-email" type="email" value={values.customerEmail} onChange={set("customerEmail")} aria-invalid={!!errors.customerEmail} />
        </Field>
        <Field label="Description" htmlFor="jf-desc" className="sm:col-span-2">
          <Textarea id="jf-desc" value={values.description} onChange={set("description")} className="min-h-20" />
        </Field>
        <Field label="Next action" htmlFor="jf-next" className="sm:col-span-2">
          <Input id="jf-next" value={values.nextAction} onChange={set("nextAction")} placeholder="e.g. Send written quote" />
        </Field>
      </div>
      <FormActions submitLabel="Add job" onCancel={ui.closeForm} />
    </form>
  );
}

/* ---------------------------------- Payment ---------------------------------- */

function PaymentForm({ prefill }: { prefill: Extract<FormPrefill, { form: "payment" }> }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const payable = data.jobs
    .map((job) => ({ job, f: jobFinance(job, data.payments) }))
    .filter(({ f }) => f.balance > 0);
  const [jobId, setJobId] = React.useState(prefill.jobId ?? payable[0]?.job.id ?? "");
  const selected = payable.find((p) => p.job.id === jobId);
  const defaultType: PaymentType = selected && selected.f.depositOutstanding > 0 ? "deposit" : "stage";
  const [amount, setAmount] = React.useState(prefill.amount ? String(prefill.amount) : "");
  const [type, setType] = React.useState<PaymentType>(defaultType);
  const [method, setMethod] = React.useState<PaymentMethod>("bank_transfer");
  const [receivedAt, setReceivedAt] = React.useState(todayKey());
  const [reference, setReference] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [step, setStep] = React.useState<"edit" | "confirm">("edit");

  React.useEffect(() => {
    if (selected) setType(selected.f.depositOutstanding > 0 ? "deposit" : "stage");
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!payable.length) {
    return <p className="text-[15px] text-muted-foreground">Every job is paid in full — there&apos;s nothing to record.</p>;
  }

  const amt = parseFloat(amount);
  const review = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: FieldErrors = {};
    if (!selected) errs.jobId = "Choose a job";
    if (!amount || !(amt > 0)) errs.amount = "Enter the amount received";
    else if (selected && amt > selected.f.balance) errs.amount = `That's more than the ${gbp(selected.f.balance)} left on this job`;
    if (!receivedAt) errs.receivedAt = "Pick the date it arrived";
    setErrors(errs);
    if (!Object.keys(errs).length) setStep("confirm");
  };

  const confirm = () => {
    const res = actions.recordPayment({ jobId, amount, type, method, receivedAt, reference });
    if (!res.ok) {
      setErrors(res.errors);
      setStep("edit");
      return;
    }
    toast(`${gbp(res.value.payment.amount)} recorded for ${res.value.job.customerName}${res.value.statusAdvanced ? " · job moved to Scheduled" : ""}`);
    ui.closeForm();
  };

  if (step === "confirm" && selected) {
    const after = selected.f.balance - amt;
    return (
      <div>
        <div className="rounded-2xl bg-copper-500/[0.07] p-4 ring-1 ring-copper-500/30">
          <div className="text-[13px] text-muted-foreground">You&apos;re recording</div>
          <div className="tabular mt-1 text-[32px] font-bold tracking-tight">{gbp(amt)}</div>
          <div className="mt-1 text-[14px] text-foreground/85">
            {PAYMENT_TYPE_LABEL[type]} from {selected.job.customerName} · {selected.job.title}
          </div>
          <dl className="mt-3 space-y-1.5 text-[13.5px]">
            <div className="flex justify-between"><dt className="text-muted-foreground">Method</dt><dd>{PAYMENT_METHOD_LABEL[method]}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Received</dt><dd>{formatDateKey(receivedAt)}</dd></div>
            {reference ? <div className="flex justify-between"><dt className="text-muted-foreground">Reference</dt><dd>{reference}</dd></div> : null}
            <div className="flex justify-between"><dt className="text-muted-foreground">Balance after</dt><dd className="tabular font-medium">{gbp(after)}</dd></div>
          </dl>
        </div>
        <p className="mt-3 text-[12.5px] text-subtle">This logs money already received. It doesn&apos;t charge the customer.</p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setStep("edit")}>
            <ArrowLeft /> Back
          </Button>
          <Button className="flex-1" onClick={confirm}>
            <Check /> Confirm payment
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={review} noValidate className="space-y-4">
      <Field label="Job" htmlFor="pf-job" error={errors.jobId}>
        <NativeSelect id="pf-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
          {payable.map(({ job, f }) => (
            <option key={job.id} value={job.id}>
              {job.customerName} — {job.title} ({gbp(f.balance)} left)
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Amount received (£)" htmlFor="pf-amount" error={errors.amount}>
        <Input id="pf-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-invalid={!!errors.amount} autoFocus />
        {selected ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selected.f.depositOutstanding > 0 ? (
              <QuickAmount onClick={() => { setAmount(String(selected.f.depositOutstanding)); setType("deposit"); }}>
                Deposit {gbp(selected.f.depositOutstanding)}
              </QuickAmount>
            ) : null}
            <QuickAmount onClick={() => { setAmount(String(selected.f.balance)); setType(selected.f.depositOutstanding >= selected.f.balance ? "deposit" : "final"); }}>
              Full balance {gbp(selected.f.balance)}
            </QuickAmount>
          </div>
        ) : null}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Type" htmlFor="pf-type">
          <NativeSelect id="pf-type" value={type} onChange={(e) => setType(e.target.value as PaymentType)}>
            {(Object.keys(PAYMENT_TYPE_LABEL) as PaymentType[]).map((t) => (
              <option key={t} value={t}>{PAYMENT_TYPE_LABEL[t]}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Method" htmlFor="pf-method">
          <NativeSelect id="pf-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Date received" htmlFor="pf-date" error={errors.receivedAt}>
          <Input id="pf-date" type="date" value={receivedAt} max={todayKey()} onChange={(e) => setReceivedAt(e.target.value)} />
        </Field>
        <Field label="Reference (optional)" htmlFor="pf-ref">
          <Input id="pf-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. bank ref" />
        </Field>
      </div>
      <FormActions submitLabel="Review" onCancel={ui.closeForm} />
    </form>
  );
}

function QuickAmount({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tabular rounded-full bg-copper-500/10 px-3 py-1 text-[12.5px] text-copper-200 ring-1 ring-copper-500/35 hover:bg-copper-500/20"
    >
      {children}
    </button>
  );
}

/* ---------------------------------- Reminder ---------------------------------- */

function ReminderForm({ prefill }: { prefill: Extract<FormPrefill, { form: "reminder" }> }) {
  const { data, actions } = useStore();
  const ui = useUI();
  const [title, setTitle] = React.useState(prefill.title ?? "");
  const [dueDate, setDueDate] = React.useState(prefill.dueDate ?? addDaysKey(1));
  const [related, setRelated] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const [relatedType, relatedId] = related ? (related.split(":") as ["job" | "enquiry", string]) : [undefined, undefined];
    const res = actions.createReminder({ title, dueDate, relatedType, relatedId });
    if (!res.ok) return setErrors(res.errors);
    toast(`Reminder set for ${formatDateInline(res.value.dueDate)}`);
    ui.closeForm();
  };

  const quick = [
    ["Today", addDaysKey(0)],
    ["Tomorrow", addDaysKey(1)],
    ["In 3 days", addDaysKey(3)],
    ["Next week", addDaysKey(7)],
  ] as const;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Remind me to…" htmlFor="rf-title" error={errors.title}>
        <Input id="rf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call Dave about the decking" aria-invalid={!!errors.title} autoFocus />
      </Field>
      <Field label="When" htmlFor="rf-date" error={errors.dueDate}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {quick.map(([label, key]) => (
            <button
              key={label}
              type="button"
              onClick={() => setDueDate(key)}
              aria-pressed={dueDate === key}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px] ring-1",
                dueDate === key ? "bg-copper-500/18 text-copper-200 ring-copper-500/60" : "bg-white/[0.04] text-muted-foreground ring-white/10",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Input id="rf-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <Field label="Link to (optional)" htmlFor="rf-rel">
        <NativeSelect id="rf-rel" value={related} onChange={(e) => setRelated(e.target.value)}>
          <option value="">Nothing</option>
          <optgroup label="Jobs">
            {data.jobs.filter((j) => j.status !== "completed").map((j) => (
              <option key={j.id} value={`job:${j.id}`}>{j.customerName} — {j.title}</option>
            ))}
          </optgroup>
          <optgroup label="Enquiries">
            {data.enquiries.filter((x) => x.status !== "closed" && x.status !== "won").map((x) => (
              <option key={x.id} value={`enquiry:${x.id}`}>{x.customerName} — {x.title}</option>
            ))}
          </optgroup>
        </NativeSelect>
      </Field>
      <FormActions submitLabel="Set reminder" onCancel={ui.closeForm} />
    </form>
  );
}

/* ---------------------------------- Enquiry ---------------------------------- */

function EnquiryForm() {
  const { actions } = useStore();
  const ui = useUI();
  const [values, setValues] = React.useState({
    source: "phone",
    customerName: "",
    phone: "",
    email: "",
    instagramHandle: "",
    title: "",
    location: "",
    description: "",
    priority: "medium",
    followUpDate: "",
  });
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((s) => ({ ...s, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = actions.createEnquiry(values);
    if (!res.ok) return setErrors(res.errors);
    toast(`Enquiry logged for ${res.value.customerName}`);
    ui.closeForm();
    ui.openEnquiry(res.value.id);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Source">
        {(["phone", "email", "instagram"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={values.source === s}
            onClick={() => setValues((v) => ({ ...v, source: s }))}
            className={cn(
              "h-10 rounded-xl text-[13.5px] font-medium capitalize ring-1",
              values.source === s ? "bg-copper-500/18 text-copper-200 ring-copper-500/60" : "bg-white/[0.04] text-muted-foreground ring-white/10",
            )}
          >
            {s === "instagram" ? "Instagram" : s}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Customer name" htmlFor="ef-name" error={errors.customerName} className="sm:col-span-2">
          <Input id="ef-name" value={values.customerName} onChange={set("customerName")} aria-invalid={!!errors.customerName} autoFocus />
        </Field>
        <Field label="Phone" htmlFor="ef-phone" error={errors.phone}>
          <Input id="ef-phone" type="tel" value={values.phone} onChange={set("phone")} aria-invalid={!!errors.phone} />
        </Field>
        {values.source === "instagram" ? (
          <Field label="Instagram handle" htmlFor="ef-ig">
            <Input id="ef-ig" value={values.instagramHandle} onChange={set("instagramHandle")} placeholder="@handle" />
          </Field>
        ) : (
          <Field label="Email" htmlFor="ef-email" error={errors.email}>
            <Input id="ef-email" type="email" value={values.email} onChange={set("email")} aria-invalid={!!errors.email} />
          </Field>
        )}
        <Field label="What's the job?" htmlFor="ef-title" error={errors.title}>
          <Input id="ef-title" value={values.title} onChange={set("title")} placeholder="e.g. Fitted wardrobes" aria-invalid={!!errors.title} />
        </Field>
        <Field label="Location" htmlFor="ef-loc" error={errors.location}>
          <Input id="ef-loc" value={values.location} onChange={set("location")} placeholder="e.g. Horsham" aria-invalid={!!errors.location} />
        </Field>
        <Field label="Details" htmlFor="ef-desc" className="sm:col-span-2">
          <Textarea id="ef-desc" value={values.description} onChange={set("description")} className="min-h-20" />
        </Field>
        <Field label="Priority" htmlFor="ef-pri">
          <NativeSelect id="ef-pri" value={values.priority} onChange={set("priority")}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </NativeSelect>
        </Field>
        <Field label="Follow up on (optional)" htmlFor="ef-fu">
          <Input id="ef-fu" type="date" value={values.followUpDate} onChange={set("followUpDate")} />
        </Field>
      </div>
      <FormActions submitLabel="Log enquiry" onCancel={ui.closeForm} />
    </form>
  );
}
