/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// The new pilot screens at a small phone width (375 px) on the fictional demo:
//   BASE=http://localhost:3000 OUT=/tmp node scripts/e2e-pilot-phone.cjs
// Invite someone, Extras, Time off history, Jobs to price list — each loads, nothing scrolls sideways.
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { try { localStorage.setItem('bob.onboarding.done', '1'); localStorage.setItem('bob.tips.off', '1'); } catch { /* */ } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + '/login');
  await p.evaluate(async () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@ninety3.example', password: 'bob-demo' }) }));
  await p.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const data = await p.evaluate(async () => (await fetch('/api/data')).json());
  const job = data.jobs.find((j) => j.quotedValue > 0 && j.status !== 'completed');
  await p.evaluate(async (jobId) => fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'saveVariation', args: { input: { jobId, description: 'Additional oak shelving', amount: 450, amountsAre: 'no_vat', status: 'proposed' } } }) }), job.id);

  await p.goto(BASE + '/team');
  await p.getByRole('button', { name: 'Invite someone' }).tap();
  // Sam already has access in the demo (no invite offered); Ellie is on the crew without a login.
  await p.getByRole('dialog').getByPlaceholder('e.g. Sam Okoro').fill('Sam');
  check('375: someone who already has access is shown as such, not offered an invite', await p.getByRole('dialog').getByText('Has access').waitFor({ timeout: 20000 }).then(() => true, () => false));
  await p.getByRole('dialog').getByPlaceholder('e.g. Sam Okoro').fill('Ellie');
  check('375: Invite someone offers the existing crew member', await p.getByRole('dialog').getByRole('button', { name: /Invite Ellie/ }).waitFor({ timeout: 20000 }).then(() => true, () => false));
  await p.screenshot({ path: path.join(OUT, 'p01-invite-375.png') });
  await p.keyboard.press('Escape');

  await p.goto(`${BASE}/jobs/${job.id}?tab=extras`);
  await p.getByTestId('revised-total').waitFor({ timeout: 30000 });
  check('375: Extras open in one tap from a link, totals readable', (await p.getByTestId('proposed-total').innerText()).includes('450'));
  check('375: Extras — no sideways scrolling', (await overflow()) <= 1, String(await overflow()));
  await p.screenshot({ path: path.join(OUT, 'p02-extras-375.png'), fullPage: true });

  await p.goto(BASE + '/team?view=holidays');
  await p.getByRole('button', { name: 'Last month' }).waitFor({ timeout: 30000 });
  await p.getByLabel('Person').selectOption({ index: 1 });
  check('375: Time off history — no sideways scrolling', (await overflow()) <= 1, String(await overflow()));
  await p.getByRole('heading', { name: /Time off history/ }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(OUT, 'p03-time-off-history-375.png') });

  await p.goto(BASE + '/pricing');
  await p.getByRole('heading', { name: 'Jobs to price' }).waitFor({ timeout: 30000 });
  check('375: Jobs to price — no sideways scrolling', (await overflow()) <= 1, String(await overflow()));
  await p.screenshot({ path: path.join(OUT, 'p04-jobs-to-price-375.png') });
  await p.getByRole('button', { name: 'Add job to price' }).tap();
  await p.getByRole('dialog').getByLabel('Job').waitFor();
  await p.screenshot({ path: path.join(OUT, 'p05-add-job-to-price-375.png') });

  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await p.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await b.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
