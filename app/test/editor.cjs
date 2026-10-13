/* 편집기 브라우저 검증. 실행 전에 bun run slidekit. 종료 뒤 git checkout decks/ 로 덱을 되돌린다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node editor.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const FILE = path.join(__dirname, '..', '..', 'decks', 'vibe-coding-workshop', 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const slides = (s) => (s.match(/<section\b[^>]*\bdata-slide\b/g) || []).length;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/edit/vibe-coding-workshop');
  const frameEl = page.locator('iframe[title="캔버스"]');
  await frameEl.waitFor();
  const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="캔버스"]'); return f && f.contentDocument && f.contentDocument.querySelector('#sk-stage') && f.contentDocument.querySelector('[data-active]'); });
  await sleep(500);
  // 레이어 썸네일 첫 3개가 그려지기까지: 레이어 목록이 보인 때부터 잰다(목표 1초)
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '/edit/vibe-coding-workshop');
  await p2.locator('[draggable="true"]').first().waitFor();
  const t0 = Date.now();
  await p2.waitForFunction(() => document.querySelectorAll('iframe[srcdoc]').length >= 3);
  await Promise.all(p2.frames().filter((f) => f.url() === 'about:srcdoc').slice(0, 3).map((f) => f.waitForLoadState('load')));
  const thumbMs = Date.now() - t0;
  await p2.close();
  check('썸네일 3개 1초 안에 표시', thumbMs < 1000, thumbMs);
  // 확대 축소, Tab 선택
  const wid = async () => (await frameEl.boundingBox()).width;
  const w0 = await wid();
  const bb = await frameEl.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.keyboard.down('Meta'); await page.mouse.wheel(0, -120); await page.keyboard.up('Meta'); await sleep(300);
  const w1 = await wid();
  check('Cmd+휠로 확대', w1 > w0 * 1.05, [w0, w1]);
  await page.keyboard.press('Meta+0'); await sleep(300);
  check('Cmd+0으로 맞춤', Math.abs((await wid()) - w0) < 2, [w0, await wid()]);
  const selVisible = () => page.locator('.border-2.border-focus-ring').first().isVisible();
  await page.keyboard.press('Escape'); await sleep(200);
  check('Tab 전에는 선택 없음', !(await selVisible()));
  await page.keyboard.press('Tab'); await sleep(300);
  check('Tab으로 요소 선택', await selVisible());
  await page.keyboard.press('Escape');
  const before = fs.readFileSync(FILE, 'utf8');
  check('원본 슬라이드 수 53', slides(before) === 53, slides(before));
  const n = (sel) => page.evaluate((s) => document.querySelector('iframe[title="캔버스"]').contentDocument.querySelectorAll(s).length, sel);
  check('캔버스에 슬라이드 53장', (await n('#sk-stage > [data-slide]')) === 53);

  // 3번째 슬라이드로 이동 후 제목 편집
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await sleep(500);
  const idx = await page.evaluate(() => [].findIndex.call(document.querySelector('iframe[title="캔버스"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1);
  check('방향키로 3번 슬라이드', idx === 3, idx);
  const h = fr().locator('[data-active] h1, [data-active] h2').first();
  const oldText = (await h.textContent()).trim();
  await h.click(); await sleep(150);
  await h.dblclick(); await sleep(150);
  check('더블클릭하면 편집 상태', await h.evaluate((e) => e.isContentEditable));
  await page.keyboard.press('Meta+a'); await page.keyboard.type('편집 테스트 제목');
  await page.keyboard.press('Enter'); await sleep(300);
  check('Enter로 편집 종료', !(await h.evaluate((e) => e.isContentEditable)));
  check('저장 전 상태 표시', (await page.getByText('저장 안 됨').count()) > 0);
  // 인라인 스타일: 선택된 요소의 속성 패널을 거치지 않고 키로 저장
  await page.keyboard.press('Meta+s'); await sleep(800);
  const after = fs.readFileSync(FILE, 'utf8');
  check('저장됨 표시', (await page.getByText('저장됨').count()) > 0);
  check('파일에 새 제목 반영', after.includes('편집 테스트 제목'), oldText);
  check('원래 제목이 바뀜', !after.includes('>' + oldText + '<') || before.split('>' + oldText + '<').length > after.split('>' + oldText + '<').length, oldText);
  const cnt = (src, re) => (src.match(re) || []).length;
  const leak = /data-active|contenteditable|sk-stage|data-sk-embed|<base /g;
  check('엔진 부착물이 새지 않음', cnt(after, leak) === cnt(before, leak), [cnt(after, leak), cnt(before, leak)]);
  check('슬라이드 수 그대로', slides(after) === 53);
  const diffLines = after.split('\n').filter((l, i) => l !== before.split('\n')[i]).length;
  check('바뀐 줄이 작음(서식 보존)', diffLines <= 6, diffLines);

  // 슬라이드 복제, 삭제, 순서 변경
  const layers = page.locator('[draggable="true"]');
  await layers.nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '복제' }).click(); await sleep(1200);
  check('복제 후 54장', (await n('#sk-stage > [data-slide]')) === 54);
  check('복제 후 현재 위치 4', (await page.evaluate(() => [].findIndex.call(document.querySelector('iframe[title="캔버스"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1)) === 4);
  await layers.nth(6).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '삭제' }).click(); await sleep(1200);
  check('삭제 후 53장', (await n('#sk-stage > [data-slide]')) === 53);
  const titleOf = (i) => page.evaluate((i) => (document.querySelector('iframe[title="캔버스"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')[i].textContent || '').trim().slice(0, 20), i);
  const t4 = await titleOf(3), t8 = await titleOf(7);
  await layers.nth(3).dragTo(layers.nth(5), { targetPosition: { x: 40, y: 20 } }); await sleep(1500);
  const moved = await titleOf(4);
  check('드래그로 순서 변경', moved === t4 && (await titleOf(3)) !== t4, [t4, t8, moved]);
  await page.keyboard.press('Meta+z'); await sleep(1500);
  check('실행 취소로 순서 복귀', (await titleOf(3)) === t4);
  await page.keyboard.press('Meta+Shift+z'); await sleep(1500);
  check('다시 실행', (await titleOf(4)) === t4);
  await page.keyboard.press('Meta+s'); await sleep(800);
  const fin = fs.readFileSync(FILE, 'utf8');
  check('최종 파일 슬라이드 53', slides(fin) === 53, slides(fin));
  check('최종 파일에 복제본 존재', (fin.match(/<section[^>]*>\s*<h1>편집 테스트 제목/g) || []).length === 2, (fin.match(/편집 테스트 제목/g) || []).length);

  // 코멘트 번호 추적: 순서 변경, 삭제
  const CF = path.join(path.dirname(FILE), 'comments.json');
  const post = (slide, text) => page.evaluate(([slide, text]) => fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deck: 'vibe-coding-workshop', slide, path: '', excerpt: text, text }) }).then((r) => r.json()), [slide, text]);
  const rd = () => JSON.parse(fs.readFileSync(CF, 'utf8'));
  const tA = await titleOf(9), tB = await titleOf(11);
  const cA = (await post(10, 'T-A')).id, cB = (await post(12, 'T-B')).id;
  await page.reload(); await frameEl.waitFor();
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="캔버스"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); }); await sleep(800);
  await layers.nth(9).dragTo(layers.nth(11), { targetPosition: { x: 40, y: 20 } }); await sleep(1500);
  await page.keyboard.press('Meta+s'); await sleep(1000);
  const posOf = (t) => page.evaluate((t) => [].findIndex.call(document.querySelector('iframe[title="캔버스"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => (s.textContent || '').trim().slice(0, 20) === t) + 1, t);
  let cs = rd();
  check('순서 변경 뒤 코멘트 번호가 따라감', cs.find((c) => c.id === cA).slide === (await posOf(tA)) && cs.find((c) => c.id === cB).slide === (await posOf(tB)) && (await posOf(tA)) !== 10, [cs.map((c) => c.slide), await posOf(tA), await posOf(tB)]);
  await layers.nth((await posOf(tA)) - 1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '삭제' }).click(); await sleep(1000);
  await page.keyboard.press('Meta+s'); await sleep(1000);
  cs = rd();
  check('삭제한 슬라이드의 코멘트는 남고 slideDeleted', cs.find((c) => c.id === cA) && cs.find((c) => c.id === cA).slideDeleted === true);
  check('나머지 코멘트 번호 유지', cs.find((c) => c.id === cB).slide === (await posOf(tB)), [cs.find((c) => c.id === cB).slide, await posOf(tB)]);
  const put = (b) => page.evaluate((b) => fetch('/api/decks/vibe-coding-workshop', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status), b);
  check('base 없이 저장하면 400', (await put({ source: fs.readFileSync(FILE, 'utf8') })) === 400);
  fs.writeFileSync(CF, '[]');

  check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
