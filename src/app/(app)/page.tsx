import { redirect } from "next/navigation";

/** Home (the business overview) is the landing page. Ask Bob lives at /assistant (and behind the mic on phones). */
export default function HomePage() {
  redirect("/home");
}
