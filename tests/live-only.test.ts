/**
 * A live-only server (BOB_DEMO_WORKSPACES=off): no fictional workspaces or demo
 * logins are created, the login page offers no demo, and provisioning creates
 * only the real workspace with Luke (owner) and Ryan (admin) invite links.
 * Nothing is emailed by provisioning. Fictional emails only.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDb } from "./helpers";
import { demoWorkspacesEnabled, getDb } from "@/server/db";
import { provisionWorkspaces } from "@/server/db/provision";
import { authenticate } from "@/server/auth/session";
import * as T from "@/server/services/team";

beforeEach(() => {
  process.env.BOB_DEMO_WORKSPACES = "off";
  freshDb();
});
afterEach(() => {
  delete process.env.BOB_DEMO_WORKSPACES;
  freshDb();
});

describe("Live-only server", () => {
  it("creates no demo workspaces or demo logins on a new database", () => {
    expect(demoWorkspacesEnabled()).toBe(false);
    expect(demoWorkspacesEnabled({ BOB_DEMO_WORKSPACES: "false" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(demoWorkspacesEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(true);
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM orgs").get()).toMatchObject({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()).toMatchObject({ n: 0 });
    expect(authenticate("owner@ninety3.example", "bob-demo")).toMatchObject({ ok: false, status: 401 });
  });

  it("provisions only Ninety3 Carpentry & Build, with Luke as owner and Ryan as admin, and emails nobody", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bob-live-")), "workspaces.json");
    const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/workspaces.ninety3-live.example.json"), "utf8"));
    spec[0].users[0].email = "luke@ninety3-live-test.example";
    spec[0].users[1].email = "ryan@ninety3-live-test.example";
    fs.writeFileSync(file, JSON.stringify(spec));
    const r = provisionWorkspaces(getDb(), file);
    expect(r.workspaces).toEqual(["ninety3-build"]);
    const orgs = getDb().prepare("SELECT slug, config FROM orgs").all() as { slug: string; config: string }[];
    expect(orgs).toHaveLength(1);
    expect(JSON.parse(orgs[0].config)).toMatchObject({ name: "Ninety3 Carpentry & Build", dataMode: "live", isDemo: false, timeZone: "Europe/London" });
    expect(r.invites.map((i) => [i.name, i.role])).toEqual([["Luke", "owner"], ["Ryan", "office"]]);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM outbox").get()).toMatchObject({ n: 0 }); // provisioning never emails
    const luke = T.acceptInvite(r.invites[0].path.split("/").pop()!, { password: "luke-test-pass" });
    const ryan = T.acceptInvite(r.invites[1].path.split("/").pop()!, { password: "ryan-test-pass" });
    expect(luke.ok && ryan.ok).toBe(true);
    const roles = getDb().prepare("SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id ORDER BY u.email").all();
    expect(roles).toEqual([{ email: "luke@ninety3-live-test.example", role: "owner" }, { email: "ryan@ninety3-live-test.example", role: "office" }]);
  });
});
