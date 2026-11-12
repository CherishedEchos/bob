import { LoginForm } from "./login-form";
import { DEMO_PASSWORD } from "@/server/db/seed";
import { getContext } from "@/server/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Sign-in. Demo accounts (fictional businesses only) are listed unless
 * BOB_SHOW_DEMO_LOGINS=false — turn that off before any real data is added.
 */
export default async function LoginPage() {
  if (await getContext()) redirect("/today");
  const showDemo = process.env.BOB_SHOW_DEMO_LOGINS !== "false";
  const demo = showDemo
    ? [
        { group: "Ninety3 Carpentry & Build — pilot workspace (sample data)", accounts: [
          { email: "owner@ninety3.example", label: "Owner" },
          { email: "office@ninety3.example", label: "Office" },
          { email: "site@ninety3.example", label: "Site team (no money access)" },
        ] },
        { group: "Ridgeway Build & Joinery — fictional demo business", accounts: [
          { email: "alex@ridgeway.example", label: "Alex Morgan · Owner" },
          { email: "priya@ridgeway.example", label: "Priya Shah · Office" },
          { email: "sam@ridgeway.example", label: "Sam Carter · Site team" },
        ] },
      ]
    : [];
  return <LoginForm demo={demo} demoPassword={showDemo ? DEMO_PASSWORD : undefined} />;
}
