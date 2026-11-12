"use client";

import * as React from "react";
import { FlaskConical, Loader2, LogIn } from "lucide-react";
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
      window.location.href = "/";
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setError(json.error ?? "Couldn't sign in");
    setBusy(null);
  };

  const primary = demo[0]?.accounts[0];
  return (
    <main className="bg-app flex min-h-dvh flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="theme-dark flex flex-col items-center rounded-3xl bg-ink-850 px-6 pb-7 pt-5 text-center shadow-lg">
          <Orb state="idle" size={120} />
          <h1 className="mt-3 text-[32px] font-bold tracking-tight">Bob</h1>
          <p className="mt-1 text-[17px] text-white/75">You do the work. Bob does the admin.</p>
          {primary && demoPassword ? (
            <>
              <Button size="lg" className="mt-6 h-14 w-full text-[17px]" disabled={!!busy} onClick={() => void signIn(undefined, { email: primary.email, password: demoPassword })}>
                {busy === primary.email ? <Loader2 className="animate-spin" /> : <FlaskConical />} Try the demo
              </Button>
              <p className="mt-3 text-[14px] leading-snug text-white/65">
                Opens a fictional Ninety3 workspace. Sample customers only — nothing is ever sent to anyone.
              </p>
            </>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-center text-[15px] text-danger-fg">
            {error}
          </p>
        ) : null}

        <details className="card-surface mt-5 rounded-3xl p-5" open={!demoPassword}>
          <summary className="cursor-pointer text-[16px] font-semibold">Sign in with an account</summary>
          <form onSubmit={signIn} className="mt-4 space-y-4" noValidate>
            <Field label="Email" htmlFor="l-email">
              <Input id="l-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password" htmlFor="l-pass">
              <Input id="l-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Button type="submit" className="w-full" disabled={!!busy}>
              {busy === email && busy ? <Loader2 className="animate-spin" /> : <LogIn />} Sign in
            </Button>
          </form>
        </details>

        {demo.length && demoPassword ? (
          <details className="card-surface mt-3 rounded-3xl p-5">
            <summary className="cursor-pointer text-[16px] font-semibold">Other demo logins</summary>
            <p className="mt-2 text-[14px] text-muted-foreground">
              Fictional data only. Password for all: <code className="rounded bg-surface-3 px-1.5">{demoPassword}</code>
            </p>
            <div className="mt-4 space-y-4">
              {demo.map((g) => (
                <div key={g.group}>
                  <div className="mb-2 text-[13px] font-medium uppercase tracking-wider text-subtle">{g.group}</div>
                  <div className="space-y-1.5">
                    {g.accounts.map((a) => (
                      <button
                        key={a.email}
                        onClick={() => void signIn(undefined, { email: a.email, password: demoPassword })}
                        disabled={!!busy}
                        className="flex min-h-12 w-full items-center justify-between rounded-xl bg-surface-2 px-4 py-2.5 text-left text-[15px] ring-1 ring-line transition hover:bg-surface-3 disabled:opacity-50"
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
        <p className="mt-6 text-center text-[13px] text-subtle">Bob by Cresaro</p>
      </div>
    </main>
  );
}
