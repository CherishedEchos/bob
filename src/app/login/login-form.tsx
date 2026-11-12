"use client";

import * as React from "react";
import { BobLogo } from "@/components/brand/logo";
import { ArrowRight, Check, FlaskConical, Hand, Keyboard, Loader2, LogIn, Mic, Users } from "lucide-react";
import { Orb } from "@/components/assistant/orb";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

interface DemoGroup {
  group: string;
  accounts: { email: string; label: string }[];
}

export function LoginForm({ demo, demoPassword }: { demo: DemoGroup[]; demoPassword?: string }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const signIn = async (e?: React.FormEvent, creds?: { email: string; password: string }) => {
    e?.preventDefault();
    const body = creds ?? { email, password };
    setBusy(body.email);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      window.location.href = "/today";
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setError(json.error ?? "Couldn't sign in");
    setBusy(null);
  };

  const primary = demo[0]?.accounts[0];
  return (
    <main className="bg-app relative min-h-dvh overflow-hidden">
      {/* Warm workshop-light glow, like the brand hero */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-40 top-[-10%] size-[620px] rounded-full bg-[radial-gradient(circle,rgb(255_130_28/0.20),transparent_62%)] blur-2xl" />
        <div className="absolute -bottom-48 right-[12%] size-[520px] rounded-full bg-[radial-gradient(circle,rgb(255_160_80/0.14),transparent_60%)] blur-3xl" />
        <div className="absolute -left-32 bottom-[-20%] size-[460px] rounded-full bg-[radial-gradient(circle,rgb(255_130_28/0.07),transparent_60%)] blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8 lg:px-12 lg:pt-10">
        <header className="flex items-center justify-between">
          <BobLogo height={30} title="Bob" />
          <span className="rounded-md bg-white/[0.06] px-2.5 py-1 text-[12.5px] font-medium text-white/70 ring-1 ring-white/10">Demo preview</span>
        </header>

        <div className="grid flex-1 grid-cols-1 items-center gap-10 py-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16 lg:py-12">
          {/* Pitch + entry */}
          <section className="max-w-2xl">
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-[#FF821C]">Your AI trade assistant</p>
            <h1 className="mt-3 text-[33px] font-bold leading-[1.04] tracking-[-0.035em] text-[#FAF9F6] min-[400px]:text-[36px] sm:text-[52px] lg:text-[58px]">
              <span className="block whitespace-nowrap">You do the work.</span>
              <span className="block whitespace-nowrap">
                Bob does the <span className="text-[#FF821C]">admin.</span>
              </span>
            </h1>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-white/70">
              The AI assistant for tradespeople that keeps on top of enquiries, jobs, invoices and follow-ups — and everything in between.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-[14.5px] text-white/85">
              <span className="w-full font-semibold text-[#FAF9F6] sm:w-auto sm:pr-1">Just talk, type or tap.</span>
              {[
                { Icon: Mic, label: "Talk" },
                { Icon: Keyboard, label: "Type" },
                { Icon: Hand, label: "Tap" },
              ].map(({ Icon, label }) => (
                <span key={label} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 ring-1 ring-white/10">
                  <Icon className="size-3.5 text-[#FF9A4A]" /> {label}
                </span>
              ))}
            </div>

            {primary && demoPassword ? (
              <div className="mt-8">
                <Button
                  size="lg"
                  className="h-14 w-full text-[17px] sm:w-auto sm:px-8"
                  disabled={!!busy}
                  onClick={() => void signIn(undefined, { email: primary.email, password: demoPassword })}
                >
                  {busy === primary.email ? <Loader2 className="animate-spin" /> : <ArrowRight />} Try the demo
                </Button>
                <p className="mt-3 flex items-start gap-1.5 text-[14px] leading-snug text-white/60">
                  <FlaskConical className="mt-0.5 size-4 shrink-0 text-sky-300/80" />
                  Opens a fictional Ninety3 workspace. Sample customers only — nothing is ever sent to anyone.
                </p>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="mt-4 text-[15px] text-danger-fg">
                {error}
              </p>
            ) : null}

            <div className="mt-8 space-y-2.5">
              <details className="group panel px-4 py-3" open={!demoPassword}>
                <summary className="cursor-pointer list-none text-[15px] font-medium text-white/85 marker:hidden">
                  <span className="inline-flex items-center gap-2">
                    <LogIn className="size-4 text-white/50" /> Sign in with an account
                  </span>
                </summary>
                <form onSubmit={signIn} className="mt-4 space-y-4" noValidate>
                  <Field label="Email" htmlFor="l-email">
                    <Input id="l-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </Field>
                  <Field label="Password" htmlFor="l-pass">
                    <Input id="l-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </Field>
                  <Button type="submit" className="w-full rounded-[12px]" disabled={!!busy}>
                    {busy === email && busy ? <Loader2 className="animate-spin" /> : <LogIn />} Sign in
                  </Button>
                </form>
              </details>

              {demo.length && demoPassword ? (
                <details className="panel px-4 py-3">
                  <summary className="cursor-pointer list-none text-[15px] font-medium text-white/85 marker:hidden">
                    <span className="inline-flex items-center gap-2">
                      <Users className="size-4 text-white/50" /> Other demo logins
                    </span>
                  </summary>
                  <p className="mt-2 text-[14px] text-muted-foreground">
                    Fictional data only. Password for all: <code className="rounded bg-surface-3 px-1.5">{demoPassword}</code>
                  </p>
                  <div className="mt-4 space-y-4">
                    {demo.map((g) => (
                      <div key={g.group}>
                        <div className="mb-2 text-[12.5px] font-medium uppercase tracking-wider text-subtle">{g.group}</div>
                        <div className="space-y-1.5">
                          {g.accounts.map((a) => (
                            <button
                              key={a.email}
                              onClick={() => void signIn(undefined, { email: a.email, password: demoPassword })}
                              disabled={!!busy}
                              className="flex min-h-12 w-full items-center justify-between rounded-[10px] bg-surface-2 px-4 py-2.5 text-left text-[15px] ring-1 ring-line transition hover:bg-surface-3 disabled:opacity-50"
                            >
                              <span>{a.label}</span>
                              {busy === a.email ? <Loader2 className="size-4 animate-spin" /> : <span className="hidden text-[13px] text-subtle sm:inline">{a.email}</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </section>

          {/* Illustration: how Bob works — voice in, draft out, your OK */}
          <section aria-hidden className="relative mx-auto w-full max-w-[460px] select-none">
            <div className="relative flex aspect-square items-center justify-center">
              <Orb state="idle" size={300} className="scale-[0.8] sm:scale-100" />
              <div className="absolute left-0 top-[12%] max-w-[250px] rounded-[14px] bg-[#1a1816]/90 px-4 py-3 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/10 backdrop-blur">
                <div className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wider text-white/45">
                  <Mic className="size-3 text-[#FF9A4A]" /> You, from the van
                </div>
                <p className="mt-1 text-[15px] leading-snug text-[#FAF9F6]">“Chase Sarah about the loft deposit.”</p>
              </div>
              <div className="absolute bottom-[8%] right-0 w-[270px] rounded-[14px] bg-[#1a1816]/90 p-4 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/10 backdrop-blur">
                <div className="flex items-center gap-2">
                  <BobLogo height={13} />
                  <span className="text-[11.5px] font-medium uppercase tracking-wider text-white/45">drafted it</span>
                </div>
                <p className="mt-2 text-[14px] leading-snug text-white/80">Hi Sarah, just a reminder the £5,600 deposit for the loft conversion is now due…</p>
                <div className="mt-3 flex gap-2">
                  <span className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-[#FF821C] text-[13px] font-semibold text-white">
                    <Check className="size-3.5" /> Approve
                  </span>
                  <span className="inline-flex h-8 flex-1 items-center justify-center rounded-lg text-[13px] font-medium text-white/75 ring-1 ring-white/15">Edit</span>
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-[13px] text-white/45">Nothing goes out until you say so.</p>
          </section>
        </div>

        <footer className="flex flex-wrap items-end justify-between gap-3 border-t border-white/[0.07] pt-5 text-[12.5px] text-white/40">
          <BobLogo height={16} byline />
          <span>Built for UK tradespeople</span>
        </footer>
      </div>
    </main>
  );
}
