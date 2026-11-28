/**
 * Rough estimates — deterministic arithmetic only. Pure functions so the
 * screen, the server and the tests agree to the penny.
 *
 *  - Every line is quantity × rate. A line with no rate is "missing": it's left
 *    out of the total and listed, never guessed.
 *  - Rates come from the workspace's own price list (Settings), from figures
 *    the user types, or are explicit allowances the user adds.
 *  - VAT follows the workspace's settings. If VAT isn't set up, that's said
 *    plainly rather than assumed.
 *  - A ± range is shown only when every line is priced AND the user chose a
 *    range percentage — otherwise there's no defensible basis for one.
 */
import type { EstimateLine, OrgConfig, RateCard, RateItem, RoughEstimate } from "@/lib/types";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineTotal = (l: Pick<EstimateLine, "qty" | "rate">) => (l.rate === null || !Number.isFinite(l.rate) ? null : r2(l.qty * l.rate));

export interface EstimateTotals {
  /** Sum of priced lines, as entered (before/after VAT depends on `pricesAre`). */
  pricedSubtotal: number;
  net: number;
  vat: number;
  gross: number;
  vatNote: string;
  vatKnown: boolean;
  missing: EstimateLine[];
  complete: boolean;
  /** Only when complete and a range was chosen. */
  range: { low: number; high: number; percent: number } | null;
  rangeNote?: string;
  bySource: Record<EstimateLine["source"], number>;
}

export function estimateTotals(e: Pick<RoughEstimate, "lines" | "rangePercent">, finance: OrgConfig["finance"]): EstimateTotals {
  const missing = e.lines.filter((l) => lineTotal(l) === null && l.qty > 0);
  const bySource = { rate_card: 0, entered: 0, allowance: 0, missing: 0 } as Record<EstimateLine["source"], number>;
  let sum = 0;
  for (const l of e.lines) {
    const t = lineTotal(l);
    if (t === null) continue;
    sum += t;
    bySource[l.source] = r2(bySource[l.source] + t);
  }
  const pricedSubtotal = r2(sum);
  let net = pricedSubtotal;
  let vat = 0;
  let gross = pricedSubtotal;
  let vatNote: string;
  const vatKnown = finance.vatRegistered !== null && (finance.vatRegistered === false || finance.vatRate !== null);
  if (finance.vatRegistered && finance.vatRate !== null) {
    const rate = finance.vatRate / 100;
    if (finance.pricesAre === "inclusive") {
      gross = pricedSubtotal;
      net = r2(gross / (1 + rate));
      vat = r2(gross - net);
      vatNote = `Prices include VAT at ${finance.vatRate}%`;
    } else {
      net = pricedSubtotal;
      vat = r2(net * rate);
      gross = r2(net + vat);
      vatNote = `Plus VAT at ${finance.vatRate}%`;
    }
  } else if (finance.vatRegistered === false) {
    vatNote = "No VAT (not VAT registered)";
  } else {
    vatNote = "VAT isn't set up in Settings, so none is added";
  }
  const complete = missing.length === 0 && e.lines.some((l) => lineTotal(l) !== null);
  const pct = e.rangePercent ?? null;
  let range: EstimateTotals["range"] = null;
  let rangeNote: string | undefined;
  if (pct && pct > 0) {
    if (!complete) rangeNote = "No range until every line has a price.";
    else range = { low: r2(gross * (1 - pct / 100)), high: r2(gross * (1 + pct / 100)), percent: pct };
  }
  return { pricedSubtotal, net, vat, gross, vatNote, vatKnown, missing, complete, range, rangeNote, bySource };
}

/* ------------------------------ Fitted furniture ------------------------------ */

export interface FittedFurnitureInput {
  /** How many units (e.g. 2 alcoves, or 1 run of wardrobes). */
  units: number;
  /** Per unit, in millimetres, as measured on site. 0 = not measured yet. */
  widthMm: number;
  heightMm: number;
  depthMm: number;
  shelvesPerUnit: number;
  doorsPerUnit: number;
  /** Days to make and fit, and how many people. 0 = not known yet. */
  days: number;
  people: number;
  finish?: string;
}

/** A standard 2440 × 1220 mm sheet. */
export const SHEET_M2 = 2.44 * 1.22;

const find = (card: RateCard | undefined, re: RegExp): RateItem | undefined => card?.items.find((i) => re.test(i.name));

let n = 0;
const lid = () => `est_${Date.now().toString(36)}_${(n++).toString(36)}`;

/**
 * Suggested lines for fitted furniture (alcove units, wardrobes) from the
 * measurements and the workspace's price list. Quantities use simple, shown
 * formulas; anything without a price or a measurement is left unpriced and
 * turned into a short question. Every line stays editable.
 */
export function suggestFittedFurniture(input: FittedFurnitureInput, card: RateCard | undefined): { lines: EstimateLine[]; questions: string[] } {
  const q: string[] = [];
  const units = Math.max(0, Math.round(input.units || 0));
  const measured = input.widthMm > 0 && input.heightMm > 0 && input.depthMm > 0;
  if (!units) q.push("How many units are there?");
  if (!measured) q.push("What are the width, height and depth of each unit (in mm)?");
  if (!input.days || !input.people) q.push("How many days to make and fit, and how many people?");

  const lines: EstimateLine[] = [];
  const fromCard = (label: string, qty: number, unit: string, item: RateItem | undefined, note: string, ask: string): EstimateLine => {
    if (!item) q.push(ask);
    return { id: lid(), label, qty, unit: item?.unit ?? unit, rate: item ? item.price : null, source: item ? "rate_card" : "missing", rateItemId: item?.id, note };
  };

  // Board: two sides, top, bottom, back and the shelves of each unit, as square metres → sheets (rounded up).
  const w = input.widthMm / 1000;
  const h = input.heightMm / 1000;
  const d = input.depthMm / 1000;
  const perUnitM2 = measured ? 2 * h * d + 2 * w * d + w * h + Math.max(0, input.shelvesPerUnit) * w * d : 0;
  const sheets = measured ? Math.ceil((perUnitM2 * units) / SHEET_M2) : 0;
  lines.push(
    fromCard(
      "Sheet material (carcasses, shelves, backs)",
      sheets,
      "sheet",
      find(card, /sheet|board|mdf|ply|veneer/i),
      measured ? `${units} × (2 sides + top + bottom + back + ${input.shelvesPerUnit} shelves) = ${(perUnitM2 * units).toFixed(2)} m², ÷ ${SHEET_M2.toFixed(2)} m² per sheet, rounded up` : "Needs the measurements",
      "What do you pay per sheet of board? (add it to your prices)",
    ),
  );
  if (input.doorsPerUnit > 0) lines.push(fromCard(input.finish?.toLowerCase().includes("shaker") ? "Shaker doors" : "Doors", units * input.doorsPerUnit, "each", find(card, /door/i), `${units} × ${input.doorsPerUnit} per unit`, "What does a door cost you?"));
  const hardware = find(card, /hinge|ironmongery|fixing|hardware/i);
  const perDoor = !!hardware && /door|pair|hinge/i.test(hardware.unit);
  const hwQty = perDoor ? units * Math.max(1, input.doorsPerUnit) : units;
  lines.push(fromCard("Hinges, handles and fixings", hwQty, hardware?.unit ?? "unit", hardware, perDoor ? `${units} × ${Math.max(1, input.doorsPerUnit)} doors` : "Per unit", "What do you allow for hinges, handles and fixings?"));
  const finish = find(card, /paint|finish|spray|lacquer|oil/i);
  lines.push(fromCard(`Finish${input.finish ? ` (${input.finish})` : ""}`, units, finish?.unit ?? "unit", finish, "Per unit", "What do you charge for the finish?"));
  const days = Math.max(0, input.days) * Math.max(0, input.people);
  lines.push({
    id: lid(),
    label: "Labour (making and fitting)",
    qty: days,
    unit: "day",
    rate: card?.labourDayRate ?? null,
    source: card?.labourDayRate ? "rate_card" : "missing",
    note: days ? `${input.days} days × ${input.people} ${input.people === 1 ? "person" : "people"}` : "Needs the days and people",
  });
  if (!card?.labourDayRate) q.push("What's your day rate for labour? (add it to your prices)");
  return { lines, questions: Array.from(new Set(q)) };
}

/** The saved estimate on a pricing record, if there really is one (empty JSON columns read back as []). */
export function savedEstimate(e: { estimate?: RoughEstimate | unknown }): RoughEstimate | undefined {
  const est = e.estimate as RoughEstimate | undefined;
  return est && !Array.isArray(est) && Array.isArray(est.lines) ? est : undefined;
}
