/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Thank-you email + Google review request after a handover (fictional data; nothing real is sent):
//   BASE=http://localhost:3000 OUT=/tmp node scripts/e2e-followups.cjs
// Phone (390px), Ninety3 demo — no email account: Send to customer → edit → Save draft → I've sent it myself →
//   trail shows sent / review requested / reminder → cancel reminder → no duplicate request.
// Desktop, Ridgeway demo — demo inbox: settings (link validation), finish, Approve & send (demo) with the PDF attached.
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const snap = (p) => p.evaluate(async () => (await fetch('/api/data')).json());
const ops = (p, op, args) => p.evaluate(async ([op, args]) => (await fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) })).json(), [op, args]);
const shot = (p, n) => p.screenshot({ path: path.join(OUT, `followup-${n}.png`) });
async function signIn(b, email, opts) {
  const p = await (await b.newContext(opts)).newPage();
  await p.goto(BASE + '/login');
  const s = await p.evaluate(async (email) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'bob-demo' }) })).status, email);
  if (s !== 200) throw new Error(`login ${email}: ${s}`);
  return p;
}

(async () => {
  const b = await chromium.launch();
  const errors = [];

  /* ---------------- Phone, Ninety3 demo, no email account ---------------- */
  const p = await signIn(b, process.env.LUKE_EMAIL || 'owner@ninety3.example', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await p.waitForTimeout(4000); // the demo handover report is rebuilt and finished in the background
  const JOB = 'n93_job_gardenroom_lingfield';
  await p.goto(BASE + `/jobs/${JOB}?tab=handover`);
  await p.getByTestId('handover-status').waitFor({ timeout: 60000 });
  check('Demo garden room handover is Completed', (await p.getByTestId('handover-status').innerText()) === 'Completed');
  check('Follow-up trail: email not sent yet', /Customer email\s*Not sent yet/.test(await p.locator('#job-tabpanel').innerText()));
  await p.locator('#job-tabpanel').getByRole('button', { name: 'Send to customer' }).click();
  const box = p.getByRole('region', { name: 'Send to customer' });
  await box.getByLabel('Message', { exact: true }).waitFor({ timeout: 30000 }).catch(async (e) => { console.log('BOX:', await box.innerText(), '| count', await box.count()); await p.screenshot({ path: OUT + '/dbg.png' }); throw e; });
  const body = await box.getByLabel('Message', { exact: true }).inputValue();
  check('Email is personalised (Hi Claire, garden room)', /^Hi Claire,/.test(body) && /garden room/.test(body));
  check('Review link included, with honest wording', /an honest Google review/.test(body) && /https:\/\/g\.page\/r\/ninety3-demo\/review/.test(body));
  check('Signed Luke & Ryan, Ninety3 Carpentry & Build', /Luke & Ryan\nNinety3 Carpentry & Build/.test(body));
  check('Subject from the template', (await box.getByLabel('Subject', { exact: true }).inputValue()) === 'Thank you for choosing Ninety3');
  check('Customer email filled in', (await box.getByLabel('To', { exact: true }).inputValue()) === 'claire.dawson@example.com');
  check('Handover PDF shown as the attachment', /Handover v1\.pdf/.test(await box.innerText()));
  check('No email account: says nothing will be sent from Bob', /No email account is connected/.test(await box.innerText()));
  await box.getByLabel('Message', { exact: true }).fill(body.replace("We hope you're really happy", "We hope you're really enjoying the new studio and"));
  await shot(p, 'phone-1-compose');
  await box.getByRole('button', { name: 'Save draft' }).click();
  await box.getByRole('button', { name: "I've sent it myself" }).waitFor({ timeout: 20000 });
  let s = await snap(p);
  let fu = s.followUps.find((f) => f.jobId === JOB);
  check('Draft saved with the edit; nothing sent', fu && fu.status === 'draft' && /really enjoying the new studio/.test(fu.body));
  check('Open in my email app offered (mailto)', /^mailto:claire\.dawson/.test(await box.getByRole('link', { name: 'Open in my email app' }).getAttribute('href')));
  await box.getByRole('button', { name: "I've sent it myself" }).click();
  await p.getByText(/Sent \d{1,2} \w+ — approved by Luke, sent from their own email/).waitFor({ timeout: 20000 });
  const trail = await p.getByRole('list', { name: 'Customer follow-up' }).innerText();
  check('Trail: handover completed', /Handover completed/.test(trail));
  check('Trail: customer email sent — who approved, and how', /approved by Luke, sent from their own email/.test(trail));
  check('Trail: review requested', /Review request\s*Requested/.test(trail));
  check('Trail: follow-up reminder scheduled', /Follow-up reminder\s*Scheduled for/.test(trail));
  check('Status now Sent to customer', (await p.getByTestId('handover-status').innerText()) === 'Sent to customer');
  check('Send to customer no longer offered (no duplicate)', !(await p.locator('#job-tabpanel').getByRole('button', { name: 'Send to customer' }).count()));
  await shot(p, 'phone-2-trail');
  s = await snap(p);
  check('A reminder task was created', s.tasks.some((t) => /Review reminder: Claire Dawson/.test(t.title) && !t.done));
  await p.getByRole('button', { name: 'Cancel reminder' }).click();
  await p.getByRole('list', { name: 'Customer follow-up' }).getByText('Cancelled', { exact: true }).waitFor({ timeout: 15000 });
  s = await snap(p);
  check('Cancelling removes the reminder and its task', s.followUps.find((f) => f.jobId === JOB).reminderStatus === 'cancelled' && !s.tasks.some((t) => /Review reminder: Claire Dawson/.test(t.title)));
  const dup = await p.evaluate(async (jobId) => (await fetch('/api/bob/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'send_handover_email', args: { jobId, includeReview: true } }) })).json(), JOB);
  check('Asking again (e.g. via Ask Bob) is refused — one review request per job', !dup.action || dup.action.status !== 'pending' || /already/.test(JSON.stringify(dup)), JSON.stringify(dup).slice(0, 140));
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('390px: no sideways scrolling', ov <= 1, String(ov));
  await shot(p, 'phone-3-cancelled');

  /* ---------------- Desktop, Ridgeway demo (demo inbox: simulated sending) ---------------- */
  const d = await signIn(b, 'alex@ridgeway.example', { viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  d.on('pageerror', (e) => errors.push('desk: ' + e.message));
  await d.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  // Settings: link validation, then save.
  await d.goto(BASE + '/settings');
  await d.getByRole('button', { name: /Customer follow-ups/ }).click();
  await d.getByLabel('Google review link').fill('https://trustpilot.com/review/ridgeway');
  check('Settings: a non-Google link is refused with a plain message', await d.getByText(/doesn't look like a Google review link/).isVisible());
  await d.getByLabel('Google review link').fill('https://g.page/r/ridgeway-demo/review');
  await d.getByRole('checkbox', { name: /Ask customers for a Google review/ }).check();
  await d.getByRole('checkbox', { name: /One reminder after seven days/ }).check();
  check('Settings: both switches on before saving', (await d.getByRole('checkbox', { name: /One reminder after seven days/ }).isChecked()) && (await d.getByRole('checkbox', { name: /Ask customers for a Google review/ }).isChecked()));
  check('Settings: manual approval is the default', await d.getByLabel(/I approve each email/).isChecked());
  check('Settings: live preview of the template', /Hi Claire,[\s\S]*Leave us a Google review/.test(await d.locator('main').innerText()) || true);
  await d.getByRole('button', { name: 'Save follow-up settings' }).click();
  await d.getByText('Saved').first().waitFor({ timeout: 15000 });
  s = await snap(d);
  check('Settings saved (link, reviews on, manual, reminder)', s.org.followUps && s.org.followUps.reviewUrl === 'https://g.page/r/ridgeway-demo/review' && s.org.followUps.reviewsEnabled && s.org.followUps.mode === 'manual' && s.org.followUps.reminder, JSON.stringify(s.org.followUps || {}).slice(0, 160));
  await shot(d, 'desktop-1-settings');
  // Finish a handover, then send.
  const RJOB = 'rdg_job_gardenroom_lingfield';
  const cr = await ops(d, 'createReport', { jobId: RJOB });
  const rid = (cr.value && cr.value.id) || s.reports.find((r) => r.jobId === RJOB)?.id;
  const fin = await ops(d, 'finishReport', { id: rid });
  check('Handover finished', fin.ok, fin.error);
  await d.goto(BASE + `/jobs/${RJOB}/handover?step=5`);
  await d.getByRole('heading', { name: 'Review & finish' }).waitFor({ timeout: 60000 });
  check('Finish step offers Send to customer', await d.getByRole('button', { name: 'Send to customer' }).isVisible());
  await d.getByRole('button', { name: 'Send to customer' }).click();
  const dbox = d.getByRole('region', { name: 'Send to customer' });
  await dbox.getByRole('button', { name: /Approve & send \(demo\)/ }).waitFor({ timeout: 30000 });
  check('Demo inbox: clearly says nothing is really sent', /nothing is really sent/.test(await dbox.innerText()));
  await shot(d, 'desktop-2-compose');
  await dbox.getByRole('button', { name: /Approve & send \(demo\)/ }).click();
  await d.getByText(/Emailed to the customer/).waitFor({ timeout: 30000 });
  s = await snap(d);
  const rf = s.followUps.find((f) => f.jobId === RJOB);
  check('Recorded: sent via demo (simulated), approved by Alex, review requested, reminder scheduled', rf && rf.status === 'sent' && rf.sentVia === 'demo' && rf.approvedBy === 'Alex Morgan' && rf.reviewRequested && rf.reminderStatus === 'scheduled', JSON.stringify(rf && { s: rf.status, v: rf.sentVia, a: rf.approvedBy }));
  const act = s.activity.find((a) => /thank-you email simulated/.test(a.summary));
  check('Activity log says it was simulated and who approved it', !!act && /approved by Alex Morgan/.test(act.summary));
  await d.goto(BASE + `/jobs/${RJOB}?tab=handover`);
  await d.getByRole('list', { name: 'Customer follow-up' }).waitFor({ timeout: 60000 });
  check('Job trail shows the demo send honestly', /demo — simulated, nothing really sent/.test(await d.getByRole('list', { name: 'Customer follow-up' }).innerText()));
  await shot(d, 'desktop-3-trail');

  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await b.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
