/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Run against a local dev server: node scripts/e2e-team-flows.cjs (screenshots go to $OUT or /tmp).
// End-to-end flows for the team/schedule brief. Fictional data, local dev server only.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const results = [];
const ROB = `rob+${Date.now()}@turner-groundworks.example`;
const check = (flow, name, ok, extra = '') => { results.push({ flow, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${flow}] ${name}${extra ? ' — ' + extra : ''}`); };
const DESK = { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] };

function london(offsetDays) {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));

  /* -------- Flow 1: owner creates a job, adds a sub without an account, books them tomorrow -------- */
  const oc = await b.newContext(DESK);
  const o = await oc.newPage();
  watch(o, 'owner');
  await o.goto(BASE + '/login');
  await o.evaluate(async () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@ninety3.example', password: 'bob-demo' }) }));
  await o.goto(BASE + '/');
  await o.waitForURL('**/week');
  check(1, 'Signing in lands on the Diary', await o.getByRole('heading', { name: 'Diary', level: 1 }).waitFor().then(() => true));
  await o.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await o.reload();
  // Add a person (no login)
  await o.goto(BASE + '/team');
  await o.getByRole('button', { name: 'Add person' }).first().click();
  const dlg = o.getByRole('dialog');
  await dlg.getByLabel('Name').fill('Rob Turner');
  await dlg.getByText('Subcontractor', { exact: true }).click();
  await dlg.getByLabel('Trade (optional)').fill('Groundworker');
  await dlg.getByLabel('Company (optional)').fill('Turner Groundworks');
  await dlg.getByLabel('Email (optional)').fill(ROB);
  await dlg.getByRole('button', { name: 'Add person' }).click();
  await o.getByRole('listitem').filter({ has: o.getByRole('button', { name: 'Open Rob Turner' }) }).waitFor();
  check(1, 'Subcontractor added without an account (Not invited)', /Not invited/.test(await o.getByRole('listitem').filter({ has: o.getByRole('button', { name: 'Open Rob Turner' }) }).innerText()));
  // Create the job
  await o.goto(BASE + '/jobs');
  await o.getByRole('button', { name: 'Add job' }).first().click();
  const jd = o.getByRole('dialog');
  await jd.getByLabel('Customer name').fill('Grace Fielding');
  await jd.getByLabel('Job', { exact: true }).fill('Garden room base');
  await jd.getByLabel('Town').fill('Lingfield');
  await jd.getByLabel('Site address (optional)').fill('7 High Street, Lingfield, RH7 6AA');
  await jd.getByLabel('Price (£)').fill('4200');
  await jd.getByRole('button', { name: 'Add job' }).click();
  await o.waitForURL(/\/jobs\/[^/?]+/);
  const sheet = o.locator('main');
  await sheet.getByRole('heading', { name: 'Garden room base' }).waitFor();
  const quick = sheet.locator('[aria-label="Quick actions"]');
  check(1, 'New job opens its page with Schedule work in the quick actions', await quick.getByRole('button', { name: 'Schedule work' }).isVisible());
  await quick.getByRole('button', { name: 'Schedule work' }).click();
  const bf = o.getByRole('dialog', { name: 'Schedule work' });
  await bf.waitFor();
  const tomorrow = london(1);
  await bf.getByLabel('Day', { exact: true }).fill(tomorrow);
  await bf.getByLabel('Start time').fill('08:00');
  await bf.getByLabel('End time').fill('16:00');
  await bf.getByRole('button', { name: /Rob Turner/ }).click();
  await bf.getByLabel(/Instructions for the team/).fill('Dig and level the base. Gate code 1290.');
  await bf.getByRole('button', { name: 'Schedule work', exact: true }).click();
  await bf.waitFor({ state: 'detached', timeout: 8000 });
  await o.keyboard.press('Escape');
  await o.goto(BASE + `/week?w=${tomorrow}`);
  const card = o.getByRole('button', { name: /Garden room base, Lingfield, 08:00–16:00, Rob Turner/ }).first();
  check(1, "Rob is booked on tomorrow's job in the planner", await card.waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await o.screenshot({ path: `${OUT}/e2e-week-desk.png` });
  // Invite Rob
  await o.goto(BASE + '/team');
  await o.getByRole('button', { name: 'Open Rob Turner' }).click();
  const ps = o.getByRole('dialog', { name: 'Team: Rob Turner' });
  await ps.getByRole('button', { name: 'Invite to Bob' }).click();
  const linkBox = ps.getByLabel(/Invite link for/);
  await linkBox.waitFor();
  const inviteUrl = await linkBox.inputValue();
  await ps.getByRole('button', { name: 'Copy link' }).click();
  await ps.getByRole('button', { name: 'Copied' }).waitFor();
  check(1, 'Invite link created, copyable, state shows pending', inviteUrl.includes('/invite/') && /Invite pending/.test(await ps.innerText()));
  await o.keyboard.press('Escape');

  /* -------- Flow 2: Rob accepts on his phone and finds the job -------- */
  const wc = await b.newContext(PHONE);
  const w = await wc.newPage();
  watch(w, 'rob');
  await w.goto(inviteUrl);
  await w.getByRole('heading', { name: 'Hi Rob' }).waitFor();
  check(2, 'Invite page is bound to the invited email', (await w.getByLabel('Email').inputValue()) === ROB);
  await w.getByLabel('Choose a password').fill('groundwork-2026');
  await w.getByRole('button', { name: /Accept and see my work/ }).tap();
  await w.waitForURL('**/my-work', { timeout: 15000 });
  await w.getByRole('heading', { name: 'My work' }).waitFor();
  await w.getByText('Garden room base').first().waitFor();
  const next = w.locator('article').first();
  const nextText = await next.innerText();
  check(2, 'Next booking first: tomorrow, 08:00–16:00', /Tomorrow · 08:00–16:00/.test(nextText));
  check(2, 'Site address and instructions visible with no extra taps', /7 High Street, Lingfield/.test(nextText) && /Gate code 1290/.test(nextText));
  const dir = await next.getByRole('link', { name: 'Open in maps' }).getAttribute('href');
  check(2, 'Directions opens maps to the site', dir && dir.includes('google.com/maps') && dir.includes('Lingfield'));
  check(2, 'No prices on My work', !/£|4,200|4200/.test(await w.locator('body').innerText()));
  await w.screenshot({ path: `${OUT}/e2e-mywork-phone.png` });

  /* -------- Flow 3 + 4: move and reassign; overlap warning; failed save keeps input -------- */
  await o.goto(BASE + `/week?w=${tomorrow}`);
  await o.getByRole('button', { name: /Garden room base, Lingfield/ }).first().click();
  const ef = o.getByRole('dialog', { name: 'Schedule work' });
  await ef.waitFor();
  const dayAfter = london(2);
  await ef.getByLabel('Day', { exact: true }).fill(dayAfter);
  await ef.getByRole('button', { name: /Rob Turner/ }).click(); // remove Rob
  await ef.getByRole('button', { name: /Callum Price/ }).click(); // add Callum (busy on the extension)
  // Failed save: the network drops once — input is kept.
  await o.route('**/api/ops', (r) => r.abort(), { times: 1 });
  await ef.getByRole('button', { name: 'Save changes' }).click();
  await ef.getByRole('alert').first().waitFor();
  const kept = (await ef.getByLabel('Day', { exact: true }).inputValue()) === dayAfter && (await ef.getByLabel(/Instructions for the team/).inputValue()).includes('Gate code 1290') && (await ef.getByRole('button', { name: /Callum Price/ }).getAttribute('aria-pressed')) === 'true';
  check(4, 'A failed save keeps everything typed', kept, (await ef.getByRole('alert').first().innerText()).slice(0, 80));
  await ef.getByRole('button', { name: 'Save changes' }).click();
  const clash = ef.getByText('Double booking');
  const hadClash = await clash.waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
  if (hadClash) {
    const msg = await ef.getByRole('alert').filter({ hasText: 'Double booking' }).innerText();
    check(4, 'Overlap warning names the person and the clash', /Callum Price.*is already on/.test(msg.replace(/\n/g, ' ')), msg.replace(/\n/g, ' ').slice(0, 120));
    await ef.getByRole('button', { name: 'Book anyway' }).click();
  } else check(4, 'Overlap warning names the person and the clash', false, 'no clash shown (Callum free on that day?)');
  await ef.waitFor({ state: 'detached', timeout: 8000 });
  await w.getByRole('button', { name: 'Refresh' }).tap();
  await w.waitForTimeout(1200);
  check(3, "Rob's My work drops the job after he's taken off it", /No work booked/.test(await w.locator('body').innerText()));
  const robApi = await w.evaluate(async () => (await fetch('/api/my-work')).json());
  check(3, "Rob's API no longer returns the job, its tasks or materials", robApi.value.bookings.length === 0 && robApi.value.materials.length === 0);
  await o.goto(BASE + `/week?w=${dayAfter}&person=n93_per_callum`);
  check(3, "Callum's schedule shows the moved booking", await o.getByRole('button', { name: /Garden room base, Lingfield, 08:00–16:00, Callum Price/ }).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));

  /* -------- Flow 5: enquiry — read, edit, save, copy; saved draft ≠ replied -------- */
  await o.goto(BASE + '/enquiries');
  const pane = o.getByRole('complementary', { name: 'Selected enquiry' });
  await o.locator('li.row-open', { hasText: 'Hannah Whitfield' }).getByRole('button').click();
  await pane.getByRole('heading', { name: 'Hannah Whitfield', exact: true }).waitFor();
  check(5, 'Full customer message shown above the reply', /Roughly 4m x 3.5m/.test(await pane.getByTestId('customer-message').innerText()));
  const ta = pane.locator('textarea');
  await ta.fill((await ta.inputValue()) + '\n\nP.S. E2E-EDIT');
  await pane.getByRole('button', { name: 'Save draft' }).click();
  await pane.getByText('Draft saved').first().waitFor();
  let hannahRow = await o.locator('li.row-open', { hasText: 'Hannah Whitfield' }).first().innerText();
  check(5, 'Saved draft shows "Draft saved" and stays in Needs reply', /Draft saved/.test(hannahRow) && !/Replied/.test(hannahRow));
  await pane.getByRole('button', { name: /Copy reply/ }).click();
  await pane.getByRole('button', { name: /Copied/ }).waitFor();
  const clip = await o.evaluate(() => navigator.clipboard.readText());
  check(5, 'Copied text includes the edit', clip.includes('E2E-EDIT'));
  check(5, 'Copying does not mark it replied', /Needs your reply|Draft saved/.test(await pane.innerText()) && !(await pane.getByText(/^Replied/).isVisible().catch(() => false)));
  await pane.getByRole('button', { name: "I've replied" }).click();
  await pane.getByRole('button', { name: "Yes, I've replied" }).click();
  await o.waitForTimeout(800);
  const snap = await o.evaluate(async () => (await fetch('/api/data')).json());
  const hannah = snap.enquiries.find((e) => e.customerName === 'Hannah Whitfield' && e.title === 'Kitchen renovation');
  check(5, "I've replied records the reply state", hannah.status === 'replied');

  /* -------- Flow 6: enquiry → won job → schedule; retry makes no duplicate -------- */
  await o.goto(BASE + '/enquiries?tab=all');
  await o.getByRole('tab', { name: /All/ }).click();
  await o.locator('li.row-open', { hasText: 'Laura Bishop' }).first().getByRole('button').click();
  await pane.getByRole('heading', { name: 'Laura Bishop', exact: true }).waitFor();
  const fold = pane.getByRole('button', { name: /Quote & job/ });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await pane.getByRole('button', { name: 'Won — create job' }).click();
  await pane.getByText('Job created').waitFor();
  const jobsBefore = (await o.evaluate(async () => (await fetch('/api/data')).json())).jobs.filter((j) => j.title === 'Composite decking').length;
  const retry = await o.evaluate(async (id) => (await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'convertToJob', args: { enquiryId: id } }) })).json(), (await o.evaluate(async () => (await fetch('/api/data')).json())).enquiries.find((e) => e.customerName === 'Laura Bishop' && e.title === 'Composite decking').id);
  const jobsAfter = retry.snapshot.jobs.filter((j) => j.title === 'Composite decking');
  check(6, 'Retrying the conversion returns the same job (no duplicate)', jobsBefore === 1 && jobsAfter.length === 1 && retry.value.existed === true);
  check(6, 'Job keeps the customer and site', jobsAfter[0].customerName === 'Laura Bishop' && /Crawley Down/.test(jobsAfter[0].siteAddress || jobsAfter[0].location));
  await pane.getByRole('button', { name: 'Schedule work' }).click();
  const sf = o.getByRole('dialog', { name: 'Schedule work' });
  await sf.waitFor();
  check(6, 'Schedule work opens with the new job selected', /Composite decking/.test(await sf.getByLabel('Job').locator('option:checked').innerText()));
  await o.keyboard.press('Escape');

  /* -------- Flow 7: task, materials, bill to pay -------- */
  await o.goto(BASE + '/jobs/n93_job_kitchen_crawley?tab=materials');
  const pj = o.locator('#job-tabpanel');
  await o.getByRole('tab', { name: /Materials & tasks/, selected: true }).waitFor();
  await pj.getByRole('button', { name: 'Add task' }).click();
  const tf = o.getByRole('dialog', { name: 'Add task' });
  await tf.getByLabel(/What do you need/).fill('Collect island end panels');
  await tf.getByLabel('Assign to (optional)').selectOption({ label: 'Liam Carter · Lead carpenter' });
  await tf.getByRole('button', { name: 'Assign task' }).click();
  await tf.waitFor({ state: 'detached' });
  check(7, 'Task assigned to a person on the job', /Collect island end panels[\s\S]*For Liam Carter/.test(await pj.innerText()));
  await pj.getByLabel(/Status for Quartz worktop offcuts/).selectOption('ordered');
  await o.waitForTimeout(700);
  const mats = (await o.evaluate(async () => (await fetch('/api/data')).json())).materials;
  check(7, 'Materials order updated to Ordered', mats.find((m) => m.item.startsWith('Quartz worktop offcuts')).status === 'ordered');
  await o.keyboard.press('Escape');
  await o.goto(BASE + '/invoices?view=bills');
  const billsText = await o.locator('main').innerText();
  check(7, 'A supplier bill due for payment is easy to identify', /Bills/.test(billsText) && /Davies Electrical[\s\S]*Overdue/.test(billsText));

  /* -------- Flow 8: subcontractor can't reach anything else; revoked invite unusable -------- */
  const sc = await b.newContext(PHONE);
  const s = await sc.newPage();
  watch(s, 'sam');
  await s.goto(BASE + '/login');
  await s.evaluate(() => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sam@so-plastering.example', password: 'bob-demo' }) }));
  for (const path of ['/week', '/jobs', '/customers', '/invoices', '/team', '/enquiries', '/assistant']) {
    await s.goto(BASE + path);
    check(8, `Direct link ${path} sends the subcontractor to My work`, s.url().endsWith('/my-work'));
  }
  const api = await s.evaluate(async () => {
    const r = async (u, init) => (await fetch(u, init)).status;
    const post = (op, args) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) });
    return {
      data: await r('/api/data'),
      reports: await r('/api/reports'),
      createJob: await r('/api/ops', post('createJob', { input: { customerName: 'X', title: 'Hack', location: 'X', quotedValue: 1 } })),
      booking: await r('/api/ops', post('saveBooking', { input: { jobId: 'n93_job_kitchen_copthorne', date: '2026-12-01', allDay: true, personIds: [] } })),
      bob: await r('/api/bob/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: "Who's not paid me?" }) }),
      exportAll: await r('/api/privacy/export'),
      myWork: await (await fetch('/api/my-work')).json(),
    };
  });
  check(8, 'Company data API refused (403)', api.data === 403, String(api.data));
  check(8, 'Reports API refused', api.reports >= 400, String(api.reports));
  check(8, 'Writes refused (create job, schedule)', api.createJob === 403 && api.booking === 403, `${api.createJob}/${api.booking}`);
  check(8, 'Ask Bob refused for workers', api.bob === 403, String(api.bob));
  check(8, 'Data export refused', api.exportAll >= 400, String(api.exportAll));
  check(8, "My work holds only Sam's own job, no money", api.myWork.value.bookings.every((x) => x.job.id === 'n93_job_extension_copthorne') && !/quotedValue|£/.test(JSON.stringify(api.myWork)));
  // Revoked invite
  const inv = await o.evaluate(async () => (await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'createInvite', args: { personId: 'n93_per_priya', email: 'priya@nair-plumbing.example' } }) })).json());
  await o.evaluate(async (id) => fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'revokeInvite', args: { inviteId: id } }) }), inv.value.inviteId);
  const rc = await b.newContext(PHONE);
  const r = await rc.newPage();
  await r.goto(BASE + inv.value.path);
  await r.getByRole('heading', { name: 'This invite was cancelled' }).waitFor();
  const accept = await r.evaluate(async (p) => (await fetch('/api/invite/' + p.split('/').pop(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'whatever-123' }) })).status, inv.value.path);
  check(8, 'Revoked invite shows as cancelled and cannot be accepted', accept === 403);
  // Another company's owner
  const rgc = await b.newContext(DESK);
  const rg = await rgc.newPage();
  await rg.goto(BASE + '/login');
  await rg.evaluate(() => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'alex@ridgeway.example', password: 'bob-demo' }) }));
  const cross = await rg.evaluate(async () => {
    const d = await (await fetch('/api/data')).json();
    const edit = await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'saveBooking', args: { input: { id: 'n93_bk_sophie_fit', jobId: 'n93_job_kitchen_copthorne', date: '2026-12-01', allDay: true, personIds: [] } } }) });
    return { leaked: JSON.stringify(d).includes('n93_'), edit: edit.status };
  });
  check(8, "Another company can't read or change Ninety3's schedule", !cross.leaked && cross.edit === 404, JSON.stringify(cross));

  /* -------- Flow 9: navigation, empty states and primary actions, desktop and phone -------- */
  for (const [label, ctxOpts] of [['desktop', DESK], ['phone 390', PHONE]]) {
    const c = await b.newContext(ctxOpts);
    const p = await c.newPage();
    const local = [];
    p.on('pageerror', (e) => local.push(e.message));
    await p.goto(BASE + '/login');
    await p.evaluate(async () => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@ninety3.example', password: 'bob-demo' }) }));
    await p.goto(BASE + '/');
    await p.waitForURL('**/week');
    const pages = [
      ['/week', /Diary/, /Schedule work/],
      ['/enquiries', /Enquiries/, /Add enquiry|Add/],
      ['/jobs', /Jobs/, /Add job/],
      ['/team', /Team/, /Add person/],
      ['/customers', /Customers/, /Add customer/],
      ['/invoices', /Money/, /Owed to you[\s\S]*Overdue[\s\S]*Received/],
      ['/invoices?view=bills', /Money/, /Add bill/],
      ['/materials', /Materials/, /Add material/],
      ['/tasks', /Tasks/, /Add task/],
      ['/settings', /Settings/, /Email & accounting/],
    ];
    for (const [path, title, action] of pages) {
      await p.goto(BASE + path);
      await p.waitForTimeout(600);
      const h = await p.getByRole('heading', { level: 1 }).first().innerText().catch(() => '');
      const body = await p.locator('body').innerText();
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(9, `${label}: ${path} loads with title and primary action`, title.test(h) && action.test(body) && !overflow, `${h}${overflow ? ' (horizontal overflow)' : ''}`);
    }
    await p.goto(BASE + '/team');
    await p.getByRole('tab', { name: 'Archived' }).click();
    check(9, `${label}: empty state on Team → Archived`, await p.getByText('No one archived').isVisible());
    if (label.startsWith('phone')) {
      await p.goto(BASE + '/week');
      await p.getByRole('heading', { name: 'Diary', level: 1 }).waitFor();
      const agendaFirst = await p.getByRole('region', { name: /^Agenda/ }).locator('h2').first().innerText();
      check(9, 'phone: Diary agenda starts with today', /^Today/.test(agendaFirst), agendaFirst);
      check(9, 'phone: bottom navigation present', await p.getByRole('navigation', { name: 'Main' }).last().waitFor().then(() => true));
      await p.screenshot({ path: `${OUT}/e2e-week-phone.png` });
    }
    check(9, `${label}: no page errors`, local.length === 0, local.slice(0, 2).join(' | '));
    await c.close();
  }

  // Leave the shared demo usable.
  await o.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  check(0, 'No uncaught page errors in the flows', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
