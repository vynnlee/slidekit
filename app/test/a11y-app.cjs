/* 덱 목록과 발표자 화면의 접근성(axe)과 화면 점검. 상태마다 axe를 돌려 serious와 critical 위반을 보고하고, SHOTS가 있으면 1440, 1024, 390 스크린샷을 남긴다.
   테스트 덱은 _e2e-a11y(파일)와 zz-e2e-qa-*(API)로 만들고 끝에 지운다.
   Usage: PW=<playwright-core> CHROME=<headless shell> AXE=<axe.min.js> BASE=http://127.0.0.1:3200 [SHOTS=<폴더>] node a11y-app.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const DECKS = path.join(__dirname, '..', '..', 'decks');
const AXE = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, 'utf8') : null;
const DIR = path.join(DECKS, '_e2e-a11y');
fs.mkdirSync(DIR, { recursive: true });
const secs = ['<section data-slide="cover"><h1>A11y deck</h1><aside data-notes>Welcome.\n\n- one\n- two</aside></section>'];
for (let c = 1; c <= 3; c++) { secs.push(`<section data-slide="chapter" data-title="Chapter ${c}"><h1>Chapter ${c}</h1></section>`); for (let k = 0; k < 3; k++) secs.push(`<section data-slide="content"><h2>Slide ${c}.${k}</h2><aside data-notes>Notes ${c}.${k} with **bold** and a [link](https://example.com).</aside></section>`); }
secs.push('<section data-slide="end"><h1>End</h1></section>');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>A11y deck</title><script type="application/json" id="deck-meta">{ "title": "A11y deck", "id": "e2e-a11y" }</script><link rel="stylesheet" href="../../engine/slidekit.css"></head><body>${secs.join('\n')}<script src="../../engine/slidekit.js"></script></body></html>`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const cleanup = () => { fs.rmSync(DIR, { recursive: true, force: true }); for (const d of fs.readdirSync(DECKS)) if (d.startsWith('zz-e2e-qa')) fs.rmSync(path.join(DECKS, d), { recursive: true, force: true }); const tr = path.join(DECKS, '.trash'); if (fs.existsSync(tr)) { for (const d of fs.readdirSync(tr)) if (d.startsWith('zz-e2e-qa')) fs.rmSync(path.join(tr, d), { recursive: true, force: true }); try { fs.rmdirSync(tr); } catch {} } };
process.on('exit', cleanup);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  for (const [w, h, tag] of [[1440, 900, 'd'], [1024, 768, 't'], [390, 844, 'm']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: tag === 'm' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    for (const n of ['a', 'b']) await ctx.request.post(BASE + '/api/decks', { data: { name: 'zz-e2e-qa-' + n, title: n === 'a' ? 'Quarterly review' : 'Offsite plan' } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const shot = (n) => process.env.SHOTS && page.screenshot({ path: path.join(process.env.SHOTS, `${tag}-${n}.png`) });
    const axe = async (n) => {
      if (!AXE) return;
      await page.evaluate(AXE);
      const r = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
      // 알려진 예외: Fluid SidebarMenu(레지스트리 파일)가 ul 안에 hover 표시용 div를 직접 넣어 axe의 list 규칙에 걸린다.
      const bad = r.violations.filter((v) => (v.impact === 'serious' || v.impact === 'critical') && !(v.id === 'list' && v.nodes.every((x) => x.target.join(' ') === 'ul')));
      check(`[${tag}] axe ${n}`, bad.length === 0, bad.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, first: v.nodes[0].target.join(' ').slice(0, 90), msg: (v.nodes[0].any[0] || v.nodes[0].all[0] || v.nodes[0].none[0] || {}).message?.slice(0, 120) })));
    };
    await page.goto(BASE + '/'); await page.getByRole('button', { name: 'New deck' }).waitFor(); await sleep(1800);
    await shot('list'); await axe('덱 목록(그리드)');
    await page.getByRole('button', { name: 'Toggle view' }).click(); await sleep(500); await shot('list-rows'); await axe('덱 목록(행)');
    await page.getByRole('button', { name: 'Toggle view' }).click(); await sleep(300);
    await page.getByRole('button', { name: /^Search/ }).click(); await sleep(500);
    await page.keyboard.type('quarterly'); await sleep(900); await shot('search'); await axe('검색 팔레트');
    await page.keyboard.press('Escape'); await sleep(400);
    await page.getByRole('button', { name: 'New deck' }).click(); await sleep(400);
    await page.getByRole('dialog').getByLabel('Title').fill('Quarterly review'); await page.getByRole('dialog').getByLabel('Folder').fill('zz-e2e-qa-a'); await sleep(300);
    await shot('newdeck'); await axe('New deck 오류 상태');
    await page.keyboard.press('Escape'); await sleep(300);
    await page.getByRole('button', { name: 'Actions for Quarterly review' }).click({ force: true }); await sleep(300);
    await page.getByRole('menuitem', { name: 'Move to trash' }).click(); await sleep(600); await shot('undo-toast'); await axe('Undo 토스트');
    await page.getByRole('button', { name: /^Trash/ }).click(); await sleep(700); await shot('trash'); await axe('Trash 보기');
    await page.goto(BASE + '/present/e2e-a11y'); await page.getByRole('button', { name: 'Present' }).waitFor(); await sleep(2000);
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.mouse.click(w / 2, h - 20); await page.keyboard.press('t'); await sleep(2300); await shot('present'); await axe('발표자 화면');
    const w2 = await ctx.newPage(); await w2.goto(BASE + '/decks/_e2e-a11y/index.html?sync=1');
    await page.bringToFront(); await sleep(3500); await shot('present-window-open');
    await w2.evaluate(() => new BroadcastChannel('slidekit:e2e-a11y').postMessage({ v: 1, type: 'blank', from: 't', mode: 'black' })); await sleep(500); await shot('present-blanked'); await axe('가리기 표시');
    await w2.close(); await sleep(7500); await shot('present-window-closed');
    await page.getByRole('button', { name: 'Summary' }).click(); await sleep(500); await shot('summary'); await axe('리허설 요약');
    await page.keyboard.press('Escape'); await sleep(300);
    await page.goto(BASE + '/present/nope'); await sleep(700); await shot('present-404'); await axe('없는 덱');
    check(`[${tag}] 페이지 오류 없음`, errors.length === 0, errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
