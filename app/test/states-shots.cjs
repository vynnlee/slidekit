/* 비정상 상태 화면 점검(수동 도구, 러너 단계 아님): 목록, 발표자, 편집기의 서버 실패, 빈 목록, 없는 덱, 슬라이드 0장, 긴 이름, 연결 끊김을 만들어
   화면 글자를 출력하고 스크린샷을 남긴다. 실제 덱은 건드리지 않고 /api/decks 같은 응답은 브라우저에서 가로채 흉내 낸다(덱 파일은 _e2e-states-* 임시 폴더만).
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 SHOTS=<폴더> node states-shots.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const OUT = process.env.SHOTS || '/tmp/states-shots';
fs.mkdirSync(OUT, { recursive: true });
const DECKS = path.join(__dirname, '..', '..', 'decks');
const mk = (name, body, meta) => { const d = path.join(DECKS, name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${meta.title}</title><script type="application/json" id="deck-meta">${JSON.stringify(meta)}</script><link rel="stylesheet" href="../../engine/slidekit.css"></head><body>${body}<script src="../../engine/slidekit.js"></script></body></html>`); };
const LONG = 'A very long deck title that goes on and on and should be truncated or wrapped without breaking the layout of the cards or the toolbar anywhere';
mk('_e2e-states-zero', '', { title: 'Zero slides', id: 'e2e-states-zero' });
mk('_e2e-states-long', '<section data-slide="cover"><h1>Long</h1></section>', { title: LONG, id: 'e2e-states-long', author: 'An author with a rather long name that also needs to be cut' });
process.on('exit', () => { for (const d of ['_e2e-states-zero', '_e2e-states-long']) fs.rmSync(path.join(DECKS, d), { recursive: true, force: true }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').slice(0, 260);

(async () => {
  const browser = await launch();
  for (const [w, h, tag] of [[1440, 900, 'd'], [390, 844, 'm']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'm' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const shot = async (n) => { await sleep(700); await page.screenshot({ path: path.join(OUT, `${tag}-${n}.png`) }); console.log(`[${tag}] ${n}: ${await text(page)}`); };
    const go = (u) => page.goto(BASE + u, { waitUntil: 'domcontentloaded' });
    // 1 서버 실패
    await page.route('**/api/decks', (r) => r.request().method() === 'GET' ? r.fulfill({ status: 500, body: 'boom' }) : r.continue());
    await go('/'); await sleep(1500); await shot('list-500');
    await go('/present/e2e-states-long'); await sleep(1500); await shot('present-500');
    await page.unroute('**/api/decks');
    // 2 빈 목록
    await page.route('**/api/decks', (r) => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue());
    await go('/'); await sleep(1500); await shot('list-empty');
    await page.unroute('**/api/decks');
    // 4 긴 이름
    await page.route('**/api/decks', (r) => r.request().method() === 'GET' ? r.fulfill({ json: [{ id: 'long-1', folder: 'long-1', title: LONG, author: 'An author with a rather long name that also needs to be cut', slides: 12, modified: new Date().toISOString(), date: '2026-10-15' }, { id: 'long-2', folder: 'long-2-with-a-very-long-folder-name-that-keeps-going', title: 'Short', slides: 3, modified: new Date().toISOString() }] }) : r.continue());
    await go('/'); await sleep(1500); await shot('list-long');
    await page.getByRole('button', { name: 'Toggle view' }).click(); await sleep(500); await shot('list-long-rows');
    await page.unroute('**/api/decks');
    await page.evaluate(() => localStorage.removeItem('slidekit:list-view'));
    // 3 없는 덱
    await go('/edit/nonexistent-deck'); await sleep(2000); await shot('edit-404');
    await go('/present/nonexistent-deck'); await sleep(2000); await shot('present-404');
    // 4 슬라이드 0장과 긴 제목
    await go('/edit/e2e-states-zero'); await sleep(2500); await shot('edit-zero');
    await go('/present/e2e-states-zero'); await sleep(2500); await shot('present-zero');
    await go('/present/e2e-states-long'); await sleep(2500); await shot('present-long');
    await go('/edit/e2e-states-long'); await sleep(2500); await shot('edit-long');
    // 5 연결 끊김
    await go('/'); await sleep(1500);
    await page.route('**/api/ping', (r) => r.abort());
    await sleep(7500); await shot('list-offline');
    await page.unroute('**/api/ping');
    await sleep(6500); await shot('list-recovered');
    await ctx.close();
  }
  await browser.close();
})();
