"use client";

import * as React from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install Bob" — add the web app to the home screen so it opens full-screen.
 * Android/Chrome offer a one-tap install; iPhone needs Share → Add to Home Screen.
 * Hidden once Bob is already running as an installed app.
 */
export function InstallBob({ compact = false }: { compact?: boolean }) {
  const [installed, setInstalled] = React.useState(true);
  const [ios, setIos] = React.useState(false);
  const [prompt, setPrompt] = React.useState<InstallPromptEvent | null>(null);

  React.useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  return (
    <div className="panel p-4">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static icon */}
        <img src="/icons/icon-192.png" alt="" width={44} height={44} className="size-11 shrink-0 rounded-xl ring-1 ring-line-strong" />
        <div className="min-w-0 flex-1">
          <div className="t-name">Put Bob on your home screen</div>
          <p className="t-meta mt-0.5">Opens full-screen like an app — one tap from the van.</p>
        </div>
      </div>
      {prompt ? (
        <Button
          className="mt-3 w-full"
          onClick={async () => {
            await prompt.prompt();
            const r = await prompt.userChoice;
            if (r.outcome === "accepted") setInstalled(true);
            setPrompt(null);
          }}
        >
          <Download /> Install Bob
        </Button>
      ) : ios ? (
        <ol className="mt-3 space-y-1.5 text-[14.5px] text-foreground/90">
          <li className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-raised text-[12px] font-semibold ring-1 ring-line-strong">1</span>
            Tap <Share className="mx-0.5 inline size-4 text-info-fg" aria-label="Share" /> <strong className="font-semibold">Share</strong> in Safari
          </li>
          <li className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-raised text-[12px] font-semibold ring-1 ring-line-strong">2</span>
            Choose <SquarePlus className="mx-0.5 inline size-4" aria-hidden /> <strong className="font-semibold">Add to Home Screen</strong>
          </li>
        </ol>
      ) : !compact ? (
        <p className="t-meta mt-3">In Chrome or Edge, use the browser menu → <strong className="font-semibold text-foreground">Install app</strong> (or Add to Home screen).</p>
      ) : null}
    </div>
  );
}
