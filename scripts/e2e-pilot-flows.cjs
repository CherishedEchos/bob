/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Ninety3 pilot flows (fictional data, local dev server only): node scripts/e2e-pilot-flows.cjs
// Screenshots go to $OUT (default /tmp).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (flow, name, ok, extra = '') => { results.push({ flow, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${flow}] ${name}${extra ? ' — ' + extra : ''}`); };
const DESK = { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] };
const LAPTOP = { viewport: { width: 1280, height: 800 } };
const WIDE = { viewport: { width: 1920, height: 1080 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const ROB = `rob+${Date.now()}@turner-groundworks.example`;
const london = (n) => { const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ops = (page, op, args) => page.evaluate(async ([op, args]) => (await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) })).json(), [op, args]);
const snap = (page) => page.evaluate(async () => (await fetch('/api/data')).json());
const ics = (page, path) => page.evaluate(async (p) => { const r = await fetch(p); return { status: r.status, text: await r.text() }; }, path);

(async () => {
  const b = await chromium.launch();
  const errors = [];

  /* 1. Diary with nothing below it; weeks, filter, schedule, edit an unassigned booking */
  const oc = await b.newContext(DESK);
  const o = await oc.newPage();
  o.on('pageerror', (e) => errors.push(e.message));
  await o.goto(BASE + '/login');
  await o.evaluate(async () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@ninety3.example', password: 'bob-demo' }) }));
  await o.goto(BASE + '/');
  await o.waitForURL('**/week');
  await o.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await o.reload();
  await o.getByRole('heading', { name: 'Diary', level: 1 }).waitFor();
  check(1, 'Sidebar and page call it Diary', await o.getByRole('link', { name: 'Diary' }).first().isVisible());
  const main = await o.locator('main').innerText();
  check(1, 'No panels below the diary', !/Needs attention|Not scheduled yet/.test(main));
  check(1, 'No permanent drag tip', !/Tip: drag/.test(main));
  const range1 = await o.getByRole('toolbar', { name: 'Diary controls' }).locator('[aria-live="polite"]').innerText();
  await o.getByRole('button', { name: 'Next week' }).click();
  await o.waitForFunction((r) => document.querySelector('[role=toolbar] [aria-live="polite"]')?.textContent !== r, range1, { timeout: 10000 }).catch(() => {});
  const range2 = await o.getByRole('toolbar', { name: 'Diary controls' }).locator('[aria-live="polite"]').innerText();
  await o.getByRole('toolbar', { name: 'Diary controls' }).getByRole('button', { name: 'Today', exact: true }).click();
  await o.waitForFunction((r) => document.querySelector('[role=toolbar] [aria-live="polite"]')?.textContent === r, range1, { timeout: 10000 }).catch(() => {});
  check(1, 'Week navigation updates the date range', range1 !== range2 && (await o.getByRole('toolbar', { name: 'Diary controls' }).locator('[aria-live="polite"]').innerText()) === range1, `${range1} → ${range2}`);
  await o.getByRole('toolbar', { name: 'Diary controls' }).locator('select').selectOption({ label: 'Sam Okoro · Plasterer' });
  await o.waitForTimeout(500);
  const cards = await o.getByRole('region', { name: 'Week' }).locator('button[draggable]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || ''));
  check(1, 'Filter by a subcontractor shows only their work', cards.length > 0 && cards.every((t) => /Sam/.test(t)), `${cards.length} bookings`);
  await o.getByRole('toolbar', { name: 'Diary controls' }).locator('select').selectOption({ label: 'Everyone' });
  const unassigned = o.getByRole('button', { name: /nobody assigned/ }).first();
  await unassigned.waitFor();
  check(1, 'Unassigned booking shows a small Needs someone label', /Needs someone/.test(await unassigned.innerText()));
  await unassigned.click();
  const bf = o.getByRole('dialog', { name: 'Schedule work' });
  await bf.waitFor();
  await o.waitForTimeout(400);
  const focusedInPeople = await o.evaluate(() => !!document.activeElement?.closest('fieldset')?.textContent?.includes("Who's on it"));
  check(1, 'Opening it lands on the assignment control', focusedInPeople && (await bf.getByText('Unassigned — choose someone').isVisible()));
  await bf.getByRole('button', { name: /Ellie Ward/ }).click();
  await bf.getByRole('button', { name: 'Save changes' }).click();
  const clash1 = await bf.getByText('Double booking').waitFor({ timeout: 2500 }).then(() => true).catch(() => false);
  if (clash1) await bf.getByRole('button', { name: 'Book anyway' }).click();
  await bf.waitFor({ state: 'detached', timeout: 8000 });
  check(1, 'Edited unassigned booking now has Ellie', (await snap(o)).bookings.find((x) => x.id === 'n93_bk_patel_templating').personIds.includes('n93_per_ellie'));
  // keyboard: per-day Add reachable
  const addBtn = o.getByRole('button', { name: /^Schedule work on / }).first();
  await addBtn.focus();
  check(1, 'Per-day Add is keyboard reachable', await addBtn.evaluate((el) => el === document.activeElement));

  /* 2. Add a subcontractor, schedule them, invite; on a phone find time, directions, w3w, access note */
  await o.goto(BASE + '/team');
  await o.getByRole('button', { name: 'Add person' }).first().click();
  let d = o.getByRole('dialog');
  await d.getByLabel('Name').fill('Rob Turner');
  await d.getByText('Subcontractor', { exact: true }).click();
  await d.getByLabel('Trade (optional)').fill('Groundworker');
  await d.getByLabel('Email (optional)').fill(ROB);
  await d.getByRole('button', { name: 'Add person' }).click();
  await o.getByRole('button', { name: 'Open Rob Turner' }).waitFor();
  const robId = (await snap(o)).people.find((p) => p.name === 'Rob Turner').id;
  const tomorrow = london(1);
  const book = await ops(o, 'saveBooking', { input: { jobId: 'n93_job_mediawall_reigate', date: tomorrow, startTime: '07:30', endTime: '15:00', personIds: [robId], notes: 'Fit the media wall frame.' } });
  check(2, 'Rob scheduled on tomorrow’s job', book.ok === true, book.error || '');
  await o.getByRole('button', { name: 'Open Rob Turner' }).click();
  const ps = o.getByRole('dialog', { name: 'Team: Rob Turner' });
  await ps.getByRole('button', { name: 'Invite to Bob' }).click();
  const inviteUrl = await ps.getByLabel(/Invite link for/).inputValue();
  check(2, 'Invite created and shown as pending', /\/invite\//.test(inviteUrl) && /Invite pending/.test(await ps.innerText()));
  await o.keyboard.press('Escape');
  const wc = await b.newContext(PHONE);
  const w = await wc.newPage();
  await w.goto(inviteUrl);
  await w.getByLabel('Choose a password').fill('groundwork-2026');
  await w.getByRole('button', { name: /Accept and see my work/ }).tap();
  await w.waitForURL('**/my-work', { timeout: 15000 });
  const next = w.locator('article').first();
  await next.waitFor();
  const nt = await next.innerText();
  check(2, 'Phone: next booking shows the time first', /Tomorrow · 07:30–15:00/.test(nt));
  check(2, 'Phone: address, what3words and access note visible without tapping', /Somers Road/.test(nt) && /velvet\.anchor\.timber/.test(nt) && /visitor permit/.test(nt));
  const maps = await next.getByRole('link', { name: 'Open in maps' }).getAttribute('href');
  const w3 = await next.getByRole('link', { name: 'Open in what3words' }).getAttribute('href');
  check(2, 'Phone: Open in maps and Open in what3words links', maps.includes('google.com/maps') && w3.includes('what3words.com/velvet.anchor.timber'));
  const overflow = await w.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(2, 'Phone: no horizontal scrolling on My work', overflow <= 1, String(overflow));
  await w.screenshot({ path: `${OUT}/pilot-mywork-390.png` });
  // Rob's personal calendar link
  const robFeed = await w.evaluate(async () => (await fetch('/api/my-calendar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json());
  const robIcs = await ics(w, robFeed.value.path);
  check(2, "Rob's personal calendar feed has his booking", robIcs.status === 200 && robIcs.text.includes('Media wall') && robIcs.text.includes(`DTSTART;TZID=Europe/London:${tomorrow.replace(/-/g, '')}T073000`));

  /* 3. Move and reassign: right people see it, old assignee loses it, feeds follow; overlap + failed save */
  const ownerFeed = await ops(o, 'createFeed', { scope: 'company' });
  const bookingId = book.value.id;
  await o.goto(BASE + `/week?w=${tomorrow}`);
  await o.getByRole('button', { name: /^Media wall,.*Rob Turner/ }).first().click();
  const ef = o.getByRole('dialog', { name: 'Schedule work' });
  await ef.waitFor();
  const dayAfter = london(2);
  await ef.getByLabel('Day', { exact: true }).fill(dayAfter);
  await ef.getByRole('button', { name: /Rob Turner/ }).click();
  await ef.getByRole('button', { name: /Liam Carter/ }).click();
  await o.route('**/api/ops', (r) => r.abort(), { times: 1 });
  await ef.getByRole('button', { name: 'Save changes' }).click();
  await ef.getByRole('alert').first().waitFor();
  check(3, 'Failed save keeps the edited day and people', (await ef.getByLabel('Day', { exact: true }).inputValue()) === dayAfter && (await ef.getByRole('button', { name: /Liam Carter/ }).getAttribute('aria-pressed')) === 'true');
  await ef.getByRole('button', { name: 'Save changes' }).click();
  const clash = await ef.getByText('Double booking').waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
  if (clash) {
    const msg = (await ef.getByRole('alert').filter({ hasText: 'Double booking' }).innerText()).replace(/\n/g, ' ');
    check(3, 'Overlap names the person and clash', /Liam Carter.*already on/.test(msg), msg.slice(0, 110));
    await ef.getByRole('button', { name: 'Book anyway' }).click();
  } else {
    // Make a guaranteed clash to prove the warning.
    const c = await ops(o, 'saveBooking', { input: { jobId: 'n93_job_stairs_horley', date: dayAfter, startTime: '08:00', endTime: '09:00', personIds: ['n93_per_liam'] } });
    check(3, 'Overlap names the person and clash', c.code === 'conflict' && /Liam Carter is already booked/.test(c.error), c.error);
  }
  await ef.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await w.getByRole('button', { name: 'Refresh' }).tap();
  await w.waitForTimeout(1000);
  const robNow = await w.evaluate(async () => (await fetch('/api/my-work')).json());
  check(3, 'Rob no longer sees the moved job or its details', robNow.value.bookings.every((x) => x.id !== bookingId));
  check(3, "Rob's calendar feed drops the booking", !(await ics(w, robFeed.value.path)).text.includes(bookingId));
  const companyIcs = (await ics(o, ownerFeed.value.path)).text;
  check(3, 'Company feed shows the same event (same UID) at the new date', (companyIcs.match(new RegExp(`UID:${bookingId}@`, 'g')) || []).length === 1 && companyIcs.includes(`DTSTART;TZID=Europe/London:${dayAfter.replace(/-/g, '')}T073000`));
  check(3, 'Feeds carry no access notes, codes or customer contacts', !/visitor permit|4471|07700|@example\.com/.test(companyIcs));
  const s3 = await snap(o);
  check(3, 'Liam now on the booking', s3.bookings.find((x) => x.id === bookingId).personIds.includes('n93_per_liam'));

  /* 4. Enquiry: full message, edit + save draft; to quote → quote sent → won → schedule; no duplicate */
  await o.goto(BASE + '/enquiries');
  const pane = o.getByRole('complementary', { name: 'Selected enquiry' });
  await o.locator('li.row-open', { hasText: 'Chris Walker' }).getByRole('button').click();
  await pane.getByRole('heading', { name: 'Chris Walker', exact: true }).waitFor();
  check(4, 'Full original message above the reply', /Monday 1st December/.test(await pane.getByTestId('customer-message').innerText()));
  const ta = pane.locator('textarea');
  await ta.fill((await ta.inputValue()) + '\n\nP.S. PILOT-EDIT');
  await pane.getByRole('button', { name: 'Save draft' }).click();
  await pane.getByText('Draft saved').first().waitFor();
  check(4, 'Saved draft is not a reply', (await snap(o)).enquiries.find((e) => e.customerName === 'Chris Walker' && e.title === 'Garden office').status === 'new');
  const chris = (await snap(o)).enquiries.find((e) => e.customerName === 'Chris Walker' && e.title === 'Garden office');
  await ops(o, 'setEnquiryStatus', { id: chris.id, status: 'quote_required' });
  const cust = await ops(o, 'createCustomer', { input: { name: 'Chris Walker', town: 'Cuckfield' } });
  await ops(o, 'updateEnquiry', { id: chris.id, patch: { customerId: cust.value.id } }).catch(() => {});
  const quote = await ops(o, 'createQuote', { input: { customerId: cust.value.id, enquiryId: chris.id, description: 'Garden office 3.5m x 2.5m', amount: 14200, status: 'sent' } });
  check(4, 'To quote → quote sent', quote.ok && (await snap(o)).enquiries.find((e) => e.id === chris.id).status === 'quoted');
  await o.reload();
  await o.getByRole('tab', { name: /Quote sent/ }).click();
  await o.locator('li.row-open', { hasText: 'Chris Walker' }).getByRole('button').click();
  await pane.getByRole('heading', { name: 'Chris Walker', exact: true }).waitFor();
  await pane.getByRole('button', { name: 'Won — create job' }).click();
  await pane.getByText('Job created').waitFor();
  const retry = await ops(o, 'convertToJob', { enquiryId: chris.id });
  const garden = retry.snapshot.jobs.filter((j) => j.enquiryId === chris.id);
  check(4, 'Won creates one job with customer, site and price; retry returns it', garden.length === 1 && retry.value.existed && garden[0].customerName === 'Chris Walker' && garden[0].quotedValue === 14200 && /Cuckfield/.test(garden[0].siteAddress || garden[0].location));
  await pane.getByRole('button', { name: 'Schedule work' }).click();
  const sf = o.getByRole('dialog', { name: 'Schedule work' });
  check(4, 'Schedule work opens with the won job preselected', /Garden office/.test(await sf.getByLabel('Job').locator('option:checked').innerText()));
  await o.keyboard.press('Escape');
  await o.goto(BASE + '/jobs');
  await o.getByRole('heading', { name: 'Jobs', level: 1 }).waitFor();
  await o.getByLabel('Search jobs').fill('Garden office');
  await o.waitForTimeout(400);
  check(4, 'Won job is on Jobs (search finds it)', /Garden office/.test(await o.locator('main').innerText()));

  /* 5. Material from a job, assign merchant, mark ordered from Materials; job and merchant reflect it */
  await o.getByText('Garden office').first().click();
  await o.waitForURL(/\/jobs\/[^/?]+/);
  await o.locator('[aria-label="Quick actions"]').getByRole('button', { name: 'Add material' }).click();
  const mf = o.getByRole('dialog', { name: 'Add to order list' });
  await mf.getByLabel('Item').fill('Treated C24 timber 47x100');
  await mf.getByLabel('Quantity').fill('24');
  await mf.getByLabel('Unit (optional)').fill('lengths');
  await mf.getByRole('button', { name: 'Add material' }).click();
  await mf.waitFor({ state: 'detached' });
  const mat = (await snap(o)).materials.find((m) => m.item === 'Treated C24 timber 47x100');
  check(5, 'Material added from the job without a merchant', !!mat && !mat.merchantId && mat.unit === 'lengths');
  await o.keyboard.press('Escape');
  await o.goto(BASE + '/materials');
  await o.getByRole('button', { name: /Edit Treated C24/ }).filter({ visible: true }).first().click();
  const ed = o.getByRole('dialog', { name: 'Add to order list' });
  await ed.getByLabel('Merchant (optional)').selectOption({ label: 'Crawley Timber Supplies · Manor Royal' });
  await ed.getByRole('button', { name: 'Save item' }).click();
  await ed.waitFor({ state: 'detached' });
  await o.getByLabel('Status for Treated C24 timber 47x100').filter({ visible: true }).first().selectOption('ordered');
  await o.waitForTimeout(700);
  const m2 = (await snap(o)).materials.find((m) => m.item === 'Treated C24 timber 47x100');
  check(5, 'Merchant assigned and marked Ordered from Materials', m2.merchantId === 'n93_mer_timber' && m2.status === 'ordered');
  await o.screenshot({ path: `${OUT}/pilot-materials-1440.png` });
  await o.goto(BASE + '/merchants?open=n93_mer_timber');
  const ms = o.getByRole('dialog', { name: 'Merchant: Crawley Timber Supplies' });
  await ms.waitFor();
  check(5, 'Merchant shows the open order', /Treated C24 timber 47x100[\s\S]*Ordered/.test(await ms.innerText()));
  check(5, 'Owner sees account reference and password-manager link (no password)', /N93-4471/.test(await ms.innerText()) && (await ms.getByRole('link', { name: 'Open in password manager' }).count()) === 1);
  await o.keyboard.press('Escape');
  await o.goto(BASE + `/jobs/${garden[0].id}?tab=materials`);
  await o.getByRole('tab', { name: /Materials & tasks/, selected: true }).waitFor();
  check(5, 'Job shows the same item as Ordered with the merchant', /Treated C24[\s\S]*Crawley Timber Supplies/.test(await o.locator('#job-tabpanel').innerText()));

  /* 6. Assign and complete a job task; record a supplier bill payment; open QuickBooks */
  const t = await ops(o, 'createTask', { input: { title: 'Pick up timber order', dueDate: london(0), relatedType: 'job', relatedId: garden[0].id, assignedPersonId: 'n93_per_callum' } });
  await o.goto(BASE + '/tasks');
  const row = o.locator('li', { hasText: 'Pick up timber order' }).first();
  check(6, 'Task shows assignee and job', /For Callum Price/.test(await row.innerText()) && /Garden office/.test(await row.innerText()));
  await row.getByRole('button', { name: 'Complete: Pick up timber order' }).click();
  await o.waitForTimeout(600);
  check(6, 'Task completed (same record)', (await snap(o)).tasks.find((x) => x.id === t.value.id).done === true);
  await o.goto(BASE + '/invoices?view=bills');
  const bill = o.locator('li', { hasText: 'Crawley Timber Supplies' }).first();
  await bill.getByRole('button', { name: 'Record payment' }).first().click();
  await bill.getByLabel('Paid on').fill(london(0));
  await bill.getByRole('button', { name: /Record payment of/ }).click();
  await o.waitForTimeout(700);
  const paid = (await snap(o)).bills.find((x) => x.supplier === 'Crawley Timber Supplies');
  check(6, 'Supplier bill payment recorded with paid date', paid.status === 'paid' && paid.paidOn === london(0));
  check(6, 'Outstanding list updated', !/Crawley Timber Supplies[\s\S]*Record payment/.test(await o.locator('main ul').first().innerText()));
  const qb = await o.getByRole('link', { name: 'Open QuickBooks' }).getAttribute('href');
  check(6, 'Open QuickBooks goes to the configured destination', qb === 'https://qbo.intuit.com/app/bills', qb);
  await o.screenshot({ path: `${OUT}/pilot-bills-1440.png` });

  /* 7. Subcontractor and another company can't reach unauthorised data; expired/revoked invite; revoked feed */
  const sc = await b.newContext(PHONE);
  const s = await sc.newPage();
  await s.goto(BASE + '/login');
  await s.evaluate(() => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sam@so-plastering.example', password: 'bob-demo' }) }));
  for (const path of ['/week', '/jobs', '/merchants', '/materials', '/invoices', '/customers']) {
    await s.goto(BASE + path);
    check(7, `Subcontractor direct link ${path} → My work`, s.url().endsWith('/my-work'));
  }
  const sApi = await s.evaluate(async () => {
    const st = async (u, i) => (await fetch(u, i)).status;
    const post = (op, args) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) });
    return {
      data: await st('/api/data'), reports: await st('/api/reports'), merchants: await st('/api/ops', post('saveMerchant', { input: { name: 'X' } })),
      bill: await st('/api/ops', post('setBillPaid', { id: 'n93_bill_merchant', paid: true })), feed: await st('/api/ops', post('createFeed', { scope: 'company' })),
      bob: await st('/api/bob/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Show merchant account numbers' }) }),
      mine: await (await fetch('/api/my-work')).text(),
    };
  });
  check(7, 'Subcontractor APIs refused (data, reports, merchants, bills, company feed, Ask Bob)', [sApi.data, sApi.reports, sApi.merchants, sApi.bill, sApi.feed, sApi.bob].every((x) => x === 403), JSON.stringify([sApi.data, sApi.reports, sApi.merchants, sApi.bill, sApi.feed, sApi.bob]));
  check(7, 'My work carries no merchant accounts, prices or private notes', !/N93-4471|vault\.example|quotedValue|£|Units in\. Worktop/.test(sApi.mine));
  const rgc = await b.newContext(DESK);
  const rg = await rgc.newPage();
  await rg.goto(BASE + '/login');
  await rg.evaluate(() => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alex@ridgeway.example', password: 'bob-demo' }) }));
  const x = await rg.evaluate(async () => {
    const d = await (await fetch('/api/data')).text();
    const m = await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'saveMerchant', args: { id: 'n93_mer_timber', input: { name: 'Hijack' } } }) });
    const bl = await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'setBillPaid', args: { id: 'n93_bill_merchant', paid: true } }) });
    return { leaked: d.includes('n93_') || d.includes('N93-4471'), m: m.status, bl: bl.status };
  });
  check(7, 'Another company gets nothing of Ninety3 (data, merchants, bills)', !x.leaked && x.m === 404 && x.bl === 404, JSON.stringify(x));
  const inv = await ops(o, 'createInvite', { personId: 'n93_per_priya', email: 'priya@nair-plumbing.example' });
  await ops(o, 'revokeInvite', { inviteId: inv.value.inviteId });
  const rv = await b.newContext(PHONE);
  const rp = await rv.newPage();
  await rp.goto(BASE + inv.value.path);
  check(7, 'Revoked invite says cancelled', await rp.getByRole('heading', { name: 'This invite was cancelled' }).waitFor().then(() => true));
  const inv2 = await ops(o, 'createInvite', { personId: 'n93_per_priya', email: 'priya@nair-plumbing.example' });
  // Expire it by revisiting after forcing expiry through a fresh, unrelated API isn't possible from the UI; the unit test covers expiry. Check the copy instead:
  await rp.goto(BASE + '/invite/' + 'x'.repeat(43));
  check(7, "Invalid invite link explains itself", await rp.getByRole('heading', { name: "This link doesn't work" }).waitFor().then(() => true));
  void inv2;
  await ops(o, 'revokeFeed', { id: ownerFeed.value.id });
  check(7, 'Revoked calendar link stops working', (await ics(rp, ownerFeed.value.path)).status === 404);

  /* 8. Main screens: desktop, laptop, wide, phone — load, actions, no overflow, no errors */
  for (const [label, opts] of [['1440', DESK], ['1280', LAPTOP], ['1920', WIDE], ['390', PHONE]]) {
    const c = await b.newContext(opts);
    const p = await c.newPage();
    const local = [];
    p.on('pageerror', (e) => local.push(e.message));
    await p.goto(BASE + '/login');
    await p.evaluate(async () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@ninety3.example', password: 'bob-demo' }) }));
    await p.goto(BASE + '/');
    await p.waitForURL('**/week');
    const pages = [['/week', /Diary/, /Schedule work/], ['/jobs', /Jobs/, /Add job/], ['/enquiries', /Enquiries/, /Add/], ['/materials', /Materials/, /Add material/], ['/merchants', /Merchants/, /Add merchant/], ['/team', /Team/, /Add person/], ['/customers', /Customers/, /Add customer/], ['/tasks', /Tasks/, /Add task/], ['/invoices', /Money/, /Owed to you[\s\S]*Overdue[\s\S]*Received/], ['/invoices?view=bills', /Money/, /Add bill/], ['/settings', /Settings/, /Calendar/]];
    for (const [path, title, action] of pages) {
      await p.goto(BASE + path);
      await p.waitForTimeout(500);
      const h = await p.getByRole('heading', { level: 1 }).first().innerText().catch(() => '');
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(8, `${label}: ${path}`, title.test(h) && action.test(await p.locator('body').innerText()) && ov <= 1, `${h}${ov > 1 ? ` overflow ${ov}` : ''}`);
    }
    if (label === '1920' || label === '1280') {
      await p.goto(BASE + '/week');
      await p.locator('section[aria-label="Week"]').waitFor({ timeout: 30000 });
      await p.waitForTimeout(500);
      const geo = await p.evaluate(() => {
        const grid = document.querySelector('section[aria-label="Week"]').getBoundingClientRect();
        const main = document.querySelector('main').getBoundingClientRect();
        const clipped = [...document.querySelectorAll('section[aria-label="Week"] button[draggable]')].some((el) => el.scrollWidth > el.clientWidth + 1);
        return { leftGap: Math.round(grid.left - main.left), rightGap: Math.round(main.right - grid.right), clipped, col: Math.round(grid.width / 6.1) };
      });
      check(8, `${label}: diary uses the width (gutters ≤ 56px, no clipped cards)`, geo.leftGap <= 56 && geo.rightGap <= 56 && !geo.clipped, JSON.stringify(geo));
      await p.screenshot({ path: `${OUT}/pilot-diary-${label}.png` });
    }
    if (label === '390') {
      await p.goto(BASE + '/week');
      await p.getByRole('heading', { name: 'Diary' }).waitFor();
      check(8, '390: agenda starts with today and Schedule work is visible', /^Today/.test(await p.getByRole('region', { name: /^Agenda/ }).locator('h2').first().innerText()) && (await p.getByRole('button', { name: 'Schedule work', exact: true }).isVisible()));
      await p.getByRole('region', { name: /^Agenda/ }).getByRole('button', { name: /^Booking: / }).first().tap();
      const dd = p.getByRole('dialog', { name: 'Schedule work' });
      await dd.waitFor();
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(8, '390: booking editor opens without horizontal scrolling', ov <= 1 && (await dd.getByText("Who's on it").first().isVisible()));
      await p.keyboard.press('Escape');
      await p.screenshot({ path: `${OUT}/pilot-diary-390.png` });
    }
    check(8, `${label}: no page errors`, local.length === 0, local.slice(0, 2).join(' | '));
    await c.close();
  }

  await o.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  check(0, 'No uncaught page errors in the flows', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
