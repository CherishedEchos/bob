/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script run outside the app */
// Home → "Your to-do list" (fictional demo data; nothing is sent):
//   BASE=http://localhost:3000 OUT=/tmp node scripts/e2e-home-todos.cjs
// Luke and Ryan each see only their own overdue / due-today tasks (max three, overdue first),
// tick one off in one tap, it stays done after a refresh, the next task moves up, a failed save
// keeps the task with a retry, "View all" opens Tasks for that person, and the section disappears
// once the last one is done. Desktop 1440 and phone 375.
const { chromium } = require('playwright');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp';
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const DESK = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function signIn(b, email, opts) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('bob.onboarding.done', '1'); localStorage.setItem('bob.tips.off', '1'); } catch { /* */ } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  const s = await p.evaluate(async (email) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'bob-demo' }) })).status, email);
  if (s !== 200) throw new Error(`login ${email}: ${s}`);
  return p;
}
const section = (p) => p.getByRole('region', { name: 'Your to-do list' });
const titles = (p) => section(p).locator('li p.font-medium').allInnerTexts();
async function openHome(p) {
  await p.goto(BASE + '/home');
  await p.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ }).waitFor({ timeout: 60000 });
  await p.waitForTimeout(400);
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const luke = await signIn(b, process.env.LUKE_EMAIL || 'owner@ninety3.example', DESK);
  luke.on('pageerror', (e) => errors.push(e.message));
  await luke.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await openHome(luke);

  // Luke: his own tasks only, overdue first.
  const lt = await titles(luke);
  check('Luke sees "Your to-do list"', await section(luke).isVisible());
  check('Luke sees only his overdue and due-today tasks, overdue first', lt.join('|') === 'Sign off the snag list on the Oak Road kitchen|Price the extra shelving for the Reigate media wall', lt.join(' | '));
  check('Labels say Overdue / Due today', (await section(luke).innerText()).includes('Overdue') && (await section(luke).innerText()).includes('Due today'));
  check('Nobody else’s tasks (e.g. Ryan’s or the office’s)', !lt.some((t) => /Davies|skip|decking|Dave/i.test(t)));
  const order = await luke.evaluate(() => ['today-h', 'todo-h', 'coming-h'].map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? -1));
  check('Desktop: beneath Today’s work and before Coming up', order[0] < order[1] && order[1] < order[2], order.join(','));
  const col = await luke.evaluate(() => [document.getElementById('today-h'), document.getElementById('todo-h'), document.getElementById('glance-h')].map((e) => Math.round(e.getBoundingClientRect().left)));
  check('Desktop: in the left column, aligned with Today’s work', col[0] === col[1] && col[2] > col[1], col.join(','));
  check('"Team to-dos" in the business at a glance', (await luke.getByRole('region', { name: 'Your business at a glance' }).innerText()).includes('Team to-dos'));
  const teamBefore = Number(await luke.getByRole('link', { name: /Team to-dos/ }).locator('span').nth(1).innerText());
  await luke.screenshot({ path: path.join(OUT, 'home-todo-luke-1440.png'), fullPage: true });

  // A failed save keeps the task and offers a retry.
  await luke.route('**/api/ops', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"offline"}' }));
  await section(luke).getByRole('button', { name: 'Complete: Sign off the snag list on the Oak Road kitchen' }).click();
  const retry = section(luke).getByRole('button', { name: 'Try again' });
  check('Failed save: task stays with "Try again"', await retry.waitFor({ timeout: 10000 }).then(() => true, () => false) && (await titles(luke)).length === 2);
  await luke.unroute('**/api/ops');
  await retry.click();
  await section(luke).getByText('Sign off the snag list on the Oak Road kitchen').waitFor({ state: 'detached', timeout: 15000 });
  check('Retry saves it and it leaves Home', !(await titles(luke)).includes('Sign off the snag list on the Oak Road kitchen'));
  const teamAfter = Number(await luke.getByRole('link', { name: /Team to-dos/ }).locator('span').nth(1).innerText());
  check('Team to-dos count goes down', teamAfter === teamBefore - 1, `${teamBefore} → ${teamAfter}`);
  await openHome(luke);
  check('Completion survives a refresh', !(await titles(luke)).includes('Sign off the snag list on the Oak Road kitchen'));

  // Ticking the last one closes the section up.
  await section(luke).getByRole('button', { name: /^Complete: Price the extra shelving/ }).click();
  await section(luke).waitFor({ state: 'detached', timeout: 15000 });
  check('Last one ticked: the section disappears', (await section(luke).count()) === 0);
  // The left column is now just Today's work: no empty panel or leftover gap beneath it.
  const gap = await luke.evaluate(() => { const s = document.getElementById('today-h').closest('section'); return Math.round(s.parentElement.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom); });
  check('…and the space closes up (nothing left under Today’s work)', gap === 0, `${gap}px`);
  await openHome(luke);
  check('…still gone after a refresh', (await section(luke).count()) === 0);
  await luke.screenshot({ path: path.join(OUT, 'home-todo-luke-cleared-1440.png'), fullPage: true });

  // Ryan, on a phone: his own four eligible tasks → three shown; tick one → the fourth moves up.
  const ryan = await signIn(b, process.env.RYAN_EMAIL || 'office@ninety3.example', PHONE);
  ryan.on('pageerror', (e) => errors.push('ryan: ' + e.message));
  await openHome(ryan);
  const rt = await titles(ryan);
  check('Ryan sees his own tasks, at most three, overdue first', rt.length === 3 && rt[0].startsWith('Chase Davies Electrical'), rt.join(' | '));
  check('Ryan doesn’t see Luke’s tasks', !rt.some((t) => /snag list|shelving|veneer/.test(t)));
  const order2 = await ryan.evaluate(() => ['today-h', 'todo-h', 'glance-h', 'coming-h'].map((id) => Math.round(document.getElementById(id)?.getBoundingClientRect().top ?? -1)));
  check('Phone: straight after today’s bookings, before the business at a glance', order2[0] < order2[1] && order2[1] < order2[2] && order2[2] < order2[3], order2.join(','));
  const ov = await ryan.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('Phone: no sideways scrolling', ov <= 1, String(ov));
  const box = await section(ryan).getByRole('button', { name: /^Complete:/ }).first().boundingBox();
  check('Phone: tick target at least 44px', box.width >= 44 && box.height >= 44, `${box.width}x${box.height}`);
  const wraps = await section(ryan).locator('li p.font-medium').first().evaluate((el) => el.scrollWidth <= el.clientWidth && getComputedStyle(el).whiteSpace !== 'nowrap');
  check('Phone: long titles wrap rather than cut off', wraps);
  await section(ryan).scrollIntoViewIfNeeded();
  await ryan.screenshot({ path: path.join(OUT, 'home-todo-ryan-375.png'), fullPage: true });
  await section(ryan).getByRole('button', { name: /^Complete: Chase Davies/ }).tap();
  await section(ryan).getByText(/^Chase Davies Electrical/).waitFor({ state: 'detached', timeout: 15000 });
  const rt2 = await titles(ryan);
  check('Ticked one goes, the next eligible task moves up', rt2.length === 3 && !rt2.some((t) => t.startsWith('Chase Davies')), rt2.join(' | '));
  await openHome(ryan);
  check('Ryan’s completion survives a refresh', !(await titles(ryan)).some((t) => t.startsWith('Chase Davies')));

  // View all → Tasks for that person (includes upcoming).
  await section(ryan).getByRole('link', { name: /View all/ }).tap();
  await ryan.waitForURL('**/tasks?who=*');
  await ryan.getByRole('heading', { name: 'Tasks', exact: true }).waitFor();
  check('View all opens Tasks filtered to Ryan', (await ryan.locator('select').last().evaluate((s) => s.options[s.selectedIndex].text)) === 'Ryan');
  await ryan.getByRole('tab', { name: /Upcoming/ }).tap();
  const up = await ryan.locator('main').innerText();
  check('…where his upcoming work is too, and nobody else’s', up.includes('Send the decking quote to Dave') && !up.includes('oak veneer'));

  // Luke on a phone: cleared, so no empty section.
  const lukePhone = await signIn(b, process.env.LUKE_EMAIL || 'owner@ninety3.example', PHONE);
  await openHome(lukePhone);
  check('Luke on a phone: nothing due, so no section', (await section(lukePhone).count()) === 0);

  // Desktop shot of Ryan too.
  const ryanDesk = await signIn(b, process.env.RYAN_EMAIL || 'office@ninety3.example', DESK);
  await openHome(ryanDesk);
  await ryanDesk.screenshot({ path: path.join(OUT, 'home-todo-ryan-1440.png'), fullPage: true });

  check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await luke.evaluate(() => fetch('/api/privacy/reset-sample', { method: 'POST' }));
  await b.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
