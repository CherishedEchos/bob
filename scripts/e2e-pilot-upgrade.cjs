/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Pilot upgrade flows (fictional data, local dev server only): node scripts/e2e-pilot-upgrade.cjs
// Screenshots go to $OUT (default /tmp). Resets the sample workspace first.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (flow, name, ok, extra = '') => { results.push({ flow, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${flow}] ${name}${extra ? ' — ' + extra : ''}`); };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true };
const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, acceptDownloads: true };
const london = (n) => { const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ops = (page, op, args) => page.evaluate(async ([op, args]) => (await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) })).json(), [op, args]);
const snap = (page) => page.evaluate(async () => (await fetch('/api/data')).json());
const get = (page, p) => page.evaluate(async (p) => { const r = await fetch(p); return { status: r.status, text: r.status < 400 ? (r.headers.get('content-type') || '').startsWith('text') ? await r.text() : '' : await r.text() }; }, p);
const login = async (ctx, email) => { const p = await ctx.newPage(); await p.goto(BASE + '/login'); const s = await p.evaluate(async (email) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'bob-demo' }) })).status, email); if (s !== 200) throw new Error(`login ${email} ${s}`); return p; };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });

// A small real JPEG made by the browser so uploads go through the real file input.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');

function unzipNames(buf) {
  const names = [];
  let p = 0;
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18), n = buf.readUInt16LE(p + 26), x = buf.readUInt16LE(p + 28);
    names.push(buf.subarray(p + 30, p + 30 + n).toString('utf8'));
    p += 30 + n + x + size;
  }
  return names;
}
void zlib;

(async () => {
  const b = await chromium.launch();
  const errors = [];

  /* 1. Root opens Ask Bob; direct links open their own screen; signed-out root goes to sign-in */
  const anon = await b.newContext(DESK);
  const ap = await anon.newPage();
  await ap.goto(BASE + '/');
  check(1, 'Signed out: root goes to sign-in', ap.url().endsWith('/login'));
  await anon.close();

  const lc = await b.newContext(DESK);
  const luke = await login(lc, 'owner@ninety3.example');
  luke.on('pageerror', (e) => errors.push('luke: ' + e.message));
  await luke.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await luke.goto(BASE + '/');
  await luke.waitForURL('**/week');
  check(1, 'Root opens the Diary after login', new URL(luke.url()).pathname === '/week');
  await luke.goto(BASE + '/assistant');
  await luke.getByRole('heading', { name: 'How can I help?' }).waitFor();
  check(1, 'Greets Luke by first name', /Good (morning|afternoon|evening), Luke/.test(await luke.locator('main').innerText()));
  // Simplified home: greeting, mic, text box and three suggestions — no shortcut cards.
  check(1, 'Ask Bob home has no shortcut cards', (await luke.getByRole('navigation', { name: 'Shortcuts' }).count()) === 0);
  check(1, 'Ask Bob home offers three suggestions', (await luke.locator('main ul li button').count()) === 3);
  check(1, 'Typing and speaking are both offered', (await luke.getByPlaceholder(/Type to Bob/).isVisible()) && (await luke.getByRole('button', { name: /talk to Bob|Tap to talk|Talk to Bob/ }).first().isVisible()));
  await shot(luke, 'desk-1440-ask-bob');
  await luke.goto(BASE + '/enquiries?tab=quote');
  check(1, 'Jobs to quote opens the To quote view', await luke.getByRole('tab', { name: /To quote/, selected: true }).first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  await luke.goto(BASE + '/week');
  check(1, 'Direct link /week opens the Diary', await luke.getByRole('heading', { name: 'Diary', level: 1 }).waitFor().then(() => true, () => false));
  const diaryText = await luke.locator('main').innerText();
  check(1, 'Diary has no summary panels or drag tip', !/Needs attention|Not scheduled yet|Needs someone|Tip: drag/.test(diaryText));
  check(1, 'Diary shows leave (approved and pending)', /Holiday|Unavailable/.test(diaryText));
  await shot(luke, 'desk-1440-diary', true);

  /* 2. Luke and Ryan see and update the same workspace */
  const rc = await b.newContext(LAPTOP);
  const ryan = await login(rc, 'office@ninety3.example');
  ryan.on('pageerror', (e) => errors.push('ryan: ' + e.message));
  const s0 = await snap(ryan);
  const created = await ops(ryan, 'createJob', { input: { customerId: s0.customers[0].id, title: 'Porch canopy', location: 'Oxted', kind: 'general', quotedValue: 2400, status: 'quoted', siteAddress: '3 Station Road, Oxted' } });
  check(2, 'Ryan (admin) creates a job', created.ok, created.error);
  const jobId = created.value?.id;
  check(2, 'Luke (owner) sees the same job', (await snap(luke)).jobs.some((j) => j.id === jobId));

  /* 3. Schedule, move and reassign */
  const tomorrow = london(1);
  const bk = await ops(luke, 'saveBooking', { input: { jobId, date: tomorrow, allDay: false, startTime: '08:00', endTime: '12:00', personIds: [] } });
  check(3, 'Luke schedules the job (unassigned)', bk.ok, bk.error);
  const moved = await ops(ryan, 'saveBooking', { input: { id: bk.value.id, jobId, date: london(30), allDay: false, startTime: '09:00', endTime: '13:00', personIds: ['n93_per_ellie'] } });
  check(3, 'Ryan moves and assigns it', moved.ok, moved.error);
  const after = (await snap(luke)).bookings.find((x) => x.id === bk.value.id);
  check(3, 'Luke sees the moved, reassigned booking', after && after.date === london(30) && after.personIds.includes('n93_per_ellie'));

  /* 4. Job page: Files & photos, drawing revision, failed upload + retry */
  await luke.goto(`${BASE}/jobs/${jobId}?tab=documents`);
  await luke.getByRole('tab', { name: /Documents/, selected: true }).waitFor();
  const fileInput = luke.locator('input[type=file][multiple]').first();
  let failOnce = true;
  await luke.route('**/api/files', async (route) => {
    if (failOnce && route.request().method() === 'POST') { failOnce = false; return route.abort('failed'); }
    return route.continue();
  });
  await fileInput.setInputFiles([{ name: 'Canopy plan - Rev A.pdf', mimeType: 'application/pdf', buffer: PDF }, { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
  const dlg = luke.getByRole('dialog', { name: /Add 2 files/ });
  await dlg.waitFor();
  await dlg.getByLabel(/What is Canopy plan/).selectOption('drawing');
  await dlg.getByLabel('Drawing revision (optional)').fill('Rev A');
  await dlg.getByRole('button', { name: /Upload 2 files/ }).click();
  const retry = dlg.getByRole('button', { name: 'Retry' });
  const sawRetry = await retry.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check(4, 'A failed upload shows a per-file error with Retry', sawRetry && /interrupted/i.test(await dlg.innerText()));
  if (sawRetry) await retry.click();
  await dlg.getByRole('button', { name: 'Done' }).waitFor({ timeout: 10000 });
  check(4, 'Both files saved after retry', /2 saved/.test(await dlg.innerText()));
  await dlg.getByRole('button', { name: 'Done' }).click();
  await luke.unroute('**/api/files');
  const filesAfter = (await snap(luke)).files.filter((f) => f.jobId === jobId);
  check(4, 'No duplicates after the retry', filesAfter.length === 2, `${filesAfter.length} files`);
  await luke.reload();
  check(4, 'Uploads survive a refresh', (await luke.locator('main').innerText()).includes('Canopy plan - Rev A.pdf'));
  // Drawing revision through the UI
  await luke.getByRole('button', { name: /Actions for Canopy plan/ }).click();
  await luke.getByRole('menuitem', { name: 'Add new revision' }).click();
  await luke.locator('input[type=file]').last().setInputFiles({ name: 'Canopy plan - Rev B.pdf', mimeType: 'application/pdf', buffer: PDF });
  const rdlg = luke.getByRole('dialog', { name: /New revision of/ });
  await rdlg.getByLabel('Drawing revision (optional)').fill('Rev B');
  await rdlg.getByRole('button', { name: /Upload 1 file/ }).click();
  await rdlg.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });
  await luke.waitForTimeout(500);
  const main4 = await luke.locator('main').innerText();
  check(4, 'Revision history kept; latest marked current', /Rev B/.test(main4) && /Current · 2 versions/.test(main4) && /Show 1 earlier revision/.test(main4));
  await shot(luke, 'desk-1440-files-photos');

  /* 5. Handover: exactly the selected files */
  const crawley = 'n93_job_kitchen_crawley';
  await luke.goto(`${BASE}/jobs/${crawley}/handover`);
  await luke.getByRole('button', { name: 'Start the handover' }).click();
  await luke.getByRole('button', { name: 'Step 2: Photos & documents' }).click();
  await luke.getByRole('heading', { name: 'Photos & documents' }).waitFor();
  // Only the "Base units in" photo and the Rev B drawing go to the customer.
  for (const name of await luke.getByRole('button', { name: /^Remove photo: / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))) {
    if (!/Base units in/.test(name)) await luke.getByRole('button', { name, exact: true }).click();
  }
  await luke.getByRole('checkbox', { name: /Kitchen layout.*Rev B/ }).check();
  await luke.getByText('Saved', { exact: true }).waitFor({ timeout: 20000 });
  await luke.getByRole('button', { name: 'Step 5: Review & finish' }).click();
  await luke.getByRole('heading', { name: 'Review & finish' }).waitFor();
  const preview = await luke.locator('main').innerText();
  check(5, 'Finish step says what the pack holds', /this report, the 1 photo you chose at full size and 1 document/.test(preview));
  check(5, 'Finish step says what is NOT included', /Not included: internal notes, site access details/.test(preview));
  const [download] = await Promise.all([luke.waitForEvent('download', { predicate: (x) => /\.zip$/.test(x.suggestedFilename()) }), luke.getByRole('button', { name: 'Download full handover pack' }).click()]);
  const zipPath = path.join(OUT, 'handover.zip');
  await download.saveAs(zipPath);
  const names = unzipNames(fs.readFileSync(zipPath));
  check(5, 'ZIP holds the report PDF, the 2 selected files and the index (+ logo)', names.filter((n) => !/index\.html|logo\./.test(n)).length === 3 && names.some((n) => /Handover v1\.pdf$/.test(n)) && names.includes('Start here - index.html'), names.join(', '));
  check(5, 'No private office file in the ZIP', !names.some((n) => /Appliance spec|IMG_4101/.test(n)));
  await shot(luke, 'desk-1440-handover');

  /* 6. Materials: added in a job, updated in the company list */
  const mat = await ops(ryan, 'saveMaterial', { input: { jobId, item: 'Cedar shingles', quantity: '3', unit: 'packs', status: 'to_order', neededBy: london(5) } });
  check(6, 'Material added within the job', mat.ok, mat.error);
  await luke.goto(BASE + '/materials');
  check(6, 'It appears on the company Materials page', await luke.getByText('Cedar shingles').first().waitFor().then(() => true, () => false));
  const st = await ops(luke, 'setMaterialStatus', { id: mat.value.id, status: 'ordered' });
  check(6, 'Status updated from the company list', st.ok && (await snap(ryan)).materials.find((m) => m.id === mat.value.id).status === 'ordered');
  await shot(luke, 'desk-1440-materials', true);

  /* 7. Enquiry → won → job without duplicates, then schedule */
  const s1 = await snap(luke);
  const enq = s1.enquiries.find((e) => e.status === 'quote_required') || s1.enquiries.find((e) => !e.jobId && e.status !== 'lost');
  const w1 = await ops(luke, 'convertToJob', { enquiryId: enq.id });
  const w2 = await ops(ryan, 'convertToJob', { enquiryId: enq.id });
  check(7, 'Won enquiry becomes one job (retry returns the same job)', w1.ok && w2.ok && w1.value.id === w2.value.id && w2.value.existed === true);
  check(7, 'Only one job for that enquiry', (await snap(luke)).jobs.filter((j) => j.enquiryId === enq.id).length === 1);
  const wb = await ops(luke, 'saveBooking', { input: { jobId: w1.value.id, date: london(8), allDay: true, personIds: ['n93_per_liam'] } });
  check(7, 'The won job can be scheduled', wb.ok, wb.error);

  /* 8. Leave: request, approve, clash warning, cancel */
  const inv = await ops(luke, 'createInvite', { personId: 'n93_per_callum', email: 'callum@ninety3.example' });
  const token = inv.value.path.split('/').pop();
  const cc = await b.newContext(PHONE);
  const cp = await cc.newPage();
  await cp.goto(BASE + '/login');
  const acc = await cp.evaluate(async (t) => (await fetch(`/api/invite/${t}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'callum-demo-1' }) })).status, token);
  check(8, 'Invited employee accepts', acc === 200);
  const start = london(20);
  const req = await cp.evaluate(async (start) => (await fetch('/api/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { kind: 'holiday', startDate: start, endDate: start } }) })).json(), start);
  check(8, 'Employee requests leave from My work', req.ok && req.value.status === 'pending');
  const appr = await ops(ryan, 'decideAbsence', { id: req.value.id, decision: 'approve' });
  check(8, 'Ryan approves it', appr.ok && appr.value.status === 'approved');
  const clash = await ops(luke, 'saveBooking', { input: { jobId, date: start, allDay: true, personIds: ['n93_per_callum'] } });
  check(8, 'Booking during approved leave is flagged', !clash.ok && clash.clashes?.some((c) => c.kind === 'absence'));
  const can = await cp.evaluate(async (id) => (await fetch('/api/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', id }) })).status, req.value.id);
  check(8, 'Employee cancels it', can === 200);
  const clash2 = await ops(luke, 'saveBooking', { input: { jobId, date: start, allDay: true, personIds: ['n93_per_callum'] } });
  check(8, 'After cancelling, the booking saves', clash2.ok, clash2.error);
  await cc.close();
  await luke.goto(BASE + '/team?view=holidays');
  await shot(luke, 'desk-1440-holidays', true);

  /* 9. Worker on a phone: next job, directions, complete a task, upload a progress photo */
  const sc = await b.newContext(PHONE);
  const sam = await login(sc, 'sam@so-plastering.example');
  sam.on('pageerror', (e) => errors.push('sam: ' + e.message));
  await sam.goto(BASE + '/');
  await sam.waitForURL('**/my-work');
  await sam.getByRole('heading', { name: 'My work' }).waitFor();
  await sam.getByText('Single-storey extension').first().waitFor().catch(() => {});
  const mw = await sam.locator('main').innerText();
  check(9, 'Invited worker lands on My work with their next job', /Single-storey extension/.test(mw));
  check(9, 'Directions are one tap away', await sam.getByRole('link', { name: /Open in maps/ }).first().isVisible());
  await shot(sam, 'phone-390-my-work');
  await sam.getByRole('button', { name: /Complete: Check angle beads/ }).click();
  await sam.getByText('Task done').waitFor();
  check(9, 'Worker completes their task', !(await sam.locator('main').innerText()).includes('Check angle beads'));
  check(9, 'Completion shows for the office too', (await snap(luke)).tasks.find((t) => t.id === 'n93_task_beads').done === true);
  await sam.locator('input[type=file][multiple]').first().setInputFiles({ name: 'skim-coat.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  const sdlg = sam.getByRole('dialog', { name: /Add 1 file/ });
  await sdlg.getByRole('button', { name: /Upload 1 file/ }).click();
  await sdlg.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });
  await sam.reload();
  await sam.getByRole('heading', { name: 'My work' }).waitFor();
  await sam.waitForTimeout(800);
  const samFiles = await sam.evaluate(async () => (await (await fetch('/api/my-work')).json()).value.files.map((f) => f.filename));
  check(9, 'Progress photo uploaded from the phone survives refresh', samFiles.includes('skim-coat.jpg'));
  check(9, 'Office sees the worker photo on the job', (await snap(luke)).files.some((f) => f.filename === 'skim-coat.jpg' && f.uploadedBy === 'Sam Okoro'));
  await shot(sam, 'phone-390-my-work-files', true);

  /* 10. Direct requests: workers and other companies get nothing they shouldn't */
  const office = (await snap(luke)).files.find((f) => f.visibility === 'office');
  const otherJobFile = (await snap(luke)).files.find((f) => f.jobId === crawley);
  check(10, 'Worker: no company snapshot', (await get(sam, '/api/data')).status === 403);
  check(10, 'Worker: office-only file is 404', (await get(sam, `/api/files/${office.id}`)).status === 404);
  check(10, 'Worker: file on a job they are not booked on is 404', (await get(sam, `/api/files/${otherJobFile.id}`)).status === 404);
  check(10, 'Worker: no handover download', (await get(sam, `/api/handovers/n93_ho_gardenroom`)).status === 403);
  const xc = await b.newContext(DESK);
  const alex = await login(xc, 'alex@ridgeway.example');
  check(10, 'Other company: Ninety3 file is 404', (await get(alex, `/api/files/${otherJobFile.id}`)).status === 404);
  check(10, 'Other company: Ninety3 handover is 404', (await get(alex, `/api/handovers/n93_ho_gardenroom`)).status === 404);
  const del = await alex.evaluate(async (id) => (await fetch(`/api/files/${id}`, { method: 'DELETE' })).status, otherJobFile.id);
  check(10, 'Other company: cannot delete Ninety3 file', del === 404);
  await xc.close();

  /* 11. Calendar feeds follow booking changes and revocation */
  const feed = await ops(luke, 'createFeed', { scope: 'company' });
  const ics1 = await get(luke, feed.value.path);
  check(11, 'Company feed includes the booking with a stable UID', ics1.status === 200 && ics1.text.includes(bk.value.id));
  await ops(luke, 'saveBooking', { input: { id: bk.value.id, jobId, date: london(3), allDay: true, personIds: ['n93_per_ellie'] } });
  const ics2 = await get(luke, feed.value.path);
  check(11, 'Moved booking updates the same event', ics2.text.includes(bk.value.id) && ics2.text.includes(london(3).replace(/-/g, '')));
  check(11, 'No entry codes or private notes in the feed', !/4471|PRIVATE/.test(ics2.text));
  await ops(luke, 'deleteBooking', { id: bk.value.id });
  check(11, 'Cancelled booking leaves the feed', !(await get(luke, feed.value.path)).text.includes(bk.value.id));
  await ops(luke, 'revokeFeed', { id: feed.value.id });
  check(11, 'Revoked feed link stops working', (await get(luke, feed.value.path)).status === 404);

  /* 12. Screenshots at other sizes */
  await ryan.goto(BASE + '/week');
  await ryan.getByRole('heading', { name: 'Diary', level: 1 }).waitFor();
  await shot(ryan, 'laptop-1280-diary', true);
  await ryan.goto(`${BASE}/jobs/${crawley}`);
  await ryan.getByRole('heading', { name: 'Kitchen renovation' }).waitFor();
  await shot(ryan, 'laptop-1280-job-profile');
  await ryan.goto(BASE + '/jobs');
  await shot(ryan, 'laptop-1280-jobs', true);
  await luke.goto(`${BASE}/jobs/${crawley}`);
  await luke.getByRole('heading', { name: 'Kitchen renovation' }).waitFor();
  await shot(luke, 'desk-1440-job-profile', true);
  const pc = await b.newContext(PHONE);
  const lp = await login(pc, 'owner@ninety3.example');
  for (const [p, n] of [['/', 'phone-390-ask-bob'], ['/week', 'phone-390-diary'], [`/jobs/${crawley}?tab=files`, 'phone-390-files'], ['/jobs', 'phone-390-jobs'], ['/materials', 'phone-390-materials'], ['/team?view=holidays', 'phone-390-holidays']]) {
    await lp.goto(BASE + p, { waitUntil: 'networkidle' });
    await lp.waitForTimeout(600);
    const overflow = await lp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll('main')].some((m) => m.scrollWidth > m.clientWidth + 1));
    check(12, `No horizontal scroll at 390px: ${p}`, !overflow);
    await shot(lp, n);
  }

  check(0, 'No uncaught page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
