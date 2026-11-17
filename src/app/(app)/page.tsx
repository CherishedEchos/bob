import { redirect } from "next/navigation";

/** Everyone lands on This week. Ask Bob lives at /assistant. */
export default function HomePage() {
  redirect("/week");
}
