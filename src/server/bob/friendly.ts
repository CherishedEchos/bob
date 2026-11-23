/**
 * Turn technical or validation errors into short, natural sentences for the
 * conversation. Nothing like "Invalid input: expected string" or internal
 * codes ever reaches the user.
 */

const FIELD: Record<string, string> = {
  name: "name",
  email: "email address",
  phone: "phone number",
  address: "address",
  town: "town",
  dueDate: "due date",
  date: "date",
  startTime: "start time",
  endTime: "end time",
  quantity: "quantity",
  item: "item",
  amount: "amount",
  title: "title",
  jobId: "job",
  customerId: "customer",
  bookingId: "booking",
  taskId: "task",
  materialId: "item",
  invoiceId: "invoice",
};

export function friendlyError(raw: string | undefined | null, fallback = "That didn't work, and nothing was changed."): string {
  if (!raw) return fallback;
  const msg = String(raw).trim();
  // Already a plain sentence written for people (our services write these): keep it.
  const technical = /invalid|expected \w+|received \w+|too (small|big)|invalid (option|enum|string|type|date)|zod|SQLITE|constraint|undefined|null|NaN|ECONN|fetch failed|status code|\bat \w+\.|TypeError|ReferenceError|^[A-Z_]{4,}:/i;
  if (!technical.test(msg)) return msg.endsWith(".") || msg.endsWith("?") ? msg : `${msg}.`;
  const field = Object.keys(FIELD).find((k) => new RegExp(`\\b${k}\\b`).test(msg));
  const what = field ? FIELD[field] : undefined;
  if (/email/i.test(msg)) return "That email address doesn't look right — could you check it?";
  if (/YYYY-MM-DD|date/i.test(msg)) return "I couldn't work out the date — which day do you mean?";
  if (/HH:MM|time/i.test(msg)) return "I couldn't work out the time — what time do you mean?";
  if (/too small|at least|>=\s*\d|required|expected string, received undefined/i.test(msg)) return what ? `I need the ${what} for that.` : "I'm missing a detail for that — could you say it again with a bit more?";
  if (/too big|at most|<=\s*\d/i.test(msg)) return what ? `That ${what} is too long — could you shorten it?` : "That's a bit long — could you shorten it?";
  if (/not.?found/i.test(msg)) return what ? `I couldn't find that ${what}.` : "I couldn't find that record.";
  if (/ECONN|fetch failed|timeout|timed out|status code|5\d\d/i.test(msg)) return "The service didn't respond, so nothing was changed. Try again in a moment.";
  return fallback;
}
