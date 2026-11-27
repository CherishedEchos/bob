/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
/**
 * Screenshots for "Getting started with Bob", taken from the running app with
 * the fictional Ridgeway demo workspace (nothing real, nothing sent). Each shot
 * can carry numbered orange markers that match the numbered steps in the guide.
 *
 *   BASE=http://localhost:3000 node docs/manual/capture.cjs
 *
 * Writes docs/manual/images/*.jpg
 */
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'images');
fs.mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.MANUAL_EMAIL || 'alex@ridgeway.example';
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** Orange rings with numbers over the things to tap, matching the numbered steps. */
async function mark(p, marks) {
  const boxes = [];
  for (const m of marks) {
    const loc = typeof m.loc === 'function' ? m.loc(p) : m.loc;
    const el = loc.first();
    await el.waitFor({ timeout: 15000 });
    const b = await el.boundingBox();
    if (b) boxes.push({ ...b, n: m.n, pad: m.pad ?? 5 });
  }
  await p.evaluate((boxes) => {
    for (const b of boxes) {
      const ring = document.createElement('div');
      ring.setAttribute('data-manual-mark', '');
      Object.assign(ring.style, { position: 'fixed', left: `${b.x - b.pad}px`, top: `${b.y - b.pad}px`, width: `${b.width + b.pad * 2}px`, height: `${b.height + b.pad * 2}px`, border: '3px solid #F38735', borderRadius: '12px', boxShadow: '0 0 0 5px rgba(243,135,53,0.22)', zIndex: 2147483646, pointerEvents: 'none' });
      document.body.appendChild(ring);
      if (b.n != null) {
        const dot = document.createElement('div');
        dot.setAttribute('data-manual-mark', '');
        dot.textContent = String(b.n);
        const left = Math.max(4, b.x - b.pad - 14);
        const top = Math.max(4, b.y - b.pad - 14);
        Object.assign(dot.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: '28px', height: '28px', borderRadius: '999px', background: '#F38735', color: '#fff', font: '700 15px/28px Inter, system-ui, sans-serif', textAlign: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', zIndex: 2147483647, pointerEvents: 'none' });
        document.body.appendChild(dot);
      }
    }
  }, boxes);
}

async function clearMarks(p) {
  await p.evaluate(() => document.querySelectorAll('[data-manual-mark]').forEach((n) => n.remove()));
}

async function settle(p) {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.getByText('Opening your workspace').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(900);
}

async function save(p, name, opts = {}) {
  const png = path.join(OUT, `${name}.png`);
  await p.screenshot({ path: png, clip: opts.clip, fullPage: false });
  // Smaller JPEGs keep the PDF light; quality stays sharp at print size.
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open(${JSON.stringify(png)}).convert('RGB'); im.save(${JSON.stringify(png.replace(/\.png$/, '.jpg'))}, quality=84, optimize=True)`]);
  fs.unlinkSync(png);
  await clearMarks(p);
  console.log('saved', name);
}

async function session(b, opts, email = EMAIL) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('bob.onboarding.done', '1');
      localStorage.setItem('bob.tips.off', '1');
    } catch {
      /* private mode */
    }
  });
  const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  const s = await p.evaluate(async (email) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'bob-demo' }) })).status, email);
  if (s !== 200) throw new Error(`sign-in failed for ${email}: ${s}`);
  return p;
}

const go = async (p, url) => {
  await p.goto(BASE + url).catch(() => p.goto(BASE + url));
  await settle(p);
};
const ops = (p, op, args) => p.evaluate(async ([op, args]) => (await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) })).json(), [op, args]);

(async () => {
  const b = await chromium.launch();

  /* ---------- Signing in (no one signed in) ---------- */
  {
    const p = await (await b.newContext(DESK)).newPage();
    await p.goto(BASE + '/login');
    await settle(p);
    await mark(p, [
      { n: 1, loc: p.getByLabel('Email', { exact: true }) },
      { n: 2, loc: p.getByLabel('Password', { exact: true }) },
      { n: 3, loc: p.getByRole('button', { name: /^Sign in$/ }) },
    ]);
    await save(p, 'signin');
  }

  const d = await session(b, DESK);
  await d.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await d.waitForTimeout(3000);

  /* ---------- Navigation and Home ---------- */
  await go(d, '/home');
  await mark(d, [
    { n: 1, loc: d.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }) },
    { n: 2, loc: d.getByRole('button', { name: /^Ask Bob/ }).first() },
    { n: 3, loc: d.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Diary' }) },
    { n: 4, loc: d.locator('aside button[aria-haspopup="menu"]') },
  ]);
  await save(d, 'nav-desktop');

  await mark(d, [
    { n: 1, loc: d.getByRole('button', { name: /Hear today's briefing/ }) },
    { n: 2, loc: d.locator('main').getByRole('button', { name: 'Ask Bob' }) },
    { n: 3, loc: d.getByRole('region', { name: /Today's work|Next up/ }).or(d.locator('section[aria-labelledby="today-h"]')) },
    { n: 4, loc: d.locator('section[aria-labelledby="glance-h"]') },
    { n: 5, loc: d.getByRole('region', { name: 'Quick actions' }).or(d.locator('section[aria-label="Quick actions"]')) },
  ]);
  await save(d, 'home');

  await d.locator('aside button[aria-haspopup="menu"]').click();
  await d.waitForTimeout(400);
  await mark(d, [{ n: 1, loc: d.getByRole('menuitem', { name: /Help & user guide/ }) }, { n: 2, loc: d.getByRole('menuitem', { name: 'Settings' }) }, { n: 3, loc: d.getByRole('menuitem', { name: 'Sign out' }) }]);
  await save(d, 'account-menu', { clip: { x: 0, y: 420, width: 520, height: 480 } });
  await d.keyboard.press('Escape');

  /* ---------- Diary ---------- */
  await go(d, '/week?view=week');
  await mark(d, [
    { n: 1, loc: d.getByRole('toolbar', { name: 'Diary controls' }).getByRole('button', { name: 'Today', exact: true }) },
    { n: 2, loc: d.getByRole('toolbar', { name: 'Diary controls' }).locator('[aria-haspopup="dialog"]') },
    { n: 3, loc: d.getByRole('radiogroup', { name: 'Diary view' }) },
    { n: 4, loc: d.getByRole('button', { name: /Schedule work/ }).first() },
    { n: 5, loc: d.getByRole('region', { name: 'Ask Bob about the diary' }) },
  ]);
  await save(d, 'diary-week');
  await go(d, '/week?view=month');
  await save(d, 'diary-month');
  await go(d, '/week?view=team');
  await mark(d, [{ n: 1, loc: d.getByRole('region', { name: 'Team schedule' }).getByText('Needs someone').first(), pad: 8 }]);
  await save(d, 'diary-team');
  await d.getByRole('button', { name: /Schedule work/ }).first().click();
  await d.getByRole('dialog', { name: 'Schedule work' }).waitFor();
  await d.waitForTimeout(600);
  await save(d, 'schedule-form');
  await d.keyboard.press('Escape');
  await go(d, '/week?view=week');

  /* ---------- Holidays ---------- */
  await go(d, '/team?view=holidays');
  await mark(d, [{ n: 1, loc: d.getByRole('button', { name: /Record leave/ }) }]);
  await save(d, 'holidays');

  /* ---------- Enquiries ---------- */
  await go(d, '/enquiries');
  await d.getByRole('region', { name: /^Selected enquiry$/ }).or(d.locator('aside[aria-label="Selected enquiry"]')).first().waitFor({ timeout: 30000 }).catch(() => {});
  await mark(d, [
    { n: 1, loc: d.getByRole('tab', { name: /Needs reply/ }) },
    { n: 2, loc: d.locator('textarea[id^="reply-"]') },
    { n: 3, loc: d.getByRole('button', { name: /Send reply|Copy reply/ }).first() },
    { n: 4, loc: d.getByRole('button', { name: /I've replied/ }).first() },
  ]);
  await save(d, 'enquiry');
  await mark(d, [{ n: 1, loc: d.getByRole('toolbar', { name: 'Enquiry actions' }).getByRole('button', { name: /Create quote/ }) }]);
  await save(d, 'enquiry-quote');

  /* ---------- Jobs ---------- */
  await go(d, '/jobs');
  await mark(d, [
    { n: 1, loc: d.getByRole('button', { name: /Add job/ }) },
    { n: 2, loc: d.getByRole('tablist', { name: 'Jobs' }) },
    { n: 3, loc: d.getByRole('searchbox', { name: 'Search jobs' }) },
  ]);
  await save(d, 'jobs');
  const job = 'rdg_job_kitchen_copthorne';
  await go(d, `/jobs/${job}`);
  await mark(d, [
    { n: 1, loc: d.getByRole('combobox', { name: 'Job status' }).or(d.getByLabel('Job status')) },
    { n: 2, loc: d.getByRole('button', { name: 'Edit dates' }) },
    { n: 3, loc: d.getByRole('link', { name: /Directions/ }) },
    { n: 4, loc: d.locator('[aria-label="Quick actions"]') },
    { n: 5, loc: d.getByRole('tablist', { name: 'Job sections' }) },
  ]);
  await save(d, 'job');
  await d.locator('[aria-label="Quick actions"]').getByRole('button', { name: 'Add update' }).click();
  await d.getByRole('dialog').first().waitFor();
  await d.waitForTimeout(600);
  await save(d, 'add-update');
  await d.keyboard.press('Escape');
  await go(d, `/jobs/${job}?tab=documents`);
  await save(d, 'job-documents');

  /* ---------- Materials, tasks ---------- */
  await go(d, '/materials');
  await mark(d, [{ n: 1, loc: d.getByRole('button', { name: /Add material/ }) }, { n: 2, loc: d.getByRole('tablist', { name: 'Order status' }) }, { n: 3, loc: d.locator('main select').filter({ hasText: 'To order' }).first() }]);
  await save(d, 'materials');
  await go(d, '/tasks');
  await mark(d, [{ n: 1, loc: d.getByRole('button', { name: /Add task/ }) }, { n: 2, loc: d.locator('main button.row-secondary').first() }]);
  await save(d, 'tasks');

  /* ---------- Customers, team, merchants ---------- */
  await go(d, '/customers');
  await mark(d, [{ n: 1, loc: d.getByRole('button', { name: /Add customer/ }) }, { n: 2, loc: d.getByRole('tablist', { name: 'Customer type' }) }]);
  await save(d, 'customers');
  await d.getByRole('button', { name: /Add customer/ }).click();
  await d.getByRole('dialog').waitFor();
  await d.getByRole('radio', { name: 'Commercial' }).click();
  await d.getByLabel('Company name').fill('Hollybank Care Homes Ltd');
  await d.getByLabel('Main contact').fill('Jo Marsh');
  await d.waitForTimeout(300);
  await save(d, 'customer-form');
  await d.keyboard.press('Escape');
  await go(d, '/team');
  await mark(d, [{ n: 1, loc: d.getByRole('button', { name: /Add person/ }) }]);
  await save(d, 'team');
  await go(d, '/merchants');
  await save(d, 'merchants');

  /* ---------- Money ---------- */
  await go(d, '/invoices');
  await mark(d, [
    { n: 1, loc: d.getByRole('region', { name: 'Headline figures' }) },
    { n: 2, loc: d.getByRole('button', { name: /Create invoice/ }) },
    { n: 3, loc: d.getByRole('button', { name: /Record payment/ }) },
    { n: 4, loc: d.getByRole('tab', { name: /Bills to pay/ }) },
  ]);
  await save(d, 'money');

  /* ---------- Handover (a finished garden room in the demo) ---------- */
  const gr = 'rdg_job_gardenroom_lingfield';
  const s0 = await d.evaluate(async () => (await fetch('/api/data')).json());
  let rid = s0.reports.find((r) => r.jobId === gr)?.id;
  if (!rid) rid = (await ops(d, 'createReport', { jobId: gr })).value?.id;
  await go(d, `/jobs/${gr}/handover?step=2`);
  await save(d, 'handover-photos');
  await go(d, `/jobs/${gr}/handover?step=3`);
  await mark(d, [{ n: 1, loc: d.getByRole('button', { name: /Let Bob write my report/ }) }]);
  await save(d, 'handover-report');
  await go(d, `/jobs/${gr}/handover?step=4`);
  await save(d, 'handover-costs');
  if (rid) await ops(d, 'finishReport', { id: rid });
  await go(d, `/jobs/${gr}/handover?step=5`);
  await mark(d, [{ n: 1, loc: d.getByRole('button', { name: 'Send to customer' }) }]);
  await save(d, 'handover-finish');
  await d.getByRole('button', { name: 'Send to customer' }).click();
  await d.getByRole('region', { name: 'Send to customer' }).waitFor({ timeout: 30000 });
  await d.waitForTimeout(800);
  await d.getByRole('region', { name: 'Send to customer' }).scrollIntoViewIfNeeded();
  await save(d, 'send-to-customer');

  /* ---------- Ask Bob ---------- */
  await go(d, '/assistant');
  await mark(d, [{ n: 1, loc: d.getByRole('button', { name: /Tap to talk|talk to Bob/i }).first() }, { n: 2, loc: d.getByPlaceholder(/Type to Bob/) }]);
  await save(d, 'ask-bob');

  /* ---------- Help ---------- */
  await go(d, '/settings?open=help');
  await d.getByRole('link', { name: /Open the user guide/ }).scrollIntoViewIfNeeded();
  await mark(d, [{ n: 1, loc: d.getByRole('link', { name: /Open the user guide/ }) }]);
  await save(d, 'help');

  /* ---------- Phone ---------- */
  const m = await session(b, PHONE);
  await go(m, '/home');
  const bar = m.getByRole('navigation', { name: 'Main' }).last();
  await mark(m, [
    { n: 1, loc: bar.getByRole('link', { name: 'Home' }) },
    { n: 2, loc: bar.getByRole('link', { name: 'Diary' }) },
    { n: 3, loc: bar.getByRole('link', { name: /Ask Bob/ }) },
    { n: 4, loc: bar.getByRole('link', { name: 'Jobs' }) },
    { n: 5, loc: bar.getByRole('link', { name: 'Tasks' }) },
    { n: 6, loc: m.getByRole('button', { name: /^More/ }) },
  ]);
  await save(m, 'phone-home');
  await go(m, '/week');
  await mark(m, [{ n: 1, loc: m.getByRole('combobox', { name: 'Show work for' }) }, { n: 2, loc: m.getByRole('tablist', { name: 'Jump to a day' }) }]);
  await save(m, 'phone-diary');
  await go(m, `/jobs/${job}`);
  await save(m, 'phone-job');

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
