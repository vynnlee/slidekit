/* 편집기에서 끌기와 크기 조절로 생기는 인라인 translate, width, height가 엔진 화면, 번들, 인쇄(PDF와 같은 print CSS)에서 같은 자리에 보이는지 본다.
   덱 decks/_mv-test를 만들고 끝나면 지운다. 사용: PW=<playwright-core> CHROME=<headless shell> node engine/test/moved.cjs
   기준 덱(translate만 없음, 크기는 같게 해서 흐름 배치가 같다)과 비교한 변위가 translate 값과 같아야 하고, 번들과 인쇄의 변위는 엔진 화면과 같아야 한다. */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), DIR = path.join(ROOT, 'decks', '_mv-test'), OUT = process.env.SHOTS;
let fail = 0; const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || x === undefined ? '' : '  ' + JSON.stringify(x))); };
const deck = (moved) => `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>mv</title>
<script type="application/json" id="deck-meta">{ "title": "mv", "id": "mv-test" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"></head><body>
<section data-slide="cover"><h1 id="t"${moved ? ' style="translate: 200px -40px"' : ''}>Moved</h1><div id="c" style="width: 500px; height: 200px; background: #ccc"${moved ? '' : ''}></div></section>
<section data-slide="content"><h2>Steps</h2><ul><li id="s1" data-step style="width: 700px${moved ? '; translate: 80px 30px' : ''}">One</li><li id="s2" data-step>Two</li></ul>
<div id="r"style="width: 640px; height: 260px; background: #888${moved ? '; translate: -50px 20px' : ''}"></div></section>
<script src="../../engine/slidekit.js"></script></body></html>`;
const sh = (c) => cp.spawnSync('sh', ['-c', c], { cwd: ROOT, encoding: 'utf8' });
const rects = (page) => page.evaluate(() => {
  const o = {};
  for (const id of ['t', 'c', 's1', 'r']) {
    const e = document.getElementById(id), s = e.closest('[data-slide]'), a = e.getBoundingClientRect(), b = s.getBoundingClientRect();
    o[id] = [Math.round(a.x - b.x), Math.round(a.y - b.y), Math.round(a.width), Math.round(a.height)];
  }
  return o;
});
(async () => {
  const b = await launch();
  const shoot = async (file, name, print) => {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const p = await ctx.newPage(); await p.goto('file://' + file + '#2'); await p.waitForSelector('#sk-stage');
    if (print) await p.emulateMedia({ media: 'print' });
    await p.evaluate(() => document.querySelectorAll('[data-step]').forEach((e) => e.setAttribute('data-shown', ''))); // 모든 단계를 보인 상태로 비교
    await p.waitForFunction(() => [...document.querySelectorAll('[data-step]')].every((e) => getComputedStyle(e).transform === 'none' || getComputedStyle(e).transform === 'matrix(1, 0, 0, 1, 0, 0)'));
    const r = await rects(p);
    if (OUT) await p.screenshot({ path: path.join(OUT, `moved-${name}.png`) });
    await ctx.close(); return r;
  };
  try {
    fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'index.html'), deck(false));
    const base = await shoot(path.join(DIR, 'index.html'), 'base-engine');
    fs.writeFileSync(path.join(DIR, 'index.html'), deck(true));
    const eng = await shoot(path.join(DIR, 'index.html'), 'engine');
    check('lint 통과', sh('bun app/server.ts lint _mv-test').status === 0, sh('bun app/server.ts lint _mv-test').stdout);
    const bun = sh('bun app/server.ts bundle _mv-test'); check('번들 생성', bun.status === 0, bun.stderr);
    const bundled = path.join(ROOT, 'dist', '_mv-test.html');
    const bun2 = await shoot(bundled, 'bundle'), prt = await shoot(bundled, 'print', true);
    const d = (m, k) => [m[k][0] - base[k][0], m[k][1] - base[k][1], m[k][2], m[k][3]];
    check('translate만 있으면 크기는 그대로, 변위는 style 값', JSON.stringify(d(eng, 't')) === JSON.stringify([200, -40, base.t[2], base.t[3]]), [d(eng, 't'), base.t]);
    check('단계 요소: translate와 width가 함께 적용', JSON.stringify(d(eng, 's1')) === JSON.stringify([80, 30, 700, base.s1[3]]), [d(eng, 's1'), base.s1]);
    check('width와 height와 translate(리사이즈한 요소)', JSON.stringify(d(eng, 'r')) === JSON.stringify([-50, 20, 640, 260]), d(eng, 'r'));
    check('손대지 않은 요소는 그대로', JSON.stringify(eng.c) === JSON.stringify(base.c), [eng.c, base.c]);
    check('번들과 엔진 화면이 같다', JSON.stringify(bun2) === JSON.stringify(eng), [bun2, eng]);
    check('인쇄(PDF와 같은 print CSS)와 엔진 화면이 같다', JSON.stringify(prt) === JSON.stringify(eng), [prt, eng]);
    const pdf = sh('bun app/server.ts pdf _mv-test'); check('PDF 생성(2페이지)', pdf.status === 0 && /2페이지/.test(pdf.stdout), pdf.stdout + pdf.stderr);
  } finally {
    await b.close(); fs.rmSync(DIR, { recursive: true, force: true });
    for (const e of ['html', 'pdf']) fs.rmSync(path.join(ROOT, 'dist', '_mv-test.' + e), { force: true });
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(DIR, { recursive: true, force: true }); process.exit(2); });
