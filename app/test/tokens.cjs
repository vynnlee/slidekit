/* TokensPanel 검증: /dev/tokens에서 accent와 pad-x를 바꿔 저장하고 파일의 :root만 바뀌었는지 본다.
   덱 decks/_qa-tok을 만들고 끝나면 지운다. 사용: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3250 node app/test/tokens.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const BASE = process.env.BASE || 'http://127.0.0.1:3250', ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'decks', '_qa-tok'), FILE = path.join(DIR, 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + String(JSON.stringify(x)).slice(0, 300))); };
const sh = (c) => cp.spawnSync('sh', ['-c', c], { cwd: ROOT, encoding: 'utf8' });

async function run(label, prep, expectDiff) {
  fs.rmSync(DIR, { recursive: true, force: true });
  sh('bun app/server.ts new qa-tok'); fs.renameSync(path.join(ROOT, 'decks', 'qa-tok'), DIR);
  let src = fs.readFileSync(FILE, 'utf8'); src = prep(src); fs.writeFileSync(FILE, src);
  const before = src;
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/dev/tokens?deck=_qa-tok'); await p.getByLabel('Accent hex').waitFor(); await sleep(800);
  const fr = () => p.frames().find((f) => f.url().includes('/decks/_qa-tok/'));
  const accent = p.getByLabel('Accent hex'); await accent.fill('#ff5500'); await accent.press('Enter'); await sleep(200);
  check(label + ': 입력 즉시 캔버스에 반영(미리보기)', (await fr().evaluate(() => document.documentElement.style.getPropertyValue('--sk-accent'))) === '#ff5500' || /ff5500/i.test(await fr().evaluate(() => document.documentElement.style.getPropertyValue('--sk-accent'))));
  await sleep(600);
  check(label + ': 바뀐 토큰에만 Reset 점', (await p.getByRole('button', { name: 'Reset Accent to default' }).count()) === 1 && (await p.getByRole('button', { name: /^Reset Text to default/ }).count()) === 0);
  const hexOf = async () => (await accent.inputValue()).toLowerCase();
  await p.getByRole('button', { name: 'Reset Accent to default' }).click(); await sleep(300);
  check(label + ': Reset이 기본값으로 되돌림', (await hexOf()) === '#a78bfa' && (await p.getByRole('button', { name: 'Reset Accent to default' }).count()) === 0, await hexOf());
  await accent.fill('#ff5500'); await accent.press('Enter'); await sleep(200);
  await p.getByTestId('panel').evaluate((e) => { e.style.width = '240px'; }); await sleep(200);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('input[aria-label$=" hex"]')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.getAttribute('aria-label')));
  check(label + ': 패널 240px에서도 hex가 잘리지 않음', clipped.length === 0, clipped);
  check(label + ': 불투명한 색은 투명도 칸을 숨김', (await p.getByLabel('Accent opacity percent').isVisible()) === false);
  const padx = p.getByLabel('Padding X', { exact: true }); await padx.fill('120'); await padx.press('Enter'); await sleep(700);
  check(label + ': 입력 뒤 Unsaved', (await p.getByTestId('status').textContent()) === 'Unsaved');
  await p.getByRole('button', { name: 'Save' }).click(); await sleep(800);
  check(label + ': Saved', (await p.getByTestId('status').textContent()) === 'Saved');
  const after = fs.readFileSync(FILE, 'utf8');
  fs.writeFileSync('/tmp/qa-tok.before', before);
  const diff = sh(`diff /tmp/qa-tok.before decks/_qa-tok/index.html`).stdout.split('\n').filter((l) => /^[<>]/.test(l));
  check(label + ': 바뀐 줄이 :root 변수뿐', diff.every((l) => /--sk-(accent|pad-x)|:root|^> *\}$/.test(l)) && expectDiff(diff, after), diff);
  check(label + ': 슬라이드 본문 그대로', after.slice(after.indexOf('<body>')) === before.slice(before.indexOf('<body>')));
  check(label + ': lint 통과', sh('bun app/server.ts lint _qa-tok').status === 0, sh('bun app/server.ts lint _qa-tok').stdout);
  if (label === '기존 :root') {
    const dv = p.getByRole('button', { name: /Deck variables/ });
    check(label + ': Deck variables는 기본 접힘과 개수 배지', (await dv.count()) === 1 && (await dv.getAttribute('aria-expanded')) === 'false' && /1/.test(await dv.textContent()), await dv.textContent());
    check(label + ': Deck styles 그룹 헤더', (await p.getByText('Deck styles', { exact: true }).count()) === 1);
  }
  const e = await ctx.newPage(); await e.goto(BASE + '/decks/_qa-tok/index.html#2'); await e.waitForSelector('#sk-stage');
  const cs = await e.evaluate(() => ({ a: getComputedStyle(document.documentElement).getPropertyValue('--sk-accent').trim(), pad: getComputedStyle(document.querySelector('[data-active]')).paddingLeft }));
  check(label + ': 엔진으로 열면 반영', /^#ff5500$/i.test(cs.a) && cs.pad === '120px', cs);
  check(label + ': 페이지 오류 없음', errs.length === 0, errs);
  await b.close();
}
(async () => {
  await run('블록 없음', (s) => s, (d, a) => /:root \{[^}]*--sk-accent: #ff5500;[^}]*--sk-pad-x: 120px/.test(a));
  await run('기존 :root', (s) => s.replace('  <style>\n', '  <style>\n    /* 덱 토큰 */\n    :root {\n      --sk-accent: #a78bfa; /* 강조 */\n      --brand-w: calc(1px + 2px);\n    }\n'), (d, a) => a.includes('/* 강조 */') && a.includes('--brand-w: calc(1px + 2px);') && /--sk-accent: #ff5500; \/\* 강조 \*\//.test(a));
  fs.rmSync(DIR, { recursive: true, force: true }); fs.rmSync(path.join(ROOT, 'dist', '_qa-tok.html'), { force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(DIR, { recursive: true, force: true }); process.exit(2); });
