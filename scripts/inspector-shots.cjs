/* Inspector(오른쪽 패널) 상태별 스크린샷. 테스트 덱 사본에서만 동작하고 저장 단축키는 누르지 않는다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3241 OUT=<폴더> node scripts/inspector-shots.cjs
   OUT 기본값은 /tmp/slidekit-shots/<타임스탬프>. 요소가 없는 상태는 건너뛰고 경고만 낸다. */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path');
const { makeTestDeck } = require('./lib/test-deck.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3241';
const OUT = process.env.OUT || path.join('/tmp/slidekit-shots', new Date().toISOString().replace(/[:.]/g, '-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const t = makeTestDeck('shots'); // 실제 덱은 건드리지 않는다
  fs.mkdirSync(OUT, { recursive: true });
  const saved = [];
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/edit/${t.id}`);
    await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
    await sleep(800);
    const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
    const panel = page.locator('aside[aria-label="Properties"]');
    const tab = (name) => page.getByRole('tab', { name });

    let n = 0;
    const shot = async (name) => {
      await sleep(400);
      const base = path.join(OUT, `${String(++n).padStart(2, '0')}-${name}`);
      await panel.screenshot({ path: `${base}.png` });
      await page.screenshot({ path: `${base}-full.png` });
      saved.push(`${base}.png`, `${base}-full.png`);
    };
    // 현재 슬라이드에서 selector 요소를 클릭. 없으면 false.
    const pick = async (sel) => {
      const el = fr().locator(sel).first();
      if (!(await el.count())) return false;
      await el.click({ force: true }).catch(() => {});
      await sleep(300);
      return true;
    };
    // 슬라이드를 넘기며 selector가 있는 슬라이드를 찾아 클릭(최대 30장).
    const find = async (name, sel) => {
      for (let i = 0; i < 30; i++) {
        if (await pick(sel)) return true;
        await page.keyboard.press('ArrowRight');
        await sleep(300);
      }
      console.warn(`WARN ${name}: 선택할 요소(${sel})가 없어 건너뜀`);
      return false;
    };
    const deselect = async () => { await page.keyboard.press('Escape'); await sleep(200); };

    await shot('slide');
    if (await find('text', '[data-active] h1, [data-active] h2, [data-active] p')) await shot('text');
    await deselect();
    if (await find('image', '[data-active] img, [data-active] svg')) await shot('image');
    await deselect();
    if (await find('container', '[data-active] div:has(> *)')) await shot('container');

    await tab(/^Comments/).click();
    await shot('comments-tab');
    await tab('Design').click();

    // 접힌 상태: 첫 섹션 헤더 버튼(aria-controls=inspector-section-*)을 접는다.
    const head = panel.locator('button[aria-controls^="inspector-section-"][aria-expanded="true"]').first();
    if (await head.count()) { await head.click(); await shot('collapsed'); await head.click(); }
    else console.warn('WARN collapsed: 접을 섹션이 없어 건너뜀');

    // 호버: 첫 NumberField(aria-label이 있는 입력) 위에 마우스.
    const field = panel.locator('input[aria-label]').first();
    if (await field.count()) {
      await field.hover();
      await shot('hover');
      // 포커스: 패널 앞 요소에서 Tab으로 패널 첫 입력까지 이동.
      await page.mouse.move(0, 0);
      await tab('Design').focus();
      for (let i = 0; i < 20 && !(await field.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
      await shot('focus');
    } else console.warn('WARN hover/focus: 패널에 입력이 없어 건너뜀');
  } finally {
    if (browser) await browser.close();
    t.cleanup();
  }
  console.log('저장된 파일:\n' + saved.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
