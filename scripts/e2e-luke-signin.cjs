/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Luke's real sign-in, on a THROWAWAY database with a FICTIONAL test identity:
//   node scripts/e2e-luke-signin.cjs
// Uses docs/workspaces.ninety3.example.json (the real Ninety3 workspace spec) with test emails,
// starts its own dev server (port 3200), restarts it to prove provisioning is safe to run twice,
// and checks: the invite opened from a browser that already has a DEMO session, landing on Ask Bob
// as Luke in the live workspace, an empty diary offering Schedule work, a job surviving sign-out /
// sign-in and a second device, Ryan invited later into the same workspace, and demo/live separation.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT || os.tmpdir();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-luke-e2e-'));
const LUKE = 'luke.test@ninety3-test.example';
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'workspaces.ninety3.example.json'), 'utf8'));
spec[0].users = [{ name: 'Luke', role: 'owner', email: LUKE }, { name: 'Ryan', role: 'office', email: '' }];
fs.writeFileSync(path.join(tmp, 'workspaces.json'), JSON.stringify(spec));

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const DESK = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
let log = '';

function start() {
  return new Promise((resolve, reject) => {
    const p = spawn('npx', ['next', 'dev', '-p', String(PORT)], { cwd: path.join(__dirname, '..'), env: { ...process.env, BOB_DB_PATH: path.join(tmp, 'bob.sqlite'), BOB_WORKSPACES_FILE: path.join(tmp, 'workspaces.json'), BOB_PUBLIC_URL: BASE, BOB_SHOW_DEMO_LOGINS: 'true' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    p.stdout.on('data', (d) => (log += d));
    p.stderr.on('data', (d) => (log += d));
    const t0 = Date.now();
    const poll = async () => {
      try { if ((await fetch(BASE + '/login')).ok) return resolve(p); } catch { /* not up */ }
      if (Date.now() - t0 > 90000) return reject(new Error('server did not start'));
      setTimeout(poll, 1000);
    };
    poll();
  });
}
const stop = (p) => new Promise((r) => { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ } setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } r(); }, 3000); });
/** Any request that opens the database runs start-up provisioning. */
const wake = () => fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: 'nobody@example.com', password: 'x' }) }).then(() => new Promise((r) => setTimeout(r, 800)));
const links = () => [...log.matchAll(/invite link for (\w+) \([^)]*\)[^:]*: (http\S+)/g)].map((m) => ({ name: m[1], url: m[2] }));
const json = (page, url, body) => page.evaluate(async ([url, body]) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [url, body]);

(async () => {
  let server = await start();
  await wake();
  const first = links().filter((l) => l.name === 'Luke');
  check('Provisioning prints one owner invite for Luke', first.length === 1);
  check('Ryan without an email is waiting, not invited', /Ryan \(admin\) is waiting for an email/.test(log));
  // Run provisioning again (restart): no duplicate workspace, users or links.
  await stop(server);
  log = '';
  server = await start();
  await wake();
  check('Restart: no second link printed while the first is unused', links().length === 0);
  const LINK = first[0].url;

  const b = await chromium.launch();
  /* The meeting: this browser already has the demo open */
  const ctx = await b.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: /Try the demo/ }).click();
  await page.waitForURL(BASE + '/');
  const demoSnap = await json(page, '/api/data');
  check('Demo session is the fictional workspace', demoSnap.body.org?.slug === 'ninety3' && demoSnap.body.org?.dataMode === 'sample');
  const demoCookie = (await ctx.cookies()).find((c) => c.name === 'bob_session').value;

  await page.goto(LINK);
  await page.getByText('This browser is signed in as someone else').waitFor();
  check('Invite page warns that the demo session is open and names the invited email', (await page.locator('main').innerText()).includes(LUKE));
  await page.screenshot({ path: path.join(OUT, 'phone-390-invite-over-demo.png') });
  await page.getByLabel('Choose a password').fill('luke-test-password-1');
  await page.getByRole('button', { name: 'Sign in as Luke' }).click();
  await page.waitForURL(BASE + '/');
  await page.getByRole('heading', { name: 'How can I help?' }).waitFor();
  const greet = await page.locator('main').innerText();
  check('Lands on Ask Bob greeting Luke', /Good (morning|afternoon|evening), Luke/.test(greet));
  const live = await json(page, '/api/data');
  check('In the live Ninety3 workspace (not the demo)', live.body.org?.slug === 'ninety3ltd' && live.body.org?.dataMode === 'live' && live.body.user?.role === 'owner' && live.body.user?.email === LUKE);
  check('Ninety3 branding and Europe/London', live.body.org?.brandColor === '#7B2001' && live.body.org?.wordmark?.onDark && live.body.org?.timeZone === 'Europe/London');
  check('Live workspace has no demo jobs or customers', live.body.jobs.length === 0 && live.body.customers.length === 0);
  await page.screenshot({ path: path.join(OUT, 'phone-390-luke-ask-bob.png') });
  // The old demo session is ended, and the demo account never got into the live workspace.
  const demoCtx = await b.newContext(DESK);
  await demoCtx.addCookies([{ name: 'bob_session', value: demoCookie, url: BASE }]);
  const dp = await demoCtx.newPage();
  await dp.goto(BASE + '/login');
  check('The previous demo session was signed out', (await json(dp, '/api/data')).status === 401);
  await demoCtx.close();

  /* Empty diary offers Schedule work; add a job */
  await page.goto(BASE + '/week');
  await page.getByRole('heading', { name: 'Diary', level: 1 }).waitFor();
  check('Empty diary offers Schedule work', await page.getByRole('button', { name: /Schedule work/ }).first().isVisible());
  const cust = await json(page, '/api/ops', { op: 'createCustomer', args: { input: { name: 'Test Customer', town: 'Crawley' } } });
  const job = await json(page, '/api/ops', { op: 'createJob', args: { input: { customerId: cust.body.value?.id, title: 'Oak Road kitchen (test)', location: 'Crawley', kind: 'kitchen', quotedValue: 9000, status: 'quoted' } } });
  check('Luke adds a job', job.body.ok, job.body.error);

  /* Sign out, sign back in; and a second device */
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.goto(BASE + '/login');
  await page.getByLabel('Email').fill(LUKE);
  await page.getByLabel('Password').fill('luke-test-password-1');
  await page.getByRole('button', { name: /^Sign in/ }).click();
  await page.waitForURL(BASE + '/');
  const again = await json(page, '/api/data');
  check('Sign back in: same live workspace, job still there', again.body.org?.slug === 'ninety3ltd' && again.body.jobs.some((j) => j.title === 'Oak Road kitchen (test)'));
  const d2 = await b.newContext(DESK);
  const p2 = await d2.newPage();
  await p2.goto(BASE + '/login');
  const s2 = await p2.evaluate(async (email) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'luke-test-password-1' }) })).status, LUKE);
  const second = await json(p2, '/api/data');
  check('Second device: same workspace and job', s2 === 200 && second.body.org?.slug === 'ninety3ltd' && second.body.jobs.length === 1);

  /* Invite Ryan later, into the same workspace */
  const ryanPerson = second.body.people.find((p) => p.name === 'Ryan');
  const inv = await json(p2, '/api/ops', { op: 'createInvite', args: { personId: ryanPerson.id, email: 'ryan.test@ninety3-test.example', role: 'office' } });
  check('Luke creates an admin invite for Ryan', inv.body.ok, inv.body.error);
  const rc = await b.newContext(DESK);
  const rp = await rc.newPage();
  await rp.goto(BASE + inv.body.value.path);
  await rp.getByLabel('Choose a password').fill('ryan-test-password-1');
  await rp.getByRole('button', { name: 'Set up my login' }).click();
  await rp.waitForURL(BASE + '/');
  const ryan = await json(rp, '/api/data');
  check('Ryan joins the same workspace as admin and sees the same job', ryan.body.org?.slug === 'ninety3ltd' && ryan.body.user?.role === 'office' && ryan.body.jobs.some((j) => j.title === 'Oak Road kitchen (test)'));

  /* Demo and live stay separate */
  const demo = await b.newContext(DESK);
  const dpg = await demo.newPage();
  await dpg.goto(BASE + '/login');
  await dpg.evaluate(async () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@ninety3.example', password: 'bob-demo' }) }));
  const dsnap = await json(dpg, '/api/data');
  const orgs = await json(dpg, '/api/auth/switch-org');
  check('Demo has its fictional jobs and none of the live ones', dsnap.body.jobs.length > 3 && !dsnap.body.jobs.some((j) => j.title.includes('Oak Road')));
  check('Demo login cannot switch into the live workspace', !(orgs.body.orgs ?? []).some((o) => o.id === live.body.org.id));
  const sw = await json(dpg, '/api/auth/switch-org', { orgId: live.body.org.id });
  check('Demo login is refused if it asks for the live workspace', sw.status >= 400, String(sw.status));
  // The used invite can't be claimed again by anyone.
  const reuse = await json(dpg, `/api/invite/${LINK.split('/').pop()}`, { password: 'whatever-123' });
  check('Used invite cannot be claimed again', reuse.status === 409, String(reuse.status));

  /* Restart again: Luke's membership and job survive, no new links */
  await b.close();
  await stop(server);
  log = '';
  server = await start();
  await wake();
  check('Restart after sign-up: no new link for Luke', !links().some((l) => l.name === 'Luke'));
  const b2 = await chromium.launch();
  const c3 = await b2.newContext(DESK);
  const p3 = await c3.newPage();
  await p3.goto(BASE + '/login');
  await p3.evaluate(async (email) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'luke-test-password-1' }) }), LUKE);
  const after = await json(p3, '/api/data');
  check('After restart: one live workspace, Luke still owner, job kept', after.body.org?.slug === 'ninety3ltd' && after.body.user?.role === 'owner' && after.body.jobs.length === 1);
  await b2.close();
  await stop(server);
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); console.error(log.slice(-3000)); process.exit(1); });
