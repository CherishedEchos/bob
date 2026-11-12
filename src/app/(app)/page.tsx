"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AssistantView } from "@/components/assistant/assistant-view";

/** Home: the voice assistant on phones; desktop lands on Today. */
export default function HomePage() {
  const router = useRouter();
  React.useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) router.replace("/today");
  }, [router]);
  return <AssistantView variant="page" />;
}
