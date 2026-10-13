/* 발표 흐름 브라우저 검증: 발표자 화면, ?sync=1 발표 창, 키, 타이머, 동기화, 창 닫힘, 외장 모니터 없음 폴백.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node present.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const DECK = 'vibe-coding-workshop';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };

// getScreenDetails 모킹: 미지원, 거부, 모니터 하나뿐
const MOCKS = {
  unsupported: `delete window.getScreenDetails;`,
  denied: `window.getScreenDetails = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));`,
  'single screen': `{ const s = { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 800 }; window.getScreenDetails = async () => ({ screens: [s], currentScreen: s }); }`,
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const errors = [];
  let first = true;
  for (const [name, mock] of Object.entries(MOCKS)) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(mock);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/present/${DECK}`);
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    check(`[${name}] 발표자 화면이 슬라이드 수를 읽는다`, await until(async () => (await counter()) === '1 / 53'), await counter().catch(() => null));

    if (first) {
      // 키 이동, 타이머, 장 위치
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      check('방향키로 이동', await until(async () => (await counter()) === '3 / 53'), await counter());
      await page.keyboard.press('ArrowLeft');
      check('왼쪽 키로 되돌아감', await until(async () => (await counter()) === '2 / 53'));
      const timer = () => page.locator('span.ml-auto.flex').first().innerText();
      await page.keyboard.press('t'); await sleep(2300); await page.keyboard.press('t');
      const t1 = await timer();
      check('T로 타이머 시작과 정지', /^00:00:0[12]$/.test(t1), t1);
      await sleep(1500);
      check('정지하면 시간이 멈춘다', (await timer()) === t1);
      await page.keyboard.press('r');
      check('R로 리셋', (await timer()) === '00:00:00', await timer());
      await page.keyboard.press('+');
      const size = () => page.locator('[aria-label="Speaker notes"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      const s1 = await size(); await page.keyboard.press('-'); await page.keyboard.press('-');
      check('+ - 로 노트 크기 조절', (await size()) === s1 - 4, [s1, await size()]);
      first = false;
    }

    // 발표 시작: 외장 모니터가 없거나 권한이 없으면 일반 새 창으로 열린다
    const base = Number((await counter()).split(' / ')[0]);
    const popupP = ctx.waitForEvent('page', { timeout: 5000 });
    await page.getByRole('button', { name: 'Present' }).click();
    const pop = await popupP.catch(() => null);
    check(`[${name}] 폴백으로 발표 창이 열린다`, !!pop);
    if (!pop) { await ctx.close(); continue; }
    pop.on('pageerror', (e) => errors.push(String(e)));
    check(`[${name}] 발표 창은 ?sync=1 덱 페이지`, pop.url().includes(`/decks/${DECK}/`) && pop.url().includes('sync=1'), pop.url());
    await pop.waitForLoadState('load');
    check(`[${name}] 발표 창 열림 표시`, await until(async () => (await page.getByText('Presentation window open').count()) === 1));
    // 발표 창이 시작할 때 hello로 위치를 받는다
    const hash = () => new URL(pop.url()).hash;
    check(`[${name}] 발표 창이 발표자 위치로 맞춰진다`, await until(async () => hash() === `#${base}`), [hash(), base]);
    await page.bringToFront(); await page.keyboard.press('ArrowRight');
    check(`[${name}] 발표자 -> 발표 창 동기화`, await until(async () => hash() === `#${base + 1}`), hash());
    await pop.bringToFront(); await pop.keyboard.press('ArrowRight');
    await page.bringToFront();
    check(`[${name}] 발표 창 -> 발표자 동기화`, await until(async () => (await counter()) === `${base + 2} / 53`), await counter());
    await pop.close();
    check(`[${name}] 발표 창 닫힘 표시`, await until(async () => (await page.getByText('Presentation window closed').count()) === 1, 3000));
    await ctx.close();
  }
  check('페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
