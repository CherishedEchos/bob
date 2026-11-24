import type { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "@/server/auth/password";

/**
 * Individual sign-ins for the Ninety3 demonstration workspace (slug "ninety3",
 * fictional data). Set as Render environment variables (never in the repo):
 *
 *   BOB_DEMO_LUKE_EMAIL / BOB_DEMO_LUKE_PASSWORD  → Luke, Owner
 *   BOB_DEMO_RYAN_EMAIL / BOB_DEMO_RYAN_PASSWORD  → Ryan, Admin
 *
 * They replace the shared demo logins for Luke and Ryan (owner@ninety3.example /
 * office@ninety3.example), keeping the same user records, so tasks, bookings
 * and activity seeded for Luke and Ryan stay theirs. Applied on every start, so
 * the accounts come back after the free plan wipes the disk on a redeploy.
 */
const ACCOUNTS = [
  { userId: "usr_n93_owner", who: "Luke", emailVar: "BOB_DEMO_LUKE_EMAIL", passwordVar: "BOB_DEMO_LUKE_PASSWORD" },
  { userId: "usr_n93_office", who: "Ryan", emailVar: "BOB_DEMO_RYAN_EMAIL", passwordVar: "BOB_DEMO_RYAN_PASSWORD" },
] as const;

export const MIN_DEMO_PASSWORD = 10;
type Env = Record<string, string | undefined>;

/** Which of Luke/Ryan have their own credentials configured (the login page hides their shared demo buttons). */
export function demoAccountsConfigured(env: Env = process.env): { luke: boolean; ryan: boolean } {
  const ok = (a: (typeof ACCOUNTS)[number]) => !!env[a.emailVar]?.trim() && (env[a.passwordVar]?.length ?? 0) >= MIN_DEMO_PASSWORD;
  return { luke: ok(ACCOUNTS[0]), ryan: ok(ACCOUNTS[1]) };
}

export function applyDemoAccounts(db: DatabaseSync, env: Env = process.env) {
  for (const a of ACCOUNTS) {
    const email = env[a.emailVar]?.trim().toLowerCase();
    const password = env[a.passwordVar] ?? "";
    if (!email && !password) continue;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error(`[bob] ${a.emailVar} isn't a valid email — ${a.who}'s demo sign-in wasn't changed.`);
      continue;
    }
    if (password.length < MIN_DEMO_PASSWORD) {
      console.error(`[bob] ${a.passwordVar} must be at least ${MIN_DEMO_PASSWORD} characters — ${a.who}'s demo sign-in wasn't changed.`);
      continue;
    }
    const user = db.prepare("SELECT id, email, password_hash FROM users WHERE id = ?").get(a.userId) as { id: string; email: string; password_hash: string } | undefined;
    if (!user) continue; // demo workspace not present
    const clash = db.prepare("SELECT id FROM users WHERE email = ? AND id <> ?").get(email, a.userId);
    if (clash) {
      console.error(`[bob] ${a.emailVar} is already used by another account (e.g. the live workspace). Use a different email for ${a.who}'s demo sign-in.`);
      continue;
    }
    const samePassword = (() => {
      try {
        return verifyPassword(password, user.password_hash);
      } catch {
        return false;
      }
    })();
    if (user.email === email && samePassword) continue;
    db.prepare("UPDATE users SET email = ?, password_hash = ? WHERE id = ?").run(email, samePassword ? user.password_hash : hashPassword(password), a.userId);
    // A changed password signs out existing sessions for that user.
    if (!samePassword) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(a.userId);
    console.log(`[bob] Ninety3 demo: ${a.who}'s individual sign-in is set.`);
  }
}
