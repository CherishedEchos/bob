/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// The customer handover, start to finish, as a first-time user would do it (fictional demo data):
//   BASE=http://localhost:3000 OUT=/tmp node scripts/e2e-handover-wizard.cjs
// Phone (390px): start → details → photos (upload, cover) → Bob writes → edit → Save & exit → resume →
// costs → review → PDF v1 → pack → email draft → status Ready → edit → PDF v2. Desktop: the garden room.
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const LUKE = { email: process.env.LUKE_EMAIL || 'owner@ninety3.example', password: process.env.LUKE_PASSWORD || 'bob-demo' };
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const snap = (p) => p.evaluate(async () => (await fetch('/api/data')).json());
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const JOB = 'n93_job_stairs_horley';

async function signIn(b, opts) {
  const ctx = await b.newContext({ ...opts, acceptDownloads: true });
  const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  await p.evaluate(async ([email, password]) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }), [LUKE.email, LUKE.password]);
  return p;
}
const saved = (p) => p.getByText('Saved', { exact: true }).waitFor({ timeout: 20000 }).then(() => true, () => false);
const shot = (p, n) => p.screenshot({ path: path.join(OUT, `handover-${n}.png`) });

(async () => {
  const b = await chromium.launch();
  const p = await signIn(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));

  /* Job page: status + one button */
  await p.goto(BASE + `/jobs/${JOB}?tab=handover`);
  await p.getByText('Customer handover').waitFor({ timeout: 60000 });
  check('Job page shows handover status: Not started', /Not started/.test(await p.locator('#job-tabpanel').innerText()));
  await p.locator('#job-tabpanel').getByRole('link', { name: /Create handover report/ }).click();
  await p.waitForURL(`**/jobs/${JOB}/handover`, { timeout: 60000 });
  check('Opens its own page — no job profile underneath', !(await p.locator('#job-tabpanel').count()));
  check('No tab bar on the handover page', !(await p.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).count()));
  await shot(p, 'phone-0-start');
  await p.getByRole('button', { name: 'Start the handover' }).click();

  /* 1. Job details, filled in from the job */
  await p.getByRole('heading', { name: 'Job details' }).waitFor();
  check('Five-step progress shown', (await p.getByRole('navigation', { name: 'Handover steps' }).getByRole('button').count()) === 5 && /Step 1 of 5/.test(await p.locator('main').innerText()));
  const title = p.getByLabel('Report title');
  check('Title, customer and address filled in from the job', (await title.inputValue()) === 'Oak staircase' && (await p.getByLabel('Customer').inputValue()).length > 2 && (await p.getByLabel('Address').inputValue()).length > 2);
  await title.fill('Oak staircase and glass balustrade');
  check('Changes save themselves', await saved(p));
  await shot(p, 'phone-1-details');
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('390px: no sideways scrolling', ov <= 1, String(ov));
  const cont = await p.getByRole('button', { name: 'Continue' }).boundingBox();
  check('Continue is a large button (≥ 52px tall)', cont && cont.height >= 52, JSON.stringify(cont));

  /* 2. Photos: tick, upload, cover */
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('heading', { name: 'Photos & documents' }).waitFor();
  check('Photos grouped (Completed shown)', /Completed/.test(await p.locator('main').innerText()));
  const before = (await snap(p)).reports.find((r) => r.jobId === JOB).selection.photoIds.length;
  await p.locator('input[type=file]').first().setInputFiles({ name: 'balustrade.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await p.getByRole('button', { name: /^Upload 1 file/ }).click();
  await p.getByText(/added and ticked/).waitFor({ timeout: 30000 });
  await saved(p);
  const afterUp = (await snap(p)).reports.find((r) => r.jobId === JOB).selection.photoIds.length;
  check('Uploaded photo is added and ticked', afterUp === before + 1, `${before} → ${afterUp}`);
  const makeCover = p.getByRole('button', { name: 'Make cover' }).first();
  if (await makeCover.count()) {
    await makeCover.click();
    await saved(p);
  }
  check('A cover photo is marked', (await p.getByText('Cover photo').count()) >= 1);
  await shot(p, 'phone-2-photos');

  /* 3. Your report: Bob writes it (built-in engine here), then edit */
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('button', { name: 'Let Bob write my report' }).click();
  await p.getByLabel(/text$/).first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(800);
  const overview = p.getByLabel('Overview text');
  check('Bob fills in the report', (await overview.inputValue()).length > 10 || (await p.getByLabel(/Work completed point/).count()) > 0);
  await overview.fill('We replaced the staircase with solid oak treads and fitted a frameless glass balustrade.');
  await p.getByRole('button', { name: 'Add aftercare advice' }).click();
  check('Optional sections stay tucked away until added', await p.getByLabel('Aftercare point 1').count().then(() => true));
  check('Rewrite with Bob offered per section', (await p.getByRole('button', { name: 'Ask Bob to change this' }).count()) >= 2);
  await saved(p);
  await shot(p, 'phone-3-report');

  /* Save & exit, then resume exactly here */
  await p.getByRole('button', { name: 'Save & exit' }).click();
  await p.waitForURL(`**/jobs/${JOB}?tab=handover`, { timeout: 30000 });
  await p.getByText('Customer handover').waitFor();
  check('Job page now says In progress', /In progress/.test(await p.locator('#job-tabpanel').innerText()));
  await p.locator('#job-tabpanel').getByRole('link', { name: /Continue handover/ }).click();
  await p.getByRole('heading', { name: 'Your report' }).waitFor({ timeout: 60000 });
  check('Resumes on the same step with the edited text', /Step 3 of 5/.test(await p.locator('main').innerText()) && /solid oak treads/.test(await p.getByLabel('Overview text').inputValue()));

  /* 4. Costs */
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('heading', { name: 'Costs' }).waitFor();
  const sw = p.getByRole('switch', { name: /Include financial summary/ });
  if (!(await sw.isChecked())) await p.getByText('Include financial summary in customer report').click();
  await saved(p);
  const costText = await p.locator('main').innerText();
  check('Costs filled in: agreed price, payments, balance', /Agreed price/.test(costText) && /Payments received/.test(costText) && /(Left to pay|Paid in full)/.test(costText));
  const figures = await p.locator('main table').innerText();
  check('No internal costs or margins in the figures', !/margin|profit|supplier|labour|expense|bill/i.test(figures), figures.replace(/\s+/g, ' ').slice(0, 120));
  await shot(p, 'phone-4-costs');

  /* 5. Review & finish */
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('heading', { name: 'Review & finish' }).waitFor();
  check('PDF preview shown', (await p.locator('iframe[title^="Preview"]').count()) === 1);
  for (const n of ['Download PDF', 'Download full handover pack', 'Edit report']) check(`Action: ${n}`, await p.getByRole('button', { name: n }).isVisible());
  const prev = await p.evaluate(async (src) => { const r = await fetch(src); return { status: r.status, type: r.headers.get('content-type') }; }, await p.locator('iframe[title^="Preview"]').getAttribute('src'));
  check('Preview is a real PDF', prev.status === 200 && /pdf/.test(prev.type || ''), JSON.stringify(prev));
  await shot(p, 'phone-5-review');
  let dl = p.waitForEvent('download', { timeout: 60000, predicate: (x) => /Handover v\d+\.pdf$/.test(x.suggestedFilename()) });
  await p.getByRole('button', { name: 'Download PDF' }).click();
  const pdf = await dl;
  check('Download PDF gives a Ninety3 PDF (version 1)', /Ninety3 .* Handover v1\.pdf$/.test(pdf.suggestedFilename()), pdf.suggestedFilename());
  dl = p.waitForEvent('download', { timeout: 60000, predicate: (x) => /\.zip$/.test(x.suggestedFilename()) });
  await p.getByRole('button', { name: 'Download full handover pack' }).click();
  const zip = await dl;
  check('Download full handover pack gives a ZIP', /\.zip$/.test(zip.suggestedFilename()), zip.suggestedFilename());
  const s1 = await snap(p);
  const pack = s1.handovers.filter((h) => h.jobId === JOB)[0];
  check('Pack starts with the report PDF, then the chosen photos', pack && /Handover v1\.pdf$/.test(pack.items[0].filename) && pack.items.length >= 2, pack ? pack.items.map((i) => i.filename).join(', ') : 'none');
  check('No new PDF version for the pack (report unchanged)', s1.reportVersions.filter((v) => v.jobId === JOB).length === 1);
  check('Send to customer only appears once the handover is finished', !(await p.getByRole('button', { name: 'Send to customer' }).count()));
  /* Finish handover → Completed */
  check('Before finishing, the main button is Finish handover', await p.getByRole('button', { name: 'Finish handover' }).isVisible());
  await p.getByRole('button', { name: 'Finish handover' }).click();
  await p.getByRole('status').filter({ hasText: 'Completed' }).first().waitFor({ timeout: 30000 });
  const banner = await p.getByRole('status').filter({ hasText: 'Completed' }).first().innerText();
  check('Completed banner shows the date and who finished it', /Completed[\s\S]*\d{4} by Luke/.test(banner) && /version 1/.test(banner), banner.replace(/\s+/g, ' ').slice(0, 90));
  check('Finishing reused the downloaded PDF (still one version)', (await snap(p)).reportVersions.filter((v) => v.jobId === JOB).length === 1);
  check('Completed and sent are separate: Send to customer is the next step', await p.getByRole('button', { name: 'Send to customer' }).isVisible());
  await shot(p, 'phone-7-completed');
  await p.getByRole('button', { name: 'Back to the job' }).click();
  await p.waitForURL(`**/jobs/${JOB}?tab=handover`);
  const status = p.getByTestId('handover-status');
  await status.waitFor();
  check('Job page: green Completed badge', (await status.innerText()) === 'Completed' && /emerald/.test(await status.getAttribute('class')));
  const panel = await p.locator('#job-tabpanel').innerText();
  check('Job page: completion date and who completed it', /Completed\s+\d{1,2} \w+ \d{4} by Luke/.test(panel), panel.replace(/\s+/g, ' ').slice(0, 120));
  check('Job page: primary button is View handover', await p.locator('#job-tabpanel').getByRole('link', { name: /View handover/ }).isVisible());
  for (const n of ['Download PDF', 'Download handover pack']) check(`Job page: ${n}`, await p.locator('#job-tabpanel').getByRole('button', { name: n }).isVisible());
  check('Job page: Edit report', await p.locator('#job-tabpanel').getByRole('link', { name: /Edit report/ }).isVisible());
  await shot(p, 'phone-8-job-completed');
  dl = p.waitForEvent('download', { timeout: 60000, predicate: (x) => /Handover v1\.pdf$/.test(x.suggestedFilename()) });
  await p.locator('#job-tabpanel').getByRole('button', { name: 'Download PDF' }).click();
  check('Job page Download PDF gives the published version', !!(await dl));
  dl = p.waitForEvent('download', { timeout: 60000, predicate: (x) => /\.zip$/.test(x.suggestedFilename()) });
  await p.locator('#job-tabpanel').getByRole('button', { name: 'Download handover pack' }).click();
  check('Job page Download handover pack gives a ZIP', !!(await dl));
  await p.reload();
  await p.getByTestId('handover-status').waitFor({ timeout: 60000 });
  check('Completed status survives a refresh', (await p.getByTestId('handover-status').innerText()) === 'Completed');

  /* Ryan, in his own session, sees the same status and marks it sent */
  const r = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const ryan = await r.newPage();
  await ryan.goto(BASE + '/login');
  await ryan.evaluate(async ([email, password]) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }), [process.env.RYAN_EMAIL || 'office@ninety3.example', process.env.RYAN_PASSWORD || 'bob-demo']);
  await ryan.goto(BASE + `/jobs/${JOB}?tab=handover`);
  await ryan.getByTestId('handover-status').waitFor({ timeout: 60000 });
  check("Ryan's account shows the same Completed status and Luke's name", (await ryan.getByTestId('handover-status').innerText()) === 'Completed' && /by Luke/.test(await ryan.locator('#job-tabpanel').innerText()));
  // No mailbox in the demo: Ryan saves the thank-you draft, sends it from his own email, and records it.
  await ryan.locator('#job-tabpanel').getByRole('button', { name: 'Send to customer' }).click();
  const rbox = ryan.getByRole('region', { name: 'Send to customer' });
  await rbox.getByRole('button', { name: 'Save draft' }).click();
  await rbox.getByRole('button', { name: "I've sent it myself" }).click();
  await ryan.getByText(/approved by Ryan, sent from their own email/).waitFor({ timeout: 15000 });
  check('Ryan sends it: "Sent to customer", approved by Ryan', (await ryan.getByTestId('handover-status').innerText()) === 'Sent to customer');
  await p.reload();
  await p.getByTestId('handover-status').waitFor({ timeout: 60000 });
  check("Luke sees Ryan's 'sent' after refresh", (await p.getByTestId('handover-status').innerText()) === 'Sent to customer');

  /* Edit after finishing → unpublished changes → finish again → version 2, version 1 kept */
  await p.locator('#job-tabpanel').getByRole('link', { name: /Edit report/ }).click();
  await p.getByRole('heading', { name: 'Your report' }).waitFor({ timeout: 60000 });
  await p.getByLabel('Overview text').fill('We replaced the staircase with solid oak treads, oiled them, and fitted a frameless glass balustrade.');
  await saved(p);
  await p.getByRole('button', { name: 'Save & exit' }).click();
  await p.waitForURL(`**/jobs/${JOB}?tab=handover`);
  await p.getByTestId('handover-status').waitFor();
  const changed = await p.locator('#job-tabpanel').innerText();
  check('Job page: Completed with "Unpublished changes" after an edit', /Unpublished changes/.test(changed) && /aren.t in the PDF yet/.test(changed));
  await shot(p, 'phone-9-unpublished');
  await p.locator('#job-tabpanel').getByRole('link', { name: /View handover/ }).click();
  await p.getByRole('heading', { name: 'Review & finish' }).waitFor({ timeout: 60000 });
  check('Handover shows the unpublished-changes warning', /Unpublished changes/.test(await p.locator('main').innerText()));
  await p.getByRole('button', { name: 'Finish again' }).click();
  await p.getByText(/version 2/).first().waitFor({ timeout: 30000 });
  const vs = (await snap(p)).reportVersions.filter((v) => v.jobId === JOB).map((v) => v.version).sort();
  check('Finishing again publishes version 2 and keeps version 1', JSON.stringify(vs) === '[1,2]', JSON.stringify(vs));
  await p.getByRole('button', { name: 'Back to the job' }).click();
  await p.getByTestId('handover-status').waitFor();
  check('Back to Completed (version 2 not yet marked as sent)', (await p.getByTestId('handover-status').innerText()) === 'Completed' && /version 2/.test(await p.locator('#job-tabpanel').innerText()));
  check('No page errors on the phone', errors.length === 0, errors.slice(0, 2).join(' | '));

  /* Desktop: the demo garden room (finished report) and the money badge */
  const d = await signIn(b, { viewport: { width: 1440, height: 900 } });
  await d.goto(BASE + '/jobs/n93_job_gardenroom_lingfield');
  await d.getByRole('heading', { name: 'Garden room' }).waitFor({ timeout: 60000 });
  const header = await d.locator('main header').first().innerText();
  check('Garden room: no "Paid in full" while £650 is outstanding', !/Paid in full/.test(header), header.replace(/\s+/g, ' ').slice(0, 80));
  await d.goto(BASE + '/jobs/n93_job_gardenroom_lingfield?tab=financials');
  check('Garden room financials show £650 left to pay', await d.getByText('£650 left to pay').first().waitFor({ timeout: 20000 }).then(() => true, () => false));
  await d.goto(BASE + '/jobs/n93_job_gardenroom_lingfield?tab=handover');
  await d.getByTestId('handover-status').waitFor({ timeout: 60000 });
  check('Desktop: the demo garden room handover shows Completed', (await d.getByTestId('handover-status').innerText()) === 'Completed');
  await shot(d, 'desktop-0-job-completed');
  await d.getByRole('link', { name: /View handover/ }).first().click();
  await d.getByRole('heading', { name: 'Review & finish' }).waitFor({ timeout: 60000 });
  check('Desktop: a finished handover opens on Review & finish with the Completed banner', /Completed[\s\S]*by Luke/.test(await d.getByRole('status').filter({ hasText: 'Completed' }).first().innerText()));
  await d.getByRole('button', { name: 'Step 1: Job details' }).click();
  await d.getByRole('heading', { name: 'Job details' }).waitFor();
  await shot(d, 'desktop-1-details');
  await d.getByRole('button', { name: 'Step 4: Costs' }).click();
  await d.getByRole('heading', { name: 'Costs' }).waitFor();
  check('Garden room costs: £650 left to pay (agreed price + cedar step − payments)', /Left to pay[\s\S]{0,80}£650/.test(await d.locator('main table').innerText()));
  await shot(d, 'desktop-4-costs');
  await d.getByRole('button', { name: 'Step 5: Review & finish' }).click();
  await d.getByRole('heading', { name: 'Review & finish' }).waitFor();
  await d.waitForTimeout(2500);
  await shot(d, 'desktop-5-review');
  check('Desktop: earlier exported version listed', /Previous versions/.test(await d.locator('main').innerText()));

  await b.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
