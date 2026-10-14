/* 휴대폰 리모컨 화면 QA(수동 도구, 러너 단계 아님): 폰 크기별 스크린샷, 터치 목표, 가로 스크롤, 긴 제목, 축 접근성(axe), 연결 끊김과 복구.
   Usage: PW=<playwright-core> CHROME=<headless shell> AXE=<axe.min.js> BASE=http://127.0.0.1:3200 [SHOTS=<폴더>] node remote-qa.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const AXE = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, 'utf8') : null;
const DECK = '_e2e-remote-qa', ID = 'e2e-remote-qa';
const DIR = path.join(__dirname, '..', '..', 'decks', DECK);
fs.mkdirSync(DIR, { recursive: true });
const LONG = 'A very long slide title that has to wrap or truncate properly on a small phone screen without breaking the layout';
const notes = Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1}: speaker notes with **bold** text and enough words to need scrolling on a phone.`).join('\n\n');
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${ID}</title>
<script type="application/json" id="deck-meta">{ "title": "${ID}", "id": "${ID}" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"></head><body>
<section data-slide="cover"><h1>${LONG}</h1><aside data-notes>${notes}</aside></section>
<section data-slide="content"><h2>Second</h2><aside data-notes>Short note</aside></section>
<script src="../../engine/slidekit.js"></script></body></html>`);
process.on('exit', () => fs.rmSync(DIR, { recursive: true, force: true }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || extra === undefined ? '' : '  ' + JSON.stringify(extra)}`); };
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };
const SIZES = [[375, 667, 'se'], [390, 844, '14'], [430, 932, 'max'], [844, 390, 'land']];

(async () => {
  const browser = await launch();
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await hostCtx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const host = await hostCtx.newPage();
  await host.goto(`${BASE}/present/${ID}`, { waitUntil: 'domcontentloaded' });
  await host.getByRole('button', { name: 'Remote' }).click();
  const dlg = host.getByRole('dialog', { name: 'Phone remote' });
  await dlg.getByRole('button', { name: 'Start remote' }).click();
  // 크기마다 새 코드가 필요하다(코드는 1회용): 발표자 키로 start를 다시 불러 코드만 갱신한다.
  const newCode = () => host.evaluate(async (d) => { const k = sessionStorage.getItem(`slidekit:remote-host:${d}`); const r = await fetch(`/api/remote/${d}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Remote-Key': k }, body: '{}' }); return (await r.json()).code.replace('-', ''); }, DECK);
  for (const [w, h, tag] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { const E = window.EventSource; window.__es = []; window.EventSource = class extends E { constructor(...a) { super(...a); window.__es.push(this); } }; });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const shot = (n) => process.env.SHOTS && page.screenshot({ path: path.join(process.env.SHOTS, `remote-${tag}-${n}.png`) });
    const axe = async (n) => {
      if (!AXE) return;
      await page.evaluate(AXE);
      const r = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      check(`[${tag}] axe ${n}`, bad.length === 0, bad.map((v) => ({ id: v.id, n: v.nodes.length, first: v.nodes[0].target.join(' ').slice(0, 80), msg: (v.nodes[0].any[0] || v.nodes[0].all[0] || {}).message?.slice(0, 100) })));
    };
    // 코드 입력 화면
    await page.goto(`${BASE}/remote/${DECK}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Pairing code').waitFor();
    await shot('code'); await axe('코드 입력');
    await page.goto('about:blank'); // 해시만 바뀌는 이동은 페이지를 다시 만들지 않는다
    await page.goto(`${BASE}/remote/${DECK}#code=${await newCode()}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Next slide' }).waitFor();
    check(`[${tag}] 슬라이드 번호가 보인다`, await until(async () => (await page.getByText(/^1 \/ 2$/).count()) === 1));
    await sleep(400); await shot('live'); await axe('연결됨');
    // 터치 목표: 모든 버튼이 44px 이상
    const small = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { n: b.getAttribute('aria-label') || b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.w < 44 || b.h < 44));
    check(`[${tag}] 모든 버튼이 44px 이상`, small.length === 0, small);
    // 가로 스크롤 없음, 모든 컨트롤이 화면 안
    const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, out: [...document.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.top < -1; }).map((b) => b.getAttribute('aria-label') || b.textContent.trim()) }));
    check(`[${tag}] 가로 스크롤 없음`, over.sw <= over.w, over);
    check(`[${tag}] 버튼이 모두 화면 안(세로로 잘리지 않음)`, over.out.length === 0, over.out);
    // 긴 제목은 레이아웃을 깨지 않는다(헤더가 화면 폭 안)
    const head = await page.evaluate(() => { const hd = document.querySelector('header'); const r = hd.getBoundingClientRect(); return { right: Math.round(r.right), w: innerWidth, h: Math.round(r.height) }; });
    check(`[${tag}] 헤더가 화면 폭 안`, head.right <= head.w + 1, head);
    // 노트는 스크롤되고 글자 크기 조절이 동작한다
    const f0 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[aria-label="Speaker notes"]')).fontSize));
    await page.getByRole('button', { name: 'Larger notes' }).tap();
    const f1 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[aria-label="Speaker notes"]')).fontSize));
    check(`[${tag}] 노트 글자 크기 조절`, f1 === f0 + 2, [f0, f1]);
    const sc = await page.evaluate(() => { const n = document.querySelector('[aria-label="Speaker notes"]'); return { sh: n.scrollHeight, ch: n.clientHeight }; });
    check(`[${tag}] 긴 노트는 안에서 스크롤`, sc.sh > sc.ch, sc);
    // 연결 끊김과 복구
    await page.route('**/ticket', (r) => r.abort());
    await page.evaluate(() => window.__es.at(-1).dispatchEvent(new Event('error')));
    check(`[${tag}] 끊김 안내`, await until(async () => (await page.getByText(/Connection lost/).count()) === 1, 10000));
    await shot('lost'); await axe('연결 끊김');
    await page.unroute('**/ticket');
    check(`[${tag}] 복구`, await until(async () => (await page.getByText(/Connection lost/).count()) === 0, 15000));
    check(`[${tag}] 페이지 오류 없음`, errors.length === 0, errors);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
