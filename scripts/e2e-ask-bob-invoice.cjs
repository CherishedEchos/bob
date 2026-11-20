/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Ask Bob invoicing through the real UI and API, on a THROWAWAY database with FICTIONAL data:
//   node scripts/e2e-ask-bob-invoice.cjs
// Starts its own dev server (port 3210) as the Ninety3 demo owner. No accounting system is
// connected, so nothing can be sent externally. No ANTHROPIC_API_KEY is passed, so this
// exercises Bob's built-in engine; the Claude engine is covered by tests/invoice-chat.test.ts.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT || os.tmpdir();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-invoice-e2e-'));
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
let log = '';

function start() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, BOB_DB_PATH: path.join(tmp, 'bob.sqlite'), BOB_PUBLIC_URL: BASE, BOB_SHOW_DEMO_LOGINS: 'true' };
    delete env.ANTHROPIC_API_KEY;
    const p = spawn('npx', ['next', 'dev', '-p', String(PORT)], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
const api = (page, url, body) => page.evaluate(async ([url, body]) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [url, body]);
const login = (page, email) => page.evaluate(async (email) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'bob-demo' }) })).status, email);

(async () => {
  const server = await start();
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  check('Signs in as the Ninety3 demo owner', (await login(page, 'owner@ninety3.example')) === 200);
  await page.goto(BASE + '/');
  await page.getByRole('heading', { name: 'How can I help?' }).waitFor();

  /* Typed, through the composer */
  const box = page.getByPlaceholder('Type to Bob…');
  const say = async (text) => {
    if (!(await box.isVisible())) await page.getByRole('button', { name: /^Type$/ }).click();
    await box.fill(text);
    const resp = page.waitForResponse((r) => r.url().includes('/api/bob/message') && r.request().method() === 'POST', { timeout: 30000 });
    await page.getByRole('button', { name: 'Send to Bob' }).click();
    await resp;
    await page.waitForTimeout(800);
    return page.locator('body').innerText();
  };
  let t = await say('Prepare me an invoice for Sophie Mackay in Copthorne');
  check('UI: asks which of Sophie Mackay\'s two jobs', /Sophie Mackay has 2 jobs/.test(t));
  t = await say('the kitchen one');
  check('UI: shows £9,940 left on the Oak Road kitchen', t.includes('£9,940 is left to invoice'));
  t = await say('the final balance');
  check('UI: asks VAT and terms once (settings unset)', /no VAT, plus VAT or including VAT\?/.test(t));
  t = await say('no VAT, 14 days');
  check('UI: draft saved, not sent, with Review invoice', /Saved draft BOB-\d+: £9,940/.test(t) && /hasn't been sent/.test(t) && (await page.getByRole('button', { name: 'Review invoice' }).or(page.getByRole('link', { name: 'Review invoice' })).count()) > 0);
  t = await say('yeah, draft that');
  check('UI: no second draft', /haven't made a second one/.test(t));
  t = await say('make that seven-fifty');
  check('UI: amended to £750', /is now £750/.test(t));
  await page.screenshot({ path: path.join(OUT, 'phone-390-ask-bob-invoice.png'), fullPage: false });
  // The editable transcript: the last message can be corrected
  check('UI: last message offers Edit', (await page.getByRole('button', { name: /Edit/ }).count()) > 0);
  t = await say('send it');
  check('UI: sending blocked (nothing connected)', /can't send invoices yet/.test(t));
  const snap = await api(page, '/api/data');
  const kitchenDrafts = (snap.body.invoices || []).filter((i) => i.jobId === 'n93_job_mackay_kitchen' && i.status === 'draft');
  check('Server: exactly one draft for £750, still a draft', kitchenDrafts.length === 1 && kitchenDrafts[0].total === 750, JSON.stringify(kitchenDrafts.map((i) => i.total)));
  await page.getByRole('button', { name: 'Review invoice' }).or(page.getByRole('link', { name: 'Review invoice' })).last().click();
  await page.waitForTimeout(1500);
  check('Review invoice opens the draft', /BOB-\d+/.test(await page.locator('body').innerText()));

  /* Voice-flagged input goes through the same handler (no real microphone here) */
  const v = await api(page, '/api/bob/message', { text: 'put a bill together for Mrs Mackey\'s wardrobes', via: 'voice' });
  const vt = (v.body.messages || []).map((m) => m.text).join(' ');
  check('API voice turn: misheard "Mackey" finds the wardrobes', v.status === 200 && vt.includes("Sophie Mackay's fitted wardrobes"), vt.slice(0, 120));

  /* Mic denied: the browser refuses the microphone; typing still works */
  const denied = await b.newContext({ viewport: { width: 1280, height: 860 }, permissions: [] });
  const dp = await denied.newPage();
  await dp.addInitScript(() => {
    class FakeRec { start() { setTimeout(() => this.onerror && this.onerror({ error: 'not-allowed' }), 50); setTimeout(() => this.onend && this.onend(), 80); } stop() {} abort() {} }
    window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
  });
  await dp.goto(BASE + '/login');
  await login(dp, 'office@ninety3.example');
  await dp.goto(BASE + '/');
  await dp.getByRole('heading', { name: 'How can I help?' }).waitFor();
  await dp.getByRole('button', { name: /talk to Bob/i }).first().click();
  await dp.waitForTimeout(1500);
  check('Mic denied: explains and offers typing', /Microphone access is blocked|type instead/i.test(await dp.locator('body').innerText()));
  await dp.screenshot({ path: path.join(OUT, 'desk-mic-denied.png') });

  /* Permissions: a site account */
  const sc = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const sp = await sc.newPage();
  await sp.goto(BASE + '/login');
  await login(sp, 'site@ninety3.example');
  const s = await api(sp, '/api/bob/message', { text: "what's left to pay on Sophie Mackay's kitchen?", via: 'text' });
  const st = (s.body.messages || []).map((m) => m.text).join(' ');
  check('Site account: no balance shown', s.status === 403 || (/doesn't have access/.test(st) && !/£/.test(st)), `${s.status} ${st.slice(0, 100)}`);

  await b.close();
  await stop(server);
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); console.error(log.slice(-3000)); process.exit(1); });
