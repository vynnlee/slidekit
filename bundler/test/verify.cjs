/* Loads dist/<deck>.html over file:// and checks it stands alone.
   Usage: PW=<playwright-core> CHROME=<headless shell> node verify.cjs <path to bundle> */
const { chromium } = require(process.env.PW || 'playwright-core');
const file = require('path').resolve(process.argv[2]);
const out = [];
const check = (n, ok, x) => { out.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' ' + JSON.stringify(x))); };
(async () => {
  const html = require('fs').readFileSync(file, 'utf8');
  const ext = html.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi, '').match(/(?:src|href)="(?!#|data:)[^"]+"/g) || [];
  check('no external src/href left', ext.length === 0, ext.slice(0, 5));
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const reqs = [], errs = [];
  p.on('request', (r) => { if (!/^data:/.test(r.url())) reqs.push(r.url()); });
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await p.goto('file://' + file + '#1', { waitUntil: 'load' });
  await p.waitForSelector('#sk-stage');
  await p.evaluate(() => document.fonts.ready);
  const n = await p.evaluate(() => document.querySelectorAll('#sk-stage > [data-slide]').length);
  check('53 slides', n === 53, n);
  const act = () => p.evaluate(() => [].findIndex.call(document.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowLeft');
  check('arrow keys move (and #hash works on file://)', (await act()) === 2 && (await p.evaluate(() => location.hash)) === '#2');
  const tokIdx = await p.evaluate(() => [].findIndex.call(document.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.id === 'tok-slide') + 1);
  await p.goto('file://' + file + '#' + tokIdx); await p.waitForSelector('#sk-stage');
  const st = () => p.evaluate(() => { const c = document.getElementById('tok').classList; return c.contains('out') ? 4 : c.contains('ids') ? 3 : c.contains('split') ? 2 : 1; });
  const seq = [await st()];
  for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150); seq.push(await st()); }
  check('tok stepper 1,2,3,4 on one slide', seq.join() === '1,2,3,4' && (await act()) === tokIdx, seq);
  const img = await p.evaluate(async () => { const i = document.querySelector('img'); await i.decode().catch(() => {}); return i.naturalWidth; });
  check('inline image decodes', img > 0, img);
  // 번들한 덱에 '한글 글꼴', '한글'이라는 글자가 들어 있어야 글꼴 부분집합에 글리프가 있다
  const fonts = await p.evaluate(async () => {
    await document.fonts.load('400 20px "Noto Sans KR"', '한글 글꼴'); await document.fonts.load('500 20px "JetBrains Mono"', 'index.html');
    return { noto: document.fonts.check('400 20px "Noto Sans KR"', '한글 글꼴'), noto700: document.fonts.check('700 20px "Noto Sans KR"', '한글'), mono: document.fonts.check('500 20px "JetBrains Mono"', 'index.html'),
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family) };
  });
  check('fonts load from embedded @font-face', fonts.noto && fonts.noto700 && fonts.mono && fonts.loaded.length >= 2, fonts);
  const bodyFont = await p.evaluate(() => getComputedStyle(document.body).fontFamily);
  check('body font stack starts with Noto Sans KR', /^"?Noto Sans KR/.test(bodyFont), bodyFont);
  await p.keyboard.press('o'); await p.waitForTimeout(200);
  check('overview works', await p.evaluate(() => document.querySelectorAll('.sk-thumb').length === 53));
  check('zero network requests besides the file itself', reqs.length === 1 && reqs[0].startsWith('file://'), reqs);
  check('no console errors', errs.length === 0, errs);
  await browser.close();
  const bad = out.filter((x) => !x).length; console.log(`${out.length - bad}/${out.length} passed`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
