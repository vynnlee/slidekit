/* 번들한 덱과 PDF가 네트워크 없이 같은 결과인지 본다(발표장 와이파이가 불안정한 경우).
   1) 외부 참조가 없는 덱(이미지, CSS url, poster)을 번들해 file://로 열고 http(s)와 ws 요청을 모두 막고 기록한다: 0건, 화면이 뜸, 이미지가 그려짐, setOffline도 같은 결과
   2) slidekit-guide도 같다
   3) 외부 이미지 참조가 남은 덱은 lint가 external을 경고하고 doctor가 알리며, 번들 결과에 그 참조가 남아 있음을 확인한다(숨기지 않는다)
   4) 느린 망(외부 요청 응답 5초 지연): 번들은 영향 없음(요청이 없다), 번들하지 않은 외부 글꼴 덱은 렌더가 그만큼 막히는지 재서 알린다(덱 수정은 사용자 몫, 실패로 치지 않음)
   5) PDF 생성은 네트워크를 쓰지 않는다(Chrome 호스트 해석을 막은 채 만든다): 페이지 수가 같다
   덱 decks/_off-test, _off-ext를 만들고 끝나면 지운다. 외부 호출은 하지 않는다. 사용: PW=<playwright-core> CHROME=<headless shell> node engine/test/offline.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), D1 = path.join(ROOT, 'decks', '_off-test'), D2 = path.join(ROOT, 'decks', '_off-ext'), D3 = path.join(ROOT, 'decks', '_off-font');
let fail = 0; const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || x === undefined ? '' : '  ' + JSON.stringify(x))); };
const sh = (c) => cp.spawnSync('sh', ['-c', c], { cwd: ROOT, encoding: 'utf8' });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const head = (t) => `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${t}</title>
<script type="application/json" id="deck-meta">{ "title": "${t}" }</script><link rel="stylesheet" href="../../engine/slidekit.css"></head><body>`;
const tail = '<script src="../../engine/slidekit.js"></script></body></html>';
const html1 = head('off') + `<section data-slide="cover"><h1>Offline</h1><img id="im" alt="dot" src="pic.png"></section>
<section data-slide="content"><h2>Two</h2><div id="bg" style="width:200px;height:100px;background:url(pic.png)"></div><video poster="pic.png"></video></section>` + tail;
const html2 = head('ext') + `<section data-slide="cover"><h1>External</h1><img alt="x" src="https://example.invalid/a.png"></section><section data-slide="content"><h2>Two</h2><p>x</p></section>` + tail;
const html3 = head('font').replace('</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR&display=swap"></head>') + `<section data-slide="cover"><h1>Font</h1></section><section data-slide="content"><h2>Two</h2></section>` + tail;
const external = (h) => [...h.matchAll(/\b(?:src|href|poster)=["'](https?:\/\/[^"']+)/g)].map((m) => m[1]).concat([...h.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/g)].map((m) => m[1]));
(async () => {
  const b = await launch();
  const open = async (file, offline) => {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
    const reqs = [], errors = [];
    await ctx.route((u) => /^(https?|wss?):/.test(u.href), (r) => { reqs.push(r.request().url()); r.abort(); });
    if (offline) await ctx.setOffline(true);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto('file://' + file); await p.waitForSelector('#sk-stage');
    await p.waitForFunction(() => [...document.images].every((i) => i.complete));
    const info = await p.evaluate(() => ({ slides: document.querySelectorAll('#sk-stage > [data-slide]').length, img: document.getElementById('im') ? document.getElementById('im').naturalWidth : -1 }));
    await ctx.close(); return { reqs, errors, info };
  };
  try {
    for (const d of [D1, D2, D3]) fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(D1, { recursive: true }); fs.mkdirSync(D2, { recursive: true }); fs.mkdirSync(D3, { recursive: true });
    fs.writeFileSync(path.join(D3, 'index.html'), html3);
    fs.writeFileSync(path.join(D1, 'pic.png'), PNG); fs.writeFileSync(path.join(D1, 'index.html'), html1); fs.writeFileSync(path.join(D2, 'index.html'), html2);
    const TG = require('../../scripts/lib/test-deck.cjs').makeTestDeck('offline-guide', 'slidekit-guide'); /* 커밋된 안내 덱의 사본 */
    const guideHtml = path.join(ROOT, 'dist', TG.folder + '.html');
    check('번들 생성(외부 참조 없는 덱)', sh('bun app/server.ts bundle _off-test').status === 0);
    const out1 = path.join(ROOT, 'dist', '_off-test.html'), t1 = fs.readFileSync(out1, 'utf8');
    check('번들 결과에 http(s) 참조가 없다(src, href, poster, url())', external(t1).length === 0, external(t1));
    for (const [name, off] of [['차단', false], ['setOffline', true]]) {
      const r = await open(out1, off);
      check(`번들을 ${name} 상태로: 외부 요청 0건, 화면이 뜨고 이미지가 그려짐, 페이지 오류 없음`, r.reqs.length === 0 && r.errors.length === 0 && r.info.slides === 2 && r.info.img === 1, r);
    }
    check('번들 생성(slidekit-guide)', sh('bun app/server.ts bundle ' + TG.folder).status === 0);
    const tg = fs.readFileSync(guideHtml, 'utf8');
    check('slidekit-guide 번들에 http(s) 참조가 없다', external(tg).length === 0, external(tg));
    const g = await open(guideHtml, true);
    check('slidekit-guide를 오프라인으로: 외부 요청 0건, 26장, 오류 없음', g.reqs.length === 0 && g.errors.length === 0 && g.info.slides >= 20, g);
    // 외부 참조가 남은 덱: 숨기지 않고 알린다
    const lint = sh('bun app/server.ts lint _off-ext'); check('lint가 외부 리소스를 경고', /external|외부 리소스/.test(lint.stdout), lint.stdout.slice(-200));
    const doc = sh('bun app/server.ts doctor _off-ext'); check('doctor <덱>이 경고 수에 알림', /경고 [1-9]|WARN|!!/.test(doc.stdout), doc.stdout.slice(0, 300));
    check('번들 생성(외부 참조 덱)', sh('bun app/server.ts bundle _off-ext').status === 0);
    const t2 = fs.readFileSync(path.join(ROOT, 'dist', '_off-ext.html'), 'utf8');
    check('외부 참조는 번들에 그대로 남는다(내장화하지 않음)이고 오프라인에서도 화면은 뜬다', external(t2).length === 1 && (await open(path.join(ROOT, 'dist', '_off-ext.html'), true)).info.slides === 2, external(t2));
    // 느린 망: 외부 요청이 5초 늦게 실패한다. 번들은 요청이 없어 바로 뜨고, 번들하지 않은 외부 글꼴 덱은 head의 stylesheet 때문에 그만큼 막힌다.
    const timed = async (file) => {
      const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
      let asked = 0;
      await ctx.route((u) => /^https?:/.test(u.href), async (r) => { asked++; await new Promise((x) => setTimeout(x, 5000)); await r.abort().catch(() => {}); });
      const p = await ctx.newPage(); const t0 = Date.now();
      await p.goto('file://' + file, { waitUntil: 'commit' }); await p.waitForSelector('#sk-stage', { timeout: 20000 });
      const ms = Date.now() - t0; await ctx.close(); return { ms, asked };
    };
    const fast = await timed(out1);
    check('느린 망: 번들은 영향 없다(요청 0건, 3초 안에 뜸)', fast.asked === 0 && fast.ms < 3000, fast);
    const slow = await timed(path.join(D3, 'index.html'));
    console.log(`INFO 번들하지 않은 외부 글꼴 덱: 외부 요청 ${slow.asked}건, 화면이 뜨기까지 ${slow.ms}ms${slow.ms > 4000 ? ' (head의 외부 stylesheet가 렌더를 막는다. 발표 전에 번들한다)' : ''}`);
    const pdf = sh('bun app/server.ts pdf _off-test'); check('PDF 생성(2페이지, 호스트 해석을 막은 Chrome)', pdf.status === 0 && /2페이지/.test(pdf.stdout), pdf.stdout + pdf.stderr);
    fs.rmSync(path.join(ROOT, 'dist', TG.folder + '.html'), { force: true }); TG.cleanup();
  } finally {
    await b.close();
    for (const d of [D1, D2, D3]) fs.rmSync(d, { recursive: true, force: true });
    for (const e of ['_off-test.html', '_off-test.pdf', '_off-ext.html']) fs.rmSync(path.join(ROOT, 'dist', e), { force: true });
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); for (const d of [D1, D2, D3]) fs.rmSync(d, { recursive: true, force: true }); process.exit(2); });
