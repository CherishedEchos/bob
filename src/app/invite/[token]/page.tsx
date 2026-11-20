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

type Info = {
  state: "pending" | "accepted" | "expired" | "revoked" | "invalid" | "not_invited";
  businessName?: string;
  personName?: string;
  email?: string;
  hasAccount?: boolean;
  owner?: boolean;
  role?: "owner" | "office" | "staff" | "worker";
  signedInAs?: { name: string; email: string; businessName: string; demo: boolean; isInvitee: boolean };
};

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
      window.location.href = "/";
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
                {info.owner
                  ? `Set up your login for ${info.businessName} in Bob. You'll be the owner.`
                  : info.role === "office"
                    ? `Set up your login for ${info.businessName} in Bob. You'll be an admin: the diary, jobs, team, customers, materials and money.`
                    : `${info.businessName} has invited you to see your jobs in Bob — when and where you're booked, directions and instructions.`}
              </p>
            </div>
            {info.signedInAs && !info.signedInAs.isInvitee ? (
              <div role="note" className="rounded-xl bg-amber-500/10 p-3 text-[14.5px] ring-1 ring-amber-500/30">
                <p className="font-semibold text-warn-fg">This browser is signed in as someone else</p>
                <p className="mt-1">
                  {info.signedInAs.demo ? (
                    <>Signed in to the <strong>demo</strong> (fictional data) as {info.signedInAs.name} ({info.signedInAs.email}).</>
                  ) : (
                    <>Signed in as <strong>{info.signedInAs.name}</strong> ({info.signedInAs.email}) at {info.signedInAs.businessName}.</>
                  )}{" "}
                  This invite is for <strong>{info.email}</strong>.
                </p>
                <p className="mt-1 text-muted-foreground">Continuing signs that session out and sets up {info.personName ? `${info.personName.split(" ")[0]}'s` : "their"} own login. Nothing from the {info.signedInAs.demo ? "demo" : "other session"} is carried over.</p>
              </div>
            ) : info.signedInAs?.isInvitee ? (
              <p role="note" className="rounded-xl bg-surface-2 p-3 text-[14.5px]">You&apos;re already signed in as {info.signedInAs.email}. Enter your password to add {info.businessName} to your login.</p>
            ) : null}
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
              {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} {busy ? "Setting up…" : info.signedInAs && !info.signedInAs.isInvitee ? `Sign in as ${info.personName?.split(" ")[0] ?? "the invited person"}` : info.owner || info.role === "office" ? "Set up my login" : "Accept and see my work"}
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
