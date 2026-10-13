/* /dev/controls 상태표 검증: 컨트롤 표면 일관성, 키보드, 설정됨 점과 Reset, 비활성 툴팁, 포커스 링과 레이아웃 불변.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 [SHOTS=<폴더>] node controls.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/dev/controls');
  await page.getByRole('heading', { name: 'Control states' }).waitFor();
  await sleep(500);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'controls-1440.png') });
  check('가로 스크롤 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // 표면: 기본 상태의 보더가 Select 기준과 같다(1px, 같은 색)
  const surface = (sel) => page.locator(sel).first().evaluate((e) => { const c = getComputedStyle(e); return [c.borderTopWidth, c.borderTopColor, c.borderTopStyle, c.height]; });
  const sel = await surface('[data-state=Default] [role=combobox]');
  const fld = await surface('[data-state=Default] input[aria-label=Field]');
  const num = await page.locator('[data-state=Default] input[aria-label=Number]').evaluate((e) => { const c = getComputedStyle(e.parentElement); return [c.borderTopWidth, c.borderTopColor, c.borderTopStyle, c.height]; });
  const seg = await surface('[data-state=Default] [role=radiogroup]');
  check('Field 보더와 높이가 Select와 같다', JSON.stringify(fld) === JSON.stringify(sel), [fld, sel]);
  check('NumberField 보더와 높이가 Select와 같다', JSON.stringify(num) === JSON.stringify(sel), [num, sel]);
  check('Segmented 보더와 높이가 Select와 같다', JSON.stringify(seg) === JSON.stringify(sel), [seg, sel]);
  check('컨트롤 높이는 모두 28px', [sel, fld, num, seg].every((s) => s[3] === '28px'));

  // 포커스 링: 키보드 포커스에서 같은 두께와 색, 레이아웃은 그대로
  const ring = async (locator) => {
    const before = await locator.boundingBox();
    await locator.focus();
    const sh = await locator.evaluate((e) => getComputedStyle(e).boxShadow);
    const after = await locator.boundingBox();
    return { sh, same: JSON.stringify(before) === JSON.stringify(after) };
  };
  const rs = await ring(page.locator('[data-state=Default] input[aria-label=Field]'));
  const rn = await ring(page.locator('[data-state=Default] input[aria-label=Number]'));
  const rn2 = await page.locator('[data-state=Default] input[aria-label=Number]').evaluate((e) => getComputedStyle(e.parentElement).boxShadow);
  await page.keyboard.press('Shift+Tab'); // 키보드로 이동해 :focus-visible을 만든다
  await page.locator('[data-state=Default] [role=combobox]').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const rc = await page.locator('[data-state=Default] [role=combobox]').evaluate((e) => getComputedStyle(e).boxShadow);
  const one = (s) => /0px 0px 0px 1px/.test(s);
  check('Field 포커스 링은 1px box-shadow', one(rs.sh), rs.sh);
  check('NumberField 포커스 링은 1px box-shadow', one(rn2), rn2);
  check('Select 포커스 링은 1px box-shadow(기준)', one(rc), rc);
  check('Field와 NumberField와 Select의 링 색이 같다', rs.sh === rn2 && rn2 === rc, [rs.sh, rn2, rc]);
  check('포커스해도 Field 박스가 변하지 않는다', rs.same);

  // Segmented 키보드
  const radios = page.locator('[data-state=Set] [role=radiogroup] [role=radio]');
  await radios.first().focus();
  await page.keyboard.press('End');
  check('End는 마지막 칸을 고른다', (await radios.nth(2).getAttribute('aria-checked')) === 'true');
  await page.keyboard.press('Home');
  check('Home은 첫 칸을 고른다', (await radios.nth(0).getAttribute('aria-checked')) === 'true');
  await page.keyboard.press('ArrowRight');
  check('화살표로 다음 칸', (await radios.nth(1).getAttribute('aria-checked')) === 'true');
  const widths = await radios.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  check('칸 폭이 같다', new Set(widths).size === 1, widths);
  check('toggle 모드는 group과 aria-pressed', (await page.locator('[data-state=Default] [role=group][aria-label=Toggle] button[aria-pressed]').count()) === 2);
  check('radio 모드는 aria-checked와 radiogroup', (await page.locator('[data-state=Default] [role=radiogroup]').count()) >= 1);

  // 설정됨 점과 Reset
  const setCell = page.locator('[data-state=Set] input[aria-label="Number set"]').locator('xpath=..');
  check('설정됨 점이 보인다', (await setCell.locator('[data-dirty]').count()) === 1);
  const reset = page.getByRole('button', { name: 'Reset Number set' });
  await page.mouse.move(0, 0); await sleep(300);
  const op0 = await reset.evaluate((e) => getComputedStyle(e).opacity);
    await page.keyboard.press('Escape'); await page.mouse.move(0, 0); await sleep(300); // 앞 단계의 툴팁이 가리지 않게 닫는다
  await setCell.hover(); await sleep(500);
  const op1 = await reset.evaluate((e) => getComputedStyle(e).opacity);
  check('Reset은 호버 때만 보인다', op0 === '0' && op1 === '1', [op0, op1]);

  // ColorField: hex가 잘리지 않는다
  const hexFit = await page.locator('[data-state=Set] input[aria-label="Color set hex"]').evaluate((e) => [e.scrollWidth, e.clientWidth]);
  check('hex 입력이 잘리지 않는다', hexFit[0] <= hexFit[1], hexFit);

  // 비활성
  const dis = page.locator('[data-state=Disabled] input[aria-label="Number disabled"]');
  check('비활성 NumberField는 입력할 수 없다', await dis.isDisabled());
  await dis.locator('xpath=..').hover(); await sleep(900);
  check('비활성 이유 툴팁', (await page.getByText('Set by the layout').count()) >= 1);
  check('비활성 Field', await page.locator('[data-state=Disabled] input[aria-label="Field disabled"]').isDisabled());
  check('오류 Field는 aria-invalid', (await page.locator('[data-state=Error] input[aria-label="Field error"]').getAttribute('aria-invalid')) === 'true');

  // 스크럽 중 커서 잠금
  const label = page.locator('[data-state=Default] input[aria-label=Number]').locator('xpath=../span').first();
  const box = await label.boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 40);
  const cur = await page.evaluate(() => document.documentElement.style.cursor);
  await page.mouse.up();
  const cur2 = await page.evaluate(() => document.documentElement.style.cursor);
  check('스크럽 중 커서가 ew-resize로 잠긴다', cur === 'ew-resize' && cur2 === '', [cur, cur2]);

  check('페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
