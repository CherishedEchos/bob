import "server-only";
/**
 * Customer handover report → A4 PDF (pdfkit; standard fonts, so all text is
 * real, selectable text).
 *
 * Layout adapts to the content:
 *  - concise (≤ 3 photos and short text): cover and everything else flow on
 *    from the first page, so a small job is one or two pages;
 *  - otherwise a full cover page, then the summary, a captioned photo
 *    gallery, costs and aftercare.
 * Photos are fitted inside their box (never stretched or cropped) and
 * captions are kept on the same page as their photo. Empty sections are
 * skipped and pages are only added when content needs them.
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { CostLine, OrgConfig, ReportContent } from "@/lib/types";
import { gbp } from "@/lib/utils";
import { printableLogoUrl } from "@/server/brand";

export interface PdfImage {
  data: Buffer;
}

export interface RenderInput {
  org: OrgConfig;
  content: ReportContent;
  costLines: CostLine[];
  costNote?: string;
  images: Map<string, PdfImage>;
}

const A4 = { w: 595.28, h: 841.89 };
const M = 50;
const W = A4.w - M * 2;
const FOOT = 40;
const BOTTOM = A4.h - M - FOOT + 14;
const INK = "#1d1d1f";
const MUTED = "#5f5f66";
const RULE = "#e2e0dc";

/** Keep text inside the standard fonts' character set (WinAnsi). */
export function pdfText(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF–—•€\n]/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

const longDate = (key: string) => new Date(`${key.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function brandColour(org: OrgConfig) {
  const c = org.brandColor ?? org.accent;
  return /^#[0-9a-f]{6}$/i.test(c) ? c : "#7a4a2a";
}

function logoBuffer(org: OrgConfig): Buffer | null {
  const url = printableLogoUrl(org);
  if (!url || !/^\/brand\/[\w.-]+\.(png|jpe?g)$/i.test(url)) return null;
  try {
    return fs.readFileSync(path.join(process.cwd(), "public", url));
  } catch {
    return null;
  }
}

type Doc = InstanceType<typeof PDFDocument>;
/** pdfkit's opened image (openImage exists at runtime; the published types omit it). */
type Img = { width: number; height: number; orientation?: number };
const openImage = (doc: Doc, data: Buffer) => (doc as unknown as { openImage(b: Buffer): Img }).openImage(data);

/** Displayed width/height of an image after its EXIF rotation. */
function dims(img: Img) {
  const rotated = (img.orientation ?? 1) > 4;
  return rotated ? { w: img.height, h: img.width } : { w: img.width, h: img.height };
}

export async function renderReportPdf(input: RenderInput): Promise<{ data: Buffer; pages: number }> {
  const { org, content } = input;
  const accent = brandColour(org);
  const doc = new PDFDocument({ size: "A4", margins: { top: M, bottom: M, left: M, right: M }, bufferPages: true, autoFirstPage: true, info: { Title: pdfText(`${content.title} - Handover`), Author: pdfText(org.name), Subject: "Customer handover report" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((r) => doc.on("end", () => r()));

  const opened = new Map<string, Img>();
  const open = (id: string) => {
    if (opened.has(id)) return opened.get(id)!;
    const src = input.images.get(id);
    if (!src) return null;
    try {
      const img = openImage(doc, src.data);
      opened.set(id, img);
      return img;
    } catch {
      return null;
    }
  };

  const visible = content.sections.filter((s) => !s.hidden && sectionHasContent(s, input));
  const photos = content.photos.filter((p) => p.include && input.images.has(p.fileId));
  const cover = content.coverFileId && photos.some((p) => p.fileId === content.coverFileId) ? content.coverFileId : photos[0]?.fileId;
  const story = photos.length > 1 ? photos.filter((p) => p.fileId !== cover) : [];
  const textLength = visible.reduce((n, s) => n + (s.body?.length ?? 0) + (s.items ?? []).join(" ").length, 0);
  const concise = photos.length <= 3 && textLength < 1400;

  /* ---------------- Cover ---------------- */
  let y = M;
  const logo = logoBuffer(org);
  if (logo) {
    try {
      doc.image(logo, M, y, { fit: [170, 44] });
    } catch {
      /* unreadable logo: name only */
    }
  }
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(pdfText(org.name), M + 180, y + 4, { width: W - 180, align: "right" });
  const contact = [org.contact.phone, org.contact.email, org.contact.website].filter(Boolean).join("  ·  ");
  if (contact) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(pdfText(contact), M + 180, y + 19, { width: W - 180, align: "right" });
  y += 56;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1.5).strokeColor(accent).stroke();
  y += 22;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(accent).text("HANDOVER REPORT", M, y, { characterSpacing: 1.2 });
  y = doc.y + 6;
  doc.font("Helvetica-Bold").fontSize(concise ? 24 : 28).fillColor(INK).text(pdfText(content.title), M, y, { width: W });
  y = doc.y + 6;
  const meta = [`For ${content.customerName}`, content.siteAddress].filter(Boolean).join("  ·  ");
  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(pdfText(meta), M, y, { width: W });
  y = doc.y + 3;
  if (content.completionDate) {
    doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(`Completed ${longDate(content.completionDate)}`, M, y, { width: W });
    y = doc.y;
  }
  y += 18;
  if (cover) {
    const img = open(cover);
    if (img) {
      const boxH = concise ? (story.length ? 250 : 300) : BOTTOM - y - 10;
      const { w, h } = dims(img);
      const scale = Math.min(W / w, boxH / h);
      const dw = w * scale, dh = h * scale;
      doc.image(img as never, M + (W - dw) / 2, y, { width: dw, height: dh });
      y += dh + 18;
    }
  }
  if (!concise) {
    doc.addPage();
    y = M;
  }

  /* ---------------- Flow helpers ---------------- */
  const ensure = (need: number) => {
    if (y + need > BOTTOM) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (t: string, keepWith = 70) => {
    ensure(keepWith);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(accent).text(pdfText(t), M, y, { width: W });
    y = doc.y + 4;
    doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.6).strokeColor(RULE).stroke();
    y += 10;
  };
  const para = (t: string) => {
    for (const p of pdfText(t).split(/\n{2,}/)) {
      doc.font("Helvetica").fontSize(10.5).fillColor(INK);
      const h = doc.heightOfString(p, { width: W, lineGap: 3 });
      ensure(Math.min(h, 60));
      doc.text(p, M, y, { width: W, lineGap: 3 });
      y = doc.y + 8;
    }
  };
  const bullets = (items: string[]) => {
    for (const it of items) {
      const t = pdfText(it);
      doc.font("Helvetica").fontSize(10.5);
      const h = doc.heightOfString(t, { width: W - 16, lineGap: 2.5 });
      ensure(h + 4);
      doc.fillColor(accent).text("•", M + 2, y, { width: 10 });
      doc.fillColor(INK).text(t, M + 16, y, { width: W - 16, lineGap: 2.5 });
      y = doc.y + 5;
    }
    y += 4;
  };
  const captionHeight = (t: string, width: number) => (t ? doc.font("Helvetica").fontSize(9).heightOfString(pdfText(t), { width, lineGap: 1.5 }) + 4 : 0);

  const photoGrid = () => {
    if (!story.length) return;
    const one = story.length <= 2;
    const gap = 16;
    const colW = one ? W : (W - gap) / 2;
    const boxH = one ? 300 : 190;
    let col = 0;
    let rowH = 0;
    for (const p of story) {
      const img = open(p.fileId);
      if (!img) continue;
      const { w, h } = dims(img);
      const scale = Math.min(colW / w, boxH / h);
      const dw = w * scale, dh = h * scale;
      const capH = captionHeight(p.caption, colW);
      const block = dh + 6 + capH;
      if (col === 0) {
        // Row height: tallest of this row's photos (image + caption) — kept together on one page.
        const pair = one ? [p] : story.slice(story.indexOf(p), story.indexOf(p) + 2);
        rowH = Math.max(...pair.map((q) => {
          const qi = open(q.fileId);
          if (!qi) return 0;
          const d = dims(qi);
          const s = Math.min(colW / d.w, boxH / d.h);
          return d.h * s + 6 + captionHeight(q.caption, colW);
        }));
        ensure(rowH);
      }
      const x = M + col * (colW + gap) + (colW - dw) / 2;
      doc.image(img as never, x, y, { width: dw, height: dh });
      if (p.caption) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(pdfText(p.caption), M + col * (colW + gap), y + dh + 6, { width: colW, lineGap: 1.5, align: one ? "left" : "left" });
      void block;
      if (one || col === 1) {
        y += rowH + 16;
        col = 0;
      } else col = 1;
    }
    if (col === 1) y += rowH + 16;
  };

  const costs = () => {
    const lines = input.costLines;
    // Keep the table together: measure it, and start a new page if it won't fit.
    let total = 12;
    for (const l of lines) {
      doc.font(l.strong ? "Helvetica-Bold" : "Helvetica").fontSize(10.5);
      total += doc.heightOfString(pdfText(l.label), { width: W - 130 }) + 10;
      if (l.note) total += doc.font("Helvetica").fontSize(8.5).heightOfString(pdfText(l.note), { width: W - 130 }) + 2;
    }
    if (input.costNote) total += 20;
    if (total < BOTTOM - M) ensure(total);
    for (const l of lines) {
      doc.font(l.strong ? "Helvetica-Bold" : "Helvetica").fontSize(10.5);
      const labelH = doc.heightOfString(pdfText(l.label), { width: W - 130 });
      const noteH = l.note ? doc.font("Helvetica").fontSize(8.5).heightOfString(pdfText(l.note), { width: W - 130 }) + 2 : 0;
      ensure(labelH + noteH + 12);
      if (l.strong) {
        doc.moveTo(M, y - 3).lineTo(M + W, y - 3).lineWidth(0.6).strokeColor(RULE).stroke();
      }
      doc.font(l.strong ? "Helvetica-Bold" : "Helvetica").fontSize(10.5).fillColor(INK).text(pdfText(l.label), M, y, { width: W - 130 });
      doc.text(gbp(l.amount), M + W - 120, y, { width: 120, align: "right" });
      y += labelH + 1;
      if (l.note) {
        doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(pdfText(l.note), M, y, { width: W - 130 });
        y += noteH;
      }
      y += 9;
    }
    if (input.costNote) {
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text(pdfText(input.costNote), M, y, { width: W });
      y = doc.y + 6;
    }
    y += 6;
  };

  /* ---------------- Sections, in the chosen order ---------------- */
  for (const s of visible) {
    if (s.kind === "photos") {
      if (!story.length) continue;
      // Keep the heading with the first row of photos.
      heading(s.heading, 60 + (story.length <= 2 ? 330 : 240));
      photoGrid();
    } else if (s.kind === "costs") {
      heading(s.heading, 30 + input.costLines.length * 26);
      costs();
    } else if (s.kind === "bullets") {
      heading(s.heading);
      bullets(s.items ?? []);
    } else {
      heading(s.heading);
      para(s.body ?? "");
    }
  }

  /* ---------------- Footer on every page ---------------- */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin would make pdfkit add a page; the footer lives in the margin.
    doc.page.margins.bottom = 0;
    const fy = A4.h - M + 6;
    doc.moveTo(M, fy - 8).lineTo(M + W, fy - 8).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(pdfText(`${org.name}${org.contact.phone ? `  ·  ${org.contact.phone}` : ""}`), M, fy, { width: W - 80, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, M + W - 80, fy, { width: 80, align: "right", lineBreak: false });
  }
  doc.end();
  await done;
  return { data: Buffer.concat(chunks), pages: range.count };
}

function sectionHasContent(s: ReportContent["sections"][number], input: RenderInput) {
  if (s.kind === "photos") return input.content.photos.filter((p) => p.include && input.images.has(p.fileId)).length > 1;
  if (s.kind === "costs") return input.costLines.length > 0;
  if (s.kind === "bullets") return (s.items ?? []).some((i) => i.trim());
  return !!s.body?.trim();
}
