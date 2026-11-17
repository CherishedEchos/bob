"use client";

/**
 * Accept an invite. The link works once, for the invited email only, and
 * expires. New people set a password; someone who already has a Bob login
 * signs in with it.
 */
import * as React from "react";
import { useParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { BobLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

type Info = { state: "pending" | "accepted" | "expired" | "revoked" | "invalid" | "not_invited"; businessName?: string; personName?: string; email?: string; hasAccount?: boolean };

const DEAD: Record<string, [string, string]> = {
  accepted: ["This invite has already been used", "If it was you, sign in with the email it was sent to."],
  expired: ["This invite has expired", "Ask the person who invited you to send a new link."],
  revoked: ["This invite was cancelled", "Ask the person who invited you to send a new link."],
  invalid: ["This link doesn't work", "Check you copied the whole link, or ask for a new one."],
};

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = React.useState<Info | null>(null);
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch(`/api/invite/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setError("Couldn't check this invite. Check your connection and reload."));
  }, [token]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fieldErrors?: Record<string, string> };
      if (!res.ok || !body.ok) {
        setError(body.fieldErrors?.password ?? body.error ?? "Couldn't accept the invite.");
        setBusy(false);
        return;
      }
      window.location.href = "/my-work";
    } catch {
      setError("Couldn't reach Bob. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 pb-10 pt-[max(2rem,env(safe-area-inset-top))]">
      <BobLogo height={28} tone="dark" />
      <div className="panel mt-8 w-full max-w-md p-5 sm:p-6">
        {!info && !error ? (
          <p className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 animate-spin" /> Checking your invite…
          </p>
        ) : null}
        {info && info.state !== "pending" ? (
          <>
            <h1 className="t-section">{(DEAD[info.state] ?? DEAD.invalid)[0]}</h1>
            <p className="t-meta mt-1">{(DEAD[info.state] ?? DEAD.invalid)[1]}</p>
            <Button asChild variant="secondary" className="mt-4">
              <a href="/login">Go to sign in</a>
            </Button>
          </>
        ) : null}
        {info?.state === "pending" ? (
          <form onSubmit={accept} noValidate className="space-y-4">
            <div>
              <h1 className="text-[22px] font-bold leading-tight tracking-tight">Hi {info.personName?.split(" ")[0]}</h1>
              <p className="t-meta mt-1">
                {info.businessName} has invited you to see your jobs in Bob — when and where you&apos;re booked, directions and instructions.
              </p>
            </div>
            <Field label="Email" htmlFor="inv-email" hint="The invite only works for this email.">
              <Input id="inv-email" value={info.email ?? ""} readOnly autoComplete="username" className="bg-message" />
            </Field>
            <Field label={info.hasAccount ? "Your Bob password" : "Choose a password"} htmlFor="inv-pass" hint={info.hasAccount ? "You already have a Bob login with this email." : "At least 8 characters."}>
              <Input id="inv-pass" type="password" autoComplete={info.hasAccount ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
            </Field>
            {error ? (
              <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-[14.5px] text-danger-fg ring-1 ring-red-500/25">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} {busy ? "Setting up…" : "Accept and see my work"}
            </Button>
          </form>
        ) : null}
        {error && !info ? (
          <p role="alert" className="text-[15px] text-danger-fg">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
