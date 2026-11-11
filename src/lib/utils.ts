import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id"): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}`;
}

const gbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const gbpPenceFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function gbp(value: number): string {
  return Number.isInteger(value) ? gbpFormatter.format(value) : gbpPenceFormatter.format(value);
}

/* ---------- Dates (local time, date-only strings are YYYY-MM-DD) ---------- */

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function addDaysKey(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from today to the given date key (negative = past). */
export function daysFromToday(key: string): number {
  const a = parseDateKey(todayKey()).getTime();
  const b = parseDateKey(key).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function formatDateKey(key: string): string {
  const diff = daysFromToday(key);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = parseDateKey(key);
  const opts: Intl.DateTimeFormatOptions =
    Math.abs(diff) < 7
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short" };
  return d.toLocaleDateString("en-GB", opts);
}

/** Same as formatDateKey but reads naturally mid-sentence: "due today", "due Sat 14 Nov". */
export function formatDateInline(key: string): string {
  const out = formatDateKey(key);
  return /^(Today|Tomorrow|Yesterday)$/.test(out) ? out.toLowerCase() : out;
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function firstName(name: string): string {
  const cleaned = name.replace(/^(the|mr\.?|mrs\.?|ms\.?|miss|dr\.?)\s+/i, "");
  return cleaned.split(/\s+/)[0] ?? name;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
