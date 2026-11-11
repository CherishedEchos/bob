"use client";

import * as React from "react";
import { Database, KeyRound, RotateCcw, ShieldCheck, UserRound } from "lucide-react";
import { useStore, DEMO_USERS } from "@/lib/store/store";
import { can } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { Card, PageHeader } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

export default function SettingsPage() {
  const { user, setUser, actions, repositoryKind } = useStore();
  const [confirmReset, setConfirmReset] = React.useState(false);
  return (
    <>
      <PageHeader title="Settings" subtitle="Demo controls and how your data is handled." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold"><UserRound className="size-5 text-copper-400" /> Demo user</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Switch between the owner and office profiles to see role-based access. Real sign-in comes with Supabase Auth.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {DEMO_USERS.map((u) => (
              <button
                key={u.id}
                onClick={() => setUser(u.id)}
                aria-pressed={user.id === u.id}
                className={cn(
                  "rounded-xl p-3 text-left ring-1",
                  user.id === u.id ? "bg-copper-500/15 ring-copper-500/50" : "bg-white/[0.03] ring-white/10",
                )}
              >
                <div className="font-medium">{u.displayName}</div>
                <div className="text-[12.5px] text-muted-foreground">{u.role === "owner" ? "Full access" : "Admin — can't delete records"}</div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold"><Database className="size-5 text-copper-400" /> Demo data</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">
            All customers, jobs and payments are fictional and stored only in this browser ({repositoryKind}). Reset to start the demo again.
          </p>
          {!confirmReset ? (
            <Button variant="secondary" className="mt-4" onClick={() => setConfirmReset(true)} disabled={!can(user.role, "settings.manage")}>
              <RotateCcw /> Reset demo data
            </Button>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setConfirmReset(false)}>Keep my changes</Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await actions.resetDemo();
                  setConfirmReset(false);
                  toast("Demo data reset");
                }}
              >
                Yes, reset everything
              </Button>
            </div>
          )}
          {!can(user.role, "settings.manage") ? <p className="mt-2 text-[12.5px] text-subtle">Only the owner can reset data.</p> : null}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-copper-400" /> Privacy & security (planned for go-live)</h2>
          <ul className="mt-3 grid gap-x-8 gap-y-2 text-[14px] text-muted-foreground sm:grid-cols-2">
            <li>• Secure sign-in for the owner and office (Supabase Auth, MFA)</li>
            <li>• Role-based permissions enforced on the server</li>
            <li>• Row Level Security so business data is isolated</li>
            <li>• Every change written to an audit log</li>
            <li>• Data hosted in the UK/EU region, encrypted at rest</li>
            <li>• UK GDPR: retention rules, export and deletion on request</li>
          </ul>
          <p className="mt-4 flex items-center gap-2 text-[13px] text-subtle">
            <KeyRound className="size-4" /> No email, Instagram, speech or accounting accounts are connected in this demo.
          </p>
        </Card>
      </div>
    </>
  );
}
