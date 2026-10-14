/* 발표 흐름 브라우저 검증: 발표자 화면, ?sync=1 발표 창, 키, 타이머, 동기화, 창 닫힘, 외장 모니터 없음 폴백.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node present.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
// 편집 테스트가 건드리지 않도록 전용 덱(30장)을 만들어 쓰고 끝에 지운다.
const DECK = '_e2e-present', ID = 'e2e-present', TOTAL = 30;
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'decks', DECK);
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${ID}</title>
<script type="application/json" id="deck-meta">{ "title": "${ID}", "id": "${ID}" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"></head><body>
<section data-slide="cover"><h1>Cover</h1><aside data-notes>Notes for cover</aside></section>
${Array.from({ length: TOTAL - 1 }, (_, i) => `<section data-slide="content"><h2>Slide ${i + 2}</h2></section>`).join('\n')}
<script src="../../engine/slidekit.js"></script></body></html>`);
process.on('exit', () => fs.rmSync(DIR, { recursive: true, force: true }));
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
    await page.goto(`${BASE}/present/${ID}`);
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    check(`[${name}] 발표자 화면이 슬라이드 수를 읽는다`, await until(async () => (await counter()) === `1 / ${TOTAL}`), await counter().catch(() => null));

    if (first) {
      // 키 이동, 타이머, 장 위치
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      check('방향키로 이동', await until(async () => (await counter()) === `3 / ${TOTAL}`), await counter());
      await page.keyboard.press('ArrowLeft');
      check('왼쪽 키로 되돌아감', await until(async () => (await counter()) === `2 / ${TOTAL}`));
      const timer = () => page.locator('[role=timer]').first().innerText();
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
    const note = { unsupported: 'Display access unavailable', denied: 'Display access unavailable', 'single screen': 'No external display found' }[name];
    check(`[${name}] 폴백 사유 표시`, await until(async () => ((await page.getByRole('status').filter({ hasText: note }).innerText()) || '').includes(note)), await page.getByRole('status').filter({ hasText: note }).innerText().catch(() => null));
    check(`[${name}] 발표 창 열림 표시`, await until(async () => (await page.getByText('Presentation window open').count()) === 1));
    // 발표 창이 시작할 때 hello로 위치를 받는다
    const hash = () => new URL(pop.url()).hash;
    check(`[${name}] 발표 창이 발표자 위치로 맞춰진다`, await until(async () => hash() === `#${base}`), [hash(), base]);
    await page.bringToFront(); await page.keyboard.press('ArrowRight');
    check(`[${name}] 발표자 -> 발표 창 동기화`, await until(async () => hash() === `#${base + 1}`), hash());
    await pop.bringToFront(); await pop.keyboard.press('ArrowRight');
    await page.bringToFront();
    check(`[${name}] 발표 창 -> 발표자 동기화`, await until(async () => (await counter()) === `${base + 2} / ${TOTAL}`), await counter());
    await pop.close();
    check(`[${name}] 발표 창 닫힘 표시`, await until(async () => (await page.getByText('Presentation window closed').count()) === 1, 3000));
    await ctx.close();
  }
  // 이미 12번에 있는 발표 창에 발표자 화면이 붙으면 12번으로 시작한다. 보기를 꺼도 이동과 동기화가 유지된다. 반복 입력 무시.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const pop = await ctx.newPage();
    await pop.goto(`${BASE}/decks/${DECK}/index.html?sync=1#12`);
    await pop.waitForFunction(() => location.hash === '#12'); await sleep(500);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/present/${ID}`);
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    check('열려 있는 발표 창 위치(12)로 시작', await until(async () => (await counter()) === `12 / ${TOTAL}`), await counter().catch(() => null));
    await page.getByRole('switch', { name: 'Current slide' }).click();
    await page.getByRole('switch', { name: 'Next slide' }).click();
    await page.mouse.click(640, 780); // 스위치 포커스를 벗어난다(위젯에 포커스가 있으면 화살표와 단축키는 그 위젯의 것이다)
    await page.keyboard.press('ArrowRight');
    check('보기를 꺼도 방향키 이동이 유지된다', await until(async () => (await counter()) === `13 / ${TOTAL}`), await counter());
    check('보기를 꺼도 발표 창과 동기화된다', await until(async () => new URL(pop.url()).hash === '#13'), pop.url());
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
    await sleep(600);
    check('방향키 반복 입력은 한 장만 넘긴다', (await counter()) === `14 / ${TOTAL}`, await counter());
    await page.keyboard.down('t'); await page.keyboard.down('t'); await page.keyboard.up('t');
    await sleep(1600);
    check('T 반복 입력은 한 번만 토글한다', (await page.locator('[role=timer]').first().innerText()) !== '00:00:00');
    await ctx.close();
  }
  // ?from=N: 그 장에서 시작, 범위 밖은 가장 가까운 장. 발표 시작은 현재 장부터.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const open = async (q) => { const pg = await ctx.newPage(); await pg.goto(`${BASE}/present/${ID}${q}`); return pg; };
    const cnt = (pg) => pg.getByText(/^\d+ \/ \d+$/).first().innerText();
    const p20 = await open('?from=20');
    check('?from=20이면 20번에서 시작', await until(async () => (await cnt(p20)) === `20 / ${TOTAL}`), await cnt(p20).catch(() => null));
    const popP = ctx.waitForEvent('page');
    await p20.getByRole('button', { name: 'Present' }).click();
    const pop = await popP;
    check('발표 시작은 현재 장(20)부터', await until(async () => new URL(pop.url()).hash === '#20'), pop.url());
    await pop.close();
    const big = await open('?from=999');
    check('범위 밖(큰 값)은 마지막 장', await until(async () => (await cnt(big)) === `${TOTAL} / ${TOTAL}`), await cnt(big).catch(() => null));
    await big.close(); await p20.close(); // 열린 발표자 화면끼리도 동기화되므로 닫고 확인한다
    const zero = await open('?from=0');
    check('범위 밖(0)은 첫 장', await until(async () => (await cnt(zero)) === `1 / ${TOTAL}`), await cnt(zero).catch(() => null));
    await ctx.close();
  }
  // 목표 시간, 초과 경고, 진행 바, 노트 크기 버튼, 라벨, 마지막 장 표시, 창 상태에 따른 버튼 이름
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.clock.install();
    await page.goto(`${BASE}/present/${ID}`);
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    await until(async () => (await counter()) === `1 / ${TOTAL}`);
    // 포커스된 위젯의 입력은 슬라이드 이동과 한 글자 단축키로 새지 않는다
    await page.getByRole('tab', { name: 'Slides' }).focus();
    await page.keyboard.press('ArrowRight'); await sleep(250);
    check('탭에서 화살표는 슬라이드를 넘기지 않는다', (await counter()) === `1 / ${TOTAL}`, await counter());
    await page.getByRole('button', { name: 'Reset timer' }).focus();
    await page.keyboard.press('t'); await page.clock.runFor(3000);
    check('버튼에 포커스가 있으면 T는 타이머를 켜지 않는다', (await page.locator('[role=timer]').first().innerText()) === '00:00:00');
    await page.locator('body').focus();
    check('Current와 Next 라벨', (await page.getByText('Current', { exact: true }).count()) === 1 && (await page.getByText(/^Next/).count()) >= 1);
    check('슬라이드 진행 바', (await page.getByRole('progressbar', { name: 'Slide progress' }).getAttribute('aria-valuenow')) === '1');
    await page.getByLabel('Target minutes').fill('1');
    await page.keyboard.press('Tab');
    await page.mouse.click(640, 780);
    await page.keyboard.press('t');
    await page.clock.runFor(10000);
    check('목표 시간이 있으면 남은 시간', await until(async () => /^00:5\d left$/.test(await page.getByText(/ left$/).first().innerText())), await page.getByText(/ left$/).first().innerText().catch(() => null));
    await page.clock.runFor(60000);
    check('초과하면 over 문구', await until(async () => /^\+00:\d\d over$/.test(await page.getByText(/ over$/).first().innerText())), await page.getByText(/ over$/).count());
    // 리허설 요약: 슬라이드별 체류 시간(타이머가 돈 시간만)
    await page.getByRole('button', { name: 'Summary' }).click();
    const sd = page.getByRole('dialog');
    check('요약 다이얼로그', await until(async () => (await sd.getByText('Rehearsal summary').count()) === 1));
    check('총 시간과 목표 대비', (await sd.innerText()).includes('00:01:10') && /00:10 over|01:10/.test(await sd.innerText()), await sd.innerText());
    check('가장 길었던 슬라이드', /1\.\s*cover[\s\S]*01:10/i.test(await sd.innerText()), await sd.innerText());
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Auto-scroll notes' }).click();
    check('자동 스크롤 토글', (await page.getByRole('button', { name: 'Auto-scroll notes' }).getAttribute('aria-pressed')) === 'true');
    await page.getByRole('button', { name: 'Auto-scroll notes' }).click();
    const size0 = await page.locator('[aria-label="Speaker notes"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    await page.getByRole('button', { name: 'Larger notes' }).click();
    check('노트 A+ 버튼', (await page.locator('[aria-label="Speaker notes"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) === size0 + 2);
    for (let i = 0; i < TOTAL - 1; i++) await page.keyboard.press('ArrowRight');
    check('마지막 장에서 End of deck 표시', await until(async () => (await page.getByText('End of deck').count()) === 1));
    await ctx.close();
  }
  // 깨진 localStorage
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(`localStorage.setItem('slidekit:view', '{bad'); localStorage.setItem('slidekit:notes-size', 'abc');`);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/present/${ID}`);
    check('깨진 localStorage에도 화면이 뜬다', await until(async () => (await page.getByText(/^\d+ \/ \d+$/).count()) === 1));
    await ctx.close();
  }
  // 덱 목록 요청 실패는 화면에 보인다
  {
    const ctx = await browser.newContext();
    await ctx.route('**/api/decks', (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/present/${ID}`);
    check('목록 요청 실패 표시', await until(async () => (await page.getByRole('alert').innerText()).includes('Could not load decks')));
    await ctx.close();
  }
  check('페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
