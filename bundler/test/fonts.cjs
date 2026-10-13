/* 글꼴 파이프라인 종단 검증: Pretendard CDN 링크 + 로컬 woff2 + 시스템 글꼴 3장을 번들해 file://에서 네트워크 요청 0건인지 본다.
   인터넷, uv, Chromium 필요. 사용: PW=<playwright-core> CHROME=<headless shell> node bundler/test/fonts.cjs (결과 크기 출력) */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.join(__dirname, '..', '..'), DIR = path.join(ROOT, 'decks', '_font-test');
let fail = 0; const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const sh = (c) => cp.spawnSync('sh', ['-c', c], { cwd: ROOT, encoding: 'utf8' });
const cleanup = () => { fs.rmSync(DIR, { recursive: true, force: true }); fs.rmSync(path.join(ROOT, 'dist', '_font-test.html'), { force: true }); };
(async () => {
  cleanup(); sh('bun app/server.ts new font-test'); fs.renameSync(path.join(ROOT, 'decks', 'font-test'), DIR);
  // 로컬 woff2: 캐시된 JetBrains Mono로 만든다(글꼴 파일은 저장소에 두지 않는다)
  const ttf = path.join(os.homedir(), '.cache', 'slidekit', 'fonts', 'JetBrainsMono[wght].ttf');
  fs.mkdirSync(path.join(DIR, 'fonts'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-'));
  fs.writeFileSync(path.join(tmp, 'c.txt'), 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ');
  fs.writeFileSync(path.join(tmp, 'j.json'), JSON.stringify([{ in: ttf, out: path.join(DIR, 'fonts', 'Local.woff2') }]));
  const mk = sh(`uv run --quiet --with fonttools --with brotli python bundler/subset.py ${tmp}/c.txt ${tmp}/j.json`);
  check('로컬 woff2 준비(캐시된 JetBrains Mono 필요)', mk.status === 0 && fs.existsSync(path.join(DIR, 'fonts', 'Local.woff2')), mk.stderr);
  const f = path.join(DIR, 'index.html'); let h = fs.readFileSync(f, 'utf8');
  h = h.replace('<style>', `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  <style>
    @font-face { font-family: "LocalMono"; src: url("./fonts/Local.woff2") format("woff2"); font-weight: 100 800; }
    #pre { font-family: "Pretendard Variable", sans-serif; } #loc { font-family: "LocalMono", monospace; } #sys { font-family: system-ui, sans-serif; }`);
  h = h.replace(/<section data-slide="content">[\s\S]*?<\/section>\s*<section data-slide="content">[\s\S]*?<\/section>/, `<section data-slide="content"><h2 id="pre">가나다 디자이너를 위한 글꼴 Pretendard 123</h2></section>
<section data-slide="content"><h2 id="loc">Local font 0123456789</h2></section>
<section data-slide="content"><h2 id="sys">System fonts only 시스템 글꼴</h2></section>`);
  fs.writeFileSync(f, h);
  const t0 = Date.now(); const b = sh('bun app/server.ts bundle _font-test'); const secs = ((Date.now() - t0) / 1000).toFixed(0);
  check('bundle 성공', b.status === 0, b.stderr.slice(-300)); console.log(b.stdout.trim().split('\n').slice(-3).join('\n'), `(${secs}s)`);
  const out = path.join(ROOT, 'dist', '_font-test.html'), html = fs.readFileSync(out, 'utf8');
  check('원격 URL과 상대 글꼴 경로가 남지 않음', !/url\(\s*["']?(https?:|\.\.?\/)/.test(html) && !/<link[^>]*stylesheet[^>]*https?:/.test(html), html.match(/url\([^d)][^)]{0,60}/g)?.slice(0, 3));
  const br = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const p = await (await br.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const reqs = []; p.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) reqs.push(r.url()); });
  await p.goto('file://' + out + '#1'); await p.waitForTimeout(800);
  for (let i = 1; i <= 3; i++) {
    await p.evaluate((i) => { location.hash = '#' + i; }, i + 1 <= 3 ? i + 1 : 3);
  }
  const res = await p.evaluate(async () => {
    const out = {};
    for (const [id, fam, txt] of [['pre', 'Pretendard Variable', '가나다 Pretendard 123'], ['loc', 'LocalMono', 'Local 0123'], ['sys', 'system-ui', 'System']]) {
      const el = document.getElementById(id); await document.fonts.load(`16px "${fam}"`, txt).catch(() => {});
      out[id] = document.fonts.check(`16px "${fam}"`, txt);
    }
    out.loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''));
    return out;
  });
  check('네트워크 요청 0건', reqs.length === 0, reqs);
  check('Pretendard(CDN)가 file://에서 로드됨', res.pre && res.loaded.includes('Pretendard Variable'), res);
  check('로컬 woff2 글꼴 로드됨', res.loc && res.loaded.includes('LocalMono'), res);
  check('시스템 글꼴 슬라이드는 정상', res.sys);
  console.log(`INFO bundle size ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
  await br.close(); cleanup(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); cleanup(); process.exit(2); });
