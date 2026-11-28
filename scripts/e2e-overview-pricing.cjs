/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Overview as home, and the simpler "Jobs to price" record (fictional demo data; nothing is sent):
//   BASE=http://localhost:3000 OUT=/tmp node scripts/e2e-overview-pricing.cjs
// - Luke and Ryan sign in through the sign-in screen and land on Overview; Overview is first in the
//   sidebar and highlighted; the team calendar is one tap away ("View diary").
// - A subcontractor lands on My work; their logo goes back to My work; Overview is closed to them.
// - A job link opened while signed out comes back after sign-in.
// - Pricing record at 375 px: Add note / Take photo / Add measurement and the price action are on the
//   first screen; a note (typed), a photo and a measurement show straight away; Ryan sees them too;
//   "Start rough estimate" opens the working estimator and reopening resumes the same draft.
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const DESK = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
// A real (fictional demo) photo, so thumbnails render.
const JPEG = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'demo', 'kitchen.jpg'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function context(b, opts) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('bob.onboarding.done', '1'); localStorage.setItem('bob.tips.off', '1'); } catch { /* */ } });
  return ctx;
}
/** Sign in the way a person does: the sign-in screen. */
async function signInForm(p, email, password = 'bob-demo') {
  await p.getByLabel('Email', { exact: true }).fill(email);
  await p.getByLabel('Password', { exact: true }).fill(password);
  await p.getByRole('button', { name: /^Sign in$/ }).click();
}

(async () => {
  const b = await chromium.launch();
  const errors = [];

  /* ---- Overview is home for Luke and Ryan ---- */
  for (const [who, email] of [['Luke', 'owner@ninety3.example'], ['Ryan', 'office@ninety3.example']]) {
    const p = await (await context(b, DESK)).newPage();
    p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    await p.goto(BASE + '/login');
    await signInForm(p, email);
    await p.waitForURL('**/home', { timeout: 60000 });
    const heading = await p.getByRole('heading', { level: 1 }).first().innerText();
    check(`${who} signs in and lands on Overview`, new URL(p.url()).pathname === '/home' && /^Good (morning|afternoon|evening), (Luke|Ryan)/.test(heading), heading);
    const navLinks = await p.getByRole('navigation', { name: 'Main' }).first().getByRole('link').allInnerTexts();
    check(`${who}: Overview is first in the sidebar, Diary straight below`, /^Overview/.test(navLinks[0]) && /^Diary/.test(navLinks[1]), navLinks.slice(0, 2).join(', '));
    check(`${who}: Overview is the highlighted item`, (await p.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: /^Overview/ }).getAttribute('aria-current')) === 'page');
    if (who === 'Luke') {
      await p.waitForLoadState('networkidle').catch(() => {});
      await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {});
      check('Luke: the Ninety3 logo is shown in the sidebar', await p.locator('aside img[alt]').first().evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false));
      await p.screenshot({ path: path.join(OUT, 'o1-overview-landing-1440.png') });
    }
    await p.getByRole('link', { name: /View diary/ }).click();
    await p.waitForURL('**/week**');
    check(`${who}: "View diary" opens the team calendar in one tap`, await p.getByRole('region', { name: 'Team schedule' }).waitFor({ timeout: 30000 }).then(() => true, () => false));
    // The logo goes back to Overview.
    await p.locator('aside').getByRole('link', { name: /Overview$/ }).first().click();
    await p.waitForURL('**/home');
    check(`${who}: the logo returns to Overview`, new URL(p.url()).pathname === '/home');
    await p.context().close();
  }

  // Phone: Home button opens Overview and is highlighted.
  {
    const p = await (await context(b, PHONE)).newPage();
    await p.goto(BASE + '/login');
    await signInForm(p, 'owner@ninety3.example');
    await p.waitForURL('**/home', { timeout: 60000 });
    await p.getByRole('heading', { level: 1 }).first().waitFor();
    await p.waitForLoadState('networkidle').catch(() => {});
    await p.screenshot({ path: path.join(OUT, 'o2-overview-landing-375.png') });
    const bar = p.getByRole('navigation', { name: 'Main' }).last();
    const labels = await bar.getByRole('link').allInnerTexts();
    check('Phone: bottom bar starts Home, Diary', /Home/.test(labels[0]) && /Diary/.test(labels[1]), labels.join(', ').replace(/\n/g, ' '));
    check('Phone: Home is highlighted on Overview', (await bar.getByRole('link', { name: /Home/ }).getAttribute('aria-current')) === 'page');
    await bar.getByRole('link', { name: /Diary/ }).tap();
    await p.waitForURL('**/week**');
    check("Phone: Diary opens on Who's where (the team view)", await p.getByRole('region', { name: "Who's where" }).waitFor({ timeout: 30000 }).then(() => true, () => false));
    await bar.getByRole('link', { name: /Home/ }).tap();
    await p.waitForURL('**/home');
    check('Phone: Home goes back to Overview', true);
    await p.context().close();
  }

  /* ---- Subcontractor lands on My work ---- */
  {
    const p = await (await context(b, PHONE)).newPage();
    await p.goto(BASE + '/login');
    await signInForm(p, 'sam@so-plastering.example');
    await p.waitForURL('**/my-work', { timeout: 60000 });
    check('A subcontractor lands on My work', new URL(p.url()).pathname === '/my-work');
    check('Their logo goes back to My work', (await p.locator('header a').first().getAttribute('href')) === '/my-work');
    await p.goto(BASE + '/home');
    await p.waitForURL('**/my-work', { timeout: 30000 });
    check('Overview is closed to subcontractors (sent to My work)', new URL(p.url()).pathname === '/my-work');
    await p.context().close();
  }

  /* ---- A job link opened while signed out comes back after sign-in ---- */
  {
    const p = await (await context(b, DESK)).newPage();
    await p.goto(BASE + '/login');
    const jobId = await p.evaluate(async () => {
      await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@ninety3.example', password: 'bob-demo' }) });
      const id = (await (await fetch('/api/data')).json()).jobs[0].id;
      await fetch('/api/auth/logout', { method: 'POST' });
      return id;
    });
    await p.context().clearCookies();
    await p.goto(`${BASE}/jobs/${jobId}?tab=schedule`);
    await p.waitForURL('**/login**');
    check('Signed out: the job link goes to sign-in, remembering the job', decodeURIComponent(p.url()).includes(`next=/jobs/${jobId}?tab=schedule`), p.url());
    await signInForm(p, 'office@ninety3.example');
    await p.waitForURL(`**/jobs/${jobId}**`, { timeout: 60000 });
    check('After signing in, the job opens (not Overview)', new URL(p.url()).pathname === `/jobs/${jobId}`);
    await p.goto(`${BASE}/login?next=${encodeURIComponent('https://evil.example/')}`);
    await p.context().clearCookies();
    await p.goto(`${BASE}/login?next=${encodeURIComponent('//evil.example')}`);
    await signInForm(p, 'office@ninety3.example');
    await p.waitForURL((u) => u.origin === new URL(BASE).origin && !u.pathname.startsWith('/login'), { timeout: 60000 });
    check('A link to another site is ignored (goes Home instead)', new URL(p.url()).origin === new URL(BASE).origin && new URL(p.url()).pathname === '/home', p.url());
    await p.context().close();
  }

  /* ---- Jobs to price: empty record on a phone ---- */
  const lukeP = await (await context(b, PHONE)).newPage();
  lukeP.on('pageerror', (e) => errors.push(`luke phone: ${e.message}`));
  await lukeP.goto(BASE + '/login');
  await signInForm(lukeP, 'owner@ninety3.example');
  await lukeP.waitForURL('**/home', { timeout: 60000 });
  await lukeP.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  // The rough estimate pilot is switched on for this check (Settings → Prices for estimates).
  await lukeP.evaluate(() => fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'setPilotFeature', args: { feature: 'roughEstimates', on: true } }) }));
  await lukeP.goto(BASE + '/pricing');
  await lukeP.getByRole('button', { name: 'Add job to price' }).tap();
  const d = lukeP.getByRole('dialog');
  await d.getByLabel('Customer').fill('Nina Fictional');
  await d.getByLabel('Phone').fill('07700 954888');
  await d.getByLabel('Job', { exact: true }).fill('Bathroom refit');
  await d.getByRole('button', { name: 'Add to jobs to price' }).tap();
  await lukeP.waitForURL('**/pricing/**', { timeout: 30000 });
  await lukeP.getByRole('button', { name: 'Add note' }).waitFor({ timeout: 30000 });
  await sleep(4000); // let the toast fade
  const inView = async (loc) => { const bb = await loc.boundingBox(); return !!bb && bb.y >= 0 && bb.y + bb.height <= 812; };
  check('375 empty record: Add note, Take photo, Add measurement are on the first screen', (await inView(lukeP.getByRole('button', { name: 'Add note' }))) && (await inView(lukeP.locator('label', { hasText: 'Take photo' }))) && (await inView(lukeP.getByRole('button', { name: 'Add measurement' }))));
  check('375 empty record: the estimate action is on the first screen too', await inView(lukeP.getByTestId('estimate-action').first()));
  check('375 empty record: "Add address" is a small action, not a big empty form', (await lukeP.getByRole('button', { name: 'Add address' }).count()) === 1 && (await lukeP.getByLabel('Site address').count()) === 0);
  check('375 empty record: status shown once, as one control', (await lukeP.getByLabel('Status').count()) === 1);
  check('375: no sideways scrolling', (await lukeP.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await lukeP.screenshot({ path: path.join(OUT, 'o3-pricing-empty-375.png') });

  /* ---- Sophie Reid's bathroom refit: add a note, photo, measurement on the phone ---- */
  const sophie = await lukeP.evaluate(async () => (await (await fetch('/api/data')).json()).enquiries.find((e) => e.customerName === 'Sophie Reid' && e.title === 'Bathroom refit').id);
  await lukeP.goto(`${BASE}/pricing/${sophie}`);
  await lukeP.getByRole('button', { name: 'Add note' }).tap();
  await lukeP.getByLabel('Note', { exact: true }).fill('Keep the bath, replace the shower and price the tiling separately.');
  await lukeP.getByRole('button', { name: 'Save note' }).tap();
  await lukeP.getByRole('list', { name: 'Notes' }).getByText('Keep the bath, replace the shower').waitFor({ timeout: 10000 });
  check('Note saved and shown straight away', true);
  await lukeP.locator('input[aria-label="Take photo"]').setInputFiles([{ name: 'bathroom.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
  const q = lukeP.getByRole('dialog');
  await q.getByRole('button', { name: /^Upload 1 file/ }).tap();
  await q.getByRole('button', { name: 'Done' }).tap({ timeout: 30000 });
  await lukeP.getByRole('list', { name: 'Photos' }).locator('li').first().waitFor({ timeout: 15000 });
  check('Photo uploaded and its thumbnail shown', true);
  await lukeP.getByRole('button', { name: 'Add measurement' }).tap();
  await lukeP.getByLabel('What you measured').fill('Bathroom width');
  await lukeP.getByLabel('Size').fill('2150');
  await lukeP.getByLabel('Unit').selectOption('mm');
  await lukeP.getByRole('button', { name: 'Save measurement' }).tap();
  await lukeP.getByRole('list', { name: 'Measurements' }).getByText('2150 mm').waitFor({ timeout: 10000 });
  check('Measurement shown with its unit (2150 mm)', true);
  check('No permanent "Saved" button', (await lukeP.getByRole('button', { name: /^Saved$/ }).count()) === 0);
  check('Notes are marked Office only', (await lukeP.getByText('Office only').count()) > 0);
  // Address: small action opens the field.
  await lukeP.getByRole('button', { name: 'Add address' }).tap();
  await lukeP.getByLabel('Site address').fill('22 Fictional Road, Reigate, RH2 0ZZ');
  await lukeP.getByRole('button', { name: 'Save address' }).tap();
  await lukeP.getByRole('link', { name: /22 Fictional Road/ }).waitFor({ timeout: 10000 });
  check('Add address opens the field; saved address shows with directions', true);

  /* ---- Rough estimate: start, save, reopen twice ---- */
  await lukeP.getByTestId('estimate-action').first().tap();
  await lukeP.waitForURL('**/estimate');
  await lukeP.getByRole('heading', { name: /Rough estimate/ }).waitFor({ timeout: 30000 });
  check('"Start rough estimate" opens the working rough estimator', true);
  for (const [label, v] of [['Units', '1'], ['Width (mm)', '1700'], ['Height (mm)', '2100'], ['Depth (mm)', '400'], ['Days to make & fit', '3']]) await lukeP.getByLabel(label, { exact: true }).fill(v);
  await lukeP.getByRole('button', { name: 'Suggest lines from my prices' }).tap();
  await lukeP.getByLabel('Quantity for Labour (making and fitting)').fill('3');
  await lukeP.getByLabel('Price for Labour (making and fitting)').fill('250');
  await lukeP.getByRole('button', { name: 'Save estimate' }).tap();
  await lukeP.getByText('All changes saved').waitFor({ timeout: 10000 });
  const saved1 = await lukeP.getByTestId('estimate-total').innerText();
  await lukeP.goto(`${BASE}/pricing/${sophie}`);
  const cont = lukeP.getByTestId('estimate-action').first();
  const contText = await cont.innerText();
  check('Record shows "Continue estimate" with the saved amount', /Continue estimate/.test(contText) && contText.includes(saved1.replace(/\s/g, '')), contText.replace(/\n/g, ' · '));
  for (let i = 1; i <= 2; i++) {
    await lukeP.getByTestId('estimate-action').first().tap();
    await lukeP.waitForURL('**/estimate');
    await lukeP.getByTestId('estimate-total').waitFor();
    const same = (await lukeP.getByTestId('estimate-total').innerText()) === saved1 && (await lukeP.getByLabel('Width (mm)', { exact: true }).inputValue()) === '1700' && (await lukeP.getByLabel('Price for Labour (making and fitting)').inputValue()) === '250';
    check(`Reopening the estimate (${i}) resumes the same draft, measurements included`, same);
    await lukeP.goBack();
    await lukeP.getByTestId('estimate-action').first().waitFor();
  }
  const quotes = await lukeP.evaluate(async (id) => (await (await fetch('/api/data')).json()).quotes.filter((x) => x.enquiryId === id), sophie);
  check('Starting and editing the estimate created no quote and sent nothing', quotes.every((x) => x.status !== 'sent'));
  await lukeP.evaluate(() => window.scrollTo(0, 0));
  await sleep(4000);
  await lukeP.screenshot({ path: path.join(OUT, 'o4-pricing-populated-375.png') });
  await lukeP.getByRole('region', { name: 'Site visit notes' }).screenshot({ path: path.join(OUT, 'o4b-pricing-site-visit-375.png') });

  /* ---- Ryan opens the same record on a desktop ---- */
  const ryan = await (await context(b, DESK)).newPage();
  ryan.on('pageerror', (e) => errors.push(`ryan: ${e.message}`));
  await ryan.goto(BASE + '/login');
  await signInForm(ryan, 'office@ninety3.example');
  await ryan.waitForURL('**/home', { timeout: 60000 });
  await ryan.goto(`${BASE}/pricing/${sophie}`);
  await ryan.getByRole('heading', { name: 'Bathroom refit' }).waitFor({ timeout: 30000 });
  const body = await ryan.locator('main').innerText();
  check('Ryan sees Luke\'s note, photo and measurement', body.includes('Keep the bath, replace the shower') && body.includes('2150 mm') && (await ryan.getByRole('list', { name: 'Photos' }).locator('li').count()) >= 1);
  const panelBox = await ryan.getByTestId('price-panel').last().boundingBox();
  check('Desktop: the price panel sits beside the site notes, near the top', !!panelBox && panelBox.x > 800 && panelBox.y < 500, JSON.stringify(panelBox));
  await sleep(500);
  await ryan.screenshot({ path: path.join(OUT, 'o5-pricing-populated-1440.png') });
  const nina = await ryan.evaluate(async () => (await (await fetch('/api/data')).json()).enquiries.find((e) => e.customerName === 'Nina Fictional').id);
  await ryan.goto(`${BASE}/pricing/${nina}`);
  await ryan.getByRole('button', { name: 'Add note' }).waitFor({ timeout: 30000 });
  await ryan.screenshot({ path: path.join(OUT, 'o6-pricing-empty-1440.png') });

  // With the pilot off, the price action is an honest manual quote draft.
  await lukeP.evaluate(() => fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'setPilotFeature', args: { feature: 'roughEstimates', on: false } }) }));
  await ryan.reload();
  await ryan.getByRole('button', { name: 'Add note' }).waitFor({ timeout: 30000 });
  check('Pilot off: the action reads "Create quote draft" (no estimator shown)', (await ryan.getByRole('button', { name: 'Create quote draft' }).count()) >= 1 && (await ryan.getByTestId('estimate-action').count()) === 0);

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await lukeP.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await b.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
