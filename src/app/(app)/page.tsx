import { redirect } from "next/navigation";

/**
 * The first screen for owners and admins is the team diary (people down the
 * side, days across; "Who's where" on a phone). The business overview lives at
 * /home ("Overview"). Invited workers and subcontractors are sent to My work by
 * the app layout before this runs.
 */
export default function Landing() {
  redirect("/week");
}
