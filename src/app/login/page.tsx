import { LoginForm } from "./login-form";
import { DEMO_PASSWORD } from "@/server/db/seed";
import { getContext } from "@/server/auth/session";
import { demoAccountsConfigured } from "@/server/db/demo-accounts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Sign-in. Demo accounts (fictional businesses only) are listed unless
 * BOB_SHOW_DEMO_LOGINS=false — turn that off before any real data is added.
 */
export default async function LoginPage() {
  if (await getContext()) redirect("/");
  const showDemo = process.env.BOB_SHOW_DEMO_LOGINS !== "false";
  // Luke and Ryan sign in with their own credentials once they're configured; no shared-password button for them.
  const own = demoAccountsConfigured();
  const demo = showDemo
    ? [
        { group: "Ninety3 Carpentry & Build — pilot workspace (sample data)", accounts: [
          ...(own.luke ? [] : [{ email: "owner@ninety3.example", label: "Luke · Owner" }]),
          ...(own.ryan ? [] : [{ email: "office@ninety3.example", label: "Ryan · Admin" }]),
          { email: "site@ninety3.example", label: "Site team (no money access)" },
          { email: "sam@so-plastering.example", label: "Sam Okoro · subcontractor (My work only)" },
        ] },
        { group: "Ridgeway Build & Joinery — fictional demo business", accounts: [
          { email: "alex@ridgeway.example", label: "Alex Morgan · Owner" },
          { email: "priya@ridgeway.example", label: "Priya Shah · Office" },
          { email: "sam@ridgeway.example", label: "Sam Carter · Site team" },
          { email: "dan@price-plastering.example", label: "Dan Price · subcontractor (My work only)" },
        ] },
      ]
    : [];
  return <LoginForm demo={demo} demoPassword={showDemo ? DEMO_PASSWORD : undefined} />;
}
