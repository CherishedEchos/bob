import { redirect } from "next/navigation";

/** The diary is the landing page. Ask Bob lives at /assistant (and behind the mic on phones). */
export default function HomePage() {
  redirect("/week");
}
