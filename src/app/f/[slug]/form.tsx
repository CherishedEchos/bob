"use client";

import * as React from "react";
import Image from "next/image";
import { CheckCircle2, Loader2, Send } from "lucide-react";

type Errors = Partial<Record<"name" | "email" | "phone" | "job" | "town" | "message" | "_", string>>;

const field =
  "w-full rounded-xl border border-[#d6d0c8] bg-white px-3.5 text-[16px] text-[#1c1917] outline-none transition placeholder:text-[#a39a90] focus:border-[#ec7a2e] focus:ring-2 focus:ring-[#ec7a2e]/25 aria-[invalid=true]:border-[#c2410c]";

export function EnquiryForm({ slug, name, shortName, logoUrl, services, embed }: { slug: string; name: string; shortName: string; logoUrl?: string; services: string[]; embed: boolean }) {
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Errors>({});
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    setBusy(true);
    setErrors({});
    const res = await fetch(`/api/public/enquiry/${encodeURIComponent(slug)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res) return setErrors({ _: "Couldn't send — check your connection and try again." });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fieldErrors?: Errors };
    if (res.ok && j.ok) return setSentTo(String(body.name ?? "").split(" ")[0] || "there");
    setErrors({ ...(j.fieldErrors ?? {}), _: j.fieldErrors ? undefined : j.error ?? "Something went wrong — please try again." });
  };

  const card = embed ? "" : "mx-auto max-w-lg rounded-2xl border border-[#e5dfd7] bg-white p-6 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.25)] sm:p-8";

  if (sentTo)
    return (
      <div className={card} role="status">
        <CheckCircle2 className="size-10 text-[#16a34a]" />
        <h1 className="mt-3 text-[22px] font-semibold tracking-tight">Thanks, {sentTo} — message sent</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-[#57534e]">{shortName} will get back to you as soon as they can.</p>
      </div>
    );

  return (
    <div className={card}>
      {!embed ? (
        <div className="mb-5 flex items-center gap-3">
          {logoUrl ? <Image src={logoUrl} alt="" width={44} height={44} className="rounded-full" /> : null}
          <div>
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Get in touch</h1>
            <p className="text-[15px] text-[#57534e]">{name}</p>
          </div>
        </div>
      ) : null}
      <form onSubmit={submit} noValidate className="space-y-4">
        <Row label="Your name" id="name" error={errors.name}>
          <input id="name" name="name" autoComplete="name" className={`${field} h-12`} aria-invalid={!!errors.name} required />
        </Row>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Row label="Email" id="email" error={errors.email}>
            <input id="email" name="email" type="email" autoComplete="email" className={`${field} h-12`} aria-invalid={!!errors.email} />
          </Row>
          <Row label="Phone" id="phone" error={errors.phone}>
            <input id="phone" name="phone" type="tel" autoComplete="tel" className={`${field} h-12`} aria-invalid={!!errors.phone} />
          </Row>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Row label="What's the job?" id="job" error={errors.job}>
            <select id="job" name="job" className={`${field} h-12`} defaultValue="">
              <option value="">Choose…</option>
              {services.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="Something else">Something else</option>
            </select>
          </Row>
          <Row label="Town or postcode" id="town" error={errors.town}>
            <input id="town" name="town" autoComplete="address-level2" className={`${field} h-12`} aria-invalid={!!errors.town} required />
          </Row>
        </div>
        <Row label="Tell us about the job" id="message" error={errors.message}>
          <textarea id="message" name="message" rows={5} className={`${field} py-3 leading-relaxed`} aria-invalid={!!errors.message} placeholder="Size, what you're after, when you'd like it done…" required />
        </Row>
        {/* Honeypot: hidden from people, irresistible to bots. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        {errors._ ? (
          <p role="alert" className="text-[14.5px] text-[#c2410c]">
            {errors._}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ec7a2e] text-[16px] font-semibold text-white transition hover:bg-[#cf631d] active:scale-[0.99] disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-4" />} Send enquiry
        </button>
        <p className="text-center text-[12.5px] text-[#8a8178]">
          Your details go to {shortName} only, to reply to your enquiry. Enquiries managed with bob.
        </p>
      </form>
    </div>
  );
}

function Row({ label, id, error, children }: { label: string; id: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-medium text-[#44403c]">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-[13.5px] text-[#c2410c]">{error}</p> : null}
    </div>
  );
}
