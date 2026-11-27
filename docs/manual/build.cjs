/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
/**
 * Builds "Getting started with Bob" from docs/manual/content.cjs:
 *   - docs/manual/Getting-started-with-Bob.pdf   (designed, A4, contents + page numbers)
 *   - docs/manual/Getting-started-with-Bob.docx  (editable Word version of the same guide)
 *   - docs/manual/getting-started-with-bob.html  (the designed page the PDF is printed from)
 *   - public/guide/getting-started-with-bob.pdf  (the copy Bob links to from Help & support)
 *
 *   node docs/manual/build.cjs
 * Needs: Playwright's Chromium, python3 with pypdf (for the contents page numbers), the `docx` package.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const guide = require('./content.cjs');

const DIR = __dirname;
const ROOT = path.join(DIR, '..', '..');
const IMG = path.join(DIR, 'images');
const OUT_PDF = path.join(DIR, 'Getting-started-with-Bob.pdf');
const OUT_DOCX = path.join(DIR, 'Getting-started-with-Bob.docx');
const OUT_HTML = path.join(DIR, 'getting-started-with-bob.html');
const PUBLIC_PDF = path.join(ROOT, 'public', 'guide', 'getting-started-with-bob.pdf');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const b64 = (file) => fs.readFileSync(file).toString('base64');
const font = `data:font/woff2;base64,${b64(path.join(ROOT, 'src/app/fonts/InterVariable-latin.woff2'))}`;
const bobLight = fs.readFileSync(path.join(ROOT, 'public/brand/bob-wordmark.svg'), 'utf8');
const bobByCresaro = fs.readFileSync(path.join(ROOT, 'public/brand/bob-wordmark-by-cresaro.svg'), 'utf8');
const bobDark = fs.readFileSync(path.join(ROOT, 'public/brand/bob-wordmark-dark.svg'), 'utf8');
const img = (name) => `data:image/jpeg;base64,${b64(path.join(IMG, `${name}.jpg`))}`;

/* ------------------------------------ HTML ------------------------------------ */

function block(b) {
  if (b.h) return `<h3>${inline(b.h)}</h3>`;
  if (b.p) return `<p>${inline(b.p)}</p>`;
  if (b.steps) return `<ol class="steps">${b.steps.map((s) => `<li><span>${inline(s)}</span></li>`).join('')}</ol>`;
  if (b.list) return `<ul class="bullets">${b.list.map((s) => `<li>${inline(s)}</li>`).join('')}</ul>`;
  if (b.img) return `<figure class="${b.phone ? 'phone' : 'shot'}"><img src="${img(b.img)}" alt="${esc(b.caption ?? '')}"/>${b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : ''}</figure>`;
  if (b.tip) return `<aside class="tip"><b>Tip</b><span>${inline(b.tip)}</span></aside>`;
  if (b.connect) return `<aside class="connect"><b>Needs a connection</b><span>${inline(b.connect)}</span></aside>`;
  if (b.say) return `<div class="say">${b.say.map((s) => `<p>“${inline(s)}”</p>`).join('')}</div>`;
  if (b.table) return `<table><thead><tr>${b.table[0].map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${b.table.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return '';
}

const CSS = `
@font-face { font-family: Inter; src: url(${font}) format('woff2'); font-weight: 100 900; }
@page { size: A4; margin: 20mm 18mm 22mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: Inter, sans-serif; color: #1d1b19; font-size: 10.6pt; line-height: 1.55; font-feature-settings: "cv11"; }
strong { font-weight: 650; color: #151311; }
.contents, .chapter { break-before: page; }
.contents h2 { font-size: 26pt; letter-spacing: -0.02em; margin: 0 0 6mm; }
.contents ol { list-style: none; padding: 0; margin: 0; }
.contents li { display: flex; align-items: baseline; gap: 4mm; padding: 3.2mm 0; border-bottom: 0.4pt solid #e4ddd2; font-size: 12.5pt; }
.contents li .n { width: 9mm; color: #e2711f; font-weight: 700; }
.contents li .t { flex: 1; font-weight: 600; }
.contents li .pg { color: #6f675e; font-variant-numeric: tabular-nums; }
.contents .about { margin-top: 10mm; color: #4f4943; font-size: 10pt; }
.opener { margin: 0 0 8mm; padding: 0 0 6mm; border-bottom: 2pt solid #F38735; }
.eyebrow { font-size: 10pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #e2711f; }
.opener h2 { font-size: 28pt; line-height: 1.1; letter-spacing: -0.025em; margin: 2mm 0 3mm; }
.opener .intro { font-size: 12.5pt; color: #4f4943; margin: 0; }
h3 { font-size: 14pt; letter-spacing: -0.01em; margin: 7mm 0 2mm; break-after: avoid; }
p { margin: 0 0 3mm; }
ol.steps { list-style: none; counter-reset: s; padding: 0; margin: 0 0 4mm; }
ol.steps li { counter-increment: s; display: flex; gap: 3.5mm; margin: 0 0 2.2mm; break-inside: avoid; }
ol.steps li::before { content: counter(s); flex: none; width: 6.4mm; height: 6.4mm; border-radius: 50%; background: #F38735; color: #fff; font-weight: 700; font-size: 9.5pt; display: grid; place-items: center; margin-top: 0.3mm; }
ul.bullets { margin: 0 0 4mm; padding-left: 5mm; }
ul.bullets li { margin: 0 0 1.6mm; padding-left: 1mm; }
ul.bullets li::marker { color: #F38735; }
figure { margin: 4mm 0 5mm; break-inside: avoid; }
figure img { display: block; width: 100%; border-radius: 3mm; border: 0.5pt solid #ddd6cb; box-shadow: 0 1mm 3mm rgba(0,0,0,0.08); }
figure.phone img { width: 62mm; margin: 0 auto; border-radius: 5mm; }
figcaption { margin-top: 2mm; font-size: 9pt; color: #6f675e; text-align: center; }
aside { display: flex; gap: 3mm; padding: 3.2mm 4mm; border-radius: 2.5mm; margin: 3mm 0 4mm; break-inside: avoid; font-size: 10pt; }
aside b { flex: none; font-weight: 700; }
aside.tip { background: #fdeedf; color: #5c3410; }
aside.tip b { color: #c2600f; }
aside.connect { background: #eef1f6; color: #2b3a55; }
aside.connect b { color: #34508a; }
.say { background: #1d1b19; color: #faf9f6; border-radius: 3mm; padding: 4mm 5mm; margin: 3mm 0 5mm; break-inside: avoid; }
.say p { margin: 0 0 2mm; font-size: 11pt; }
.say p:last-child { margin: 0; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 5mm; font-size: 10pt; break-inside: avoid; }
th { text-align: left; background: #f4efe7; font-weight: 650; padding: 2.4mm 3mm; }
td { padding: 2.4mm 3mm; border-bottom: 0.4pt solid #e4ddd2; vertical-align: top; }
`;

function bodyHtml(pages) {
  const contents = `<section class="contents"><h2>Contents</h2><ol>${guide.chapters.map((c, i) => `<li><span class="n">${i + 1}</span><span class="t">${esc(c.title)}</span><span class="pg">${pages ? pages[i] : '00'}</span></li>`).join('')}</ol>
  <p class="about">This guide uses a fictional demo business, Ridgeway Build &amp; Joinery. Your own Bob shows your business's name, team, jobs and customers. Numbered orange markers on the screenshots match the numbered steps.</p></section>`;
  const chapters = guide.chapters
    .map((c, i) => `<section class="chapter"><header class="opener"><div class="eyebrow">Chapter ${i + 1}</div><h2>${esc(c.title)}</h2><p class="intro">${inline(c.intro)}</p></header>${c.blocks.map(block).join('\n')}</section>`)
    .join('\n');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(guide.title)}</title><style>${CSS}</style></head><body>${contents}${chapters}</body></html>`;
}

const coverHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url(${font}) format('woff2'); font-weight: 100 900; }
@page { size: A4; margin: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: Inter, sans-serif; }
.cover { width: 210mm; height: 297mm; background: #1d1b19; color: #faf9f6; position: relative; overflow: hidden; }
.glow { position: absolute; right: -60mm; top: 40mm; width: 200mm; height: 200mm; border-radius: 50%; background: radial-gradient(circle, rgba(243,135,53,0.35), rgba(243,135,53,0) 65%); }
.logo { position: absolute; left: 22mm; top: 24mm; width: 46mm; }
.logo svg, .foot svg { width: 100%; height: auto; display: block; }
.title { position: absolute; left: 22mm; right: 22mm; top: 112mm; }
.bar { width: 18mm; height: 2.2mm; background: #F38735; border-radius: 2mm; margin-bottom: 8mm; }
h1 { font-size: 40pt; line-height: 1.05; letter-spacing: -0.03em; margin: 0 0 6mm; font-weight: 750; }
.sub { font-size: 16pt; color: rgba(250,249,246,0.75); margin: 0; max-width: 140mm; line-height: 1.4; }
.meta { position: absolute; left: 22mm; bottom: 26mm; font-size: 10.5pt; color: rgba(250,249,246,0.6); line-height: 1.6; }
.foot { position: absolute; right: 22mm; bottom: 24mm; width: 36mm; }
</style></head><body><div class="cover"><div class="glow"></div><div class="logo">${bobLight}</div>
<div class="title"><div class="bar"></div><h1>${esc(guide.title)}</h1><p class="sub">${esc(guide.subtitle)}</p></div>
<div class="meta">Version ${esc(guide.version)} · ${esc(guide.published)}<br/>For Bob customers and their teams</div><div class="foot">${bobByCresaro}</div></div></body></html>`;

const footer = `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:8pt;color:#8a8178;padding:0 18mm;display:flex;justify-content:space-between;"><span>${esc(guide.title)} · v${esc(guide.version)} · ${esc(guide.published)}</span><span><span class="pageNumber"></span></span></div>`;

async function renderPdf(browser, html, file, withFooter) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: file, format: 'A4', printBackground: true, displayHeaderFooter: withFooter, headerTemplate: '<span></span>', footerTemplate: withFooter ? footer : '<span></span>', preferCSSPageSize: true });
  await page.close();
}

function chapterPages(file) {
  const out = execFileSync('python3', ['-c', `
import sys, re, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1]); found = {}
for i, p in enumerate(r.pages):
    for m in re.finditer(r"CHAPTER (\\d+)", p.extract_text() or ""):
        found.setdefault(int(m.group(1)), i + 1)
print(json.dumps(found))`, file]).toString();
  const found = JSON.parse(out);
  return guide.chapters.map((_, i) => found[String(i + 1)] ?? '');
}

function merge(files, out) {
  execFileSync('python3', ['-c', `
import sys
from pypdf import PdfWriter
w = PdfWriter()
for f in sys.argv[2:]: w.append(f)
w.add_metadata({"/Title": "Getting started with Bob", "/Author": "Cresaro", "/Subject": "A practical guide to running your business with Bob."})
w.write(sys.argv[1])`, out, ...files]);
}

/* ------------------------------------ DOCX ------------------------------------ */

async function buildDocx() {
  const d = require('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType, Footer, PageNumber, TableOfContents, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageBreak, LevelFormat } = d;
  const runs = (s, opts = {}) => String(s).split(/(\*\*.+?\*\*)/).filter(Boolean).map((part) => (part.startsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true, ...opts }) : new TextRun({ text: part, ...opts })));
  const size = (name) => {
    const out = execFileSync('python3', ['-c', `from PIL import Image; im=Image.open(${JSON.stringify(path.join(IMG, `${name}.jpg`))}); print(im.size[0], im.size[1])`]).toString().trim().split(' ').map(Number);
    return { w: out[0], h: out[1] };
  };
  const children = [];
  children.push(new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: guide.title, bold: true, size: 64, color: '1D1B19' })] }));
  children.push(new Paragraph({ spacing: { after: 400 }, children: [new TextRun({ text: guide.subtitle, size: 30, color: '6F675E' })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Version ${guide.version} · ${guide.published}`, size: 22, color: '6F675E' })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: 'Bob by Cresaro', size: 22, color: 'E2711F', bold: true })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] }));
  children.push(new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-1' }));
  children.push(new Paragraph({ children: [new TextRun({ text: 'Right-click the contents and choose Update Field to refresh the page numbers after editing.', italics: true, size: 18, color: '8A8178' })] }));
  guide.chapters.forEach((c, i) => {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `CHAPTER ${i + 1}`, bold: true, color: 'E2711F', size: 20 })] }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(c.title)] }));
    children.push(new Paragraph({ spacing: { after: 240 }, children: runs(c.intro, { color: '4F4943', size: 24 }) }));
    let listRef = 0;
    for (const b of c.blocks) {
      if (b.h) children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.h)] }));
      else if (b.p) children.push(new Paragraph({ spacing: { after: 120 }, children: runs(b.p) }));
      else if (b.steps) {
        listRef += 1;
        const ref = `steps-${i}-${listRef}`;
        numberingConfigs.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 440, hanging: 300 } }, run: { bold: true, color: 'E2711F' } } }] });
        for (const s of b.steps) children.push(new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 80 }, children: runs(s) }));
      } else if (b.list) for (const s of b.list) children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: runs(s) }));
      else if (b.img) {
        const { w, h } = size(b.img);
        const width = b.phone ? 230 : 600;
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: [new ImageRun({ type: 'jpg', data: fs.readFileSync(path.join(IMG, `${b.img}.jpg`)), transformation: { width, height: Math.round((h / w) * width) } })] }));
        if (b.caption) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: runs(b.caption, { size: 18, color: '6F675E' }) }));
      } else if (b.tip || b.connect) {
        const label = b.tip ? 'Tip: ' : 'Needs a connection: ';
        children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: b.tip ? 'FDEEDF' : 'EEF1F6' }, spacing: { before: 120, after: 160 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: b.tip ? 'F38735' : '34508A', space: 6 } }, children: [new TextRun({ text: label, bold: true }), ...runs(b.tip || b.connect)] }));
      } else if (b.say) for (const s of b.say) children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: '1D1B19' }, spacing: { after: 0 }, children: [new TextRun({ text: `“${s}”`, color: 'FAF9F6' })] }));
      else if (b.table)
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.table.map((r, ri) => new TableRow({ children: r.map((cell) => new TableCell({ shading: ri === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F4EFE7' } : undefined, children: [new Paragraph({ children: runs(cell, ri === 0 ? { bold: true } : {}) })] })) })),
          }),
        );
    }
  });
  const doc = new Document({
    creator: 'Cresaro',
    title: guide.title,
    description: guide.subtitle,
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: 'Inter', size: 21, color: '1D1B19' } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 48, bold: true, color: '151311' }, paragraph: { spacing: { before: 120, after: 160 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, color: '151311' }, paragraph: { spacing: { before: 280, after: 100 } } },
      ],
    },
    numbering: { config: [...numberingConfigs] },
    sections: [{ properties: { page: { margin: { top: 1100, bottom: 1100, left: 1000, right: 1000 } } }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${guide.title} · v${guide.version} · page `, size: 16, color: '8A8178' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '8A8178' })] })] }) }, children }],
  });
  fs.writeFileSync(OUT_DOCX, await Packer.toBuffer(doc));
}
const numberingConfigs = [];

(async () => {
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bob-guide-'));
  const cover = path.join(tmp, 'cover.pdf');
  const body = path.join(tmp, 'body.pdf');
  await renderPdf(browser, coverHtml, cover, false);
  await renderPdf(browser, bodyHtml(null), body, true);
  const pages = chapterPages(body);
  const html = bodyHtml(pages);
  await renderPdf(browser, html, body, true);
  await browser.close();
  merge([cover, body], OUT_PDF);
  fs.writeFileSync(OUT_HTML, html.replace('<body>', `<body>${coverHtml.match(/<div class="cover">[\s\S]*<\/div><\/body>/)[0].replace('</body>', '')}`).replace('</style>', `${coverHtml.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/@page[^}]*}/, '')}</style>`));
  fs.mkdirSync(path.dirname(PUBLIC_PDF), { recursive: true });
  fs.copyFileSync(OUT_PDF, PUBLIC_PDF);
  await buildDocx();
  console.log('Contents page numbers:', pages.join(', '));
  console.log('Wrote', path.relative(ROOT, OUT_PDF), path.relative(ROOT, OUT_DOCX), path.relative(ROOT, OUT_HTML), path.relative(ROOT, PUBLIC_PDF));
  void bobDark;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
