/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// End-to-end check of a provisioned live workspace, in a real browser, on a THROWAWAY database.
//   node scripts/e2e-live-workspace.cjs        (screenshots go to $OUT or the OS temp folder)
// Starts its own dev server on port 3100 with a temporary BOB_DB_PATH and BOB_WORKSPACES_FILE
// (fictional emails), takes the invite links from the server log, and checks: both users land on
// the same Diary, each sees the other's booking changes without reloading, neither can reach the
// demo company's records, and an invited subcontractor only sees their own job.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT || os.tmpdir();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-live-e2e-'));
const LUKE = 'luke@live-test.example';
const RYAN = 'ryan@live-test.example';
fs.writeFileSync(path.join(tmp, 'workspaces.json'), JSON.stringify([{
  slug: 'live-test', name: 'Live Test Carpentry and Build Ltd', shortName: 'Live Test', logoUrl: '/brand/ninety3-logo.png',
  timeZone: 'Europe/London', contact: { email: 'hello@live-test.example' },
  users: [{ name: 'Luke', role: 'owner', email: LUKE }, { name: 'Ryan', role: 'office', email: RYAN }],
}]));

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const DESK = { viewport: { width: 1280, height: 860 } };

function london(offsetDays) {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

(async () => {
  const log = [];
  const server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, BOB_DB_PATH: path.join(tmp, 'bob.sqlite'), BOB_WORKSPACES_FILE: path.join(tmp, 'workspaces.json'), BOB_PUBLIC_URL: BASE, BOB_SHOW_DEMO_LOGINS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));
  const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } };
  try {
    for (let i = 0; i < 120 && !/Ready|ready in/i.test(log.join('')); i++) await new Promise((r) => setTimeout(r, 500));
    await fetch(BASE + '/api/invite/' + 'x'.repeat(43)).catch(() => null); // opens the database → provisioning runs
    let links = {};
    for (let i = 0; i < 60; i++) {
      for (const m of log.join('').matchAll(/invite link for (\w+) \([^)]*\)[^:]*: (\S+\/invite\/[\w-]+)/g)) links[m[1]] = m[2];
      if (links.Luke && links.Ryan) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!links.Luke) console.log(log.join("").slice(-3000));
    check('Provisioning printed an owner link for Luke and an admin link for Ryan', links.Luke && links.Ryan);
    check('Server log masks emails', !log.join('').includes(LUKE) && !log.join('').includes(RYAN));

    const b = await chromium.launch();
    const errors = [];
    const accept = async (url, password, who) => {
      const ctx = await b.newContext(DESK);
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
      await p.goto(url);
      await p.getByLabel('Choose a password').fill(password);
      await p.getByRole('button', { name: /Set up my login|Accept/ }).click();
      await p.waitForURL(/\/(home|my-work)/, { timeout: 120000 }); // first compile on a dev server can be slow
      return { ctx, p };
    };
    const ops = (p, op, args) => p.evaluate(async ([op, args]) => {
      const r = await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) });
      return { status: r.status, body: await r.json() };
    }, [op, args]);

    const luke = await accept(links.Luke, 'luke-test-pass-1', 'luke');
    check('Luke lands on the Diary', /\/week$/.test(luke.p.url()) && await luke.p.getByRole('heading', { name: 'Diary' }).waitFor().then(() => true));
    const ryan = await accept(links.Ryan, 'ryan-test-pass-1', 'ryan');
    check('Ryan lands on the Diary', /\/week$/.test(ryan.p.url()) && await ryan.p.getByRole('heading', { name: 'Diary' }).waitFor().then(() => true));
    const who = async (p) => p.evaluate(async () => (await (await fetch('/api/data')).json()));
    const lukeData = await who(luke.p);
    const ryanData = await who(ryan.p);
    check('Same live workspace for both', lukeData.org.id === ryanData.org.id && lukeData.org.name === 'Live Test Carpentry and Build Ltd' && lukeData.org.dataMode === 'live', lukeData.org.name);
    check('Roles: Luke owner, Ryan admin (office)', lukeData.user.role === 'owner' && ryanData.user.role === 'office');
    check('Workspace starts empty', ['jobs', 'customers', 'enquiries', 'merchants', 'materials', 'bills', 'invoices', 'bookings'].every((k) => (lukeData[k] ?? []).length === 0));
    check('No mailbox connected', (lukeData.connections ?? []).every((c) => c.status !== 'connected'));

    // Luke adds a job and books it in; Ryan's open Diary picks it up without a reload.
    const day = london(1);
    const job = await ops(luke.p, 'createJob', { input: { customerName: 'Test Customer', title: 'Loft boarding E2E', location: 'Crawley', quotedValue: 2400 } });
    const jobId = job.body.value?.id;
    const people = lukeData.people;
    const lukeP = people.find((x) => x.name === 'Luke');
    const add = await ops(luke.p, 'saveBooking', { input: { jobId, date: day, startTime: '08:00', endTime: '12:00', personIds: [lukeP.id] } });
    check('Luke books the job', add.status === 200, String(add.status));
    const bookingId = add.body.value?.id;
    const t0 = Date.now();
    const seen = await ryan.p.getByText('Loft boarding E2E').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    check("Ryan's Diary shows Luke's booking without reloading", seen, `${Math.round((Date.now() - t0) / 1000)}s`);

    // Ryan moves it to the afternoon and adds himself; Luke sees the change.
    const ryanP = people.find((x) => x.name === 'Ryan');
    const edit = await ops(ryan.p, 'saveBooking', { input: { id: bookingId, jobId, date: day, startTime: '13:00', endTime: '16:30', personIds: [lukeP.id, ryanP.id] } });
    check('Ryan edits the booking', edit.status === 200, String(edit.status));
    await luke.p.evaluate(() => window.dispatchEvent(new Event('focus')));
    const lukeSees = await luke.p.getByText('13:00–16:30').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    check("Luke's Diary shows Ryan's edit", lukeSees);
    await luke.p.screenshot({ path: path.join(OUT, 'live-luke-diary.png') });
    await ryan.p.screenshot({ path: path.join(OUT, 'live-ryan-diary.png') });

    // Another company's private records: the demo's IDs, used from the live workspace.
    const demo = await b.newContext(DESK);
    const dp = await demo.newPage();
    await dp.goto(BASE + '/login');
    await dp.getByRole('button', { name: /Try the demo/ }).click();
    await dp.waitForURL('**/home');
    const demoData = await who(dp);
    check('Demo still available separately', demoData.org.dataMode === 'sample' && demoData.org.id !== lukeData.org.id);
    const demoJob = demoData.jobs[0];
    const demoBooking = demoData.bookings[0];
    for (const [name, page] of [['Luke', luke.p], ['Ryan', ryan.p]]) {
      const r1 = await ops(page, 'saveBooking', { input: { jobId: demoJob.id, date: day, allDay: true } });
      const r2 = await ops(page, 'updateJob', { id: demoJob.id, patch: { title: 'hijack' } });
      const r3 = await ops(page, 'deleteBooking', { id: demoBooking.id });
      const r4 = await page.evaluate(async (id) => (await fetch(`/api/photos?relatedType=job&relatedId=${id}`)).status, demoJob.id);
      const data = await who(page);
      check(`${name} can't book onto, edit or delete the demo company's records`, [r1, r2, r3].every((r) => r.status >= 400) && !JSON.stringify(data).includes(demoJob.title), `${r1.status}/${r2.status}/${r3.status}/photos ${r4}`);
    }
    const switchTry = await luke.p.evaluate(async (orgId) => (await fetch('/api/auth/switch-org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) })).status, demoData.org.id);
    check("Luke can't switch into the demo company", switchTry === 403, String(switchTry));
    const demoSees = await who(dp);
    check("The demo can't see the live company's job", !JSON.stringify(demoSees).includes('Loft boarding E2E'));

    // Ryan adds and invites a subcontractor; they see only the job they're booked on.
    const other = await ops(luke.p, 'createJob', { input: { customerName: 'Other Customer', title: 'Kitchen fit E2E', location: 'Horley', quotedValue: 15000 } });
    await ops(ryan.p, 'saveBooking', { input: { jobId: other.body.value.id, date: day, startTime: '08:00', endTime: '16:00', personIds: [lukeP.id], confirmOverlap: true } });
    const sub = await ops(ryan.p, 'createPerson', { input: { name: 'Dan Price', kind: 'subcontractor', trade: 'Electrician', email: 'dan@sparks-test.example' } });
    const subId = sub.body.value.id;
    const adminTry = await ops(ryan.p, 'createInvite', { personId: subId, role: 'office' });
    check("Ryan can't give admin access (owner only)", adminTry.status === 403, String(adminTry.status));
    const addSub = await ops(ryan.p, 'saveBooking', { input: { id: bookingId, jobId, date: day, startTime: '13:00', endTime: '16:30', personIds: [lukeP.id, ryanP.id, subId], confirmOverlap: true } });
    check('Ryan assigns the subcontractor to the booking', addSub.status === 200, String(addSub.status));
    const inv = await ops(ryan.p, 'createInvite', { personId: subId });
    check('Ryan invites the subcontractor (My work only)', inv.status === 200 && inv.body.value.role === 'worker');
    const dan = await accept(BASE + inv.body.value.path, 'dan-test-pass-1', 'dan');
    check('Subcontractor lands on My work', /\/my-work$/.test(dan.p.url()));
    const mine = await dan.p.evaluate(async () => { const j = await (await fetch('/api/my-work')).json(); return j.value ?? j; });
    const titles = (mine.bookings ?? []).map((x) => x.job.title);
    if (!titles.length) console.log('my-work:', JSON.stringify(mine).slice(0, 600));
    check('Subcontractor sees only their own job', titles.length === 1 && titles[0] === 'Loft boarding E2E' && !JSON.stringify(mine).includes('Kitchen fit E2E') && !JSON.stringify(mine).includes('2400'), titles.join(', '));
    const danData = await dan.p.evaluate(async () => (await fetch('/api/data')).status);
    const danOps = await ops(dan.p, 'createJob', { input: { customerName: 'X', title: 'Y', location: 'Z', quotedValue: 1 } });
    await dan.p.goto(BASE + '/week');
    check('Subcontractor is refused the company data, ops and Diary', danData === 403 && danOps.status === 403 && /\/my-work$/.test(dan.p.url()), `${danData}/${danOps.status}`);
    await dan.p.screenshot({ path: path.join(OUT, 'live-subcontractor-mywork.png') });

    check('No page errors', errors.length === 0, errors.join(' | '));
    await b.close();
  } finally {
    stop();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
