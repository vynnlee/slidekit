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

  check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
