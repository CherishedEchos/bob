"use client";

/**
 * Team → Invite someone, and what happened to an invite.
 *  - InviteSomeone: name, email, Employee or Subcontractor. Someone already on
 *    the crew is offered first, so their bookings stay with them.
 *  - InviteDelivery: the truth about the email — emailed, failed (try again) or
 *    not set up here (copy the link) — with the link when it's just been made.
 */
import * as React from "react";
import { AlertTriangle, Check, Copy, MailCheck, RefreshCw, Send } from "lucide-react";
import { useStore } from "@/lib/store/store";
import type { Person, PersonAccess } from "@/lib/types";
import { formatDayShort } from "@/lib/dates";
import { cn, copyToClipboard } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";

export interface SentInvite {
  personId: string;
  inviteId: string;
  path: string;
  email: string;
  expiresAt: string;
  role: "worker" | "office";
  emailStatus: "sent" | "failed" | "not_configured";
  emailError?: string;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The link and email status right after an invite is made (the link is shown once). */
export function FreshInvite({ sent, name, onRetry, busy }: { sent: SentInvite; name: string; onRetry: () => void; busy?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  const url = `${typeof window === "undefined" ? "" : window.location.origin}${sent.path}`;
  const copy = async () => {
    const ok = await copyToClipboard(url);
    if (!ok) return toast("Couldn't copy — select the link and copy it", "error");
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div className="mt-3 rounded-xl bg-message p-3" data-testid="fresh-invite">
      {sent.emailStatus === "sent" ? (
        <p className="flex items-start gap-2 text-[15px] font-semibold text-good-fg">
          <MailCheck className="mt-0.5 size-[18px] shrink-0" aria-hidden /> Invite emailed to {sent.email}
        </p>
      ) : sent.emailStatus === "failed" ? (
        <div role="alert" className="text-[15px]">
          <p className="flex items-start gap-2 font-semibold text-danger-fg">
            <AlertTriangle className="mt-0.5 size-[18px] shrink-0" aria-hidden /> The email to {sent.email} didn&apos;t go
          </p>
          {sent.emailError ? <p className="mt-0.5 pl-[26px] text-muted-foreground">{sent.emailError}</p> : null}
          <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry} disabled={busy}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : (
        <p className="text-[15px] font-semibold">Email isn&apos;t set up here yet, so nothing was sent. Send {name.split(/\s+/)[0]} this link yourself:</p>
      )}
      <label htmlFor={`invite-link-${sent.inviteId}`} className={cn("mt-2 block text-[14px] font-medium text-muted-foreground", sent.emailStatus === "not_configured" && "sr-only")}>
        Invite link for {sent.email}
      </label>
      <div className="mt-1 flex gap-2">
        <Input id={`invite-link-${sent.inviteId}`} readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-11 text-[15px]" />
        <Button size="sm" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p className="mt-2 text-[14px] text-muted-foreground">
        Works once, only for {sent.email}, until {formatDayShort(sent.expiresAt.slice(0, 10))}. Sending a new invite stops this link working.
      </p>
    </div>
  );
}

/** The invite's state when it isn't fresh: who sent it, when, and whether the email went. */
export function InviteStatusLine({ a }: { a: PersonAccess }) {
  if (a.state !== "pending" && a.state !== "expired") return null;
  return (
    <p className="mt-2 text-[14.5px] text-muted-foreground" data-testid="invite-status">
      {a.state === "expired" ? "Invite expired" : "Invite sent"}
      {a.invitedBy ? ` by ${a.invitedBy}` : ""}
      {a.sentAt ? ` · ${when(a.sentAt)}` : ""}
      {a.email ? ` · ${a.email}` : ""}
      {a.emailStatus === "sent" ? " · emailed" : a.emailStatus === "failed" ? <span className="font-medium text-danger-fg"> · the email didn&apos;t go</span> : a.emailStatus === "not_configured" ? " · link shared by hand (not emailed)" : ""}
    </p>
  );
}

/** Team → Invite someone. */
export function InviteSomeone({ open, onClose, onOpenPerson }: { open: boolean; onClose: () => void; onOpenPerson: (id: string) => void }) {
  const { data, can, actions } = useStore();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [kind, setKind] = React.useState<"subcontractor" | "employee">("subcontractor");
  const [role, setRole] = React.useState<"worker" | "office">("worker");
  const [personId, setPersonId] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState<SentInvite | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setKind("subcontractor");
    setRole("worker");
    setPersonId(null);
    setErrors({});
    setSent(null);
  }, [open]);

  const access = new Map(data.access.map((a) => [a.personId, a]));
  const chosen = personId ? data.people.find((p) => p.id === personId) : undefined;
  // Already on the crew? Match on name or email as they type.
  const q = name.trim().toLowerCase();
  const e = email.trim().toLowerCase();
  const matches: Person[] = chosen
    ? []
    : data.people.filter(
        (p) => !p.archivedAt && ((q.length >= 2 && p.name.toLowerCase().includes(q)) || (e.length > 3 && (p.email ?? "").toLowerCase() === e)),
      ).slice(0, 4);

  const choose = (p: Person) => {
    setPersonId(p.id);
    setName(p.name);
    setKind(p.kind);
    if (p.email) setEmail(p.email);
    setErrors({});
  };

  const submit = async (retry = false) => {
    setBusy(true);
    setErrors({});
    const r = retry && sent
      ? await actions.run<SentInvite>("resendInvite", { personId: sent.personId })
      : await actions.run<SentInvite & { createdPerson: boolean }>("inviteSomeone", { personId: personId ?? undefined, name, email, kind, role });
    setBusy(false);
    if (!r.ok) return setErrors(r.errors);
    setSent(r.value);
    toast(r.value.emailStatus === "sent" ? `Invite emailed to ${r.value.email}` : r.value.emailStatus === "failed" ? "The invite email didn't go — try again or copy the link" : "Invite link ready — send it yourself", r.value.emailStatus === "failed" ? "error" : "success");
  };

  const already = chosen ? access.get(chosen.id) : undefined;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Invite someone" description="They'll get their own sign-in and see the work they're booked on.">
        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6 sm:px-6">
          <h2 className="pr-12 text-[22px] font-bold tracking-tight">Invite someone</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">They get their own sign-in. Subcontractors and staff see only the jobs they&apos;re booked on.</p>
          {sent ? (
            <>
              <FreshInvite sent={sent} name={name} busy={busy} onRetry={() => void submit(true)} />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => onOpenPerson(sent.personId)}>
                  Open {name.split(/\s+/)[0]}&apos;s profile
                </Button>
                <Button size="sm" variant="ghost" onClick={onClose}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <form
              className="mt-5 flex flex-col gap-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                void submit();
              }}
            >
              <label className="block">
                <span className="text-[15px] font-semibold">Name</span>
                <Input
                  value={name}
                  onChange={(ev) => {
                    setName(ev.target.value);
                    if (personId) setPersonId(null);
                  }}
                  autoComplete="off"
                  placeholder="e.g. Sam Okoro"
                  aria-invalid={!!errors.name}
                  className="mt-1"
                />
                {errors.name ? <span className="mt-1 block text-[14px] text-danger-fg">{errors.name}</span> : null}
              </label>
              {matches.length ? (
                <div className="rounded-xl bg-surface-2 p-3" role="group" aria-label="Already on your crew">
                  <p className="text-[14.5px] font-semibold">Already on your crew</p>
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {matches.map((p) => {
                      const a = access.get(p.id);
                      return (
                        <li key={p.id}>
                          <button type="button" disabled={a?.state === "accepted"} onClick={() => choose(p)} className="flex w-full items-center justify-between gap-3 rounded-lg bg-card px-3 py-2.5 text-left ring-1 ring-line hover:ring-accent/40 disabled:cursor-default disabled:hover:ring-line">
                            <span className="min-w-0">
                              <span className="block text-[15.5px] font-medium">{p.name}</span>
                              <span className="block text-[14px] text-muted-foreground">
                                {p.kind === "subcontractor" ? "Subcontractor" : "Employee"}
                                {p.trade ? ` · ${p.trade}` : ""}
                              </span>
                            </span>
                            {a?.state === "accepted" ? (
                              <span className="shrink-0 text-[14.5px] font-medium text-good-fg">Has access</span>
                            ) : (
                              <span className="shrink-0 text-[14.5px] font-semibold text-accent-fg">Invite {p.name.split(/\s+/)[0]}</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-[13.5px] text-subtle">Inviting their existing profile keeps their bookings with them.</p>
                </div>
              ) : null}
              {chosen ? (
                <p className="rounded-xl bg-selected px-3 py-2 text-[15px]">
                  Inviting <strong>{chosen.name}</strong> from your crew list — their bookings stay with them.{" "}
                  <button type="button" className="font-semibold text-accent-fg underline-offset-2 hover:underline" onClick={() => setPersonId(null)}>
                    Someone else
                  </button>
                </p>
              ) : null}
              {already?.state === "accepted" ? <p className="text-[15px] text-danger-fg">{chosen?.name} already has access to Bob.</p> : null}
              <label className="block">
                <span className="text-[15px] font-semibold">Email</span>
                <Input type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(ev) => setEmail(ev.target.value)} placeholder="name@example.com" aria-invalid={!!errors.email} className="mt-1" />
                {errors.email ? <span className="mt-1 block text-[14px] text-danger-fg">{errors.email}</span> : <span className="mt-1 block text-[13.5px] text-subtle">The invite only works for this email address.</span>}
              </label>
              {!chosen ? (
                <fieldset>
                  <legend className="text-[15px] font-semibold">They are</legend>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {(["subcontractor", "employee"] as const).map((k) => (
                      <label key={k} className={cn("flex h-12 cursor-pointer items-center gap-2.5 rounded-xl px-3 ring-1", kind === k ? "bg-selected ring-accent/40" : "ring-line hover:bg-surface-2")}>
                        <input type="radio" name="invite-kind" checked={kind === k} onChange={() => setKind(k)} className="accent-[var(--color-accent)]" />
                        <span className="text-[15.5px] font-medium">{k === "subcontractor" ? "Subcontractor" : "Employee"}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {can("settings.manage") ? (
                <fieldset>
                  <legend className="text-[15px] font-semibold">What they can see</legend>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    {([
                      ["worker", "My work only", "Their own bookings, site details and tasks"],
                      ["office", "Admin", "The whole business, except Settings"],
                    ] as const).map(([value, label, hint]) => (
                      <label key={value} className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1", role === value ? "bg-selected ring-accent/40" : "ring-line hover:bg-surface-2")}>
                        <input type="radio" name="invite-access" checked={role === value} onChange={() => setRole(value)} className="mt-1 accent-[var(--color-accent)]" />
                        <span>
                          <span className="block text-[15px] font-medium">{label}</span>
                          <span className="block text-[14px] text-muted-foreground">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              {errors._ ? (
                <p role="alert" className="text-[15px] text-danger-fg">
                  {errors._}
                </p>
              ) : null}
              <Button type="submit" disabled={busy || already?.state === "accepted"} className="h-12">
                <Send /> {busy ? "Sending…" : "Send invite"}
              </Button>
              <p className="text-[13.5px] text-subtle">The invite names {data.org.name} and you. The link works once and expires after 7 days.</p>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
