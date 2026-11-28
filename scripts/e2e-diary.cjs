/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// The Diary (fictional demo data; nothing is sent):
//   BASE=http://localhost:3000 OUT=/tmp node scripts/e2e-diary.cjs
// Week / Month / Team views, remembered per person; date picker; weekends; summary;
// Team view drag to assign and the clash check before a move is saved; Ryan sees the change; phone agenda.
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const snap = (p) => p.evaluate(async () => (await fetch('/api/data')).json());
async function signIn(b, email, opts) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('bob.onboarding.done', '1'); localStorage.setItem('bob.tips.off', '1'); } catch { /* */ } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  const s = await p.evaluate(async (email) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'bob-demo' }) })).status, email);
  if (s !== 200) throw new Error(`login ${email}: ${s}`);
  return p;
}
async function drag(p, from, to) {
  const a = await from.boundingBox();
  const t = await to.boundingBox();
  await p.mouse.move(a.x + 20, a.y + 15);
  await p.mouse.down();
  await p.mouse.move(a.x + 40, a.y + 25, { steps: 5 });
  await p.mouse.move(t.x + 30, t.y + 20, { steps: 10 });
  await p.mouse.up();
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const DESK = { viewport: { width: 1440, height: 900 } };
  const luke = await signIn(b, process.env.LUKE_EMAIL || 'owner@ninety3.example', DESK);
  luke.on('pageerror', (e) => errors.push(e.message));
  await luke.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await luke.goto(BASE + '/');
  await luke.waitForURL('**/week');
  check('Signing in lands on the team diary (people down the side, days across)', await luke.getByRole('region', { name: 'Team schedule' }).waitFor({ timeout: 60000 }).then(() => true, () => false));
  await luke.goto(BASE + '/week?view=week');
  await luke.getByRole('region', { name: 'Week' }).waitFor({ timeout: 60000 });
  const sub = await luke.locator('header p').first().innerText();
  check('Diary summary: sites · people scheduled · off', /\d+ active sites? · \d+ (people|person) scheduled/.test(sub), sub);
  check('Summary flags the clash this week', /1 clash/.test(sub));
  check('Week view: multi-day work is one block (Kitchen refit spans Mon–Wed)', await luke.getByRole('region', { name: 'Week' }).getByRole('button', { name: /^Kitchen refit,.* to /i }).count() > 0 || (await luke.getByRole('region', { name: 'Week' }).getByRole('button', { name: /^Kitchen refit,/ }).first().evaluate((el) => el.getBoundingClientRect().width > 300)));
  check('Clash shown on the block', await luke.getByRole('region', { name: 'Week' }).getByRole('button', { name: /Clash: Liam/ }).count() > 0);
  check('Today is highlighted', await luke.getByRole('region', { name: 'Week' }).getByText('(today)').count() === 1);
  await luke.screenshot({ path: path.join(OUT, 'diary-week.png') });

  // Weekends off, then on again.
  await luke.getByRole('checkbox', { name: 'Weekends' }).uncheck();
  const cols = await luke.getByRole('region', { name: 'Week' }).locator('h2').count();
  const today = new Date().getDay();
  check('Weekends can be hidden (kept when today is a weekend day)', cols === ([0, 6].includes(today) ? 7 : 5), String(cols));
  await luke.getByRole('checkbox', { name: 'Weekends' }).check();

  // Date picker: next week.
  const before = await luke.getByRole('toolbar', { name: 'Diary controls' }).locator('[aria-live="polite"]').innerText();
  await luke.getByRole('toolbar', { name: 'Diary controls' }).locator('[aria-haspopup="dialog"]').click();
  await luke.getByRole('dialog', { name: 'Choose a date' }).getByRole('button', { name: 'Next week' }).click();
  await luke.waitForTimeout(400);
  const after = await luke.getByRole('toolbar', { name: 'Diary controls' }).locator('[aria-live="polite"]').innerText();
  check('Date picker moves the diary', before !== after, `${before} → ${after}`);
  await luke.getByRole('toolbar', { name: 'Diary controls' }).getByRole('button', { name: 'Today', exact: true }).click();
  await luke.waitForFunction((b) => document.querySelector('[role=toolbar] [aria-live="polite"]')?.textContent === b, before);

  // Month and Team, remembered.
  await luke.getByRole('radio', { name: 'Month' }).click();
  await luke.getByRole('region', { name: 'Month' }).waitFor();
  check('Month view shows holidays and bookings', /off/.test(await luke.getByRole('region', { name: 'Month' }).innerText()));
  await luke.screenshot({ path: path.join(OUT, 'diary-month.png') });
  await luke.getByRole('radio', { name: 'Team' }).click();
  await luke.getByRole('region', { name: 'Team schedule' }).waitFor();
  await luke.reload();
  check('The chosen view is remembered', await luke.getByRole('region', { name: 'Team schedule' }).waitFor({ timeout: 30000 }).then(() => true, () => false));
  await luke.getByRole('region', { name: 'Team schedule' }).locator('button[draggable]').first().waitFor({ timeout: 30000 });
  await luke.waitForTimeout(500);
  const team = await luke.getByRole('region', { name: 'Team schedule' }).innerText();
  check('Team view: people as rows with role, Luke and Ryan included', /Liam Carter\s*Lead carpenter/.test(team) && /Ryan\s*Office & site/.test(team));
  check('Team view shows who is free and who is off', /Free/.test(team) && /Unavailable/.test(team), team.slice(0, 400).replace(/\n/g, ' '));
  check('Unassigned work has its own row', /Needs someone/.test(team));
  await luke.screenshot({ path: path.join(OUT, 'diary-team.png') });

  // Drag the unassigned templating visit onto Ellie (free that day) → saved, Ryan sees it.
  const s0 = await snap(luke);
  const tmpl = s0.bookings.find((x) => x.id === 'n93_bk_patel_templating');
  const dayLabel = new Date(`${tmpl.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  await drag(luke, luke.getByRole('button', { name: /^Kitchen renovation.*nobody assigned/ }), luke.getByRole('button', { name: `Book Ellie Ward on ${dayLabel}` }).locator('..'));
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) { await luke.waitForTimeout(500); ok = (await snap(luke)).bookings.find((x) => x.id === 'n93_bk_patel_templating').personIds.includes('n93_per_ellie'); }
  check('Drag onto a person assigns the work', ok);
  const ryan = await signIn(b, process.env.RYAN_EMAIL || 'office@ninety3.example', DESK);
  check('Ryan sees the reassignment', (await snap(ryan)).bookings.find((x) => x.id === 'n93_bk_patel_templating').personIds.includes('n93_per_ellie'));

  // Drag Ellie's staircase snag onto Callum on a day he's busy → nothing saved until confirmed.
  const stair = s0.bookings.find((x) => x.id === 'n93_bk_smith_snag');
  const callumBusy = s0.bookings.find((x) => x.personIds.includes('n93_per_callum') && x.date >= s0.bookings.find((y) => y.id === 'n93_bk_sophie_fit').date && x.id !== 'n93_bk_smith_snag');
  const busyLabel = new Date(`${callumBusy.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  await drag(luke, luke.getByRole('region', { name: 'Team schedule' }).getByRole('button', { name: /^Oak staircase/ }).first(), luke.getByRole('button', { name: `Book Callum Price on ${busyLabel}` }).locator('..'));
  const dlg = luke.getByText('That would double-book someone');
  check('Moving onto a busy person asks first', await dlg.waitFor({ timeout: 20000 }).then(() => true, () => false));
  await luke.screenshot({ path: path.join(OUT, 'diary-clash.png') });
  await luke.getByRole('button', { name: 'Leave it as it was' }).click();
  const still = (await snap(luke)).bookings.find((x) => x.id === 'n93_bk_smith_snag');
  check('…and leaving it changes nothing', still.date === stair.date && still.personIds.join() === stair.personIds.join());

  // Phone agenda.
  const phone = await signIn(b, process.env.LUKE_EMAIL || 'owner@ninety3.example', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  phone.on('pageerror', (e) => errors.push('phone: ' + e.message));
  await phone.goto(BASE + '/week');
  // Phones open on "Who's where" (the team view, one day at a time); "By day" is the week agenda.
  check("Phone: opens on Who's where", await phone.getByRole('region', { name: "Who's where" }).waitFor({ timeout: 60000 }).then(() => true, () => false));
  await phone.getByRole('radio', { name: 'By day' }).click();
  const agenda = phone.getByRole('region', { name: 'Agenda' });
  // Late in the week (e.g. a weekend), the days already gone are folded away: open them.
  const earlier = phone.getByRole('button', { name: /Show earlier this week/ });
  if (await earlier.isVisible().catch(() => false)) await earlier.click();
  await agenda.waitFor({ timeout: 60000 });
  check('Phone: agenda, not a squeezed calendar', (await phone.getByRole('region', { name: 'Week' }).isVisible().catch(() => false)) === false);
  check('Phone: cards have directions and the job', (await agenda.getByRole('link', { name: 'Directions' }).count()) > 0 && (await agenda.getByRole('button', { name: /Open job/ }).count()) > 0);
  check('Phone: Schedule work is prominent', await phone.getByRole('button', { name: 'Schedule work', exact: true }).isVisible());
  await phone.getByRole('combobox', { name: 'Show work for' }).selectOption({ label: 'Callum Price' });
  await phone.waitForTimeout(500);
  const labels = await agenda.getByRole('button', { name: /^Booking: / }).count();
  check('Phone: the person dropdown narrows to one person', labels > 0 && (await agenda.innerText()).includes('Callum'));
  const ov = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('Phone: no sideways scrolling', ov <= 1, String(ov));
  await phone.screenshot({ path: path.join(OUT, 'diary-phone.png') });

  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await b.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
