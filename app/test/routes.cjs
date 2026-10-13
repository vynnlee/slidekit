/* 세 라우트(목록, 발표자 화면, 편집기)가 뜨고 콘솔과 페이지 오류가 0인지 확인한다. production 실행에서도 쓴다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node routes.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const errors = [], scripts = new Set();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  // 폰트 요청은 일부러 막으므로 자원 로드 실패 메시지는 오류로 세지 않는다.
  page.on('console', (m) => m.type() === 'error' && !/Failed to load|net::/.test(m.text()) && errors.push(m.text()));
  page.on('response', (r) => /\.js(\?|$)/.test(r.url()) && scripts.add(new URL(r.url()).pathname));
  const routes = [
    ['/', () => page.getByRole('button', { name: 'New deck' }).waitFor()],
    ['/present/vibe-coding-workshop', () => page.getByRole('button', { name: 'Present' }).waitFor()],
    ['/edit/vibe-coding-workshop', () => page.locator('iframe').first().waitFor()],
  ];
  for (const [url, ready] of routes) {
    const before = errors.length;
    await page.goto(BASE + url);
    let ok = true;
    try { await ready(); } catch { ok = false; }
    await sleep(800);
    check(`${url} 이 뜬다`, ok);
    check(`${url} 오류 0`, errors.length === before, errors.slice(before));
  }
  console.log('loaded scripts:', [...scripts].join(' '));
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
