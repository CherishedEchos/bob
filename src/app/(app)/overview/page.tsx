import { redirect } from "next/navigation";

/** Older links to /overview open the business overview (Home). */
export default function OverviewRedirect() {
  redirect("/home");
}
