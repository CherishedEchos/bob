"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Bot, Building2, CalendarDays, ChevronRight, Copy, Smartphone, Download, ExternalLink, Globe, Link2, PoundSterling, RotateCcw, ShieldCheck, Unlink, Users } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import type { Connection, OrgConfig, Snapshot } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/auth/permissions";
import { cn, timeAgo } from "@/lib/utils";
import { InstallBob } from "@/components/common/install-bob";
import { CalendarLink } from "@/components/settings/calendar-links";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";

const PROVIDER_LABEL: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Outlook / Microsoft 365",
  xero: "Xero",
  quickbooks: "QuickBooks",
  demo_inbox: "Demo inbox",
  demo_accounting: "Demo accounting",
};

/** The public website enquiry form: link, embed code and the demo example site. */
function WebsiteFormSection({ slug }: { slug: string }) {
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}/f/${slug}`;
  const embed = `<iframe src="${link}?embed=1" title="Enquiry form" style="width:100%;height:640px;border:0"></iframe>`;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`, "success");
    } catch {
      toast("Couldn't copy — select it and copy instead", "error");
    }
  };
  return (
    <Section icon={Globe} title="Website enquiry form" subtitle="Enquiries from your website land straight in Bob, with a reply drafted.">
      <div className="space-y-3">
        <div>
          <div className="mb-1.5 text-[14px] font-medium text-foreground/90">Form link</div>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-message px-3.5 py-3 text-[14px] ring-1 ring-line-strong">{link}</code>
            <Button variant="secondary" onClick={() => void copy(link, "Link")}>
              <Copy /> Copy
            </Button>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[14px] font-medium text-foreground/90">Add it to your website</div>
          <code className="block break-all rounded-xl bg-message px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground ring-1 ring-line-strong">{embed}</code>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void copy(embed, "Embed code")}>
              <Copy /> Copy embed code
            </Button>
            <Button asChild variant="ghost">
              <a href={`/example-site/${slug}`} target="_blank" rel="noreferrer">
                <ExternalLink /> See it on an example website
              </a>
            </Button>
          </div>
        </div>
        <p className="text-[13px] text-subtle">Spam protection and rate limits are built in. Messages are treated as plain text — never as instructions to Bob.</p>
      </div>
    </Section>
  );
}

/** One settings row: a short label that opens to reveal its controls. */
function Section({ icon: Icon, title, subtitle, children, defaultOpen = false }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  return (
    <li>
      <h2 className="m-0">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 active:bg-surface-3 lg:px-5">
          <Icon className="size-5 shrink-0 text-accent-icon" />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">{title}</span>
            {subtitle && !open ? <span className="mt-0.5 block truncate text-[14px] text-muted-foreground">{subtitle}</span> : null}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[13.5px] font-medium text-muted-foreground">
            <span className="hidden sm:inline">{open ? "Hide" : "Show"}</span>
            <ChevronRight aria-hidden className={cn("size-5 text-subtle transition-transform", open && "rotate-90")} />
          </span>
        </button>
      </h2>
      {open ? (
        <div id={id} className="px-4 pb-5 lg:px-5">
          {subtitle ? <p className="mb-4 text-[14.5px] text-muted-foreground">{subtitle}</p> : null}
          {children}
        </div>
      ) : null}
    </li>
  );
}

function SettingsInner() {
  const { data, org, can, setSnapshot } = useStore();
  const owner = can("settings.manage");
  const params = useSearchParams();

  React.useEffect(() => {
    const c = params.get("connected");
    if (c) toast(`${PROVIDER_LABEL[c] ?? c} connected`);
  }, [params]);

  const live = data.connections.filter((c) => c.status === "connected" || c.status === "demo");
  const connectedSummary = live.length
    ? `${live.map((c) => PROVIDER_LABEL[c.provider] ?? c.provider).join(", ")} connected`
    : "Nothing connected — email and accounting are not connected";
  const save = async (patch: Record<string, unknown>) => {
    const r = await api<{ ok?: boolean; error?: string; snapshot?: Snapshot }>("/api/settings", { json: patch });
    if (r.body.snapshot) setSnapshot(r.body.snapshot);
    toast(r.body.ok ? "Saved" : r.body.error ?? "Couldn't save", r.body.ok ? "success" : "error");
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="t-page">Settings</h1>
        <p className="t-meta mt-0.5 lg:text-[15px]">{`${org.name}${owner ? "" : " · only the owner can change these"}`}</p>
      </div>
      <ul className="panel divide-y divide-line overflow-hidden">
        <Section icon={Link2} title="Connected accounts" subtitle={connectedSummary} defaultOpen>
          <p className="mb-3 text-[14.5px] text-muted-foreground">Bob uses each service&apos;s official sign-in page. He never asks for your passwords.</p>
          <div className="space-y-2">
            {data.connections.map((c) => (
              <ConnectionRow key={c.provider} c={c} owner={can("integrations.manage")} />
            ))}
            <QuickBooksLink org={org} owner={owner} save={save} />
            <div className="rounded-xl bg-card px-3.5 py-3 ring-1 ring-line">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">
                    Instagram <span className="text-[13px] font-normal text-subtle">· Messages</span>
                  </div>
                  <div className="text-[13.5px] text-muted-foreground">Not connected. In this demo, Instagram enquiries are logged manually and you paste Bob&apos;s reply into Instagram yourself.</div>
                </div>
                <StatusChip tone="neutral">Coming soon</StatusChip>
              </div>
            </div>
          </div>
        </Section>
        <Section icon={CalendarDays} title="Calendar" subtitle="Show Bob's diary in Google, Apple or Outlook calendar (one way, read-only).">
          <CalendarSettings />
        </Section>
        <Section icon={Smartphone} title="Install Bob on your phone" subtitle="Add Bob to your home screen so it opens like an app.">
          <InstallBob />
          <p className="text-[14px] text-muted-foreground">Already installed? Bob opens full-screen from your home screen icon.</p>
        </Section>
        <BusinessSection org={org} owner={owner} save={save} />
        <FinanceSection org={org} owner={owner} save={save} />
        <WebsiteFormSection slug={org.slug} />
        <BobSection org={org} owner={owner} save={save} />
        <Section icon={Users} title="Team" subtitle="Who can use Bob for this business.">
          <ul className="divide-y divide-line">
            {data.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-[15px] font-medium">{m.name}</div>
                  <div className="text-[13.5px] text-muted-foreground">{m.email}</div>
                </div>
                <span className="text-[14px] text-muted-foreground">{ROLE_LABEL[m.role]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13.5px] text-subtle">Owner: everything. Admin: planning, jobs, enquiries, tasks, materials, merchants, team and money — not Settings or connected accounts. Site team: jobs, tasks, notes and costs — no financial records. My work only: their own bookings.</p>
        </Section>
        <LeavePolicySection org={org} owner={owner} save={save} />
        <PrivacySection org={org} owner={can("data.delete")} save={save} />
      </ul>
    </div>
  );
}

function LeavePolicySection({ org, owner, save }: { org: OrgConfig; owner: boolean; save: (p: Record<string, unknown>) => Promise<void> }) {
  const on = org.leavePolicy?.managersSelfApprove ?? true;
  return (
    <Section icon={CalendarDays} title="Team & holidays" subtitle={on ? "Luke and Ryan can record their own leave and approve crew requests." : "A main user's own leave needs the other main user's approval."}>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 accent-[var(--color-copper-500)]"
          checked={on}
          disabled={!owner}
          onChange={(e) => void save({ leavePolicy: { managersSelfApprove: e.target.checked } })}
        />
        <span>
          <span className="block text-[15px] font-medium">Owners and admins can record their own leave as approved</span>
          <span className="block text-[14px] text-muted-foreground">
            Either way, owners and admins approve or decline requests from employees, and subcontractors record their own unavailable dates. Manage leave in Team → Holidays.
          </span>
        </span>
      </label>
      {!owner ? <p className="mt-2 text-[13.5px] text-subtle">Only the owner can change this.</p> : null}
    </Section>
  );
}

function BusinessSection({ org, owner, save }: { org: OrgConfig; owner: boolean; save: (p: Record<string, unknown>) => Promise<void> }) {
  const [v, setV] = React.useState({
    name: org.name,
    shortName: org.shortName,
    logoUrl: org.logoUrl ?? "",
    timeZone: org.timeZone ?? "Europe/London",
    tradeType: org.tradeType,
    services: org.services.join(", "),
    serviceArea: org.serviceArea.join(", "),
    days: org.workingHours.days,
    start: org.workingHours.start,
    end: org.workingHours.end,
    phone: org.contact.phone ?? "",
    email: org.contact.email ?? "",
    website: org.contact.website ?? "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <Section icon={Building2} title="Business profile" subtitle="Bob uses this to understand your business.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            name: v.name,
            shortName: v.shortName,
            logoUrl: v.logoUrl,
            timeZone: v.timeZone,
            tradeType: v.tradeType,
            services: list(v.services),
            serviceArea: list(v.serviceArea),
            workingHours: { days: v.days, start: v.start, end: v.end },
            contact: { phone: v.phone, email: v.email, website: v.website },
          });
        }}
      >
        <fieldset disabled={!owner} className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
            <Field label="Business name" htmlFor="s-name">
              <Input id="s-name" value={v.name} onChange={set("name")} />
            </Field>
            <Field label="Short name" htmlFor="s-short" hint="Shown in the menu.">
              <Input id="s-short" value={v.shortName} onChange={set("shortName")} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
            <Field label="Logo link (optional)" htmlFor="s-logo" hint="An https:// image link. Leave empty to show your initials.">
              <Input id="s-logo" value={v.logoUrl} onChange={set("logoUrl")} placeholder="https://…" />
            </Field>
            <Field label="Time zone" htmlFor="s-tz" hint="Used for “today” and booking times.">
              <Input id="s-tz" value={v.timeZone} onChange={set("timeZone")} />
            </Field>
          </div>
          <Field label="Trade" htmlFor="s-trade">
            <Input id="s-trade" value={v.tradeType} onChange={set("tradeType")} />
          </Field>
          <Field label="Services (comma separated)" htmlFor="s-services">
            <Input id="s-services" value={v.services} onChange={set("services")} />
          </Field>
          <Field label="Areas you cover" htmlFor="s-area" hint={org.serviceArea.length ? undefined : "Not set yet."}>
            <Input id="s-area" value={v.serviceArea} onChange={set("serviceArea")} placeholder="e.g. Crawley, Horsham, East Grinstead" />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Working days" htmlFor="s-days">
              <Input id="s-days" value={v.days} onChange={set("days")} />
            </Field>
            <Field label="Start" htmlFor="s-start">
              <Input id="s-start" type="time" value={v.start} onChange={set("start")} />
            </Field>
            <Field label="Finish" htmlFor="s-end">
              <Input id="s-end" type="time" value={v.end} onChange={set("end")} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Phone" htmlFor="s-phone">
              <Input id="s-phone" value={v.phone} onChange={set("phone")} />
            </Field>
            <Field label="Email" htmlFor="s-email">
              <Input id="s-email" type="email" value={v.email} onChange={set("email")} />
            </Field>
            <Field label="Website" htmlFor="s-web">
              <Input id="s-web" value={v.website} onChange={set("website")} />
            </Field>
          </div>
        </fieldset>
        {owner ? <Button type="submit">Save profile</Button> : null}
      </form>
    </Section>
  );
}

function FinanceSection({ org, owner, save }: { org: OrgConfig; owner: boolean; save: (p: Record<string, unknown>) => Promise<void> }) {
  const [vat, setVat] = React.useState(org.finance.vatRegistered === null ? "unset" : org.finance.vatRegistered ? "yes" : "no");
  const [rate, setRate] = React.useState(org.finance.vatRate != null ? String(org.finance.vatRate) : "");
  const [terms, setTerms] = React.useState(org.finance.defaultPaymentTermsDays != null ? String(org.finance.defaultPaymentTermsDays) : "");
  return (
    <Section icon={PoundSterling} title="Invoicing" subtitle="Bob never guesses these — if they're not set, he asks each time.">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            finance: {
              vatRegistered: vat === "unset" ? null : vat === "yes",
              vatRate: vat === "yes" && rate ? Number(rate) : null,
              defaultPaymentTermsDays: terms ? Number(terms) : null,
            },
          });
        }}
      >
        <fieldset disabled={!owner} className="space-y-3">
          <Field label="VAT registered?" htmlFor="f-vat">
            <NativeSelect id="f-vat" value={vat} onChange={(e) => setVat(e.target.value)}>
              <option value="unset">Not set — ask me each time</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </NativeSelect>
          </Field>
          {vat === "yes" ? (
            <Field label="VAT rate (%)" htmlFor="f-rate" hint="Standard UK rate is 20%. Check with your accountant.">
              <Input id="f-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Default payment terms (days)" htmlFor="f-terms" hint={terms ? undefined : "Not set — Bob will ask when an invoice is due."}>
            <Input id="f-terms" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 14" />
          </Field>
        </fieldset>
        {owner ? <Button type="submit">Save invoicing settings</Button> : null}
      </form>
    </Section>
  );
}

/** Shows whether Claude has been answering (or Bob fell back), and runs a tiny live test. */
function AiCheck() {
  const [status, setStatus] = React.useState<{ model?: string; health?: { ok: number; failed: number; lastOkAt?: string; lastErrorAt?: string; lastError?: string; lastModel?: string } } | null>(null);
  const [test, setTest] = React.useState<{ ok: boolean; model?: string; ms?: number; error?: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(() => {
    void fetch("/api/bob/ai-status").then(async (r) => (r.ok ? setStatus(await r.json()) : null));
  }, []);
  React.useEffect(load, [load]);
  const h = status?.health;
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  return (
    <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-[13.5px] ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-heading">AI connection</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await fetch("/api/bob/ai-status", { method: "POST" });
            setTest(await r.json().catch(() => ({ ok: false, error: "No response" })));
            setBusy(false);
            load();
          }}
        >
          {busy ? "Testing…" : "Test connection"}
        </Button>
      </div>
      <p className="mt-1.5 text-subtle">
        Model {h?.lastModel ?? status?.model ?? "—"} · since the server started: {h?.ok ?? 0} answered by Claude, {h?.failed ?? 0} fell back to the built-in assistant.
        {h?.lastOkAt ? ` Last Claude answer ${when(h.lastOkAt)}.` : ""}
      </p>
      {h?.lastError ? (
        <p className="mt-1 text-danger-fg">
          Last problem ({when(h.lastErrorAt)}): {h.lastError}
        </p>
      ) : null}
      {test ? <p className={cn("mt-1 font-medium", test.ok ? "text-good-fg" : "text-danger-fg")}>{test.ok ? `Connected — ${test.model} replied in ${test.ms} ms.` : `Test failed: ${test.error}`}</p> : null}
    </div>
  );
}

function BobSection({ org, owner, save }: { org: OrgConfig; owner: boolean; save: (p: Record<string, unknown>) => Promise<void> }) {
  const { data } = useStore();
  const [signOff, setSignOff] = React.useState(org.assistant.signOff);
  const [readAloud, setReadAloud] = React.useState(org.assistant.readAloudDefault);
  const [voice, setVoice] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setVoice(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  return (
    <Section icon={Bot} title="Bob" subtitle="How your assistant behaves.">
      <div className="mb-4 space-y-2 text-[14.5px]">
        <StatusLine ok={data.mode.aiEngine === "claude"} label="Understanding" value={data.mode.aiEngine === "claude" ? "Claude AI (live)" : "Demo rules engine — set ANTHROPIC_API_KEY on the server for full AI"} />
        {data.mode.aiEngine === "claude" && (data.user.role === "owner" || data.user.role === "office") ? <AiCheck /> : null}
        <StatusLine ok={!!voice} label="Voice" value={voice === null ? "Checking…" : voice ? "Browser speech recognition available on this device" : "Not available in this browser — typing works the same"} />
        <StatusLine ok={false} label="Database" value="Local demo database (SQLite). Supabase is set up in code but not connected." />
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ assistant: { signOff, readAloudDefault: readAloud } });
        }}
      >
        <fieldset disabled={!owner} className="space-y-3">
          <Field label="Email sign-off" htmlFor="b-sign">
            <Textarea id="b-sign" value={signOff} onChange={(e) => setSignOff(e.target.value)} className="min-h-20" />
          </Field>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} className="size-4 accent-[#e4752f]" />
            Speak Bob&apos;s replies to voice requests by default
          </label>
        </fieldset>
        {owner ? <Button type="submit">Save</Button> : null}
      </form>
    </Section>
  );
}

function CalendarSettings() {
  const { data, can, actions } = useStore();
  const linked = data.people.some((p) => p.userId === data.user.id && !p.archivedAt);
  const feed = (scope: "company" | "person") => data.feeds.find((f) => f.scope === scope);
  const create = (scope: "company" | "person") => async () => {
    const r = await actions.run<{ path: string }>("createFeed", { scope });
    return r.ok ? { ok: true as const, path: r.value.path } : { ok: false as const, error: r.errors._ || "Couldn't create the link" };
  };
  const revoke = async (id: string) => (await actions.run("revokeFeed", { id })).ok;
  return (
    <div className="space-y-3">
      <p className="text-[14.5px] text-muted-foreground">
        Bob is where work is created and changed. These links let a calendar app show it. Feeds include the job, town or site address, times and who&apos;s on it — never customer phone numbers, emails, site access notes, entry codes or private notes. A moved booking updates the same event; a cancelled one disappears.
      </p>
      {can("schedule.read") ? (
        <CalendarLink scope="company" title="Company diary" body="Every booking, for owners and the office." feed={feed("company")} create={create("company")} revoke={revoke} />
      ) : null}
      <CalendarLink
        scope="person"
        title="My bookings"
        body={linked ? "Only the bookings you're on." : "Link your login to a Team record (Team → your name → invite) to get a personal feed."}
        feed={feed("person")}
        create={create("person")}
        revoke={revoke}
      />
      <p className="text-[13px] text-muted-foreground">Team members get their own personal link in My work. Removing someone&apos;s access turns their links off.</p>
    </div>
  );
}

function QuickBooksLink({ org, owner, save }: { org: OrgConfig; owner: boolean; save: (p: Record<string, unknown>) => Promise<void> }) {
  const [url, setUrl] = React.useState(org.quickbooksUrl ?? "");
  return (
    <form
      className="rounded-xl bg-card px-3.5 py-3 ring-1 ring-line"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ quickbooksUrl: url.trim() });
      }}
    >
      <label htmlFor="qb-url" className="text-[15px] font-medium">
        Open QuickBooks shortcut
      </label>
      <p className="text-[13.5px] text-muted-foreground">Where the Open QuickBooks button in Money goes, e.g. your QuickBooks bills page. This is just a link — it doesn&apos;t connect or sync anything.</p>
      <div className="mt-2 flex gap-2">
        <Input id="qb-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://qbo.intuit.com/app/bills" disabled={!owner} className="h-11" />
        {owner ? (
          <Button type="submit" size="sm" variant="secondary">
            Save
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function StatusLine({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", ok ? "bg-emerald-400" : "bg-amber-400")} />
      <span>
        <span className="font-medium">{label}: </span>
        <span className="text-muted-foreground">{value}</span>
      </span>
    </div>
  );
}

function StatusChip({ tone, children }: { tone: "good" | "info" | "bad" | "neutral"; children: React.ReactNode }) {
  const cls = {
    good: "bg-emerald-500/10 text-good-fg ring-emerald-500/25",
    info: "bg-sky-500/10 text-info-fg ring-sky-500/25",
    bad: "bg-red-500/10 text-danger-fg ring-red-500/25",
    neutral: "bg-surface-2 text-muted-foreground ring-line-strong",
  }[tone];
  return <span className={cn("inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-[12.5px] font-medium ring-1", cls)}>{children}</span>;
}

function ConnectionRow({ c, owner }: { c: Connection; owner: boolean }) {
  const { setSnapshot } = useStore();
  const [missing, setMissing] = React.useState<string[] | null>(null);
  const live = c.status === "connected" || c.status === "demo";
  const chip: { tone: "good" | "info" | "bad" | "neutral"; label: string } =
    c.status === "connected" ? { tone: "good", label: "Connected" } :
    c.status === "demo" ? { tone: "info", label: "Demo (simulated)" } :
    c.status === "error" ? { tone: "bad", label: "Needs reconnecting" } : { tone: "neutral", label: "Not connected" };
  const statusText =
    c.status === "connected" ? (c.accountLabel ?? "Working") :
    c.status === "demo" ? "Simulated — nothing real is sent" :
    c.status === "error" ? (c.error ?? "Sign in again to reconnect") :
    c.status === "not_configured" ? "Not set up on this server yet — Cresaro needs to add it before you can connect" :
    c.kind === "email" ? "Connect to send approved replies from your own mailbox" : "Connect to send invoices from your accounts";
  return (
    <div className="rounded-xl bg-card px-3.5 py-3 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
            {PROVIDER_LABEL[c.provider] ?? c.provider} <span className="text-[13px] font-normal text-subtle">· {c.kind === "email" ? "Email" : "Accounting"}</span>
            <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
          </div>
          <div className="mt-0.5 text-[13.5px] text-muted-foreground">
            {statusText}
            {c.lastSyncAt ? ` · synced ${timeAgo(c.lastSyncAt)}` : ""}
          </div>
        </div>
        {owner && !c.provider.startsWith("demo_") && c.status !== "not_configured" ? (
          live ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const r = await api<{ snapshot?: Snapshot }>(`/api/integrations/${c.provider}/disconnect`, { method: "POST" });
                if (r.body.snapshot) setSnapshot(r.body.snapshot);
                toast("Disconnected and tokens deleted");
              }}
            >
              <Unlink /> Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const res = await fetch(`/api/integrations/${c.provider}/connect`, { redirect: "manual", credentials: "same-origin" });
                if (res.type === "opaqueredirect" || res.status === 0 || (res.status >= 300 && res.status < 400)) {
                  window.location.href = `/api/integrations/${c.provider}/connect`;
                  return;
                }
                const body = (await res.json().catch(() => ({}))) as { error?: string; missing?: string[] };
                setMissing(body.missing ?? []);
                toast(body.error ?? "Couldn't start the connection", "error");
              }}
            >
              <Link2 /> Connect
            </Button>
          )
        ) : null}
      </div>
      {missing ? (
        <p className="mt-2 text-[13px] text-warn-fg">
          To enable this, the server needs: {missing.join(", ")}. See docs/SETUP.md.
        </p>
      ) : null}
    </div>
  );
}

function PrivacySection({ org, owner, save }: { org: OrgConfig; owner: boolean; save: (p: Record<string, unknown>) => Promise<void> }) {
  const { setSnapshot } = useStore();
  const [months, setMonths] = React.useState(String(org.retention.closedEnquiryMonths));
  const [days, setDays] = React.useState(String(org.retention.conversationDays));
  const [confirmReset, setConfirmReset] = React.useState(false);
  return (
    <Section icon={ShieldCheck} title="Data & privacy" subtitle="UK GDPR controls for your business data.">
      <ul className="mb-4 space-y-1.5 text-[14px] text-muted-foreground">
        <li>• Your data is only visible to members of {org.shortName}. Every request is checked on the server.</li>
        <li>• Customer emails are treated as untrusted text — instructions inside them are ignored.</li>
        <li>• Nothing is sent to a customer without your explicit approval.</li>
      </ul>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ retention: { closedEnquiryMonths: Number(months), conversationDays: Number(days) } });
        }}
      >
        <fieldset disabled={!owner} className="contents">
          <Field label="Keep closed enquiries (months)" htmlFor="p-months">
            <Input id="p-months" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>
          <Field label="Keep Bob conversations (days)" htmlFor="p-days">
            <Input id="p-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </fieldset>
        {owner ? (
          <div className="col-span-2">
            <Button type="submit" variant="secondary">
              Save retention
            </Button>
          </div>
        ) : null}
      </form>
      {owner ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <Button asChild variant="secondary" size="sm">
            <a href="/api/privacy/export">
              <Download /> Export all data
            </a>
          </Button>
          {org.dataMode === "sample" ? (
            confirmReset ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setConfirmReset(false)}>
                  Keep
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    const r = await api<{ ok?: boolean; snapshot?: Snapshot }>("/api/privacy/reset-sample", { method: "POST" });
                    if (r.body.snapshot) setSnapshot(r.body.snapshot);
                    setConfirmReset(false);
                    toast(r.body.ok ? "Sample data reset" : "Couldn't reset", r.body.ok ? "success" : "error");
                  }}
                >
                  <RotateCcw /> Yes, reset sample data
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
                <RotateCcw /> Reset sample data
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 text-[13px] text-subtle">To erase one customer&apos;s personal data, open them under Customers → Privacy.</p>
    </Section>
  );
}

export default function SettingsPage() {
  return (
    <React.Suspense fallback={null}>
      <SettingsInner />
    </React.Suspense>
  );
}
