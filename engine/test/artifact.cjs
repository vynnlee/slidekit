/* 발행 호환(M2b, spec/ARTIFACT-CHECK.md 4절)의 브라우저 쪽: 번들한 덱이 엄격한 CSP 아래에서 그대로 동작하는지, --build의 크기 판정이 실제 번들과 맞는지.
   덱 decks/_art-e2e를 만들고 끝나면 지운다(dist/_art-e2e.html도). 서버는 127.0.0.1 임시 포트에 CSP 헤더를 붙여 번들을 내준다.
   사용: PW=<playwright-core> CHROME=<headless shell> node engine/test/artifact.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http');
const ROOT = path.join(__dirname, '..', '..'), DIR = path.join(ROOT, 'decks', '_art-e2e'), OUT = path.join(ROOT, 'dist', '_art-e2e.html');
let fail = 0; const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 400))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* M2a(Worker)의 값과 맞출 때까지의 기준 CSP: 자기 출처와 data:만, 연결 없음 */
const CSP = process.env.ARTIFACT_CSP || "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const html = `<!doctype html><html lang="ko" data-slidekit="1"><head><meta charset="utf-8"><title>art</title>
<script type="application/json" id="deck-meta">{ "title": "art", "id": "art-e2e" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"><style>.bg { background-image: url(pic.png); width: 40px; height: 40px }</style></head><body>
<section data-slide="cover"><h1>Artifact</h1></section>
<section data-slide="content"><h2>Steps</h2><div class="bg"></div><img id="im" src="pic.png" alt=""><p id="a" data-step="2">A</p><p id="b" data-step="3" data-step-out="4">B</p></section>
<section data-slide="end"><h1>끝</h1></section>
<script src="../../engine/slidekit.js"></script></body></html>`;
const sh = (c) => cp.spawnSync('sh', ['-c', c], { cwd: ROOT, encoding: 'utf8' });
(async () => {
  const b = await launch();
  let srv;
  try {
    fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'index.html'), html); fs.writeFileSync(path.join(DIR, 'pic.png'), PNG);
    const st = sh('bun app/server.ts doctor _art-e2e --artifact --json');
    const stat = JSON.parse(st.stdout || '{}');
    check('정적 검사: 올릴 수 있음', st.status === 0 && stat.ok === true, st.stdout.slice(-300));
    const bd = sh('bun app/server.ts doctor _art-e2e --artifact --build --json');
    const built = JSON.parse(bd.stdout || '{}');
    check('--build: 번들러가 성공하고 올릴 수 있음', bd.status === 0 && built.ok === true && fs.existsSync(OUT), bd.stdout.slice(-300));
    const real = fs.existsSync(OUT) ? fs.statSync(OUT).size : 0;
    check('--build의 크기가 실제 번들 크기다', built.estimatedBytes === real, [built.estimatedBytes, real]);
    console.log(`INFO 정적 예상 ${stat.estimatedBytes} 바이트, 실제 번들 ${real} 바이트(예상은 글꼴이 없어도 엔진과 이미지를 더한 값)`);
    check('예상이 실제의 0.5~2배', stat.estimatedBytes > real * 0.5 && stat.estimatedBytes < real * 2, [stat.estimatedBytes, real]);
    const bundle = fs.readFileSync(OUT, 'utf8');
    check('번들에 외부 참조가 없다(src, href, url())', !/(?:src|href)=["']https?:|url\(\s*["']?https?:/.test(bundle.replace(/xmlns="[^"]*"/g, '')));

    srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }); res.end(bundle); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}/`;
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await ctx.newPage(); const viol = [], errs = [], blocked = [];
    p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('requestfailed', (r) => blocked.push(r.url().slice(0, 80)));
    await p.addInitScript(() => { window.__v = []; document.addEventListener('securitypolicyviolation', (e) => window.__v.push(e.violatedDirective + ' ' + e.blockedURI)); });
    await p.goto(url + '#2'); await p.waitForSelector('#sk-stage');
    await p.waitForFunction(() => document.getAnimations().length === 0);
    const vis = (id) => p.evaluate((id) => getComputedStyle(document.getElementById(id)).visibility, id);
    check('CSP 아래에서 엔진이 뜬다(슬라이드 3장, 이미지가 그려진다)', await p.evaluate(() => document.querySelectorAll('#sk-stage > [data-slide]').length === 3 && document.getElementById('im').naturalWidth === 1));
    check('1단계: 단계 요소는 숨김', (await vis('a')) === 'hidden');
    await p.keyboard.press('ArrowRight'); await p.waitForFunction(() => document.getAnimations().length === 0);
    check('방향키로 단계가 나타난다(CSP 아래 인라인 스크립트와 스타일 전환)', (await vis('a')) === 'visible' && (await p.evaluate(() => location.hash)) === '#2');
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await sleep(400);
    check('끝까지 넘기면 다음 장으로 간다', (await p.evaluate(() => location.hash)) === '#3');
    await p.keyboard.press('o'); await sleep(300);
    check('전체 보기(O)가 열린다', await p.evaluate(() => !!document.getElementById('sk-overview') && document.getElementById('sk-overview').children.length > 0));
    await p.keyboard.press('Escape');
    const v = await p.evaluate(() => window.__v);
    check('CSP 위반 0건', v.length === 0 && blocked.length === 0, { v, blocked });
    check('페이지 오류 0건', errs.length === 0, errs);
    await ctx.close();
  } finally {
    if (srv) srv.close();
    await b.close(); fs.rmSync(DIR, { recursive: true, force: true }); fs.rmSync(OUT, { force: true });
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(DIR, { recursive: true, force: true }); fs.rmSync(OUT, { force: true }); process.exit(2); });
