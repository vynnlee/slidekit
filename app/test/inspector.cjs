/* /dev/inspector 부품 검증. 사용: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3230 [SHOT=dir] node app/test/inspector.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:3230';
let bad = 0;
const check = (n, ok, extra) => { if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + JSON.stringify(extra))); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/dev/inspector'); await p.waitForSelector('[data-testid=panel]');
  const st = async () => JSON.parse(await p.textContent('[data-testid=state]'));
  const label = (name) => p.locator(`input[aria-label="${name}"]`).locator('xpath=preceding-sibling::span[1]');
  const input = (name) => p.locator(`input[aria-label="${name}"]`);
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '/inspector.png' });

  check('Mixed placeholder and empty value', (await input('X').getAttribute('placeholder')) === 'Mixed' && (await input('X').inputValue()) === '');
  const drag = async (name, dx, mods = [], dy = 0) => {
    const r = await label(name).boundingBox(); const x0 = r.x + r.width / 2, y0 = r.y + r.height / 2;
    for (const m of mods) await p.keyboard.down(m);
    await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x0, y0 + dy); await p.mouse.move(x0 + dx / 2, y0 + dy, { steps: 4 }); await p.mouse.move(x0 + dx, y0 + dy, { steps: 4 }); await p.mouse.up();
    for (const m of mods) await p.keyboard.up(m);
  };
  let s = await st();
  await drag('W', 50);
  let s2 = await st();
  check('scrub right +50 (W 400 -> 450)', s2.w === '450px', s2.w);
  check('one scrub = one undo group, many live updates', s2.undo - s.undo === 1 && s2.live - s.live > 3, [s.undo, s2.undo, s2.live - s.live]);
  await drag('W', 20, ['Shift']); s = await st();
  check('Shift scrub x10 (+200)', s.w === '650px', s.w);
  await drag('W', 100, ['Alt']); s2 = await st();
  check('Alt scrub x0.1 (+10)', s2.w === '660px', s2.w);
  await drag('W', -40); s = await st();
  check('scrub left decreases', s.w === '620px', s.w);
  await drag('W', 20, [], -60); s2 = await st();
  check('cursor above label scrubs 2x (+40)', s2.w === '660px', s2.w);

  await input('W').focus(); await p.keyboard.press('ArrowUp'); s = await st();
  check('ArrowUp +1', s.w === '661px', s.w);
  await p.keyboard.press('Shift+ArrowDown'); s = await st();
  check('Shift+ArrowDown -10', s.w === '651px', s.w);
  await p.keyboard.press('Alt+ArrowUp'); s = await st();
  check('Alt+ArrowUp +0.1', s.w === '651.1px', s.w);
  await input('W').fill('+9'); await p.keyboard.press('Enter'); s = await st();
  check('formula +9 on 651.1', s.w === '660.1px', s.w);
  await input('W').fill('200'); await p.keyboard.press('Enter'); s = await st();
  check('plain number keeps px unit', s.w === '200px', s.w);
  await input('W').fill('/0'); await p.keyboard.press('Enter'); s = await st();
  check('divide by zero ignored', s.w === '200px', s.w);
  await input('W').fill('abc'); await p.keyboard.press('Enter'); s = await st();
  check('garbage ignored', s.w === '200px', s.w);
  await input('Rotation').focus(); await input('Rotation').fill('500'); await p.keyboard.press('Enter'); s = await st();
  check('max clamps (rotation 180, unitless)', s.rot === '180', s.rot);
  await input('X').focus(); await p.keyboard.press('ArrowUp'); s = await st();
  check('arrow on Mixed field resolves it', s.mixed === false, s);

  check('sections no longer collapse (no chevron buttons)', (await p.locator('[aria-controls^="inspector-section-"]').count()) === 0);
  await p.getByRole('radio', { name: 'Column' }).click(); s = await st();
  check('segmented control selects', s.dir === 'column', s.dir);
  await p.getByRole('button', { name: 'Link ratio' }).click(); s = await st();
  check('toggle aria-pressed state', s.pressed === true);
  check('no page errors', errs.length === 0, errs);
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + '/inspector2.png' });
  await b.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
