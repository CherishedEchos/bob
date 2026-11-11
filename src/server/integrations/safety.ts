/**
 * Prompt-injection defences for external content (emails, form submissions,
 * Instagram messages).
 *
 * Defence in depth:
 *  1. External text is stored and shown as DATA. The rule engine never parses
 *     it for commands; the LLM engine receives it wrapped in
 *     <untrusted_external_content> with instructions to treat it as data.
 *  2. Every external or financial action needs explicit human approval in
 *     the UI, so injected text can't send, pay or delete anything on its own.
 *  3. This heuristic flags suspicious messages so the user is warned.
 */

const PATTERNS: [RegExp, string][] = [
  [/\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all|earlier)\b.{0,20}\b(instructions?|prompts?|rules?)\b/i, "asks the assistant to ignore its instructions"],
  [/\byou are now\b|\bact as\b|\bnew instructions?\b|\badmin mode\b|\bdeveloper mode\b|\bjailbreak\b/i, "tries to change the assistant's role"],
  [/\bsystem prompt\b|<\/?(system|assistant|tool)>/i, "mentions system prompts or tool markup"],
  [/\bmark\b.{0,40}\b(as )?paid\b|\brefund\b.{0,30}\b(all|every)\b/i, "asks for a payment record to be changed"],
  [/\b(send|email|forward|export)\b.{0,40}\b(customer list|all customers|contacts|database|passwords?)\b/i, "asks for business data to be sent out"],
  [/\b(bob|assistant|ai)\b\s*[,:]\s*(please\s+)?(send|delete|mark|transfer|forward|create|cancel)\b/i, "addresses the assistant directly with a command"],
];

export interface InjectionCheck {
  suspicious: boolean;
  reasons: string[];
}

export function detectInjection(text: string): InjectionCheck {
  const reasons = PATTERNS.filter(([re]) => re.test(text)).map(([, why]) => why);
  return { suspicious: reasons.length > 0, reasons };
}

/** Wrap untrusted text for an LLM prompt. Neutralises attempts to close the wrapper. */
export function wrapUntrusted(source: string, text: string): string {
  const safe = text.replace(/<\/?untrusted_external_content[^>]*>/gi, "[removed tag]");
  return `<untrusted_external_content source="${source}">\n${safe}\n</untrusted_external_content>`;
}
