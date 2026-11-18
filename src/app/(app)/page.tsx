"use client";

import { AssistantView } from "@/components/assistant/assistant-view";

/** The opening screen: Ask Bob. Direct links (/week, /jobs/…) open their own screens. */
export default function HomePage() {
  return <AssistantView variant="page" />;
}
