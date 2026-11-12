import { redirect } from "next/navigation";

/** Everyone lands on Today. Ask Bob lives at /assistant. */
export default function HomePage() {
  redirect("/today");
}
