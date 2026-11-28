import { redirect } from "next/navigation";

/**
 * Home for owners and admins is Overview (today's work, their to-do list and
 * the business at a glance); the team calendar is one tap away in Diary.
 * (src/middleware.ts redirects "/" before this runs; this is the fallback.)
 * Invited workers and subcontractors are sent to My work by the app layout.
 */
export default function Landing() {
  redirect("/home");
}
