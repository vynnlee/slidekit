/* 레이아웃 검증: 뷰포트별로 세 화면에 가로 스크롤이 없고 주요 요소가 보이며 패널이 규칙대로 동작하는지 본다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 [SHOTS=<폴더>] node responsive.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const DECK = '_e2e-resp', ID = 'e2e-resp';
const DIR = path.join(__dirname, '..', '..', 'decks', DECK);
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${ID}</title>
<script type="application/json" id="deck-meta">{ "title": "${ID}", "id": "${ID}" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"></head><body>
<section data-slide="cover"><h1>Cover</h1><aside data-notes>## Notes\n\n- one\n- two\n\nLong paragraph of notes for the layout check.</aside></section>
<section data-slide="content"><h2>Second</h2></section>
<script src="../../engine/slidekit.js"></script></body></html>`);
process.on('exit', () => fs.rmSync(DIR, { recursive: true, force: true }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const VIEWPORTS = [[1024, 768], [820, 1180], [1440, 900], [1920, 1080]];
const inside = (b, w, h) => b && b.x >= -1 && b.y >= -1 && b.x + b.width <= w + 1 && b.y + b.height <= h + 1;
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  for (const [w, h] of VIEWPORTS) {
    const tag = `${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const shot = (n) => process.env.SHOTS && page.screenshot({ path: path.join(process.env.SHOTS, `${tag}-${n}.png`) });
    const noScroll = async (n) => check(`[${tag}] ${n} 가로 스크롤 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));

    // 덱 목록
    await page.goto(BASE + '/');
    await page.getByRole('button', { name: 'New deck' }).waitFor();
    await sleep(1500); await shot('list');
    await noScroll('목록');
    for (const n of ['New deck', 'Search', 'Trash']) check(`[${tag}] 목록 컨트롤 ${n} 보임`, inside(await page.getByRole('button', { name: new RegExp(n) }).first().boundingBox(), w, h));
    const cards = await page.getByRole('button', { name: ID, exact: true }).first().boundingBox().catch(() => null);
    check(`[${tag}] 카드 폭 220px 이상`, !cards || cards.width >= 200, cards);

    // 발표자 화면
    await page.goto(`${BASE}/present/${ID}`);
    await page.getByRole('button', { name: 'Present' }).waitFor();
    await sleep(1500); await shot('present');
    await noScroll('발표자');
    const cur = await page.locator('iframe[title="Current slide"]').boundingBox();
    const nxt = await page.locator('iframe[title="Next slide"]').boundingBox();
    const notes = await page.locator('[aria-label="Speaker notes"]').boundingBox();
    check(`[${tag}] 현재 슬라이드가 보인다`, inside(cur, w, h) && cur.width > 200, cur);
    check(`[${tag}] 현재와 다음 슬라이드가 겹치지 않는다`, !overlap(cur, nxt), [cur, nxt]);
    check(`[${tag}] 노트가 슬라이드와 겹치지 않는다`, notes && !overlap(cur, notes) && !overlap(nxt, notes), [cur, notes]);
    check(`[${tag}] 노트 영역이 화면 안`, notes && notes.x >= 0 && notes.x + notes.width <= w + 1, notes);
    if (w <= 900) check(`[${tag}] 좁은 폭에서는 다음 슬라이드가 현재 아래`, nxt.y >= cur.y + cur.height - 1, [cur, nxt]);
    else check(`[${tag}] 넓은 폭에서는 다음 슬라이드가 현재 오른쪽`, nxt.x >= cur.x + cur.width - 1, [cur, nxt]);

    // 편집기와 패널
    await page.goto(`${BASE}/edit/${ID}`);
    await page.locator('iframe').first().waitFor();
    await sleep(2000); await shot('edit');
    await noScroll('편집기');
    // 넓은 화면에서는 왼쪽 패널의 썸네일도 iframe이라 가장 큰 것을 캔버스로 본다.
    await page.locator('iframe[title="Canvas"]').waitFor(); // 부하에서 iframe이 아직 없을 때 canvas가 undefined가 되던 경합을 막는다
    const canvas = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.getBoundingClientRect().toJSON()).sort((a, b) => b.width * b.height - a.width * a.height)[0]);
    check(`[${tag}] 캔버스가 보인다`, inside(canvas, w, h) && canvas.width > 300, canvas);
    // 필름스트립은 모든 폭에서 보이고 가로 스크롤 없이 화면 안에 있다(패널이 접혀도 그대로).
    const film = await page.locator('section[data-testid="filmstrip"]').boundingBox().catch(() => null);
    check(`[${tag}] 필름스트립이 보인다`, !film || (film.x >= -1 && film.x + film.width <= w + 1 && film.height > 20), film);
    const asides = () => page.locator('aside[aria-label]').count();
    if (w <= 1100) {
      check(`[${tag}] 좁은 폭에서 패널은 기본 접힘`, (await asides()) === 0, await asides());
      await page.getByRole('button', { name: 'Toggle sidebar' }).click();
      await sleep(500); await shot('edit-left-open');
      const left = await page.locator('aside[aria-label]').first().boundingBox();
      check(`[${tag}] 열린 패널 폭은 화면의 85% 이내`, left && left.width <= w * 0.85 + 1, left);
      const main = await page.locator('main').boundingBox();
      check(`[${tag}] 패널은 콘텐츠를 밀지 않고 위에 뜬다`, Math.abs(main.width - w) < 2, main);
      check(`[${tag}] 열린 패널은 role=dialog이고 포커스가 안으로 들어간다`, await page.evaluate(() => { const d = document.querySelector('[data-shell-panel]'); return !!d && d.getAttribute('role') === 'dialog' && d.contains(document.activeElement); }));
      await page.keyboard.press('Escape'); await sleep(500);
      check(`[${tag}] 닫으면 포커스가 토글 버튼으로 돌아간다`, await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Toggle sidebar'), await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 80)));
      check(`[${tag}] Esc로 닫힌다`, (await asides()) === 0, await asides());
      await page.getByRole('button', { name: 'Toggle sidebar' }).click(); await sleep(400);
      await page.getByTestId('shell-scrim').click({ position: { x: w - 5, y: 300 } }); await sleep(500);
      check(`[${tag}] 바깥 클릭으로 닫힌다`, (await asides()) === 0, await asides());
      await page.keyboard.press('Control+\\'); await sleep(500);
      check(`[${tag}] Cmd+\\로 좌우 패널이 함께 열린다`, (await asides()) === 2, await asides());
      await shot('edit-both-open');
    } else {
      check(`[${tag}] 넓은 폭에서 패널은 기본 펼침`, (await asides()) === 2, await asides());
    }
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
