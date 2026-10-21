/* 덱 30개 목록의 부하 측정과 검증: 스크롤해도 동시에 올라 있는 썸네일 iframe 수와 브라우저 메모리가 제한되는지,
   검색이 바로 반응하는지 본다. 테스트 덱은 decks/_e2e-load-NN(시험용 덱 사본)로 만들고 끝나면 지운다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 [CHECK=1] node list-load.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const DECKS = path.join(__dirname, '..', '..', 'decks');
// 시험용 덱(app/test/fixtures/decks/sample)을 쓴다.
const SRC_HTML = fs.readFileSync(path.join(__dirname, 'fixtures', 'decks', 'sample', 'index.html'), 'utf8');
const N = 30;
const names = Array.from({ length: N }, (_, i) => `_e2e-load-${String(i).padStart(2, '0')}`);
for (const n of names) {
  fs.mkdirSync(path.join(DECKS, n), { recursive: true });
  const html = SRC_HTML.replace(/"id":\s*"[^"]*"/, `"id": "${n.slice(1)}"`).replace(/("title":\s*")[^"]*"/, `$1Load deck ${n.slice(-2)}"`);
  fs.writeFileSync(path.join(DECKS, n, 'index.html'), html);
}
process.on('exit', () => { for (const n of names) fs.rmSync(path.join(DECKS, n), { recursive: true, force: true }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const rssMB = (pid) => { // 브라우저 프로세스와 모든 자손의 RSS 합(MB)
  const rows = execSync('ps -axo pid=,ppid=,rss=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map(); for (const [p, pp, r] of rows) kids.set(p, { pp, r });
  let sum = 0; for (const [p, { r }] of kids) { let c = p; while (c && c !== pid) c = kids.get(c)?.pp; if (c === pid) sum += r; }
  return Math.round(sum / 1024);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  // 브라우저 프로세스: 이 node 프로세스의 직계 자식인 chrome
  const pid = Number(execSync('ps -axo pid=,ppid=,command=').toString().split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).find((m) => m && Number(m[2]) === process.pid && /chrome/.test(m[3]))?.[1]);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const frames = () => page.evaluate(() => document.querySelectorAll('iframe').length);
  const t0 = Date.now();
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: 'New deck' }).waitFor();
  await page.getByRole('button', { name: 'Load deck 00', exact: true }).waitFor();
  console.log(`INFO 목록 표시 ${Date.now() - t0}ms`);
  // 로드 중인 iframe 수의 최대값을 계속 잰다(동시 로드 상한 확인)
  await page.evaluate(() => { window.__maxLoading = 0; setInterval(() => { const n = [...document.querySelectorAll('iframe')].filter((f) => { try { return f.contentDocument && f.contentDocument.readyState !== 'complete'; } catch { return false; } }).length; if (n > window.__maxLoading) window.__maxLoading = n; }, 50); });
  await sleep(4000);
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'load-top.png') });
  const top = { frames: await frames(), rss: rssMB(pid) };
  // 끝까지 천천히 스크롤
  const main = page.locator('main');
  for (let i = 0; i < 40; i++) { await main.evaluate((e) => e.scrollBy(0, 500)); await sleep(200); }
  await sleep(3000);
  const bottom = { frames: await frames(), rss: rssMB(pid), m: await metrics() };
  console.log(`INFO 맨 위: iframe ${top.frames}개, 브라우저 ${top.rss}MB`);
  console.log(`INFO 맨 아래: iframe ${bottom.frames}개, 브라우저 ${bottom.rss}MB, DOM 노드 ${bottom.m.Nodes}, JS 힙 ${Math.round(bottom.m.JSHeapUsedSize / 1048576)}MB`);
  if (process.env.CHECK) {
    check('스크롤해도 동시에 올라 있는 썸네일이 화면 가까운 것으로 제한된다', bottom.frames <= 28, bottom.frames);
    const maxLoading = await page.evaluate(() => window.__maxLoading);
    console.log(`INFO 동시에 로드 중이던 iframe 최대 ${maxLoading}개`);
    check('동시 로드는 상한(3, 여유 1) 이하', maxLoading <= 4, maxLoading);
  }
  // 검색 반응
  await main.evaluate((e) => e.scrollTo(0, 0));
  const tOpen = Date.now();
  await page.getByRole('button', { name: /^Search/ }).click();
  const input = page.getByRole('dialog').getByRole('combobox');
  await input.waitFor();
  console.log(`INFO 검색창 열림 ${Date.now() - tOpen}ms`);
  const t1 = Date.now();
  await input.fill('load deck 2');
  await page.getByRole('dialog').getByRole('option').first().waitFor();
  const ms = Date.now() - t1;
  console.log(`INFO 입력 후 첫 결과 ${ms}ms`);
  check('검색이 2초 안에 반응한다', ms < 2000, ms);
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
