/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Handover report journey (fictional data, local dev server): node scripts/e2e-handover-report.cjs <photosDir>
// Luke adds an update on a phone; Ryan builds, edits, previews and exports the report on desktop.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const PHOTOS = process.argv[2];
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const JOB = 'n93_job_kitchen_crawley';
const login = async (ctx, email) => { const p = await ctx.newPage(); await p.goto(BASE + '/login'); const s = await p.evaluate(async (email) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'bob-demo' }) })).status, email); if (s !== 200) throw new Error('login ' + email); return p; };
const snap = (page) => page.evaluate(async () => (await fetch('/api/data')).json());
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });

(async () => {
  const b = await chromium.launch();
  const errors = [];

  /* Luke on a phone: Add update with a photo, a caption and a stage; then a note-only update */
  const lc = await b.newContext(PHONE);
  const luke = await login(lc, 'owner@ninety3.example');
  luke.on('pageerror', (e) => errors.push('luke: ' + e.message));
  await luke.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await luke.goto(`${BASE}/jobs/${JOB}`);
  await luke.getByRole('heading', { name: 'Kitchen renovation' }).waitFor();
  await luke.getByRole('button', { name: 'Add update' }).first().click();
  const dlg = luke.getByRole('dialog', { name: 'Add update' });
  await dlg.waitFor();
  await dlg.getByLabel(/What's happened/).fill('Quartz worktops fitted and sealed. Island overhang set at 300mm for the stools.');
  await dlg.getByRole('button', { name: 'Finished' }).click();
  // Fail the first photo upload to prove Retry works and nothing is duplicated.
  let failOnce = true;
  await luke.route('**/api/files', async (route) => { if (failOnce && route.request().method() === 'POST') { failOnce = false; return route.abort('failed'); } return route.continue(); });
  await dlg.locator('input[type=file]').nth(1).setInputFiles([path.join(PHOTOS, 'worktop-rotated.jpg'), path.join(PHOTOS, 'wide.jpg')]);
  await dlg.getByLabel(/Caption for worktop-rotated/).fill('Island worktop, sealed');
  await shot(luke, 'phone-390-add-update');
  await dlg.getByRole('button', { name: 'Save update' }).click();
  const retry = dlg.getByRole('button', { name: 'Retry', exact: true });
  const sawRetry = await retry.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check('Failed photo shows Retry; the update itself is already saved', sawRetry);
  await shot(luke, 'phone-390-add-update-retry');
  if (sawRetry) await retry.click();
  await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  check('Dialog closes once every photo is saved', !(await dlg.isVisible()));
  if (await dlg.isVisible()) await dlg.getByText('Close', { exact: true }).click();
  await luke.unroute('**/api/files');
  let s = await snap(luke);
  const upd = s.updates.filter((u) => u.jobId === JOB && /Quartz worktops/.test(u.note ?? ''));
  check('One update saved (no duplicate after retry)', upd.length === 1, `${upd.length}`);
  const linked = s.files.filter((f) => f.updateId === upd[0]?.id);
  check('Both photos linked to the update, originals kept', linked.length === 2 && linked.some((f) => f.description === 'Island worktop, sealed'), linked.map((f) => f.filename).join(', '));
  check('Finished-stage photos filed as completion', linked.every((f) => f.category === 'completion'));
  const orig = await luke.evaluate(async (id) => (await (await fetch(`/api/files/${id}`)).arrayBuffer()).byteLength, linked.find((f) => f.filename === 'worktop-rotated.jpg').id);
  check('Original file preserved byte-for-byte size', orig === fs.statSync(path.join(PHOTOS, 'worktop-rotated.jpg')).size);
  await luke.getByRole('button', { name: 'Add update' }).first().click();
  await luke.getByRole('dialog', { name: 'Add update' }).getByLabel(/What's happened/).fill('Customer happy with the island. Sink goes in tomorrow.');
  await luke.getByRole('dialog', { name: 'Add update' }).getByRole('button', { name: 'Save update' }).click();
  await luke.getByRole('dialog', { name: 'Add update' }).waitFor({ state: 'detached' });
  await luke.reload();
  await luke.getByText('Customer happy with the island').first().waitFor();
  check('Note-only update shows in the timeline after refresh', true);
  await shot(luke, 'phone-390-job-timeline', true);

  /* Ryan on desktop: create, choose content, draft (no AI key → known-details draft), edit, preview, export */
  const rc = await b.newContext(DESK);
  const ryan = await login(rc, 'office@ninety3.example');
  ryan.on('pageerror', (e) => errors.push('ryan: ' + e.message));
  await ryan.goto(`${BASE}/jobs/${JOB}?tab=report`);
  await ryan.getByRole('button', { name: 'Create handover report' }).click();
  await ryan.getByRole('heading', { name: 'Updates', exact: true }).waitFor();
  s = await snap(ryan);
  const rep = s.reports.find((r) => r.jobId === JOB);
  check('Draft preselects the customer, title and site', rep.content.customerName === 'The Patels' && rep.content.title === 'Kitchen renovation' && /Ifield Avenue/.test(rep.content.siteAddress));
  // Exclude one progress photo; include costs.
  const excluded = s.files.find((f) => f.jobId === JOB && f.filename === 'IMG_4101.png');
  await ryan.getByRole('checkbox', { name: 'Back to bare walls, ready for first fix.', exact: true }).uncheck();
  await ryan.getByRole('checkbox', { name: 'Include cost summary' }).check();
  await shot(ryan, 'desk-1440-report-review', true);
  await ryan.getByRole('button', { name: 'Draft the report' }).click();
  await ryan.getByText(/Bob filled in what it knows/).first().waitFor({ timeout: 15000 });
  check('Without AI, an editable draft opens and says so', true);
  const overview = ryan.getByLabel('Overview text');
  await overview.fill('We refitted the kitchen at 41 Ifield Avenue with a new island and quartz worktops, and laid new flooring throughout.');
  await ryan.getByLabel('Work completed point 1').fill('Old units stripped out and walls made good');
  await ryan.getByRole('button', { name: 'Save draft' }).click();
  await ryan.getByText('Draft saved').waitFor();
  // Rewrite is offered; with no AI it fails safely and leaves the text alone.
  await ryan.getByRole('button', { name: 'Rewrite this section' }).first().click();
  await ryan.waitForTimeout(1500);
  check('Rewrite without AI leaves manual text unchanged', (await overview.inputValue()).startsWith('We refitted the kitchen'));
  check('Missing-info prompts stay in the editor', await ryan.getByRole('heading', { name: 'Before you send' }).isVisible());
  await ryan.waitForTimeout(5500); // let toasts clear
  await ryan.evaluate(() => window.scrollTo(0, 0));
  await shot(ryan, 'desk-1440-report-editor');
  // Luke edits the same draft in the meantime → Ryan's next save is protected.
  s = await snap(luke);
  const cur = s.reports.find((r) => r.jobId === JOB);
  const lukeSave = await luke.evaluate(async ([id, rev, content]) => (await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'saveReport', args: { id, baseRevision: rev, content: { ...content, title: 'Ifield Avenue kitchen' } } }) })).json(), [cur.id, cur.revision, cur.content]);
  check('Luke saves a change to the shared draft', lukeSave.ok);
  await ryan.getByLabel('Report title').fill('Kitchen renovation, 41 Ifield Avenue');
  await ryan.getByRole('button', { name: 'Save draft' }).click();
  const seenConflict = await ryan.getByText(/saved this report/).first().waitFor({ timeout: 8000 }).then(() => true, async () => { console.log('DEBUG title now:', await ryan.getByLabel('Report title').inputValue(), '| status:', await ryan.locator('[aria-live=polite]').allInnerTexts()); return false; });
  if (!seenConflict) throw new Error('no conflict shown');
  check("Ryan's stale save is refused and Luke's version is offered", await ryan.getByRole('button', { name: 'Load their version' }).isVisible());
  await ryan.getByRole('button', { name: 'Load their version' }).click();
  check("Luke's title is kept", (await ryan.getByLabel('Report title').inputValue()) === 'Ifield Avenue kitchen');
  await ryan.getByRole('button', { name: 'Preview PDF' }).click();
  await ryan.locator('iframe[title^="Customer preview"]').waitFor();
  await ryan.waitForTimeout(2500);
  await shot(ryan, 'desk-1440-report-preview');
  const [dl] = await Promise.all([ryan.waitForEvent('download'), ryan.getByRole('button', { name: /Save version & download PDF/ }).click()]);
  const pdfPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(pdfPath);
  check('Download is a recognisable versioned filename', dl.suggestedFilename() === 'Ninety3 - Ifield Avenue Kitchen - Handover v1.pdf', dl.suggestedFilename());
  check('Downloaded file is a real PDF', fs.readFileSync(pdfPath).subarray(0, 5).toString() === '%PDF-');
  s = await snap(ryan);
  check('Version saved on the job', s.reportVersions.some((v) => v.jobId === JOB && v.version === 1));
  const finalRep = s.reports.find((r) => r.jobId === JOB);
  check('Unselected photo is not in the report', !!excluded && !finalRep.content.photos.some((p) => p.fileId === excluded.id));
  const imgs = require('node:child_process').execFileSync('pdfimages', ['-list', pdfPath]).toString().trim().split('\n').slice(2).filter((l) => l.trim().split(/\s+/)[2] === 'image').length;
  const included = finalRep.content.photos.filter((p) => p.include).length;
  check('PDF embeds exactly the included photos (+ logo)', imgs === included + 1, `${imgs} images for ${included} photos`);
  const text = require('node:child_process').execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString();
  check('PDF text: customer, title, site and no internal notes or access codes', /The Patels/.test(text) && /Ifield Avenue kitchen/.test(text) && !/Ring the bell at the side door|INTERNAL/.test(text));
  check('PDF cost summary uses Bob figures', /Agreed price\s+£12,500/.test(text), (text.match(/Agreed price.*$/m) || [''])[0]);

  /* Another workspace can't reach the draft, preview or PDF */
  const xc = await b.newContext(DESK);
  const alex = await login(xc, 'alex@ridgeway.example');
  const v1 = s.reportVersions.find((v) => v.jobId === JOB);
  const prev = await alex.evaluate(async (id) => (await fetch(`/api/handover-reports/${id}/preview`)).status, rep.id);
  const file = await alex.evaluate(async (id) => (await fetch(`/api/files/${id}?download=1`)).status, v1.fileId);
  const save = await alex.evaluate(async (id) => (await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'saveReport', args: { id, baseRevision: 1 } }) })).status, rep.id);
  check('Other company: preview is refused', prev === 404, String(prev));
  check('Other company: PDF is 404', file === 404, String(file));
  check('Other company: cannot save the draft', save === 404, String(save));
  const site = await b.newContext(DESK);
  const sp = await login(site, 'site@ninety3.example');
  check('Site team: no report PDF (it can show money)', (await sp.evaluate(async (id) => (await fetch(`/api/files/${id}`)).status, v1.fileId)) === 404);

  check('No uncaught page errors', errors.length === 0, errors.join(' | '));
  console.log(`PDF: ${pdfPath}`);
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
