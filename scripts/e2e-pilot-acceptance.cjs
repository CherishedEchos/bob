/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Ninety3 live-pilot acceptance scenario, end to end, on a STAGING-LIKE server:
//   npx next build && OUT=docs/screenshots/pilot node scripts/e2e-pilot-acceptance.cjs
// - Starts its own production server (`next start`) on a fresh database file, with a live
//   workspace provisioned from a workspaces file (fictional Luke and Ryan).
// - Email goes to a LOCAL STAND-IN for the email provider (nothing leaves this machine).
// - Restarts the server on the same database to prove accounts, jobs and files survive,
//   then backs up and restores the database with scripts/backup-db.cjs / restore-db.cjs.
// Steps follow the brief: invite → accept on phone → move booking → other sub blocked →
// pricing → job → £450 extra → time-off history → rough estimate → restart → revoke.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = process.env.OUT || '/tmp';
const PORT = Number(process.env.PORT || 3150);
const BASE = `http://localhost:${PORT}`;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-staging-'));
const DB = path.join(WORK, 'bob.sqlite');
const LOG = path.join(WORK, 'server.log');
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DESK = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const PASS = { luke: 'luke-staging-pass', ryan: 'ryan-staging-pass', sam: 'sam-staging-pass', dan: 'dan-staging-pass' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(6000, 1)]);

/* ---------------- stand-in email service (Resend-compatible) ---------------- */
const mail = [];
let mailFails = false;
const mailServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (mailFails) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ message: 'Service unavailable (stand-in)' })); }
    mail.push(JSON.parse(body || '{}'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: `stub_${mail.length}` }));
  });
});
const linkIn = (m) => (m.text.match(/https?:\/\/\S+\/invite\/\S+/) || [])[0];

/* ---------------- the server ---------------- */
let server;
async function startServer(dbPath = DB) {
  fs.writeFileSync(path.join(WORK, 'workspaces.json'), JSON.stringify([{ slug: 'ninety3-staging', name: 'Ninety3 Carpentry and Build Ltd', shortName: 'Ninety3', logoUrl: '/brand/ninety3-logo.png', wordmark: { onDark: '/brand/ninety3-wordmark-white.svg', onLight: '/brand/ninety3-wordmark.svg' }, timeZone: 'Europe/London', users: [{ name: 'Luke', role: 'owner', email: 'luke@ninety3-staging.example' }, { name: 'Ryan', role: 'office', email: 'ryan@ninety3-staging.example' }] }]));
  server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    env: {
      ...process.env, NODE_ENV: 'production', BOB_INSECURE_COOKIES: 'true',
      BOB_DB_PATH: dbPath, BOB_PERSISTENT_STORAGE: 'true', BOB_WORKSPACES_FILE: path.join(WORK, 'workspaces.json'), BOB_PUBLIC_URL: BASE,
      BOB_MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'stand-in', BOB_MAIL_FROM: 'Bob <invites@bob.test>', RESEND_API_URL: `http://localhost:${mailServer.address().port}/emails`,
      BOB_MAIL_ALLOWED_RECIPIENTS: '@ninety3-staging.example,@subs-staging.example', ANTHROPIC_API_KEY: '', BOB_SHOW_DEMO_LOGINS: 'false',
    },
    stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
    detached: true,
  });
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${BASE}/login`); if (r.ok) return; } catch { /* starting */ }
    await sleep(500);
  }
  throw new Error('server did not start: ' + fs.readFileSync(LOG, 'utf8').slice(-2000));
}
async function stopServer() {
  if (!server) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  await sleep(1500);
  server = null;
}

async function ctxFor(b, opts) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('bob.onboarding.done', '1'); localStorage.setItem('bob.tips.off', '1'); } catch { /* */ } });
  return ctx;
}
async function login(b, email, password, opts = DESK) {
  const ctx = await ctxFor(b, opts);
  const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  const s = await p.evaluate(async ([email, password]) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).status, [email, password]);
  if (s !== 200) throw new Error(`login ${email}: ${s}`);
  return p;
}
const op = (p, name, args) => p.evaluate(async ([name, args]) => { const r = await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: name, args }) }); return { status: r.status, body: await r.json() }; }, [name, args]);
const getJson = (p, url) => p.evaluate(async (url) => { const r = await fetch(url); let body = null; try { body = await r.json(); } catch { /* not json */ } return { status: r.status, body }; }, url);
const addDays = (k, n) => { const d = new Date(`${k}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const nextFriday = () => { let d = addDays(todayKey(), 1); while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 5) d = addDays(d, 1); return d; };
const shot = (p, name, full = true) => p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => mailServer.listen(0, r));
  await startServer();
  const b = await chromium.launch();
  const errors = [];

  /* ---- 0. Luke and Ryan accept their provisioning invites (live workspace, empty) ---- */
  // The database (and provisioning) starts on the first request that needs it.
  await fetch(`${BASE}/api/invite/not-a-real-token-but-long-enough`);
  await sleep(500);
  const log = fs.readFileSync(LOG, 'utf8');
  const provLinks = [...log.matchAll(/invite link for (Luke|Ryan) .*?: (https?:\/\/\S+)/g)].reduce((m, x) => ({ ...m, [x[1]]: x[2] }), {});
  check('Live workspace provisioned with invite links for Luke (owner) and Ryan (admin)', provLinks.Luke && provLinks.Ryan);
  for (const [who, pw] of [['Luke', PASS.luke], ['Ryan', PASS.ryan]]) {
    const r = await fetch(`${BASE}/api/invite/${provLinks[who].split('/invite/')[1]}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ password: pw }) });
    check(`${who} sets up their own login`, r.ok, String(r.status));
  }
  const luke = await login(b, 'luke@ninety3-staging.example', PASS.luke);
  luke.on('pageerror', (e) => errors.push('luke: ' + e.message));
  const ryan = await login(b, 'ryan@ninety3-staging.example', PASS.ryan);
  ryan.on('pageerror', (e) => errors.push('ryan: ' + e.message));

  // Landing: the team diary.
  await luke.goto(BASE + '/');
  await luke.waitForURL('**/week');
  check('Owner lands on the team diary', await luke.getByRole('region', { name: 'Team schedule' }).waitFor({ timeout: 60000 }).then(() => true, () => false));
  check('Live workspace: no demo strip, no storage warning (declared persistent)', !(await luke.getByText('Demo workspace').count()) && !(await luke.getByText("Storage isn't permanent").count()));

  // Fictional work: the Oak Road kitchen, Sam (already on the crew) booked on Friday.
  const oak = (await op(luke, 'createJob', { input: { customerName: 'Sophie Fictional', customerPhone: '07700 900500', title: 'Oak Road kitchen', location: 'Copthorne', siteAddress: '12 Oak Road, Copthorne, RH10 3HQ', quotedValue: 18000, status: 'scheduled', sharedNotes: 'Dust sheets down in the hall every day.', accessNote: 'Side gate on the left.' } })).body.value;
  const garden = (await op(luke, 'createJob', { input: { customerName: 'Other Fictional', customerPhone: '07700 900501', title: 'Garden room', location: 'Lingfield', quotedValue: 9000, status: 'scheduled' } })).body.value;
  await op(luke, 'addJobNote', { id: oak.id, text: 'PRIVATE: margin tight on the oak — buy at trade.' });
  const sam = (await op(ryan, 'createPerson', { input: { name: 'Sam Fictional', kind: 'subcontractor', trade: 'Plasterer' } })).body.value;
  const dan = (await op(ryan, 'createPerson', { input: { name: 'Dan Fictional', kind: 'subcontractor', trade: 'Electrician' } })).body.value;
  const friday = nextFriday();
  const booking = (await op(ryan, 'saveBooking', { input: { jobId: oak.id, date: friday, startTime: '08:00', endTime: '16:00', personIds: [sam.id] } })).body.value;
  await op(ryan, 'saveBooking', { input: { jobId: garden.id, date: friday, startTime: '08:00', endTime: '16:00', personIds: [dan.id] } });
  // A shared drawing (crew can see) and an office-only costing on the Oak Road job.
  const upload = (p, fields, name, bytes, type) => p.evaluate(async ([fields, name, b64, type]) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set('file', new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type }));
    const r = await fetch('/api/files', { method: 'POST', body: fd });
    return { status: r.status, body: await r.json() };
  }, [fields, name, bytes.toString('base64'), type]);
  const drawing = (await upload(luke, { jobId: oak.id, category: 'drawing', clientRef: 'dr1' }, 'kitchen-plan.jpg', JPEG, 'image/jpeg')).body.value;
  const costing = (await upload(luke, { jobId: oak.id, category: 'other', visibility: 'office', clientRef: 'co1' }, 'costing.jpg', JPEG, 'image/jpeg')).body.value;

  /* ---- 1. Luke invites Sam from the crew list; Sam accepts on a phone ---- */
  await luke.goto(BASE + '/team');
  await luke.getByRole('button', { name: 'Invite someone' }).click();
  const sheet = luke.getByRole('dialog');
  await sheet.getByPlaceholder('e.g. Sam Okoro').fill('Sam');
  check('Invite someone offers Sam from the crew list', await sheet.getByRole('button', { name: /Invite Sam/ }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  await sheet.getByRole('button', { name: /Invite Sam/ }).click();
  await sheet.getByPlaceholder('name@example.com').fill('sam@subs-staging.example');
  await shot(luke, '01-invite-someone-1440', false);
  await sheet.getByRole('button', { name: 'Send invite' }).click();
  await sheet.getByText('Invite emailed to sam@subs-staging.example').waitFor({ timeout: 15000 });
  check('Invite emailed (stand-in email service received it)', mail.length === 1 && mail[0].to[0] === 'sam@subs-staging.example');
  check('Email names Ninety3 and the inviter', /Luke has invited you to Ninety3 Carpentry and Build Ltd on Bob/.test(mail[0].subject), mail[0].subject);
  await shot(luke, '02-invite-sent-1440', false);
  await luke.keyboard.press('Escape');
  await luke.reload();
  await luke.getByText('Sam Fictional').first().click();
  check('Team shows the invite as pending, sent by Luke, emailed', /Invite sent by Luke.*emailed/.test(await luke.getByTestId('invite-status').innerText().catch(() => '')));
  await luke.keyboard.press('Escape');

  const samCtx = await ctxFor(b, PHONE);
  const samPhone = await samCtx.newPage();
  samPhone.on('pageerror', (e) => errors.push('sam: ' + e.message));
  await samPhone.goto(linkIn(mail[0]));
  await samPhone.getByLabel('Choose a password').fill(PASS.sam);
  await shot(samPhone, '03-invite-accept-375', false);
  await samPhone.getByRole('button', { name: 'Accept and see my work' }).click();
  await samPhone.waitForURL('**/my-work', { timeout: 60000 });
  await samPhone.getByText('Oak Road kitchen').first().waitFor({ timeout: 30000 });
  const mw = await samPhone.locator('main').innerText();
  check('Sam lands on My work and sees his Friday booking (already assigned before the invite)', mw.includes('Oak Road kitchen') && /08:00/.test(mw), mw.slice(0, 160).replace(/\n/g, ' '));
  check('My work shows the site address and shared notes', mw.includes('12 Oak Road') && mw.includes('Dust sheets'));
  check('…and none of the private note, price or other jobs', !/PRIVATE|18,?000|Garden room/.test(mw));
  check('Directions are one tap away', (await samPhone.getByRole('link', { name: /Directions|Open in maps/i }).count()) > 0);
  await shot(samPhone, '04-my-work-375');

  /* ---- 2. Ryan moves the booking; Sam sees it; Dan can't reach Oak Road ---- */
  await op(ryan, 'saveBooking', { input: { id: booking.id, jobId: oak.id, date: friday, startTime: '10:30', endTime: '15:00', personIds: [sam.id] } });
  await samPhone.reload();
  await samPhone.getByText('Oak Road kitchen').first().waitFor({ timeout: 30000 });
  const mw2 = await samPhone.locator('main').innerText();
  check('Sam sees the new time after Ryan moves it', /10:30/.test(mw2) && /15:00/.test(mw2));
  await shot(samPhone, '05-my-work-moved-375');
  const danInv = await op(luke, 'inviteSomeone', { personId: dan.id, email: 'dan@subs-staging.example' });
  const danLink = linkIn(mail[mail.length - 1]);
  check('Dan invited too', danInv.status === 200 && !!danLink);
  await fetch(`${BASE}/api/invite/${danLink.split('/invite/')[1]}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ password: PASS.dan }) });
  const danP = await login(b, 'dan@subs-staging.example', PASS.dan, PHONE);
  check('Dan can\'t download the Oak Road drawing (not his job)', (await getJson(danP, `/api/files/${drawing.id}`)).status === 404);
  check('Dan\'s My work has no Oak Road', !JSON.stringify((await getJson(danP, '/api/my-work')).body).includes('Oak Road'));
  check('Dan can\'t open the company data', (await getJson(danP, '/api/data')).status === 403);
  await danP.goto(`${BASE}/jobs/${oak.id}`);
  check('A direct link to the job sends Dan to My work', /\/my-work/.test(danP.url()));
  check('Sam CAN open the shared drawing, but not the office-only costing', (await getJson(samPhone, `/api/files/${drawing.id}`)).status === 200 && (await getJson(samPhone, `/api/files/${costing.id}`)).status === 404);
  check('Ask Bob is closed to subcontractors', (await samPhone.evaluate(async () => (await fetch('/api/bob/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'What is the price of Oak Road?' }) })).status)) === 403);

  /* ---- 3. Luke: enquiry → Jobs to price → photo, video, measurements, private note → back later → accepted ---- */
  const enq = (await op(luke, 'createEnquiry', { input: { customerName: 'Hattie Fictional', phone: '07700 900777', source: 'phone', title: 'Alcove units', location: 'Horley', description: 'Both alcoves in the lounge' } })).body.value;
  await op(luke, 'addToPricing', { id: enq.id });
  const lukePhone = await login(b, 'luke@ninety3-staging.example', PASS.luke, PHONE);
  lukePhone.on('pageerror', (e) => errors.push('luke phone: ' + e.message));
  await lukePhone.goto(`${BASE}/pricing/${enq.id}`);
  await lukePhone.getByRole('heading', { name: 'Alcove units' }).waitFor({ timeout: 60000 });
  await lukePhone.getByLabel('Site address').fill('4 Fictional Close, Horley, RH6 7AA');
  await lukePhone.getByLabel('Site address').blur();
  await lukePhone.getByText("Saved. It carries to the job").waitFor({ timeout: 10000 });
  await lukePhone.locator('input[type=file][multiple]').first().setInputFiles([{ name: 'alcove-left.jpg', mimeType: 'image/jpeg', buffer: JPEG }, { name: 'walkround.mp4', mimeType: 'video/mp4', buffer: MP4 }]);
  const upDlg = lukePhone.getByRole('dialog');
  await shot(lukePhone, '06a-upload-queue-375', false);
  await upDlg.getByRole('button', { name: /^Upload 2 files/ }).click();
  await upDlg.getByRole('button', { name: 'Done' }).click({ timeout: 30000 });
  await lukePhone.getByText('walkround.mp4').first().waitFor({ timeout: 15000 });
  await lukePhone.getByRole('button', { name: 'Add measurement' }).click();
  await lukePhone.getByLabel('Measurement 1 name').fill('Left alcove width');
  await lukePhone.getByLabel('Measurement 1 value').fill('1020 mm');
  await lukePhone.getByRole('button', { name: 'Add measurement' }).click();
  await lukePhone.getByLabel('Measurement 2 name').fill('Height');
  await lukePhone.getByLabel('Measurement 2 value').fill('2210 mm');
  await lukePhone.getByRole('button', { name: 'Save measurements' }).click();
  await lukePhone.getByRole('button', { name: 'Saved' }).first().waitFor({ timeout: 10000 });
  await lukePhone.getByLabel('New note').fill('Chimney breast not square — scribe the backs. Allow an extra day.');
  await lukePhone.getByRole('button', { name: 'Add note' }).click();
  await lukePhone.getByText('scribe the backs').waitFor({ timeout: 10000 });
  await lukePhone.evaluate(() => window.scrollTo(0, 0));
  await sleep(4500); // let the "saved" toasts fade
  await shot(lukePhone, '06-pricing-record-375');
  // Leave and come back later.
  await lukePhone.goto(BASE + '/pricing');
  await lukePhone.getByRole('link', { name: /Alcove units/ }).click();
  await lukePhone.getByRole('heading', { name: 'Alcove units' }).waitFor();
  const rec = await lukePhone.locator('main').innerText();
  check('Coming back later: address, photo, video, measurements and note are all still there', rec.includes('walkround.mp4') && rec.includes('alcove-left.jpg') && (await lukePhone.getByLabel('Measurement 1 value').inputValue()) === '1020 mm' && rec.includes('scribe the backs') && (await lukePhone.getByLabel('Site address').inputValue()).includes('Horley'));
  await lukePhone.getByRole('button', { name: 'Customer accepted' }).click();
  await lukePhone.getByRole('button', { name: 'Create the job' }).click();
  await lukePhone.waitForURL('**/jobs/**', { timeout: 30000 });
  const jobsNow = (await getJson(luke, '/api/data')).body.jobs.filter((j) => j.enquiryId === enq.id);
  check('Accepting creates exactly one job', jobsNow.length === 1);
  const again = await op(luke, 'acceptPricing', { id: enq.id });
  check('A repeated accept returns the same job (no duplicate)', again.body.value?.id === jobsNow[0].id && (await getJson(luke, '/api/data')).body.jobs.filter((j) => j.enquiryId === enq.id).length === 1);
  check('The job has the site address carried across', jobsNow[0].siteAddress === '4 Fictional Close, Horley, RH6 7AA');
  const files = (await getJson(luke, '/api/data')).body.files.filter((f) => f.jobId === jobsNow[0].id);
  check('Photo and video came across, office-only', files.length >= 2 && files.every((f) => f.visibility === 'office'));
  check('Measurements and notes are private job notes', jobsNow[0].notes.map((n) => n.text).join(' ').includes('1020 mm'));
  await shot(lukePhone, '07-job-from-pricing-375');

  /* ---- 4. Ryan records a £450 extra; proposed is separate; approved adds exactly £450 ---- */
  await ryan.goto(`${BASE}/jobs/${oak.id}?tab=extras`);
  await ryan.getByRole('button', { name: 'Add an extra' }).click();
  await ryan.getByLabel('Extra work').fill('Additional oak shelving');
  await ryan.getByLabel('Amount (£)').fill('450');
  await ryan.getByRole('button', { name: 'Save extra' }).click();
  await ryan.getByText('£450.00 proposed').or(ryan.getByText(/£450 proposed/)).first().waitFor({ timeout: 10000 }).catch(() => {});
  const revisedBefore = await ryan.getByTestId('revised-total').innerText();
  check('Proposed £450 shown separately; revised total unchanged', /18,000/.test(revisedBefore) && (await ryan.getByTestId('proposed-total').innerText()).includes('450'), revisedBefore);
  await ryan.getByRole('button', { name: 'Record approval' }).click();
  await ryan.getByLabel(/How did the customer agree/).selectOption('phone');
  await ryan.getByLabel('Note (optional)').fill('Sophie agreed on the phone');
  await ryan.getByRole('button', { name: 'Record approval' }).last().click();
  await ryan.waitForFunction(() => document.querySelector('[data-testid=revised-total]')?.textContent?.includes('18,450'), null, { timeout: 10000 }).catch(() => {});
  check('Approved: revised agreed total rises by exactly £450', /18,450/.test(await ryan.getByTestId('revised-total').innerText()));
  check('Shows who recorded the approval and how', /Approval recorded by Ryan.*by phone/.test(await ryan.getByTestId('extra-record').first().innerText()));
  await sleep(4500);
  await shot(ryan, '08-extras-1440');
  const samWork = JSON.stringify((await getJson(samPhone, '/api/my-work')).body);
  check('Sam can\'t see the extra or its price', !/450|oak shelving/i.test(samWork));
  check('No invoice or email was created by the extra', mail.length === 2 && !(await getJson(luke, '/api/data')).body.invoices.length);

  /* ---- 5. Time off history: last month, a leave period spanning two months ---- */
  const today = todayKey();
  const firstThis = today.slice(0, 8) + '01';
  const lastPrev = addDays(firstThis, -1);
  const prevFirst = lastPrev.slice(0, 8) + '01';
  await op(ryan, 'saveBooking', { input: { jobId: oak.id, date: addDays(prevFirst, 9), startTime: '08:00', endTime: '16:00', personIds: [sam.id] } });
  await op(luke, 'addAbsence', { input: { personId: sam.id, kind: 'holiday', startDate: addDays(lastPrev, -2), endDate: addDays(firstThis, 2) } });
  await luke.goto(BASE + '/team?view=holidays');
  await luke.getByRole('heading', { name: /Time off history/ }).waitFor({ timeout: 30000 });
  await luke.getByLabel('Person').selectOption({ label: 'Sam Fictional (subcontractor)' });
  await luke.getByRole('button', { name: 'Last month' }).click();
  const hist = await luke.locator('#hol-history').locator('..').innerText();
  check('History shows Sam\'s leave, counted only within last month', /Unavailable/.test(hist) && /in this period \(of/.test(hist), hist.slice(0, 200).replace(/\n/g, ' '));
  check('Booked work listed separately', /Booked work — Sam Fictional/.test(hist) && /Oak Road kitchen/.test(hist));
  check('Says plainly that attendance isn\'t tracked', (await luke.getByTestId('attendance-note').innerText()).includes("doesn't track attendance"));
  await luke.getByTestId('attendance-note').scrollIntoViewIfNeeded();
  await shot(luke, '09-time-off-history-1440');

  /* ---- 6. Rough estimate (pilot): missing rates flagged, quantity corrected, nothing sent ---- */
  await op(luke, 'setPilotFeature', { feature: 'roughEstimates', on: true });
  await op(luke, 'saveRateCard', { card: { labourDayRate: 280, items: [{ name: '18mm MDF sheet', unit: 'sheet', price: 42 }, { name: 'Shaker door', unit: 'each', price: 65 }] } });
  const enq2 = (await op(luke, 'createPricing', { input: { customerName: 'Wardrobe Fictional', phone: '07700 900888', title: 'Alcove units', siteAddress: '8 Test Lane, Crawley, RH10 1AA' } })).body.value;
  await luke.goto(`${BASE}/pricing/${enq2.id}`);
  await luke.getByRole('heading', { name: /Rough estimate/ }).waitFor({ timeout: 30000 });
  for (const [label, v] of [['Width (mm)', '1000'], ['Height (mm)', '2200'], ['Depth (mm)', '350'], ['Days to make & fit', '4']]) await luke.getByLabel(label, { exact: true }).fill(v);
  await luke.getByRole('button', { name: 'Suggest lines from my prices' }).click();
  const missingText = await luke.getByTestId('estimate-missing').innerText();
  check('Missing rates are flagged and left out of the total', /2 lines have no price/.test(missingText), missingText);
  const total1 = await luke.getByTestId('estimate-total').innerText();
  await luke.getByLabel('Quantity for Labour (making and fitting)').fill('5');
  const total2 = await luke.getByTestId('estimate-total').innerText();
  check('Correcting a quantity updates the total (labour 4 → 5 days adds £280)', total1 !== total2 && /1,828/.test(total2) && /1,548/.test(total1), `${total1} → ${total2}`);
  await luke.getByRole('button', { name: 'Save estimate' }).click();
  await luke.getByRole('button', { name: 'Saved' }).first().waitFor({ timeout: 10000 });
  check('Turn into a quote is held back while lines are unpriced', await luke.getByRole('button', { name: 'Turn into a quote draft' }).isDisabled());
  await luke.getByTestId('estimate-total').scrollIntoViewIfNeeded();
  await sleep(4000);
  await shot(luke, '10-rough-estimate-1440');
  check('No quote, concept or message went to a customer', mail.length === 2 && !(await getJson(luke, '/api/data')).body.quotes.some((q) => q.enquiryId === enq2.id));

  // Phone screenshots of the diary for owners.
  await lukePhone.goto(BASE + '/week');
  await lukePhone.getByRole('region', { name: "Who's where" }).waitFor({ timeout: 30000 });
  await shot(lukePhone, '11-whos-where-375');
  // The week with Sam's booking in it: Friday, grouped by person, with directions.
  if (friday > addDays(todayKey(), 6 - ((new Date(`${todayKey()}T12:00:00Z`).getUTCDay() + 6) % 7))) await lukePhone.getByRole('button', { name: 'Next week' }).click();
  await lukePhone.getByRole('tab', { name: /^Friday/ }).click();
  await lukePhone.getByRole('region', { name: "Who's where" }).getByText('Sam Fictional').first().waitFor({ timeout: 10000 });
  await sleep(800); // let the day strip finish its colour transition
  const ww = await lukePhone.getByRole('region', { name: "Who's where" }).innerText();
  check("Phone: Who's where shows Sam at Oak Road with directions", ww.includes('Oak Road kitchen') && ww.includes('12 Oak Road'), ww.replace(/\n/g, ' | ').slice(0, 500));
  await shot(lukePhone, '11b-whos-where-friday-375');
  await luke.goto(BASE + '/week');
  await luke.getByRole('region', { name: 'Team schedule' }).waitFor({ timeout: 30000 });
  await shot(luke, '12-team-diary-1440', false);

  /* ---- 7. Restart: accounts, jobs and files survive; then backup → restore; then revoke ---- */
  const drawingBefore = await luke.evaluate(async (id) => { const r = await fetch(`/api/files/${id}`); return Array.from(new Uint8Array(await r.arrayBuffer())).slice(0, 64).join(','); }, drawing.id);
  await b.close();
  await stopServer();
  await startServer();
  const b2 = await chromium.launch();
  const luke2 = await login(b2, 'luke@ninety3-staging.example', PASS.luke);
  const data2 = (await getJson(luke2, '/api/data')).body;
  check('After a restart: Luke signs in with his own password', !!data2.user);
  check('…jobs, extras and the pricing record are all there', data2.jobs.some((j) => j.id === oak.id) && data2.variations.some((v) => v.description === 'Additional oak shelving' && v.status === 'approved') && data2.enquiries.some((e) => e.id === enq2.id && e.estimate));
  const drawingAfter = await luke2.evaluate(async (id) => { const r = await fetch(`/api/files/${id}`); return Array.from(new Uint8Array(await r.arrayBuffer())).slice(0, 64).join(','); }, drawing.id);
  check('…and uploaded files open with the same bytes', drawingAfter === drawingBefore && drawingAfter.length > 0);
  const sam2 = await login(b2, 'sam@subs-staging.example', PASS.sam, PHONE);
  check('…Sam can still sign in to My work', (await getJson(sam2, '/api/my-work')).status === 200);

  // Backup (while running) and restore into a new file; start on the restored copy.
  const backupOut = execFileSync('node', ['scripts/backup-db.cjs', DB, path.join(WORK, 'backups')]).toString();
  const backup = JSON.parse(backupOut);
  check('Backup made while running, integrity ok, includes files', backup.integrity === 'ok' && backup.files >= 4, `${backup.files} files, ${backup.jobs} jobs`);
  await b2.close();
  await stopServer();
  const restoredDb = path.join(WORK, 'restored', 'bob.sqlite');
  const restoreOut = JSON.parse(execFileSync('node', ['scripts/restore-db.cjs', backup.backup, restoredDb]).toString());
  check('Restore script checks the backup and puts it in place', restoreOut.integrity === 'ok');
  await startServer(restoredDb);
  const b3 = await chromium.launch();
  const luke3 = await login(b3, 'luke@ninety3-staging.example', PASS.luke);
  const data3 = (await getJson(luke3, '/api/data')).body;
  const drawingRestored = await luke3.evaluate(async (id) => { const r = await fetch(`/api/files/${id}`); return Array.from(new Uint8Array(await r.arrayBuffer())).slice(0, 64).join(','); }, drawing.id);
  check('Server running on the RESTORED database: same accounts, jobs and file bytes', data3.jobs.length === data2.jobs.length && drawingRestored === drawingBefore);

  // Remove Sam's access: his existing session stops; his work can't be fetched; his booking stays.
  const sam3 = await login(b3, 'sam@subs-staging.example', PASS.sam, PHONE);
  check('Sam signed in before removal', (await getJson(sam3, '/api/my-work')).status === 200);
  const rev = await op(luke3, 'revokeAccess', { personId: sam.id });
  check('Luke removes Sam\'s access', rev.status === 200);
  check('Sam\'s existing session no longer works', (await getJson(sam3, '/api/my-work')).status === 401);
  check('…and the shared drawing can\'t be downloaded', [401, 404].includes((await getJson(sam3, `/api/files/${drawing.id}`)).status));
  const data4 = (await getJson(luke3, '/api/data')).body;
  check('Sam\'s bookings stay on the diary', data4.bookings.some((x) => x.id === booking.id && x.personIds.includes(sam.id)));
  check('Team shows his access as removed', data4.access.find((a) => a.personId === sam.id)?.state === 'revoked');

  // Email failure is visible and retryable (stand-in service down).
  mailFails = true;
  const failing = await op(luke3, 'inviteSomeone', { name: 'Mia Fictional', email: 'mia@subs-staging.example', kind: 'subcontractor' });
  check('A failed email is shown as failed, never as sent', failing.body.value?.emailStatus === 'failed');
  mailFails = false;
  const retry = await op(luke3, 'resendInvite', { personId: failing.body.value.personId });
  check('…and Try again sends it', retry.body.value?.emailStatus === 'sent');

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b3.close();
  await stopServer();
  mailServer.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed (staging folder: ${WORK})`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await stopServer(); process.exit(1); });
