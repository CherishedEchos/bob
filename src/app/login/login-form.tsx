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

  return (
    <main className="bg-app flex min-h-dvh flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <Orb state="idle" size={120} />
          <h1 className="mt-5 text-[30px] font-bold tracking-tight">Bob</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">You do the work. Bob does the admin.</p>
        </div>

        <form onSubmit={signIn} className="card-surface mt-8 space-y-4 rounded-3xl p-5" noValidate>
          <Field label="Email" htmlFor="l-email">
            <Input id="l-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="l-pass">
            <Input id="l-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error ? (
            <p role="alert" className="text-[13.5px] text-red-300">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={!!busy}>
            {busy === email && busy ? <Loader2 className="animate-spin" /> : <LogIn />} Sign in
          </Button>
        </form>

        {demo.length && demoPassword ? (
          <section className="mt-6 rounded-3xl bg-sky-500/[0.06] p-5 ring-1 ring-sky-400/20">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-sky-100">
              <FlaskConical className="size-4" /> Demo accounts
            </div>
            <p className="mt-1 text-[12.5px] leading-snug text-sky-100/70">
              Fictional sample data only. Nothing is sent to real customers. Password for all: <code className="rounded bg-black/30 px-1">{demoPassword}</code>
            </p>
            <div className="mt-4 space-y-4">
              {demo.map((g) => (
                <div key={g.group}>
                  <div className="mb-2 text-[12px] font-medium uppercase tracking-wider text-subtle">{g.group}</div>
                  <div className="space-y-1.5">
                    {g.accounts.map((a) => (
                      <button
                        key={a.email}
                        onClick={() => void signIn(undefined, { email: a.email, password: demoPassword })}
                        disabled={!!busy}
                        className="flex w-full items-center justify-between rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-left text-[14px] ring-1 ring-white/10 transition hover:bg-white/[0.08] disabled:opacity-50"
                      >
                        <span>{a.label}</span>
                        {busy === a.email ? <Loader2 className="size-4 animate-spin" /> : <span className="text-[12px] text-subtle">{a.email}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <p className="mt-6 text-center text-[12px] text-subtle">Bob by Cresaro</p>
      </div>
    </main>
  );
}
