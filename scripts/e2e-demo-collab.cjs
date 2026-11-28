/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Luke and Ryan working together in the Ninety3 demonstration workspace, in two separate browser
// sessions, each with their own sign-in (fictional data only). Start the dev server with the
// individual demo sign-ins set, then run:
//   BOB_DEMO_LUKE_EMAIL=… BOB_DEMO_LUKE_PASSWORD=… BOB_DEMO_RYAN_EMAIL=… BOB_DEMO_RYAN_PASSWORD=… npx next dev
//   BASE=http://localhost:3000 LUKE_EMAIL=… LUKE_PASSWORD=… RYAN_EMAIL=… RYAN_PASSWORD=… node scripts/e2e-demo-collab.cjs
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const LUKE = { email: process.env.LUKE_EMAIL || 'owner@ninety3.example', password: process.env.LUKE_PASSWORD || 'bob-demo' };
const RYAN = { email: process.env.RYAN_EMAIL || 'office@ninety3.example', password: process.env.RYAN_PASSWORD || 'bob-demo' };
const individual = !!process.env.LUKE_PASSWORD;
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const london = (n) => { const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const snap = (p) => p.evaluate(async () => (await fetch('/api/data')).json());
const status = (p, url, body) => p.evaluate(async ([u, b]) => (await fetch(u, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {})).status, [url, body]);

/** Sign in through the real form, as Luke or Ryan would. */
async function signIn(browser, who, opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  await p.getByLabel('Email', { exact: true }).fill(who.email);
  await p.getByLabel('Password', { exact: true }).fill(who.password);
  await p.getByRole('button', { name: /^Sign in$/ }).click();
  await p.waitForURL('**/week', { timeout: 60000 });
  return p;
}

(async () => {
  const b = await chromium.launch();
  const errors = [];

  /* Sign-in page: with individual credentials configured, no shared buttons for Luke or Ryan */
  const anon = await (await b.newContext()).newPage();
  await anon.goto(BASE + '/login');
  const loginText = await anon.locator('body').innerText();
  if (individual) {
    check('Sign-in page has no shared-password buttons for Luke or Ryan', !/Luke · Owner|Ryan · Admin/.test(loginText));
    const shared = await anon.evaluate(async () => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@ninety3.example', password: 'bob-demo' }) })).status);
    check("The old shared demo password doesn't open Luke's account", shared === 401, String(shared));
  }

  /* Two separate sessions: Luke on a desktop, Ryan on a phone */
  const luke = await signIn(b, LUKE, { viewport: { width: 1440, height: 900 } });
  const ryan = await signIn(b, RYAN, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  luke.on('pageerror', (e) => errors.push('luke: ' + e.message));
  ryan.on('pageerror', (e) => errors.push('ryan: ' + e.message));
  await luke.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await luke.reload();
  await ryan.reload();
  const [ls, rs] = [await snap(luke), await snap(ryan)];
  check('Both are in the same Ninety3 demo workspace', ls.org.id === 'org_ninety3' && rs.org.id === 'org_ninety3');
  check('Luke is the Owner, Ryan the Admin', ls.user.name === 'Luke' && ls.user.role === 'owner' && rs.user.name === 'Ryan' && rs.user.role === 'office', `${ls.user.name}/${ls.user.role} · ${rs.user.name}/${rs.user.role}`);

  /* Bob greets each by name */
  await luke.goto(BASE + '/assistant');
  await ryan.goto(BASE + '/assistant');
  const lg = await luke.locator('main').innerText();
  const rg = await ryan.locator('main').innerText();
  check('Bob greets Luke by name', /(Morning|Afternoon|Evening), Luke/.test(lg));
  check('Bob greets Ryan by name', /(Morning|Afternoon|Evening), Ryan/.test(rg));

  /* 1. Luke books work; Ryan sees it */
  const day = london(3);
  await luke.goto(BASE + '/jobs/n93_job_mediawall_reigate');
  await luke.locator('[aria-label="Quick actions"]').getByRole('button', { name: 'Schedule work' }).click();
  const bf = luke.getByRole('dialog', { name: 'Schedule work' });
  await bf.getByLabel('Day', { exact: true }).fill(day);
  await bf.getByLabel('Start time').fill('08:00');
  await bf.getByLabel('End time').fill('15:30');
  await bf.getByRole('button', { name: /Ellie Ward/ }).click();
  await bf.getByRole('button', { name: 'Schedule work', exact: true }).click();
  const clash = await bf.getByText(/Double booking|Clashes with leave/).waitFor({ timeout: 2500 }).then(() => true).catch(() => false);
  if (clash) await bf.getByRole('button', { name: 'Book anyway' }).click();
  await bf.waitFor({ state: 'detached', timeout: 10000 });
  const bk = (await snap(ryan)).bookings.find((x) => x.jobId === 'n93_job_mediawall_reigate' && x.date === day && x.personIds.includes('n93_per_ellie'));
  check("Luke's booking is in Ryan's workspace data", !!bk);
  await ryan.goto(BASE + `/week?w=${day}`);
  const dayNum = String(Number(day.slice(8)));
  await ryan.locator('main button').filter({ hasText: new RegExp(`^\\s*[MTWFS]\\s*${dayNum}\\s*$`) }).first().click();
  await ryan.waitForTimeout(500);
  check("Ryan sees Luke's booking on his phone's Diary", /Media wall/.test(await ryan.locator('main').innerText()));
  await ryan.screenshot({ path: path.join(OUT, 'collab-ryan-diary.png') });

  /* 2. Ryan adds materials on the job page; Luke sees them */
  await ryan.goto(BASE + '/jobs/n93_job_mediawall_reigate');
  await ryan.locator('[aria-label="Quick actions"]').getByRole('button', { name: 'Add material' }).click();
  const mf = ryan.getByRole('dialog');
  await mf.getByLabel('Item').fill('Oak veneered MDF 18mm');
  await mf.getByLabel('Quantity').fill('6');
  await mf.locator('button[type=submit]').click();
  await mf.waitFor({ state: 'detached', timeout: 10000 });
  await luke.goto(BASE + '/materials');
  await luke.getByRole('heading', { name: 'Materials', level: 1 }).waitFor();
  check("Luke sees Ryan's material on Materials", /Oak veneered MDF 18mm/.test(await luke.locator('main').innerText()));
  const mat = (await snap(luke)).materials.find((m) => m.item === 'Oak veneered MDF 18mm');
  check('…on the right job, still To order', mat?.jobId === 'n93_job_mediawall_reigate' && mat?.status === 'to_order');

  /* 3. Ryan updates the job and sets Luke a task; Luke sees both */
  await ryan.goto(BASE + '/jobs/n93_job_mediawall_reigate');
  await ryan.getByRole('button', { name: 'Edit dates' }).click();
  await ryan.getByLabel('Finish date').fill('2026-12-18');
  await ryan.getByRole('button', { name: 'Save dates' }).click();
  await ryan.waitForTimeout(800);
  const endNow = (await snap(ryan)).jobs.find((j) => j.id === 'n93_job_mediawall_reigate').endDate;
  check("Ryan sets the job's finish date", endNow === '2026-12-18', endNow);
  const t = await ryan.evaluate(async (due) => (await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'createTask', args: { input: { title: 'Ring the customer about the TV bracket', dueDate: due, relatedType: 'job', relatedId: 'n93_job_mediawall_reigate', assignedUserId: 'usr_n93_owner' } } }) })).json(), london(0));
  check('Ryan sets Luke a task', t.ok === true, t.error || '');
  await luke.goto(BASE + '/jobs/n93_job_mediawall_reigate');
  const lukeJob = (await snap(luke)).jobs.find((j) => j.id === 'n93_job_mediawall_reigate');
  check("Luke's session has Ryan's new finish date", lukeJob.endDate === '2026-12-18', lukeJob.endDate);
  // An open task on the job is shown as its next step, so Luke sees the task Ryan just set.
  check("Luke's job page shows the job's new next step (Ryan's task)", /Ring the customer about the TV bracket/.test(await luke.locator('main').innerText()));
  await luke.goto(BASE + '/tasks');
  await luke.getByRole('heading', { name: 'Tasks', level: 1 }).waitFor();
  check("Luke sees the task Ryan set him, under Today", /Ring the customer about the TV bracket[\s\S]*For Luke/.test(await luke.locator('main').innerText()));

  /* 4. Activity shows who did what */
  await luke.goto(BASE + '/activity');
  await luke.getByRole('tab', { name: /Just me/ }).click();
  const mine = await luke.locator('main').innerText();
  check("Luke's own activity lists his booking, not Ryan's material", /You/.test(mine) && !/Oak veneered MDF/.test(mine));
  await luke.getByRole('tab', { name: 'Everyone' }).click();
  check("Everyone's activity names Ryan", /Ryan/.test(await luke.locator('main').innerText()));

  /* 5. Permissions */
  check('Ryan (Admin) can see money', (await status(ryan, '/api/data')) === 200 && Array.isArray((await snap(ryan)).invoices));
  check("Ryan can't change business settings", (await status(ryan, '/api/settings', { name: 'Hijacked' })) === 403);
  check("Neither can open the Cresaro admin area", (await status(luke, '/api/cresaro/usage')) === 404 && (await status(ryan, '/api/cresaro/usage')) === 404 && (await status(luke, '/api/cresaro/ai-test', {})) === 404);
  await luke.goto(BASE + '/cresaro');
  check('Luke sees "not available" on /cresaro', await luke.getByText(/isn.t available/).waitFor({ timeout: 20000 }).then(() => true, () => false));
  check('No Cresaro admin link in the menu', !(await snap(luke)).mode.platformAdmin);
  const site = await (await b.newContext()).newPage();
  await site.goto(BASE + '/login');
  await site.evaluate(async () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'site@ninety3.example', password: 'bob-demo' }) }));
  const ss = await snap(site);
  check('Site team account sees no money records', !ss.invoices?.length && !ss.payments?.length);

  check('No page errors in either session', errors.length === 0, errors.slice(0, 2).join(' | '));
  await luke.screenshot({ path: path.join(OUT, 'collab-luke-activity.png') });
  await b.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
