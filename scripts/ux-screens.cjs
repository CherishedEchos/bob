/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Screenshots of every main screen at phone, tablet and desktop widths (fictional demo data):
//   BASE=http://localhost:3000 OUT=/tmp/shots node scripts/ux-screens.cjs [prefix]
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const PREFIX = process.argv[2] || 'shot';
fs.mkdirSync(OUT, { recursive: true });
const PAGES = [
  ['diary', '/week'], ['ask-bob', '/assistant'], ['enquiries', '/enquiries'], ['jobs', '/jobs'], ['job', '/jobs/n93_job_mackay_kitchen'],
  ['handover', '/jobs/n93_job_gardenroom_lingfield?tab=handover'], ['activity', '/activity'], ['customers', '/customers'], ['tasks', '/tasks'], ['team', '/team'], ['materials', '/materials'], ['merchants', '/merchants'], ['money', '/invoices'], ['settings', '/settings'],
];
const SIZES = { 'phone-375': { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 }, desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } };
(async () => {
  const b = await chromium.launch();
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const [size, opts] of Object.entries(SIZES)) {
    if (process.env.SIZES && !process.env.SIZES.split(',').includes(size)) continue;
    const ctx = await b.newContext(opts);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`pageerror ${size}: ${e.message}`));
    await p.goto(BASE + '/login');
    await p.evaluate(async ([email, password]) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }), [process.env.LUKE_EMAIL || 'owner@ninety3.example', process.env.LUKE_PASSWORD || 'bob-demo']);
    await ctx.addInitScript(() => { try { localStorage.setItem('bob.onboarding.done', '1'); localStorage.setItem('bob.tips.off', '1'); } catch { /* */ } });
    for (const [name, url] of PAGES) {
      if (only && !only.includes(name)) continue;
      await p.goto(BASE + url);
      await p.waitForLoadState('networkidle').catch(() => {});
      await p.waitForTimeout(1200);
      await p.screenshot({ path: path.join(OUT, `${PREFIX}-${size}-${name}.png`), fullPage: size !== 'desktop' ? false : false });
    }
    await ctx.close();
  }
  await b.close();
})();
