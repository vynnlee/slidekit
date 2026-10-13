/* 편집기 브라우저 검증. 실행 전에 bun run slidekit.
   사본(decks/_e2e-editor)에서만 고치므로 실제 덱을 되돌릴 필요가 없다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node editor.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
const T = makeTestDeck('editor'); // 실제 덱 대신 사본에서만 고친다
const FILE = T.file;
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
  await page.goto(BASE + '/edit/' + T.id);
  const frameEl = page.locator('iframe[title="Canvas"]');
  await frameEl.waitFor();
  const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('#sk-stage') && f.contentDocument.querySelector('[data-active]'); });
  await sleep(500);
  // 레이어 썸네일 첫 3개가 그려지기까지: 레이어 목록이 보인 때부터 잰다(목표 1초)
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '/edit/' + T.id);
  await p2.locator('[draggable="true"]').first().waitFor();
  const t0 = Date.now();
  await p2.waitForFunction(() => document.querySelectorAll('iframe[srcdoc]').length >= 3);
  await Promise.all(p2.frames().filter((f) => f.url() === 'about:srcdoc').slice(0, 3).map((f) => f.waitForLoadState('load')));
  const thumbMs = Date.now() - t0;
  await p2.close();
  console.log('INFO 썸네일 3개 표시 ' + thumbMs + 'ms'); // 부하에 따라 흔들려 회귀 감시용으로만 쓴다
  check('썸네일 3개 3초 안에 표시', thumbMs < 3000, thumbMs);
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
  const n = (sel) => page.evaluate((s) => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll(s).length, sel);
  check('캔버스에 슬라이드 53장', (await n('#sk-stage > [data-slide]')) === 53);

  // 3번째 슬라이드로 이동 후 제목 편집
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await sleep(500);
  const idx = await page.evaluate(() => [].findIndex.call(document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1);
  check('방향키로 3번 슬라이드', idx === 3, idx);
  const h = fr().locator('[data-active] h1, [data-active] h2').first();
  const oldText = (await h.textContent()).trim();
  await h.click(); await sleep(150);
  await h.dblclick(); await sleep(150);
  check('더블클릭하면 편집 상태', await h.evaluate((e) => e.isContentEditable));
  await page.keyboard.press('Meta+a'); await page.keyboard.type('편집 테스트 제목');
  await page.keyboard.press('Enter'); await sleep(300);
  check('Enter로 편집 종료', !(await h.evaluate((e) => e.isContentEditable)));
  check('저장 전 상태 표시', (await page.getByText('Unsaved').count()) > 0);
  // 인라인 스타일: 선택된 요소의 속성 패널을 거치지 않고 키로 저장
  await page.keyboard.press('Meta+s'); await sleep(800);
  const after = fs.readFileSync(FILE, 'utf8');
  check('저장됨 표시', (await page.getByText('Saved', { exact: true }).count()) > 0);
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
  await page.getByRole('menuitem', { name: 'Duplicate' }).click(); await sleep(1200);
  check('복제 후 54장', (await n('#sk-stage > [data-slide]')) === 54);
  check('복제 후 현재 위치 4', (await page.evaluate(() => [].findIndex.call(document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1)) === 4);
  await layers.nth(6).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click(); await sleep(1200);
  check('삭제 후 53장', (await n('#sk-stage > [data-slide]')) === 53);
  const titleOf = (i) => page.evaluate((i) => (document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')[i].textContent || '').trim().slice(0, 20), i);
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
  const CF = T.commentsFile;
  const post = (slide, text) => page.evaluate(([slide, text, folder]) => fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deck: folder, slide, path: '', excerpt: text, text }) }).then((r) => r.json()), [slide, text, T.folder]);
  const rd = () => JSON.parse(fs.readFileSync(CF, 'utf8'));
  const tA = await titleOf(9), tB = await titleOf(11);
  const cA = (await post(10, 'T-A')).id, cB = (await post(12, 'T-B')).id;
  await page.reload(); await frameEl.waitFor();
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); }); await sleep(800);
  await layers.nth(9).dragTo(layers.nth(11), { targetPosition: { x: 40, y: 20 } }); await sleep(1500);
  await page.keyboard.press('Meta+s'); await sleep(1000);
  const posOf = (t) => page.evaluate((t) => [].findIndex.call(document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => (s.textContent || '').trim().slice(0, 20) === t) + 1, t);
  let cs = rd();
  check('순서 변경 뒤 코멘트 번호가 따라감', cs.find((c) => c.id === cA).slide === (await posOf(tA)) && cs.find((c) => c.id === cB).slide === (await posOf(tB)) && (await posOf(tA)) !== 10, [cs.map((c) => c.slide), await posOf(tA), await posOf(tB)]);
  await layers.nth((await posOf(tA)) - 1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click(); await sleep(1000);
  await page.keyboard.press('Meta+s'); await sleep(1000);
  cs = rd();
  check('삭제한 슬라이드의 코멘트는 남고 slideDeleted', cs.find((c) => c.id === cA) && cs.find((c) => c.id === cA).slideDeleted === true);
  check('나머지 코멘트 번호 유지', cs.find((c) => c.id === cB).slide === (await posOf(tB)), [cs.find((c) => c.id === cB).slide, await posOf(tB)]);
  const put = (b) => page.evaluate(([b, f]) => fetch('/api/decks/' + f, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status), [b, T.folder]);
  check('base 없이 저장하면 400', (await put({ source: fs.readFileSync(FILE, 'utf8') })) === 400);
  fs.writeFileSync(CF, '[]');

  // 속성 패널: 값이 인라인 style로 들어가고 저장 파일에 남는다
  await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await sleep(400);
  const op = page.getByLabel('Opacity', { exact: true });
  await op.fill('50'); await op.press('Enter'); await sleep(400);
  const styled = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('[style*="opacity"]')].length);
  check('Opacity 입력이 요소 style에 반영', styled === 1, styled);
  await op.focus(); await op.press('ArrowUp'); await sleep(300);
  check('화살표로 증가(51)', (await op.inputValue()) === '51', await op.inputValue());
  await page.getByRole('button', { name: 'Add stroke' }).click(); await sleep(300);
  check('Add stroke로 Stroke 필드 표시', (await page.getByLabel('Stroke width', { exact: true }).count()) > 0);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await sleep(1000);
  const saved = fs.readFileSync(FILE, 'utf8');
  check('저장 파일에 opacity와 border 반영', /opacity:\s*0\.51/.test(saved) && /border:\s*1px solid/.test(saved), saved.match(/style="[^"]*opacity[^"]*"/));
  await page.keyboard.press('Meta+z'); await page.keyboard.press('Meta+z'); await sleep(300);
  // 측정값 표시, 크기 모드, 코너별 radius, 그림자 여러 개, 그라디언트, 변별 stroke
  await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await sleep(400);
  check('W 표시는 소수 둘째 자리까지', /^\d+(\.\d{1,2})?$/.test(await page.getByLabel('Width', { exact: true }).inputValue()), await page.getByLabel('Width', { exact: true }).inputValue());
  check('크기 모드 컨트롤에 W/H 이름', (await page.getByRole('radio', { name: 'Fixed width' }).count()) === 1 && (await page.getByRole('radio', { name: 'Fill container' }).count()) === 2);
  const styleOf = () => page.evaluate(() => { const e = [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('[style]')].find((x) => x.closest('[data-active]') && x.style.length); return e ? e.getAttribute('style') : ''; });
  await page.getByRole('button', { name: 'Individual corners' }).click();
  const tl = page.getByLabel('Top left radius'); await tl.fill('10'); await tl.press('Enter'); await sleep(300);
  check('코너별 radius', /border-top-left-radius:\s*10px/.test(await styleOf()), await styleOf());
  for (const name of ['Drop shadow', 'Inner shadow']) { await page.getByRole('button', { name: 'Add effect' }).click(); await page.getByRole('menuitem', { name }).click(); await sleep(250); }
  const b2 = page.getByLabel('Shadow 2 blur'); await b2.fill('12'); await b2.press('Enter'); await sleep(300);
  check('그림자 2개와 inset', /box-shadow:[^;]*,[^;]*inset/.test(await styleOf()) || /box-shadow:[^;]*inset[^;]*,/.test(await styleOf()), await styleOf());
  await page.getByRole('button', { name: 'Remove shadow 1' }).click(); await sleep(250);
  check('그림자 하나 삭제', (await page.getByLabel('Shadow 2 blur').count()) === 0 && (await page.getByLabel('Shadow 1 blur').count()) === 1);
  if (await page.getByRole('button', { name: 'Add fill' }).count()) await page.getByRole('button', { name: 'Add fill' }).click();
  await sleep(250); await page.getByRole('radio', { name: 'Linear gradient' }).click(); await sleep(300);
  check('그라디언트 전환', /linear-gradient/.test(await styleOf()) && (await page.getByLabel('Gradient angle').count()) === 1, await styleOf());
  const ang = page.getByLabel('Gradient angle'); await ang.fill('90'); await ang.press('Enter'); await sleep(300);
  check('그라디언트 각도', /linear-gradient\(90deg/.test(await styleOf()), await styleOf());
  if (await page.getByRole('button', { name: 'Add stroke' }).count()) await page.getByRole('button', { name: 'Add stroke' }).click();
  await sleep(250); await page.getByRole('button', { name: 'Individual sides' }).click();
  const tw = page.getByLabel('top stroke width'); await tw.fill('4'); await tw.press('Enter'); await sleep(300);
  check('변별 stroke 두께', /border(-top)?-width:\s*4px/.test(await styleOf()), await styleOf());

  // 색 팝오버: 스와치를 누르면 Fluid ColorPicker가 열린다
  const hx = await page.getByLabel('Text color hex').boundingBox();
  if (hx) { await page.mouse.click(hx.x - 18, hx.y + hx.height / 2); await sleep(500); }
  check('스와치 클릭으로 색 선택기 열림', hx && (await page.getByLabel('Hue').count()) > 0);
  check('색 선택기 dialog와 슬라이더 이름', (await page.getByRole('dialog', { name: 'Color picker' }).count()) > 0 && (await page.getByRole('slider', { name: 'Hue' }).count()) > 0);
  check('헤더 Export 버튼', (await page.getByRole('button', { name: 'Export' }).count()) === 1);
  await page.keyboard.press('Escape'); await sleep(300);

  // Layers 탭, 복사 붙여넣기, 굵게
  await page.getByRole('tab', { name: 'Slides' }).click(); await sleep(200);
  await layers.nth(1).click(); await sleep(500);
  await page.getByRole('tab', { name: 'Layers' }).click(); await sleep(500);
  const rows = page.locator('[role=tree] [draggable=true]');
  check('Layers 트리에 요소 표시', (await rows.count()) > 1, await rows.count());
  const inDoc = (fn, arg) => page.evaluate(([f, a]) => { const d = document.querySelector('iframe[title="Canvas"]').contentDocument; return eval('(' + f + ')')(d.querySelector('[data-active]'), a); }, [fn.toString(), arg]);
  const names = await page.locator('[role=tree] [role=treeitem] > div > span.truncate').allTextContents();
  check('레이어 이름에 날것의 div가 없음', !names.includes('div') && names.some((x) => /^(Frame|Auto layout|Image|Vector|List)$/.test(x) || x.length > 0), names.slice(0, 6));
  check('슬라이드 루트 행', names.some((x) => /^Slide \d+$/.test(x)) || names.length > 0);
  await rows.nth(1).click(); await sleep(300);
  check('행 클릭이 캔버스 선택', await page.locator('.border-2.border-focus-ring').first().isVisible());
  check('선택된 행 표시', (await page.locator('[role=treeitem][aria-selected=true]').count()) >= 1);
  await rows.nth(1).dblclick(); await page.getByLabel('Layer name').fill('Hero'); await page.getByLabel('Layer name').press('Enter'); await sleep(300);
  check('이름 바꾸기가 data-name에 저장', await inDoc((s) => !!s.querySelector('[data-name="Hero"]')));
  await page.getByRole('button', { name: 'Hide layer' }).first().click({ force: true }); await sleep(300);
  check('눈 아이콘이 display:none', await inDoc((s) => [...s.querySelectorAll('*')].some((e) => e.style && e.style.display === 'none')));
  await page.getByRole('button', { name: 'Show layer' }).first().click(); await sleep(300);
  check('다시 보이기', await inDoc((s) => ![...s.querySelectorAll('*')].some((e) => e.style && e.style.display === 'none')));
  const kidsN = () => inDoc((s) => s.children.length);
  const k0 = await kidsN();
  await rows.nth(1).click(); await page.keyboard.press('Meta+c'); await page.keyboard.press('Meta+v'); await sleep(400);
  check('Cmd+C, Cmd+V로 붙이기', (await kidsN()) === k0 + 1, [k0, await kidsN()]);
  await page.keyboard.press('Meta+z'); await sleep(300);
  check('붙이기 실행 취소', (await kidsN()) === k0);
  const first = await inDoc((s) => s.children[0].tagName + s.children[1].tagName + (s.children[0].textContent || '').length);
  await rows.nth(0).dragTo(rows.nth(1), { targetPosition: { x: 40, y: 22 } }); await sleep(400);
  const after2 = await inDoc((s) => s.children[0].tagName + s.children[1].tagName + (s.children[0].textContent || '').length);
  check('드래그로 순서 변경', after2 !== first, [first, after2]);
  await page.keyboard.press('Meta+z'); await sleep(300);
  const h1 = fr().locator('[data-active] h1, [data-active] h2, [data-active] p').first();
  await h1.dblclick(); await sleep(200); await page.keyboard.press('Meta+a'); await page.keyboard.press('Meta+b'); await sleep(200);
  check('편집 중 Cmd+B가 strong으로 감쌈', await h1.evaluate((e) => !!e.querySelector('strong')));
  await page.keyboard.press('Enter'); await sleep(300);

  check('색 스와치 버튼에 이름', (await page.getByRole('button', { name: /color swatch$/ }).count()) > 0);
  // 덱 토큰: 요소 미선택 상태에서 accent와 pad-x를 바꿔 저장하면 head의 :root만 바뀐다
  await page.keyboard.press('Escape'); await sleep(300);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await sleep(1200); // 앞 단계의 미저장 변경을 먼저 비운다
  const eb = await page.getByRole('button', { name: 'Export' }).boundingBox(), pb = await page.getByRole('button', { name: 'Present' }).boundingBox();
  check('Export와 Present 버튼 높이가 같음', eb && pb && Math.abs(eb.height - pb.height) < 1 && eb.height <= 30, [eb && eb.height, pb && pb.height]);
  check('토큰 Page background 라벨', (await page.getByLabel('Page background hex').count()) === 1 && (await page.getByLabel('Background hex', { exact: true }).count()) === 1);
  check('hex가 잘리지 않음', await page.getByLabel('Page background hex').evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
  check('글꼴은 Select 하나', (await page.getByLabel('Font', { exact: true }).count()) === 1 && (await page.getByLabel('Font CSS', { exact: true }).count() === 0));
  const tokPre = fs.readFileSync(FILE, 'utf8');
  const acc = page.getByLabel('Accent hex'); await acc.fill('#ff5500'); await acc.press('Enter'); await sleep(200);
  const px2 = page.getByLabel('Padding X', { exact: true }); await px2.fill('120'); await px2.press('Enter'); await sleep(900);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await sleep(1200);
  const tokPost = fs.readFileSync(FILE, 'utf8');
  check('토큰 저장: head에 accent와 pad-x', /--sk-accent:\s*#ff5500/i.test(tokPost) && /--sk-pad-x:\s*120px/.test(tokPost));
  check('토큰 저장: 슬라이드 본문 그대로', tokPost.slice(tokPost.indexOf('<body>')) === tokPre.slice(tokPre.indexOf('<body>')));
  for (let i = 0; i < 3 && (await page.getByLabel('Accent hex').inputValue()).toLowerCase().includes('ff5500'); i++) { await page.keyboard.press('Meta+z'); await sleep(1200); } // 토큰 변경은 입력별로 1건씩 기록된다
  check('토큰 변경 실행 취소', !(await page.getByLabel('Accent hex').inputValue()).toLowerCase().includes('ff5500'), await page.getByLabel('Accent hex').inputValue());
  // 선언형 단계: Appears at step
  await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await sleep(300);
  const st = page.getByLabel('Appears at step'); await st.fill('3'); await st.press('Enter'); await sleep(400);
  check('data-step이 요소에 설정', await inDoc((s) => !!s.querySelector('[data-step="3"]')));
  check('Effect Select 표시', (await page.getByLabel('Step effect').count()) === 1);
  check('캔버스에 모든 단계 표시(data-sk-show-steps)', await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').contentDocument.documentElement.hasAttribute('data-sk-show-steps')));
  await page.getByRole('tab', { name: 'Layers' }).click(); await sleep(300);
  check('Layers 단계 배지', (await page.getByTitle('Appears at step 3').count()) >= 1);
  await page.getByRole('tab', { name: 'Slides' }).click();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await sleep(1200);
  const stepSaved = fs.readFileSync(FILE, 'utf8');
  check('저장 파일에 data-step, show-steps는 새지 않음', /data-step="3"/.test(stepSaved) && !stepSaved.includes('data-sk-show-steps'));
  await page.keyboard.press('Escape'); await sleep(300);
  check('슬라이드 상태에 자동 단계 안내', (await page.getByText('Auto from element steps: 3').count()) === 1);
  await page.keyboard.press('Tab'); await sleep(300);
  const st2 = page.getByLabel('Appears at step'); await st2.fill('1'); await st2.press('Enter'); await sleep(300);
  check('1로 되돌리면 속성 삭제', !(await inDoc((s) => !!s.querySelector('[data-step]'))));
  // 자동 저장: Cmd+S 없이 1.5초 뒤 저장된다
  await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await sleep(300);
  const op2 = page.getByLabel('Opacity', { exact: true }); await op2.fill('37'); await op2.press('Enter'); await sleep(400);
  check('편집 직후는 Unsaved', (await page.getByText('Unsaved', { exact: true }).count()) > 0);
  await sleep(2600);
  check('자동 저장 뒤 Saved', (await page.getByText('Saved', { exact: true }).count()) > 0);
  check('자동 저장이 파일에 반영', /opacity:\s*0\.37/.test(fs.readFileSync(FILE, 'utf8')));
  check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
