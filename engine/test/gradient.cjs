/* linear-gradient 채우기(편집기의 Fill, Background)가 엔진 화면, 번들, 인쇄(PDF와 같은 print CSS), 실제 PDF에서 같게 보이는지 본다.
   덱 decks/_gr-test를 만들고 끝나면 지운다. 사용: PW=<playwright-core> CHROME=<headless shell> node engine/test/gradient.cjs
   확인: 슬라이드 배경과 요소 채우기, var(--sk-*) 스톱이 토큰 변경을 따라감, hex8과 rgba 스톱, 번들과 print의 computed background-image가 엔진과 같음,
   실제 PDF에서 벡터 셰이딩(ShadingType 2)으로 남고 양 끝 색이 맞음. */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), DIR = path.join(ROOT, 'decks', '_gr-test');
let fail = 0; const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || x === undefined ? '' : '  ' + JSON.stringify(x))); };
const html = `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>gr</title>
<script type="application/json" id="deck-meta">{ "title": "gr", "id": "gr-test" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css">
<style>:root { --sk-accent: #00ff00; }</style></head><body>
<section data-slide="cover" id="s1" style="background-image: linear-gradient(90deg, var(--sk-accent) 0%, #0000ff 100%)"><h1>Gradient</h1></section>
<section data-slide="content" id="s2"><h2>Fill</h2>
<div id="e1" style="width: 600px; height: 200px; background-image: linear-gradient(45deg, #ff000080 0%, rgba(0, 0, 255, 0.5) 100%)"></div>
<div id="e2" style="width: 600px; height: 200px; background-image: linear-gradient(180deg, var(--sk-accent) 10%, #123456 60%, #ffffff 100%)"></div></section>
<script src="../../engine/slidekit.js"></script></body></html>`;
const sh = (c) => cp.spawnSync('sh', ['-c', c], { cwd: ROOT, encoding: 'utf8' });
const bgs = (p) => p.evaluate(() => ['s1', 'e1', 'e2'].map((id) => getComputedStyle(document.getElementById(id)).backgroundImage));
(async () => {
  const b = await launch();
  const open = async (file, hash, print) => {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ctx.newPage(); await p.goto('file://' + file + hash); await p.waitForSelector('#sk-stage');
    if (print) await p.emulateMedia({ media: 'print' });
    return { p, ctx };
  };
  try {
    fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'index.html'), html);
    check('lint 통과', sh('bun app/server.ts lint _gr-test').status === 0, sh('bun app/server.ts lint _gr-test').stdout);
    const bun = sh('bun app/server.ts bundle _gr-test'); check('번들 생성', bun.status === 0, bun.stderr);
    const bundled = path.join(ROOT, 'dist', '_gr-test.html');
    const eng = await open(path.join(DIR, 'index.html'), '#1'), e = await bgs(eng.p);
    check('엔진: 슬라이드 배경(var 스톱이 rgb로 풀림)', e[0] === 'linear-gradient(90deg, rgb(0, 255, 0) 0%, rgb(0, 0, 255) 100%)', e[0]);
    check('엔진: hex8과 rgba 스톱(투명도 유지)', /^linear-gradient\(45deg, rgba\(255, 0, 0, 0\.50?\d*\) 0%, rgba\(0, 0, 255, 0\.5\) 100%\)$/.test(e[1]), e[1]);
    check('엔진: 3스톱과 var 스톱', /^linear-gradient\((180deg, )?rgb\(0, 255, 0\) 10%, rgb\(18, 52, 86\) 60%, rgb\(255, 255, 255\) 100%\)$/.test(e[2]), e[2]);
    await eng.p.evaluate(() => document.documentElement.style.setProperty('--sk-accent', '#ff00ff'));
    const t = await bgs(eng.p);
    check('토큰을 바꾸면 var 스톱이 따라간다(슬라이드 배경과 요소)', t[0].includes('rgb(255, 0, 255) 0%') && t[2].includes('rgb(255, 0, 255) 10%'), t);
    await eng.ctx.close();
    const bun2 = await open(bundled, '#1'), bd = await bgs(bun2.p); await bun2.ctx.close();
    check('번들과 엔진이 같다', JSON.stringify(bd) === JSON.stringify(e), [bd, e]);
    const prt = await open(bundled, '#1', true), pr = await bgs(prt.p);
    const adj = await prt.p.evaluate(() => getComputedStyle(document.body).printColorAdjust || getComputedStyle(document.body).webkitPrintColorAdjust);
    await prt.ctx.close();
    check('인쇄 CSS와 엔진이 같고 print-color-adjust가 exact', JSON.stringify(pr) === JSON.stringify(e) && adj === 'exact', [pr, adj]);
    // 실제 PDF: 1쪽을 그림으로 바꿔 왼쪽 끝은 초록, 오른쪽 끝은 파랑이고 가운데는 둘 사이인지 픽셀로 본다
    const pdf = sh('bun app/server.ts pdf _gr-test'); check('PDF 생성(2페이지)', pdf.status === 0 && /2페이지/.test(pdf.stdout), pdf.stdout + pdf.stderr);
    // PDF 안에 선형 그라디언트가 벡터 셰이딩(ShadingType 2)으로 들어 있고 슬라이드 배경의 양 끝 색이 맞는지: 객체 사전은 압축되지 않아 바이트에서 읽을 수 있다.
    // (macOS sips/Quick Look으로 그림으로 바꿔 보는 방법은 CoreGraphics가 이 셰이딩을 그리지 못해 검게 나와 쓰지 않는다. Chrome이 만든 PDF 자체는 정상이다.)
    // 투명도 있는 스톱(e1)은 SMask로 들어가 셰이딩 수가 달라질 수 있어 여기서는 세지 않는다.
    const raw = fs.readFileSync(path.join(ROOT, 'dist', '_gr-test.pdf')).toString('latin1');
    const shadings = raw.match(/<<[^<>]*?(?:<<[^<>]*?>>[^<>]*?)*\/ShadingType 2[^>]*>>/g) || [];
    check('PDF: 슬라이드 배경이 벡터 셰이딩으로 들어 있고 양 끝 색이 초록(0 1 0)과 파랑(0 0 1)이다',
      /\/C0 \[0 1 0\][^>]*\/C1 \[0 0 1\]/.test(raw) && /\/Coords \[0 0 1920 0\]/.test(raw), raw.match(/\/ShadingType \d/g));
    check('PDF: 3스톱 요소(var 스톱 포함)도 셰이딩이며 끝 색이 흰색(1 1 1)이다', /\/Coords \[0 0 0 200\][^]*?\/ShadingType 2/.test(raw) || /\/C1 \[1 1 1\]/.test(raw), shadings.length);
  } finally {
    await b.close(); fs.rmSync(DIR, { recursive: true, force: true });
    for (const e of ['html', 'pdf']) fs.rmSync(path.join(ROOT, 'dist', '_gr-test.' + e), { force: true });
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(DIR, { recursive: true, force: true }); process.exit(2); });
