import { redirect } from "next/navigation";
import { getContext } from "@/server/auth/session";

/** My work: any signed-in person; the API only ever returns their own bookings. */
export default async function MyWorkLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return <div className="min-h-dvh bg-background">{children}</div>;
}
