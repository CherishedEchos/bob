import { redirect } from "next/navigation";

/** Today's list now lives on This week (Needs attention). Old links still work. */
export default function TodayPage() {
  redirect("/week");
}
