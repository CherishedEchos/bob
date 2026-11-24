/**
 * Luke's and Ryan's individual demo sign-ins (Render environment variables):
 * same shared Ninety3 demo workspace, their own credentials, no shared
 * password, no Cresaro admin access.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { getDb } from "@/server/db";
import { applyDemoAccounts, demoAccountsConfigured } from "@/server/db/demo-accounts";
import { authenticate, contextFromToken } from "@/server/auth/session";
import { isPlatformAdmin } from "@/server/auth/platform";

const env = {
  BOB_DEMO_LUKE_EMAIL: "Luke.Demo@ninety3-demo.example",
  BOB_DEMO_LUKE_PASSWORD: "luke-secret-1234",
  BOB_DEMO_RYAN_EMAIL: "ryan.demo@ninety3-demo.example",
  BOB_DEMO_RYAN_PASSWORD: "ryan-secret-5678",
};

const savedAdmins = process.env.BOB_PLATFORM_ADMINS;
beforeEach(() => freshDb());
afterEach(() => {
  if (savedAdmins === undefined) delete process.env.BOB_PLATFORM_ADMINS;
  else process.env.BOB_PLATFORM_ADMINS = savedAdmins;
});

const login = (email: string, password: string) => {
  const r = authenticate(email, password);
  return r.ok ? contextFromToken(r.token) : null;
};

describe("individual demo sign-ins", () => {
  it("Luke (owner) and Ryan (admin) sign in to the same Ninety3 demo workspace with their own passwords", () => {
    applyDemoAccounts(getDb(), env);
    const luke = login("luke.demo@ninety3-demo.example", "luke-secret-1234");
    const ryan = login("ryan.demo@ninety3-demo.example", "ryan-secret-5678");
    expect(luke).toMatchObject({ orgId: "org_ninety3", role: "owner", userName: "Luke" });
    expect(ryan).toMatchObject({ orgId: "org_ninety3", role: "office", userName: "Ryan" });
  });

  it("the shared demo password and old addresses no longer open Luke's or Ryan's account", () => {
    applyDemoAccounts(getDb(), env);
    expect(login("owner@ninety3.example", "bob-demo")).toBeNull();
    expect(login("office@ninety3.example", "bob-demo")).toBeNull();
    expect(login("luke.demo@ninety3-demo.example", "bob-demo")).toBeNull();
    expect(login("ryan.demo@ninety3-demo.example", "luke-secret-1234")).toBeNull();
    // Other demo accounts are unaffected.
    expect(login("site@ninety3.example", "bob-demo")).not.toBeNull();
  });

  it("re-applying on restart is idempotent and keeps sessions; a new password signs old sessions out", () => {
    applyDemoAccounts(getDb(), env);
    const r = authenticate("luke.demo@ninety3-demo.example", "luke-secret-1234");
    if (!r.ok) throw new Error("login failed");
    applyDemoAccounts(getDb(), env);
    expect(contextFromToken(r.token)).not.toBeNull();
    applyDemoAccounts(getDb(), { ...env, BOB_DEMO_LUKE_PASSWORD: "a-new-password-99" });
    expect(contextFromToken(r.token)).toBeNull();
    expect(login("luke.demo@ninety3-demo.example", "a-new-password-99")).not.toBeNull();
  });

  it("refuses short passwords, bad emails and emails already used by another account", () => {
    applyDemoAccounts(getDb(), { BOB_DEMO_LUKE_EMAIL: "luke@x.example", BOB_DEMO_LUKE_PASSWORD: "short" });
    expect(login("owner@ninety3.example", "bob-demo")).not.toBeNull();
    applyDemoAccounts(getDb(), { BOB_DEMO_RYAN_EMAIL: "not-an-email", BOB_DEMO_RYAN_PASSWORD: "long-enough-pass" });
    expect(login("office@ninety3.example", "bob-demo")).not.toBeNull();
    applyDemoAccounts(getDb(), { BOB_DEMO_RYAN_EMAIL: "alex@ridgeway.example", BOB_DEMO_RYAN_PASSWORD: "long-enough-pass" });
    expect(login("alex@ridgeway.example", "bob-demo")).not.toBeNull();
    expect(demoAccountsConfigured({ BOB_DEMO_LUKE_EMAIL: "a@b.example", BOB_DEMO_LUKE_PASSWORD: "short" }).luke).toBe(false);
    expect(demoAccountsConfigured(env)).toEqual({ luke: true, ryan: true });
  });

  it("Luke and Ryan can't open the Cresaro admin area (unless Cresaro lists them)", () => {
    applyDemoAccounts(getDb(), env);
    process.env.BOB_PLATFORM_ADMINS = "ops@cresaro.example";
    const luke = login("luke.demo@ninety3-demo.example", "luke-secret-1234")!;
    const ryan = login("ryan.demo@ninety3-demo.example", "ryan-secret-5678")!;
    expect(isPlatformAdmin(luke)).toBe(false);
    expect(isPlatformAdmin(ryan)).toBe(false);
  });
});
