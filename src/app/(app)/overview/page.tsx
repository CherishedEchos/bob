import { redirect } from "next/navigation";

/** Overview was renamed to Today. */
export default function OverviewRedirect() {
  redirect("/today");
}
