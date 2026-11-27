"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Bot, BookOpen, Building2, CalendarDays, LifeBuoy, Star, CreditCard, UserRound, ChevronRight, Copy, Smartphone, Download, ExternalLink, Globe, Link2, PoundSterling, RotateCcw, ShieldCheck, Unlink, Users } from "lucide-react";
import { api, useStore } from "@/lib/store/store";
import type { Connection, OrgConfig, Snapshot } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/auth/permissions";
import { DEFAULT_TEMPLATE, contactLine, fillTemplate, followUpSettings, isGoogleReviewUrl } from "@/lib/followups";
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
          <div className="mb-1.5 text-[15px] font-medium text-foreground/90">Form link</div>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-message px-3.5 py-3 text-[15px] ring-1 ring-line-strong">{link}</code>
            <Button variant="secondary" onClick={() => void copy(link, "Link")}>
              <Copy /> Copy
            </Button>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[15px] font-medium text-foreground/90">Add it to your website</div>
          <code className="block break-all rounded-xl bg-message px-3.5 py-3 text-[14px] leading-relaxed text-muted-foreground ring-1 ring-line-strong">{embed}</code>
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
        <p className="text-[14px] text-subtle">Spam protection and rate limits are built in. Messages are treated as plain text — never as instructions to Bob.</p>
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
          <Icon className="size-5 shrink-0 text-subtle" />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">{title}</span>
            {subtitle && !open ? <span className="mt-0.5 block truncate text-[15px] text-muted-foreground">{subtitle}</span> : null}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[14.5px] font-medium text-muted-foreground">
            <span className="hidden sm:inline">{open ? "Hide" : "Show"}</span>
            <ChevronRight aria-hidden className={cn("size-5 text-subtle transition-transform", open && "rotate-90")} />
          </span>
        </button>
      </h2>
      {open ? (
        <div id={id} className="px-4 pb-5 lg:px-5">
          {subtitle ? <p className="mb-4 text-[15px] text-muted-foreground">{subtitle}</p> : null}
          {children}
        </div>
      ) : null}
    </li>
  );
}

/** The customer user guide, served from /public so it works for everyone signed in. */
const GUIDE_URL = "/guide/getting-started-with-bob.pdf";

function SettingsInner() {
  const { data, org, can, setSnapshot, user } = useStore();
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

  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="mt-6 first:mt-0" aria-label={title}>
      <h2 className="mb-2 px-1 text-[14px] font-semibold text-muted-foreground">{title}</h2>
      <ul className="panel divide-y divide-line overflow-hidden">{children}</ul>
    </section>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="t-page">Settings</h1>
        <p className="t-meta mt-0.5 lg:text-[15px]">{`${org.name}${owner ? "" : " · only the owner can change these"}`}</p>
      </div>

      <Group title="Your business">
        <BusinessSection org={org} owner={owner} save={save} />
        <FinanceSection org={org} owner={owner} save={save} />
        <FollowUpSection org={org} owner={owner} save={save} />
      </Group>

      <Group title="Connections">
        <Section icon={Link2} title="Email & accounting" subtitle={connectedSummary} defaultOpen={params.get("open") === "email"}>
          <p className="mb-3 text-[15px] text-muted-foreground">Connecting uses each service&apos;s own sign-in page — Bob never sees your password. You can disconnect at any time, and Bob deletes its access straight away.</p>
          <div className="space-y-2">
            {data.connections.map((c) => (
              <ConnectionRow key={c.provider} c={c} owner={can("integrations.manage")} />
            ))}
            <QuickBooksLink org={org} owner={owner} save={save} />
            <div className="rounded-xl bg-card px-3.5 py-3 ring-1 ring-line">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">Instagram</div>
                  <div className="text-[14.5px] text-muted-foreground">Log Instagram enquiries in Bob and paste Bob&apos;s reply into Instagram yourself.</div>
                </div>
                <StatusChip tone="neutral">Coming soon</StatusChip>
              </div>
            </div>
          </div>
        </Section>
        <Section icon={CalendarDays} title="Calendar" subtitle="Show Bob's diary in Google, Apple or Outlook calendar (read-only).">
          <CalendarSettings />
        </Section>
        <WebsiteFormSection slug={org.slug} />
      </Group>

      <Group title="People & access">
        <Section icon={Users} title="User accounts & roles" subtitle={`${data.members.length} ${data.members.length === 1 ? "person" : "people"} can sign in`}>
          <ul className="divide-y divide-line">
            {data.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-[15px] font-medium">{m.name}</div>
                  <div className="text-[14.5px] text-muted-foreground">{m.email}</div>
                </div>
                <span className="text-[15px] text-muted-foreground">{ROLE_LABEL[m.role]}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 text-[14.5px] text-subtle">
            <div><dt className="inline font-medium text-foreground">Owner</dt> <dd className="inline">— everything.</dd></div>
            <div><dt className="inline font-medium text-foreground">Admin</dt> <dd className="inline">— planning, jobs, enquiries, tasks, materials, merchants, team and money. Not Settings or connections.</dd></div>
            <div><dt className="inline font-medium text-foreground">Site team</dt> <dd className="inline">— jobs, tasks, notes and costs. No money.</dd></div>
            <div><dt className="inline font-medium text-foreground">My work only</dt> <dd className="inline">— their own bookings.</dd></div>
          </dl>
          <p className="mt-3 text-[14.5px] text-subtle">Invite someone from Team → their name → Invite.</p>
        </Section>
        <LeavePolicySection org={org} owner={owner} save={save} />
      </Group>

      <Group title="Bob preferences">
        <BobSection org={org} owner={owner} save={save} />
        <Section icon={Smartphone} title="Bob on your phone" subtitle="Add Bob to your home screen so it opens like an app.">
          <InstallBob />
          <p className="text-[15px] text-muted-foreground">Already installed? Bob opens full-screen from your home screen icon.</p>
        </Section>
      </Group>

      <Group title="Account">
        <Section icon={UserRound} title="Your details" subtitle={`${user.name} · ${ROLE_LABEL[user.role]}`}>
          <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[15px]">
            <dt className="text-subtle">Name</dt>
            <dd>{user.name}</dd>
            <dt className="text-subtle">Email</dt>
            <dd className="break-all">{user.email}</dd>
            <dt className="text-subtle">Role</dt>
            <dd>{ROLE_LABEL[user.role]}</dd>
          </dl>
        </Section>
        <Section icon={CreditCard} title="Subscription" subtitle={org.dataMode === "sample" ? "Demo workspace" : "Pilot — managed by Cresaro"}>
          <p className="text-[15px] text-muted-foreground">
            {org.dataMode === "sample" ? "This is a demo workspace with fictional data. Nothing here is billed." : "Your business is on the Bob pilot. Cresaro looks after billing — get in touch with them for anything about your plan."}
          </p>
        </Section>
        <PrivacySection org={org} owner={can("data.delete")} save={save} />
      </Group>

      <Group title="Help & support">
        <Section icon={BookOpen} title="User guide" subtitle="Getting started with Bob — a step-by-step guide to every part of Bob." defaultOpen={params.get("open") === "help"}>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={GUIDE_URL} target="_blank" rel="noreferrer">
                <BookOpen /> Open the user guide
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={GUIDE_URL} download>
                <Download /> Download PDF
              </a>
            </Button>
          </div>
        </Section>
        <Section icon={LifeBuoy} title="Getting help" subtitle="Forgotten passwords, the microphone, and who to contact.">
          <ul className="space-y-2.5 text-[15.5px] leading-relaxed">
            <li>
              <strong className="font-semibold">Forgotten your password?</strong> Ask your workspace owner to set a new one in Settings → User accounts & roles, or contact Cresaro.
            </li>
            <li>
              <strong className="font-semibold">Microphone not working?</strong> Allow microphone access for this site in your browser or phone settings, then tap Bob&apos;s microphone again. You can always type instead.
            </li>
            <li>
              <strong className="font-semibold">Something not right?</strong> Contact Cresaro using the details in your welcome email. Tell us what you were doing and, if you can, send a screenshot.
            </li>
          </ul>
        </Section>
      </Group>
    </div>
  );
}

function LeavePolicySection({ org, owner, save }: { org: OrgConfig; owner: boolean; save: (p: Record<string, unknown>) => Promise<void> }) {
  const on = org.leavePolicy?.managersSelfApprove ?? true;
  return (
    <Section icon={CalendarDays} title="Team & holidays" subtitle={on ? "Owners and admins can record their own leave and approve crew requests." : "A main user's own leave needs the other main user's approval."}>
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
          <span className="block text-[15px] text-muted-foreground">
            Either way, owners and admins approve or decline requests from employees, and subcontractors record their own unavailable dates. Manage leave in Team → Holidays.
          </span>
        </span>
      </label>
      {!owner ? <p className="mt-2 text-[14.5px] text-subtle">Only the owner can change this.</p> : null}
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


/** Thank-you email and Google review request after a handover. */
function FollowUpSection({ org, owner, save }: { org: OrgConfig; owner: boolean; save: (p: Record<string, unknown>) => Promise<void> }) {
  const { data } = useStore();
  const f = followUpSettings(org);
  const [url, setUrl] = React.useState(f.reviewUrl ?? "");
  const [enabled, setEnabled] = React.useState(f.reviewsEnabled);
  const [mode, setMode] = React.useState(f.mode);
  const [reminder, setReminder] = React.useState(f.reminder);
  const [subject, setSubject] = React.useState(f.template.subject);
  const [body, setBody] = React.useState(f.template.body);
  const mailbox = data.connections.some((c) => c.kind === "email" && (c.status === "connected" || c.status === "demo"));
  const urlOk = !url || isGoogleReviewUrl(url);
  const team = data.members.filter((m) => m.role === "owner" || m.role === "office").map((m) => m.name.split(/\s+/)[0]);
  const example = { firstName: "Claire", customerName: "Claire Dawson", job: "garden room", business: org.shortName || org.name, businessName: org.name, team: team.length > 1 ? `${team.slice(0, -1).join(", ")} & ${team.at(-1)}` : team[0] ?? org.name, signOff: org.assistant.signOff, contact: contactLine(org), reviewLink: url || "https://g.page/r/your-business/review" };
  return (
    <Section icon={Star} title="Customer follow-ups" subtitle={enabled && f.reviewUrl ? `Thank-you email with a review request · ${f.mode === "auto" ? "sent automatically" : "you approve each one"}` : "Thank-you email after each handover"}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!urlOk) return;
          void save({ followUps: { reviewUrl: url.trim(), reviewsEnabled: enabled, mode, reminder, template: { subject, body } } });
        }}
      >
        <Field label="Google review link" htmlFor="fu-url" hint="From your Google Business Profile → Ask for reviews → copy the link." error={urlOk ? undefined : "That doesn't look like a Google review link. It should start https:// and be on g.page or google.com."}>
          <Input id="fu-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://g.page/r/…/review" disabled={!owner} inputMode="url" />
        </Field>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 accent-[var(--color-copper-500)]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!owner} />
          <span className="text-[15px]">
            <span className="block font-semibold">Ask customers for a Google review</span>
            <span className="block text-muted-foreground">The same honest request to every customer, once per job. Bob never asks only happy customers and never says a review was left.</span>
          </span>
        </label>
        <fieldset>
          <legend className="mb-1.5 text-[15px] font-medium">Sending</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([["manual", "I approve each email", "Bob prepares it; you check and press send."], ["auto", "Send automatically", "Sent as soon as you finish a handover. Needs a connected email account."]] as const).map(([v, label, hint]) => (
              <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-xl px-3.5 py-3 ring-1", mode === v ? "bg-selected ring-copper-500/50" : "ring-line-strong", (!owner || (v === "auto" && !mailbox)) && "cursor-not-allowed opacity-60")}>
                <input type="radio" name="fu-mode" className="mt-1 accent-[var(--color-copper-500)]" checked={mode === v} onChange={() => setMode(v)} disabled={!owner || (v === "auto" && !mailbox)} />
                <span className="text-[15px]">
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-muted-foreground">{v === "auto" && !mailbox ? "Connect an email account first (Connections)." : hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 accent-[var(--color-copper-500)]" checked={reminder} onChange={(e) => setReminder(e.target.checked)} disabled={!owner} />
          <span className="text-[15px]">
            <span className="block font-semibold">One reminder after seven days</span>
            <span className="block text-muted-foreground">Only if a review was asked for. It can be cancelled on the job.</span>
          </span>
        </label>
        <details className="rounded-xl ring-1 ring-line">
          <summary className="flex min-h-12 cursor-pointer items-center px-3.5 text-[15px] font-semibold">Email template</summary>
          <div className="space-y-3 border-t border-line px-3.5 pb-3.5 pt-3">
            <p className="text-[14px] text-muted-foreground">Bob fills in {"{firstName}"}, {"{job}"}, {"{business}"}, {"{team}"}, {"{businessName}"} and {"{reviewBlock}"} (the review paragraph, only when asking). Your contact details are added at the end.</p>
            <Field label="Subject" htmlFor="fu-subject">
              <Input id="fu-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!owner} />
            </Field>
            <Field label="Message" htmlFor="fu-body">
              <Textarea id="fu-body" rows={9} value={body} onChange={(e) => setBody(e.target.value)} disabled={!owner} />
            </Field>
            {owner ? (
              <button type="button" onClick={() => { setSubject(DEFAULT_TEMPLATE.subject); setBody(DEFAULT_TEMPLATE.body); }} className="h-9 text-[15px] font-semibold text-accent-fg">
                Reset to Bob&apos;s wording
              </button>
            ) : null}
            <div className="rounded-xl bg-surface-2 p-3.5">
              <p className="text-[13.5px] font-semibold uppercase tracking-wide text-subtle">Preview (example customer)</p>
              <p className="mt-1.5 text-[15px] font-semibold">{fillTemplate(subject, example, false)}</p>
              <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed">{fillTemplate(body, example, enabled)}</p>
            </div>
          </div>
        </details>
        {owner ? (
          <Button type="submit" disabled={!urlOk}>
            Save follow-up settings
          </Button>
        ) : null}
      </form>
    </Section>
  );
}

function FinanceSection({ org, owner, save }: { org: OrgConfig; owner: boolean; save: (p: Record<string, unknown>) => Promise<void> }) {
  const [vat, setVat] = React.useState(org.finance.vatRegistered === null ? "unset" : org.finance.vatRegistered ? "yes" : "no");
  const [rate, setRate] = React.useState(org.finance.vatRate != null ? String(org.finance.vatRate) : "");
  const [terms, setTerms] = React.useState(org.finance.defaultPaymentTermsDays != null ? String(org.finance.defaultPaymentTermsDays) : "");
  const [pricesAre, setPricesAre] = React.useState(org.finance.pricesAre ?? "");
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
              pricesAre: vat === "yes" && pricesAre ? pricesAre : null,
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
          {vat === "yes" ? (
            <Field label="Your prices and quotes are" htmlFor="f-prices" hint={pricesAre ? "Bob uses this for final balances and deposits." : "Not set — Bob will ask whether each invoice is plus VAT or including VAT."}>
              <NativeSelect id="f-prices" value={pricesAre} onChange={(e) => setPricesAre(e.target.value as typeof pricesAre)}>
                <option value="">Not set — ask me each time</option>
                <option value="exclusive">Plus VAT (VAT added on top)</option>
                <option value="inclusive">Including VAT</option>
              </NativeSelect>
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
      <div className="mb-4 space-y-2 text-[15px]">
        <StatusLine ok={data.mode.aiEngine === "claude"} label="Understanding" value={data.mode.aiEngine === "claude" ? "Full AI assistant" : "Built-in assistant"} />
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
      <p className="text-[15px] text-muted-foreground">
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
      <p className="text-[14px] text-muted-foreground">Team members get their own personal link in My work. Removing someone&apos;s access turns their links off.</p>
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
      <p className="text-[14.5px] text-muted-foreground">Where the Open QuickBooks button in Money goes, e.g. your QuickBooks bills page. This is just a link — it doesn&apos;t connect or sync anything.</p>
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
  return <span className={cn("inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-[13.5px] font-medium ring-1", cls)}>{children}</span>;
}

function ConnectionRow({ c, owner }: { c: Connection; owner: boolean }) {
  const { setSnapshot } = useStore();
  const [missing, setMissing] = React.useState<string[] | null>(null);
  const live = c.status === "connected" || c.status === "demo";
  const chip: { tone: "good" | "info" | "bad" | "neutral"; label: string } =
    c.status === "connected" ? { tone: "good", label: "Connected" } :
    c.status === "demo" ? { tone: "info", label: "Demo" } :
    c.status === "error" ? { tone: "bad", label: "Needs reconnecting" } :
    c.status === "not_configured" ? { tone: "neutral", label: "Coming soon" } : { tone: "neutral", label: "Not connected" };
  const statusText =
    c.status === "connected" ? (c.accountLabel ?? "Working") :
    c.status === "demo" ? "Simulated — nothing real is sent" :
    c.status === "error" ? (c.error ?? "Sign in again to reconnect") :
    c.status === "not_configured" ? "Available soon — Cresaro will switch this on for you" :
    c.kind === "email" ? "Tap Connect, sign in to your mailbox, and allow Bob to read enquiries and send replies you approve" : "Tap Connect and sign in — Bob can then send invoices you approve from your accounts";
  return (
    <div className="rounded-xl bg-card px-3.5 py-3 ring-1 ring-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
            {PROVIDER_LABEL[c.provider] ?? c.provider} <span className="text-[14px] font-normal text-subtle">· {c.kind === "email" ? "Email" : "Accounting"}</span>
            <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
          </div>
          <div className="mt-0.5 text-[14.5px] text-muted-foreground">
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
        <p className="mt-2 text-[14px] text-warn-fg">
          Cresaro needs to finish setting this up before it can connect. We&apos;ve kept your place — try again later.
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
      <ul className="mb-4 space-y-1.5 text-[15px] text-muted-foreground">
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
      <p className="mt-3 text-[14px] text-subtle">To erase one customer&apos;s personal data, open them under Customers → Privacy.</p>
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
