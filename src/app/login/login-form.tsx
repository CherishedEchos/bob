"use client";

/**
 * Sign-in. Desktop: a full-height split — Bob's charcoal brand panel with the
 * voice orb on the left, a warm off-white sign-in panel on the right. Phones:
 * a compact brand header and the form straight away, no scrolling.
 *
 * Authentication is unchanged: POST /api/auth/login, then the workspace loads.
 * Demo logins (fictional data) appear only when the server passes them
 * (BOB_SHOW_DEMO_LOGINS), and never for Luke or Ryan once their own sign-ins
 * are configured.
 */
import * as React from "react";
import { ChevronDown, Eye, EyeOff, Loader2 } from "lucide-react";
import { BobLogo } from "@/components/brand/logo";
import { Orb } from "@/components/assistant/orb";
import { cn } from "@/lib/utils";

interface DemoGroup {
  group: string;
  accounts: { email: string; label: string }[];
}

type FieldErrors = { email?: string; password?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = "Enter your email address.";
  else if (!EMAIL_RE.test(email.trim())) errors.email = "That doesn't look like an email address. Check for typos.";
  if (!password) errors.password = "Enter your password.";
  return errors;
}

/** Plain-English messages for what the server says. */
function friendly(status: number, serverMessage?: string): string {
  if (status === 401) return "That email and password don't match. Check them and try again.";
  if (status === 429) return serverMessage ?? "Too many attempts. Wait 15 minutes and try again.";
  if (status === 403) return serverMessage ?? "This account can't sign in to a workspace yet. Ask the owner to check your access.";
  if (status >= 500) return "Bob had a problem signing you in. Wait a few seconds and try again.";
  return serverMessage ?? "Couldn't sign in. Try again.";
}

export function LoginForm({ demo, demoPassword }: { demo: DemoGroup[]; demoPassword?: string }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  const post = async (body: { email: string; password: string }, demoEntry: boolean) => {
    setBusy(body.email);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      setError(demoEntry ? "Couldn't open the demo. Bob didn't respond — the demo server can take up to a minute to wake up, so try again shortly." : "Couldn't reach Bob. Check your connection and try again.");
      setBusy(null);
      return;
    }
    if (res.ok) {
      // Keep the loading state until the workspace has loaded.
      window.location.href = "/";
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setError(demoEntry ? `${friendly(res.status, json.error)}` : friendly(res.status, json.error));
    setBusy(null);
    if (!demoEntry) {
      setPassword("");
      passwordRef.current?.focus();
    }
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validate(email, password);
    setFieldErrors(errors);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();
    await post({ email: email.trim(), password }, false);
  };

  const primary = demo[0]?.accounts[0];
  const submitting = !!busy && busy === email.trim();

  return (
    <main className="flex min-h-dvh flex-col bg-[#141416] lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      {/* ------------------------------ Brand ------------------------------ */}
      <section aria-label="Bob" className="theme-dark relative isolate flex shrink-0 flex-col overflow-hidden bg-[#141416] text-[#FAF9F6] lg:min-h-dvh">
        {/* One restrained source of warm light behind the orb. */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[44%] -z-10 hidden size-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgb(243_135_53/0.10),transparent_62%)] lg:block" />

        {/* Phones: compact, app-like header */}
        <div className="flex items-center gap-4 px-6 pb-7 pt-[max(1.75rem,env(safe-area-inset-top))] lg:hidden">
          <div className="min-w-0 flex-1">
            <BobLogo height={26} title="Bob" />
            <p className="mt-4 text-[22px] font-semibold leading-[1.15] tracking-[-0.025em]">
              You do the work.
              <br />
              Bob does the admin.
            </p>
          </div>
          <div aria-hidden className="-mr-2 shrink-0">
            <Orb tone="soft" state="idle" size={92} />
          </div>
        </div>

        {/* Desktop: logo, orb, message, footer */}
        <div className="hidden min-h-dvh flex-col px-12 py-10 lg:flex xl:px-16">
          <BobLogo height={32} title="Bob" />
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <div aria-hidden className="motion-safe:animate-[float_9s_ease-in-out_infinite]">
              <Orb tone="soft" state="idle" size={280} />
            </div>
            <h1 className="mt-12 max-w-[560px] text-[44px] font-semibold leading-[1.06] tracking-[-0.035em] xl:text-[52px]">
              You do the work.
              <br />
              <span className="text-[#F38735]">Bob</span> does the admin.
            </h1>
            <p className="mt-5 max-w-[480px] text-balance text-[17px] leading-relaxed text-white/60">Your jobs, your team and your business. All in one place.</p>
          </div>
          <p className="text-[13px] text-white/40">Built for the trades. Powered by Cresaro.</p>
        </div>
      </section>

      {/* ------------------------------ Sign in ------------------------------ */}
      <section className="relative z-10 flex flex-1 flex-col text-[#18181B] lg:min-h-dvh lg:bg-[#FAF9F6]">
        <div className="-mt-4 flex flex-1 flex-col rounded-t-[22px] bg-[#FAF9F6] px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7 sm:px-10 lg:mt-0 lg:justify-center lg:rounded-none lg:px-12">
          <div className="mx-auto w-full max-w-[380px]">
            <h2 className="text-[26px] font-semibold tracking-[-0.025em] text-[#18181B] lg:text-[30px]">Welcome to Bob</h2>
            <p className="mt-1.5 text-[15.5px] text-[#6B6B70]">Sign in to your workspace.</p>

            {error ? (
              <div role="alert" className="mt-6 rounded-[10px] border border-[#F1C9C4] bg-[#FDF2F1] px-3.5 py-3 text-[14.5px] leading-snug text-[#9A2B22]">
                {error}
              </div>
            ) : null}

            <form onSubmit={signIn} noValidate className="mt-6 space-y-5" aria-label="Sign in">
              <div>
                <label htmlFor="l-email" className="block text-[14px] font-medium text-[#2A2A2E]">
                  Email
                </label>
                <input
                  ref={emailRef}
                  id="l-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
                  }}
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "l-email-error" : undefined}
                  placeholder="you@company.co.uk"
                  className={cn(
                    "mt-1.5 block h-12 w-full rounded-[10px] border bg-white px-3.5 text-[16px] text-[#18181B] outline-none transition placeholder:text-[#A1A1A6]",
                    "focus:border-[#E4752F] focus:ring-[3px] focus:ring-[#E4752F]/15",
                    fieldErrors.email ? "border-[#D6453D]" : "border-[#DCDAD4] hover:border-[#C7C4BC]",
                  )}
                />
                {fieldErrors.email ? (
                  <p id="l-email-error" className="mt-1.5 text-[13.5px] text-[#B4332A]">
                    {fieldErrors.email}
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="l-pass" className="block text-[14px] font-medium text-[#2A2A2E]">
                  Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    ref={passwordRef}
                    id="l-pass"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
                    }}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={fieldErrors.password ? "l-pass-error" : undefined}
                    className={cn(
                      "block h-12 w-full rounded-[10px] border bg-white pl-3.5 pr-12 text-[16px] text-[#18181B] outline-none transition",
                      "focus:border-[#E4752F] focus:ring-[3px] focus:ring-[#E4752F]/15",
                      fieldErrors.password ? "border-[#D6453D]" : "border-[#DCDAD4] hover:border-[#C7C4BC]",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide password" : "Show password"}
                    aria-pressed={show}
                    aria-controls="l-pass"
                    className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-[10px] text-[#6B6B70] transition hover:text-[#18181B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#E4752F]"
                  >
                    {show ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
                  </button>
                </div>
                {fieldErrors.password ? (
                  <p id="l-pass-error" className="mt-1.5 text-[13.5px] text-[#B4332A]">
                    {fieldErrors.password}
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={!!busy}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#E4752F] text-[16px] font-semibold text-white shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.18)] transition hover:bg-[#D9682A] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#E4752F]/35 active:bg-[#C95E24] disabled:cursor-default disabled:opacity-70"
              >
                {submitting ? <Loader2 className="size-[18px] animate-spin" aria-hidden /> : null}
                {submitting ? "Signing in…" : "Sign in"}
              </button>
              <span className="sr-only" aria-live="polite">
                {submitting ? "Signing in" : ""}
              </span>
            </form>

            <p className="mt-5 text-[13.5px] leading-relaxed text-[#8A8A8F]">Forgotten your password? Ask your workspace owner to reset it, or contact Cresaro.</p>

            {/* Fictional demo access — only when the server allows it */}
            {primary && demoPassword ? (
              <div className="mt-8 border-t border-[#E7E4DE] pt-6">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void post({ email: primary.email, password: demoPassword }, true)}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-[#DCDAD4] bg-white text-[15px] font-medium text-[#2A2A2E] transition hover:border-[#C7C4BC] hover:bg-[#F6F5F1] disabled:opacity-60"
                >
                  {busy === primary.email ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  {busy === primary.email ? "Opening the demo workspace…" : "Try the demo"}
                </button>
                <p className="mt-2 text-center text-[13px] text-[#8A8A8F]">A fictional workspace. Nothing is sent to anyone.</p>
                {demo.length ? (
                  <details className="group mt-4">
                    <summary className="flex cursor-pointer list-none items-center justify-center gap-1 text-[13.5px] font-medium text-[#6B6B70] hover:text-[#18181B] [&::-webkit-details-marker]:hidden">
                      Other demo logins <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="mt-3 space-y-4">
                      {demo.map((g) => (
                        <div key={g.group}>
                          <div className="mb-1.5 text-[12px] font-medium text-[#8A8A8F]">{g.group}</div>
                          <ul className="divide-y divide-[#ECEAE5] overflow-hidden rounded-[10px] border border-[#E7E4DE] bg-white">
                            {g.accounts.map((a) => (
                              <li key={a.email}>
                                <button
                                  type="button"
                                  onClick={() => void post({ email: a.email, password: demoPassword }, true)}
                                  disabled={!!busy}
                                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[14px] text-[#2A2A2E] transition hover:bg-[#F6F5F1] disabled:opacity-50"
                                >
                                  <span>{a.label}</span>
                                  {busy === a.email ? <Loader2 className="size-4 animate-spin text-[#8A8A8F]" aria-hidden /> : null}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
          <p className="mx-auto mt-auto w-full max-w-[380px] pt-8 text-[12.5px] text-[#A1A1A6] lg:hidden">Built for the trades. Powered by Cresaro.</p>
        </div>
      </section>
    </main>
  );
}
