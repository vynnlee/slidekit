/* 화면 일관성 점검용 스크린샷(수동 도구, 러너 단계 아님): 목록, 발표자, 편집기와 대화상자들을 1440x900과 390x844로 찍는다.
   각 상태는 실패해도 다음으로 넘어가고, 못 연 상태는 SKIP으로 알린다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 SHOTS=<폴더> node audit-shots.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const OUT = process.env.SHOTS || '/tmp/audit-shots';
fs.mkdirSync(OUT, { recursive: true });
const DECK = '_e2e-audit', ID = 'e2e-audit';
const DIR = path.join(__dirname, '..', '..', 'decks', DECK);
fs.mkdirSync(DIR, { recursive: true });
const secs = ['<section data-slide="cover"><h1>Audit deck</h1><p>Subtitle</p><aside data-notes>Welcome notes.\n\n- one\n- two</aside></section>'];
for (let c = 1; c <= 2; c++) { secs.push(`<section data-slide="chapter" data-title="Chapter ${c}"><h1>Chapter ${c}</h1></section>`); for (let k = 1; k <= 3; k++) secs.push(`<section data-slide="content"><h2>Slide ${c}.${k}</h2><p>Body text for slide ${c}.${k}</p><aside data-notes>Notes ${c}.${k}</aside></section>`); }
secs.push('<section data-slide="end"><h1>End</h1></section>');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>Audit deck</title>
<script type="application/json" id="deck-meta">{ "title": "Audit deck", "id": "${ID}", "author": "Audit", "date": "2026-10-15" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"></head><body>
${secs.join('\n')}
<script src="../../engine/slidekit.js"></script></body></html>`);
process.on('exit', () => fs.rmSync(DIR, { recursive: true, force: true }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];

(async () => {
  const browser = await launch();
  for (const [w, h, tag] of [[1440, 900, 'd'], [390, 844, 'm']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'm' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const shot = async (n) => { await sleep(500); await page.screenshot({ path: path.join(OUT, `${tag}-${n}.png`) }); };
    const state = async (n, fn) => { try { await fn(); await shot(n); } catch (e) { log.push(`SKIP ${tag}-${n}: ${String(e).split('\n')[0].slice(0, 100)}`); try { await page.screenshot({ path: path.join(OUT, `${tag}-${n}-fail.png`) }); } catch {} } finally { await page.keyboard.press('Escape').catch(() => {}); await sleep(250); } };
    const to = async (u) => { await page.goto(BASE + u, { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    // 목록
    await to('/');
    await state('list', async () => {});
    await state('list-search', async () => { await page.keyboard.press('Control+k'); await page.getByRole('dialog').waitFor(); });
    await state('list-keys', async () => { await page.locator('body').click({ position: { x: 3, y: 3 } }); await page.keyboard.press('Shift+?'); await page.getByRole('dialog').waitFor(); });
    await state('list-newdeck', async () => { await page.getByRole('button', { name: 'New deck' }).click(); await page.getByRole('dialog').waitFor(); });
    await state('list-menu', async () => { await page.getByRole('button', { name: ID, exact: true }).click({ button: 'right', position: { x: 30, y: 30 } }); await page.getByRole('menu').waitFor(); });
    await state('list-settings', async () => { await page.getByRole('button', { name: `Actions for Audit deck` }).click(); await page.getByRole('menuitem', { name: 'Settings' }).click(); await page.getByRole('dialog').waitFor(); });
    await state('list-trash', async () => { await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Trash', exact: true }).click(); await sleep(600); });
    // 발表자
    await to(`/present/${ID}`);
    await state('present', async () => {});
    await state('present-palette', async () => { await page.keyboard.press('Control+k'); await page.getByRole('dialog').waitFor(); });
    await state('present-keys', async () => { await page.mouse.click(5, h - 5); await page.keyboard.press('Shift+?'); await page.getByRole('dialog').waitFor(); });
    await state('present-remote', async () => { await page.getByRole('button', { name: 'Remote' }).click(); await page.getByRole('dialog').waitFor(); });
    // 편집기
    await to(`/edit/${ID}`);
    await state('edit', async () => {});
    await state('edit-palette', async () => { await page.keyboard.press('Control+k'); await page.getByRole('dialog').waitFor(); });
    await state('edit-keys', async () => { await page.keyboard.press('Control+/'); await page.getByRole('dialog').waitFor(); });
    await state('edit-find', async () => { await page.keyboard.press('Control+f'); await sleep(400); });
    await state('edit-settings', async () => { await page.getByRole('button', { name: /Deck settings/ }).click(); await page.getByRole('dialog').waitFor(); });
    await state('edit-export', async () => { await page.getByRole('button', { name: /^Export/ }).click(); await sleep(500); });
    await state('edit-versions', async () => { await page.getByRole('button', { name: /^Export/ }).click(); await page.getByRole('menuitem', { name: /Version history/ }).click(); await page.getByRole('dialog').waitFor(); });
    await state('edit-published', async () => { await page.getByRole('button', { name: /^Export/ }).click(); await page.getByRole('menuitem', { name: /Published/ }).click(); await page.getByRole('dialog').waitFor(); });
    // 리모컨
    await ctx.close();
  }
  await browser.close();
  console.log(log.length ? log.join('\n') : 'all states captured');
})();
