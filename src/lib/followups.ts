/**
 * Customer follow-ups: the thank-you email sent with the handover report and,
 * if the business wants, an honest request for a Google review. Shared by the
 * settings page, the handover and the server, so what's previewed is exactly
 * what's sent.
 *
 * Guardrails (also in the wording): every customer gets the same request —
 * Bob never filters by expected rating, never asks only for positive reviews,
 * and never claims a review was left.
 */
import type { FollowUpSettings, OrgConfig } from "@/lib/types";

export const DEFAULT_TEMPLATE = {
  subject: "Thank you for choosing {business}",
  body: `Hi {firstName},

It's been a pleasure working on your {job}. We hope you're really happy with the finished result.

Please find your project handover report attached.
{reviewBlock}
Thanks again,
{team}
{businessName}`,
};

export const DEFAULT_REVIEW_BLOCK = `
If you have a spare minute, we'd really appreciate an honest Google review. It makes a huge difference to our business.

Leave us a Google review: {reviewLink}
`;

export const REMINDER = {
  subject: "A quick favour — {business}",
  body: `Hi {firstName},

Just a gentle follow-up on your {job}. If you have a minute, an honest Google review would really help us:

{reviewLink}

If you've already left one, thank you — and please ignore this email.

{team}
{businessName}`,
};

export const REMINDER_DAYS = 7;

export function followUpSettings(org: Pick<OrgConfig, "followUps">): FollowUpSettings {
  const f = org.followUps;
  return {
    reviewUrl: f?.reviewUrl || undefined,
    reviewsEnabled: f?.reviewsEnabled ?? false,
    mode: f?.mode ?? "manual",
    reminder: f?.reminder ?? false,
    template: { subject: f?.template?.subject || DEFAULT_TEMPLATE.subject, body: f?.template?.body || DEFAULT_TEMPLATE.body },
  };
}

/** A Google review link: https on a Google host (g.page, google.*, maps.app.goo.gl, goo.gl). */
export function isGoogleReviewUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return /(^|\.)g\.page$|(^|\.)google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** True when a review can be asked for: switched on and a valid link saved. */
export const reviewsReady = (s: FollowUpSettings) => s.reviewsEnabled && isGoogleReviewUrl(s.reviewUrl);

export interface TemplateVars {
  firstName: string;
  customerName: string;
  job: string;
  business: string;
  /** Full business name, e.g. "Ninety3 Carpentry & Build". */
  businessName: string;
  /** First names of the owner and admins, e.g. "Luke & Ryan". */
  team: string;
  signOff: string;
  contact: string;
  reviewLink?: string;
}

/** Fill a template. {reviewBlock} becomes the review paragraph only when a review is being asked for. */
export function fillTemplate(text: string, v: TemplateVars, includeReview: boolean): string {
  const block = includeReview && v.reviewLink ? DEFAULT_REVIEW_BLOCK : "";
  let out = text.replace(/\{reviewBlock\}/g, block);
  if (!includeReview || !v.reviewLink) out = out.replace(/^.*\{reviewLink\}.*$\n?/gm, "");
  out = out
    .replace(/\{firstName\}/g, v.firstName)
    .replace(/\{customerName\}/g, v.customerName)
    .replace(/\{job\}/g, v.job)
    .replace(/\{businessName\}/g, v.businessName)
    .replace(/\{business\}/g, v.business)
    .replace(/\{team\}/g, v.team)
    .replace(/\{signOff\}/g, v.signOff)
    .replace(/\{contact\}/g, v.contact)
    .replace(/\{reviewLink\}/g, v.reviewLink ?? "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Contact line from the business profile (phone · email · website). */
export function contactLine(org: Pick<OrgConfig, "contact">): string {
  return [org.contact.phone, org.contact.email, org.contact.website].filter(Boolean).join(" · ");
}
