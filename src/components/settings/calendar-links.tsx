"use client";

/**
 * Calendar subscription links (one way: Bob → your calendar). Used in
 * Settings (company + personal) and My work (personal only).
 */
import * as React from "react";
import { CalendarDays, Check, Copy, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyToClipboard, timeAgo } from "@/lib/utils";
import { toast } from "@/components/ui/toaster";

export interface FeedInfo {
  id: string;
  scope: "company" | "person";
  createdAt: string;
  lastFetchedAt?: string;
}

export function CalendarLink({
  scope,
  title,
  body,
  feed,
  create,
  revoke,
}: {
  scope: "company" | "person";
  title: string;
  body: string;
  feed?: FeedInfo;
  create: () => Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  revoke: (id: string) => Promise<boolean>;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const make = async () => {
    setBusy(true);
    setError(null);
    const r = await create();
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setUrl(`${window.location.origin}${r.path}`);
  };
  return (
    <div className="rounded-xl p-3.5 ring-1 ring-line" data-feed-scope={scope}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[15.5px] font-semibold">
            <CalendarDays className="size-4 text-subtle" aria-hidden /> {title}
          </p>
          <p className="mt-0.5 text-[15px] text-muted-foreground">{body}</p>
          {feed && !url ? (
            <p className="mt-1 text-[14.5px] text-muted-foreground">
              Link on · created {timeAgo(feed.createdAt)}
              {feed.lastFetchedAt ? ` · last checked by a calendar ${timeAgo(feed.lastFetchedAt)}` : " · not used by a calendar yet"}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={feed ? "secondary" : "default"} disabled={busy} onClick={() => void make()}>
            {feed ? "New link" : "Create link"}
          </Button>
          {feed ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (await revoke(feed.id)) {
                  setUrl(null);
                  toast("Calendar link turned off — calendars using it stop updating");
                }
              }}
            >
              <Link2Off /> Turn off
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[15px] text-danger-fg">
          {error}
        </p>
      ) : null}
      {url ? (
        <div className="mt-3 rounded-xl bg-message p-3">
          <label htmlFor={`feed-${scope}`} className="text-[14.5px] font-semibold">
            Subscription link — private, treat it like a password
          </label>
          <div className="mt-1.5 flex gap-2">
            <Input id={`feed-${scope}`} readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-11 text-[14.5px]" />
            <Button
              size="sm"
              onClick={async () => {
                const ok = await copyToClipboard(url);
                if (!ok) return toast("Couldn't copy — select the link and copy it", "error");
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <ul className="mt-2 space-y-0.5 text-[14px] text-muted-foreground">
            <li>Google Calendar (computer): Other calendars → + → From URL → paste.</li>
            <li>iPhone / Mac: Settings → Calendar → Accounts → Add subscribed calendar (Mac: File → New Calendar Subscription).</li>
            <li>Outlook: Add calendar → Subscribe from web.</li>
            <li>Your calendar app decides how often it checks for changes — Google can take several hours; Apple and Outlook are usually quicker. Make changes in Bob, not in the calendar.</li>
          </ul>
          <p className="mt-1.5 text-[14px] text-muted-foreground">Shown once. Making a new link turns the old one off.</p>
        </div>
      ) : null}
    </div>
  );
}
