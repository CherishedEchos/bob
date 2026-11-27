/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// The everyday tasks from the usability brief, done through the real UI on a phone and on a desktop
// (fictional demo data; resets the sample workspace first):
//   BASE=http://localhost:3000 OUT=/tmp node scripts/e2e-ux-tasks.cjs
// Can a user find tomorrow's work, add a job, find a customer's address, book a holiday, upload a
// photo, add materials, check money owed and create an invoice through Bob?
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (size, name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} [${size}] ${name}${extra ? ' — ' + extra : ''}`); };
const SIZES = {
  'phone-375': { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 1 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const london = (n) => { const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const snap = (p) => p.evaluate(async () => (await fetch('/api/data')).json());
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

/** Go somewhere the way a person would: the sidebar on desktop, the tab bar or More sheet on a phone. */
async function nav(p, size, label) {
  if (size === 'desktop') return p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: new RegExp(`^${label}`) }).first().click();
  const bar = p.getByRole('navigation', { name: 'Main' }).last();
  const direct = bar.getByRole('link', { name: new RegExp(`^${label}`) });
  if (await direct.count()) return direct.first().click();
  await p.getByRole('button', { name: /^More/ }).first().click();
  await p.getByRole('dialog').getByRole('link', { name: new RegExp(`^${label}`) }).click();
}

(async () => {
  const b = await chromium.launch();
  for (const [size, opts] of Object.entries(SIZES)) {
    const ctx = await b.newContext(opts);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(BASE + '/login');
    await p.evaluate(async ([email, password]) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }), [process.env.LUKE_EMAIL || 'owner@ninety3.example', process.env.LUKE_PASSWORD || 'bob-demo']);
    await p.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
    await p.goto(BASE + '/');
    await p.waitForURL('**/home', { timeout: 90000 });
    await p.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ }).waitFor({ timeout: 60000 });
    check(size, 'Home is the landing page, with View diary', await p.getByRole('link', { name: /View diary/ }).isVisible());
    await nav(p, size, 'Diary');
    await p.waitForURL('**/week');

    /* 1. Tomorrow's work: the Diary shows tomorrow's bookings */
    const tomorrow = london(1);
    const data = await snap(p);
    const tmrw = data.bookings.filter((bk) => bk.date <= tomorrow && (bk.endDate || bk.date) >= tomorrow);
    const jobTitle = (id) => data.jobs.find((j) => j.id === id)?.title;
    if (size.startsWith('phone')) {
      const day = String(Number(tomorrow.slice(8)));
      await p.locator('main button').filter({ hasText: new RegExp(`^\\s*[MTWFS]\\s*${day}\\s*$`) }).first().click();
      await p.waitForTimeout(400);
    }
    const diary = await p.locator('main').innerText();
    check(size, "Tomorrow's work is on the Diary", tmrw.length === 0 || tmrw.some((bk) => diary.includes(jobTitle(bk.jobId))), `${tmrw.length} booking(s)`);

    /* 2. Add a job */
    await nav(p, size, 'Jobs');
    await p.waitForURL('**/jobs');
    await p.getByRole('button', { name: /Add job/ }).first().click();
    const jf = p.getByRole('dialog');
    await jf.getByLabel('Customer name').fill(`Test Customer ${size}`);
    await jf.getByLabel('Job', { exact: true }).fill(`Porch build ${size}`);
    await jf.getByLabel('Town').fill('Crawley');
    await jf.getByRole('button', { name: /^Add job$/ }).click();
    await p.waitForURL(/\/jobs\/[^/?]+$/, { timeout: 60000 }).catch(() => {});
    check(size, 'Add a job from Jobs', (await snap(p)).jobs.some((j) => j.title === `Porch build ${size}`));
    await p.keyboard.press('Escape').catch(() => {});

    /* 3. Find a customer's address */
    await nav(p, size, 'Customers');
    await p.getByRole('searchbox').or(p.getByPlaceholder(/Search name/)).first().fill('Sophie Mackay');
    await p.getByText('Sophie Mackay').first().click();
    await p.waitForTimeout(800);
    check(size, "Find a customer's address", /7 Oak Road/.test(await p.getByRole('dialog').innerText().catch(() => '')));
    await p.keyboard.press('Escape');

    /* 4. Book a holiday */
    await nav(p, size, 'Team');
    await p.getByRole('tab', { name: /Holidays/ }).click();
    await p.getByRole('button', { name: /Record leave/ }).first().click();
    const lv = p.getByRole('dialog');
    const person = data.people.find((x) => x.name === 'Ellie Ward') || data.people[0];
    await lv.getByLabel('Who').selectOption(person.id);
    await lv.getByLabel('First day').fill(london(20));
    await lv.getByRole('button', { name: /Record|Save|Book/ }).last().click();
    await p.waitForTimeout(1000);
    check(size, 'Book a holiday from Team → Holidays', (await snap(p)).absences.some((a) => a.personId === person.id && a.startDate === london(20)));
    await p.keyboard.press('Escape').catch(() => {});

    /* 5 + 6. Upload a photo and add materials from the job page's quick actions */
    await p.goto(BASE + '/jobs/n93_job_mackay_kitchen');
    await p.getByRole('toolbar', { name: 'Quick actions' }).or(p.locator('[aria-label="Quick actions"]')).first().waitFor();
    const quick = p.locator('[aria-label="Quick actions"]');
    for (const name of ['Add update', 'Upload photo', 'Schedule work', 'Add material']) check(size, `Job page quick action: ${name}`, await quick.getByRole('button', { name }).isVisible());
    await quick.getByRole('button', { name: 'Upload photo' }).click();
    await p.waitForTimeout(600);
    const before = (await snap(p)).files.filter((f) => f.jobId === 'n93_job_mackay_kitchen').length;
    const input = p.locator('#job-photos input[type=file]').first();
    await input.setInputFiles({ name: `site-${size}.jpg`, mimeType: 'image/jpeg', buffer: JPEG });
    await p.getByRole('button', { name: /^Upload 1 file/ }).click();
    await p.waitForTimeout(2500);
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.locator('main').evaluate((m) => m.scrollTo(0, 0));
    check(size, 'Upload a photo from the job page', (await snap(p)).files.filter((f) => f.jobId === 'n93_job_mackay_kitchen').length > before);
    await p.waitForTimeout(600);
    await quick.getByRole('button', { name: 'Add material' }).click();
    const mf = p.getByRole('dialog');
    await mf.getByLabel('Item').fill(`Oak shelf boards ${size}`);
    await mf.getByLabel('Quantity').fill('4');
    await mf.locator('button[type=submit]').click();
    await p.waitForTimeout(1000);
    check(size, 'Add materials from the job page', (await snap(p)).materials.some((m) => m.item === `Oak shelf boards ${size}` && m.jobId === 'n93_job_mackay_kitchen'));
    await p.keyboard.press('Escape').catch(() => {});

    /* 7. Check money owed */
    await nav(p, size, 'Money');
    await p.waitForURL('**/invoices');
    const money = await p.locator('main').innerText();
    check(size, 'Money owed is the first figure on Money', /Owed to you\s*£[\d,]+/.test(money) && /Overdue/.test(money) && /Received/.test(money));
    await p.screenshot({ path: path.join(OUT, `ux-task-${size}-money.png`) });

    /* 8. Invoice through Bob (built-in engine here; no AI key) */
    await p.goto(BASE + '/assistant');
    await p.getByRole('heading', { name: /What are we sorting today\?|What do you need a hand with\?/ }).waitFor();
    const box = p.getByPlaceholder(/Type to Bob/);
    if (!(await box.isVisible())) await p.getByRole('button', { name: /^Type$/ }).click();
    await box.fill("Prepare an invoice for the final balance on Sophie Mackay's Oak Road kitchen");
    const resp = p.waitForResponse((r) => r.url().includes('/api/bob/message'));
    await p.getByRole('button', { name: 'Send to Bob' }).click();
    await resp;
    await p.waitForTimeout(800);
    const said = await p.locator('main, body').first().innerText();
    check(size, 'Create an invoice draft through Bob', /Saved draft BOB-\d+|Create invoice draft|plus VAT or including VAT/.test(said), said.match(/(Saved draft[^\n]*|VAT[^\n]*)/)?.[0]?.slice(0, 90));
    await p.screenshot({ path: path.join(OUT, `ux-task-${size}-bob-invoice.png`) });

    /* Desktop: Ask Bob from any page, knowing the job on screen */
    if (size === 'desktop') {
      await p.goto(BASE + '/jobs/n93_job_mackay_kitchen');
      await p.getByRole('button', { name: /Ask Bob about Sophie Mackay/ }).click();
      const panelText = await p.getByRole('dialog').innerText();
      check(size, 'Desktop Ask Bob button opens Bob with the job as context', /About Sophie Mackay — Oak Road kitchen|looking at Sophie Mackay/.test(panelText));
      await p.screenshot({ path: path.join(OUT, `ux-task-desktop-ask-bob-panel.png`) });
    }
    // Nothing important hidden behind the floating nav: the last item on long pages can scroll clear of it.
    if (size.startsWith('phone')) {
      await p.goto(BASE + '/jobs/n93_job_mackay_kitchen');
      await p.waitForTimeout(800);
      const clear = await p.evaluate(() => {
        const main = document.querySelector('main');
        main.scrollTo(0, main.scrollHeight);
        const nav = [...document.querySelectorAll('nav[aria-label="Main"]')].pop().getBoundingClientRect();
        const items = [...main.querySelectorAll('button, a')].filter((el) => el.offsetParent);
        const last = items[items.length - 1].getBoundingClientRect();
        return last.bottom <= nav.top + 2;
      });
      check(size, 'Phone: the floating nav never covers the last control on a page', clear);
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(size, 'Phone: job page has no sideways scrolling', ov <= 1, String(ov));
      const small = await p.evaluate(() => [...document.querySelectorAll('[aria-label="Quick actions"] button')].filter((b) => b.getBoundingClientRect().height < 44).length);
      check(size, 'Phone: job quick actions are at least 44px tall', small === 0, `${small} small`);
      await p.screenshot({ path: path.join(OUT, `ux-task-${size}-job.png`) });
    }
    check(size, 'No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  await b.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
