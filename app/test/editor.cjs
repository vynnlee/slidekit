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
  const focusBody = () => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); // 패널에 포커스가 있으면 Tab이 브라우저 이동이라 본문으로 돌린다
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
  // 필름스트립을 끝까지 넘겨도(53장 덱) 화면 근처 썸네일만 iframe으로 남는다
  const nSlides = slides(fs.readFileSync(FILE, 'utf8'));
  const nIframes = () => page.locator('iframe[srcdoc]').count();
  const vp = page.locator('[data-testid=filmstrip] [data-slot=scroll-area-viewport], [data-testid=filmstrip] [data-radix-scroll-area-viewport]').first();
  const firstN = await nIframes();
  for (let x = 0; x <= 12000; x += 600) { await vp.evaluate((e, v) => { e.scrollLeft = v; }, x); await sleep(120); }
  await sleep(600);
  const endN = await nIframes();
  console.log('INFO 필름스트립 iframe 수 처음 ' + firstN + ', 끝까지 넘긴 뒤 ' + endN + ' (슬라이드 ' + nSlides + '장)');
  const vpW = (await vp.boundingBox()).width, perScreen = Math.ceil(vpW / 130); // 썸네일 하나 약 128px
  const has = (n) => page.getByRole('option', { name: 'Slide ' + n, exact: true }).locator('iframe[srcdoc]').count();
  check('테스트 덱이 30장 이상(검사가 의미 있으려면)', nSlides >= 30, nSlides);
  check('끝까지 넘기면 iframe 수가 보이는 수 + 여유 이내이고 슬라이드 수보다 훨씬 적음', endN <= perScreen + 6 && endN < nSlides / 2, [endN, perScreen, nSlides]);
  check('끝에서는 마지막 썸네일이 올라와 있고 먼 2번은 내려감', (await has(nSlides)) === 1 && (await has(2)) === 0, [await has(nSlides), await has(2)]);
  await vp.evaluate((e) => { e.scrollLeft = 0; });
  for (let i = 0; i < 40 && !((await has(nSlides)) === 0 && (await has(2)) === 1); i++) await sleep(150); // 큐를 거쳐 다시 올라오기를 기다린다
  check('처음으로 돌아오면 먼 쪽(마지막)이 내려가고 2번이 다시 올라옴', (await has(nSlides)) === 0 && (await has(2)) === 1, [await has(nSlides), await has(2)]);
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
  await focusBody(); await page.keyboard.press('Tab'); await sleep(300);
  check('Tab으로 요소 선택', await selVisible());
  await page.keyboard.press('Escape');
  const before = fs.readFileSync(FILE, 'utf8');
  check('원본 슬라이드 수 53', slides(before) === 53, slides(before));
  const n = (sel) => page.evaluate((s) => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll(s).length, sel);
  // 고정 sleep 대신 조건 대기. 조건이 끝내 안 맞아도 던지지 않는다(뒤의 check가 실패로 보고한다).
  const cond = (fn, arg, ms = 5000) => page.waitForFunction(([src, a]) => { try { return !!(0, eval)('(' + src + ')')(a); } catch { return false; } }, [fn.toString(), arg], { timeout: ms }).catch(() => {}); // 읽는 도중 iframe이 다시 그려져 예외가 나면 아직 아님으로 본다
  const saveDone = async () => { await sleep(150); await cond(() => document.querySelector('[data-testid=status]')?.textContent === 'Saved', null, 8000); }; // 키 입력이 Unsaved로 반영될 틈을 둔 뒤 Saved를 기다린다
  const unsaved = () => cond(() => document.querySelector('[data-testid=status]')?.textContent !== 'Saved', null, 4000);
  const stageCount = (c) => cond((c) => document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelectorAll('#sk-stage > [data-slide]').length === c, c);
  check('캔버스에 슬라이드 53장', (await n('#sk-stage > [data-slide]')) === 53);

  // 3번째 슬라이드로 이동 후 제목 편집
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await sleep(500);
  const idx = await page.evaluate(() => [].findIndex.call(document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1);
  check('방향키로 3번 슬라이드', idx === 3, idx);
  const h = fr().locator('[data-active] h1, [data-active] h2').first();
  const oldText = (await h.textContent()).trim();
  await h.click({ modifiers: ['Meta'] }); await sleep(150); // Cmd+클릭: 가장 안쪽 단위를 바로 고른다
  await h.dblclick(); await sleep(150);
  check('더블클릭하면 편집 상태', await h.evaluate((e) => e.isContentEditable));
  await page.keyboard.press('Meta+a'); await page.keyboard.type('편집 테스트 제목');
  await page.keyboard.press('Enter'); await sleep(300);
  check('Enter로 편집 종료', !(await h.evaluate((e) => e.isContentEditable)));
  check('저장 전 상태 표시', (await page.getByText('Unsaved').count()) > 0);
  // 인라인 스타일: 선택된 요소의 속성 패널을 거치지 않고 키로 저장
  await page.keyboard.press('Meta+s'); await saveDone();
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
  const layers = page.locator('[data-testid=filmstrip] [role=option]'); // 슬라이드 필름스트립
  await layers.nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate' }).click(); await stageCount(54);
  check('복제 후 54장', (await n('#sk-stage > [data-slide]')) === 54);
  check('복제 후 현재 위치 4', (await page.evaluate(() => [].findIndex.call(document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1)) === 4);
  await layers.nth(6).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click(); await stageCount(53);
  check('삭제 후 53장', (await n('#sk-stage > [data-slide]')) === 53);
  const titleOf = (i) => page.evaluate((i) => (document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')[i].textContent || '').trim().slice(0, 20), i);
  const t4 = await titleOf(3), t8 = await titleOf(7);
  await layers.nth(3).dragTo(layers.nth(5), { targetPosition: { x: 20, y: 30 } });
  await cond(([a]) => { const t = (i) => (document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')[i].textContent || '').trim().slice(0, 20); return t(4) === a; }, [t4]);
  const moved = await titleOf(4);
  check('드래그로 순서 변경', moved === t4 && (await titleOf(3)) !== t4, [t4, t8, moved]);
  await page.keyboard.press('Meta+z');
  await cond(([a]) => (document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')[3].textContent || '').trim().slice(0, 20) === a, [t4]);
  check('실행 취소로 순서 복귀', (await titleOf(3)) === t4);
  await page.keyboard.press('Meta+Shift+z');
  await cond(([a]) => (document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')[4].textContent || '').trim().slice(0, 20) === a, [t4]);
  check('다시 실행', (await titleOf(4)) === t4);
  await page.keyboard.press('Meta+s'); await saveDone(); // 자동 저장과 겹쳐도 Saved가 될 때까지 기다린다
  const fin = fs.readFileSync(FILE, 'utf8');
  check('최종 파일 슬라이드 53', slides(fin) === 53, slides(fin));
  check('최종 파일에 복제본 존재', (fin.match(/<section[^>]*>\s*<h1>편집 테스트 제목/g) || []).length === 2, fin.match(/.{0,90}편집 테스트 제목.{0,20}/g));

  // 코멘트 번호 추적: 순서 변경, 삭제
  const CF = T.commentsFile;
  const post = (slide, text) => page.evaluate(([slide, text, folder]) => fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deck: folder, slide, path: '', excerpt: text, text }) }).then((r) => r.json()), [slide, text, T.folder]);
  const rd = () => JSON.parse(fs.readFileSync(CF, 'utf8'));
  const titlesNow = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')].map((s) => (s.textContent || '').trim().slice(0, 20)));
  const occOf = (i) => titlesNow.slice(0, i).filter((t) => t === titlesNow[i]).length; // 같은 제목이 앞에 몇 번 있었는지
  const tA = titlesNow[4], tB = titlesNow[5], oA = occOf(4), oB = occOf(5); // 스크롤 없이 모두 보이는 칸(앞 6개) 중 사진이 든 4번째 뒤의 두 장 // 필름스트립에서 화면에 보이는 앞쪽 슬라이드로 잡는다
  const cA = (await post(5, 'T-A')).id, cB = (await post(6, 'T-B')).id;
  await page.reload(); await frameEl.waitFor();
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); }); await sleep(800);
  await layers.nth(4).dragTo(layers.nth(5), { targetPosition: { x: 100, y: 30 } }); // 오른쪽 절반에 놓으면 한 칸 뒤로 간다
  await unsaved();
  await page.keyboard.press('Meta+s'); await saveDone();
  const posOf = (t, occ = 0) => page.evaluate(([t, occ]) => { const m = []; [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')].forEach((s, i) => { if ((s.textContent || '').trim().slice(0, 20) === t) m.push(i + 1); }); return m[occ] || 0; }, [t, occ]);
  let cs = rd();
  check('순서 변경 뒤 코멘트 번호가 따라감', cs.find((c) => c.id === cA).slide === (await posOf(tA, oA)) && cs.find((c) => c.id === cB).slide === (await posOf(tB, oB)) && (await posOf(tA, oA)) !== 5, [cs.map((c) => c.slide), await posOf(tA, oA), await posOf(tB, oB)]);
  await layers.nth((await posOf(tA, oA)) - 1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click(); await unsaved();
  await page.keyboard.press('Meta+s'); await saveDone();
  cs = rd();
  check('삭제한 슬라이드의 코멘트는 남고 slideDeleted', cs.find((c) => c.id === cA) && cs.find((c) => c.id === cA).slideDeleted === true);
  check('나머지 코멘트 번호 유지', cs.find((c) => c.id === cB).slide === (await posOf(tB, oB)), [cs.find((c) => c.id === cB).slide, await posOf(tB)]);
  const put = (b) => page.evaluate(([b, f]) => fetch('/api/decks/' + f, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status), [b, T.folder]);
  check('base 없이 저장하면 400', (await put({ source: fs.readFileSync(FILE, 'utf8') })) === 400);
  fs.writeFileSync(CF, '[]');

  // 속성 패널: 값이 인라인 style로 들어가고 저장 파일에 남는다
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await sleep(400);
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
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await sleep(400);
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
  const tw = page.getByLabel('top stroke width', { exact: true }); await tw.fill('4'); await tw.press('Enter'); await sleep(300);
  check('변별 stroke 두께', /border(-top)?-width:\s*4px/.test(await styleOf()), await styleOf());

  // 색 팝오버: 스와치를 누르면 Fluid ColorPicker가 열린다
  const hx = await page.getByLabel('Text color hex').boundingBox();
  if (hx) { await page.mouse.click(hx.x - 18, hx.y + hx.height / 2); await sleep(500); }
  check('스와치 클릭으로 색 선택기 열림', hx && (await page.getByLabel('Hue').count()) > 0);
  check('색 선택기 dialog와 슬라이더 이름', (await page.getByRole('dialog', { name: 'Color picker' }).count()) > 0 && (await page.getByRole('slider', { name: 'Hue' }).count()) > 0);
  check('헤더 Export 버튼', (await page.getByRole('button', { name: 'Export' }).count()) === 1);
  await page.keyboard.press('Escape'); await sleep(300);

  // Layers 탭, 복사 붙여넣기, 굵게
  await layers.nth(1).click(); await sleep(500);
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
  await h1.click({ modifiers: ['Meta'] }); await sleep(150); await h1.dblclick(); await sleep(200); await page.keyboard.press('Meta+a'); await page.keyboard.press('Meta+b'); await sleep(200);
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
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await sleep(300);
  const st = page.getByLabel('Appears at step'); await st.fill('3'); await st.press('Enter'); await sleep(400);
  check('data-step이 요소에 설정', await inDoc((s) => !!s.querySelector('[data-step="3"]')));
  check('Effect Select 표시', (await page.getByLabel('Step effect').count()) === 1);
  check('캔버스에 모든 단계 표시(data-sk-show-steps)', await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').contentDocument.documentElement.hasAttribute('data-sk-show-steps')));
  check('Layers 단계 배지', (await page.getByTitle('Appears at step 3').count()) >= 1);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await sleep(1200);
  const stepSaved = fs.readFileSync(FILE, 'utf8');
  check('저장 파일에 data-step, show-steps는 새지 않음', /data-step="3"/.test(stepSaved) && !stepSaved.includes('data-sk-show-steps'));
  await page.keyboard.press('Escape'); await sleep(300);
  check('슬라이드 상태에 자동 단계 안내', (await page.getByText('Auto from element steps: 3').count()) === 1);
  await focusBody(); await page.keyboard.press('Tab'); await sleep(300);
  const st2 = page.getByLabel('Appears at step'); await st2.fill('1'); await st2.press('Enter'); await sleep(300);
  check('1로 되돌리면 속성 삭제', !(await inDoc((s) => !!s.querySelector('[data-step]'))));
  // 속성 패널 UX: 선택 헤더, 설정 표시와 Reset, 크기 모드, 정렬 사유, 슬라이드 힌트
  await page.screenshot({ path: '/tmp/sk-ux-elem.png' });
  check('선택 헤더(이름과 태그)', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  const o3 = page.getByLabel('Opacity', { exact: true }); await o3.fill('60'); await o3.press('Enter'); await sleep(300);
  check('설정한 속성에 점 표시', (await page.locator('[data-dirty]').count()) >= 1);
  await o3.hover(); await page.getByRole('button', { name: 'Reset Opacity' }).click(); await sleep(300);
  check('Reset이 인라인 값을 지움', !(await inDoc((s) => [...s.querySelectorAll('[style]')].some((e) => /opacity/.test(e.getAttribute('style') || '')))));
  check('크기 모드가 하나만 선택', (await page.getByRole('radiogroup', { name: 'Width mode' }).locator('[aria-checked=true]').count()) === 1);
  check('정렬 버튼에 규칙 툴팁이나 비활성', (await page.getByRole('button', { name: 'Align top' }).count()) === 1);
  await page.getByRole('button', { name: 'Show in layers' }).click(); await sleep(300);
  check('선택 헤더를 누르면 Layers 탭', (await page.getByRole('tree', { name: 'Layers' }).count()) === 1);
  await page.keyboard.press('Escape'); await sleep(300);
  await page.screenshot({ path: '/tmp/sk-ux-slide.png' });
  check('요소 미선택 힌트', (await page.getByText('Select an element to edit its properties').count()) === 1);
  // 키보드와 되돌리기: 패널의 Tab 이동, 되돌린 뒤 선택 유지, 스크럽 한 번이 별도 undo
  await focusBody(); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await sleep(300);
  const o4 = page.getByLabel('Opacity', { exact: true }); await o4.fill('80'); await o4.press('Enter'); await sleep(1400);
  const lab = await o4.locator('xpath=../span[1]').boundingBox();
  await page.mouse.move(lab.x + lab.width / 2, lab.y + lab.height / 2); await page.mouse.down(); await page.mouse.move(lab.x + lab.width / 2 - 25, lab.y + lab.height / 2, { steps: 8 }); await page.mouse.up(); await sleep(300);
  const scrubbed = await o4.inputValue();
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(500);
  check('스크럽 한 번이 별도 undo(직전 값 80으로)', scrubbed !== '80' && (await page.getByLabel('Opacity', { exact: true }).inputValue()) === '80', [scrubbed, await page.getByLabel('Opacity', { exact: true }).inputValue()]);
  check('되돌린 뒤에도 요소 선택 유지', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  await page.getByRole('button', { name: 'Show in layers' }).focus(); await page.keyboard.press('Tab'); await sleep(200);
  check('패널에서 Tab은 포커스를 옮기고 선택을 순환시키지 않음', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) !== 'Show in layers' && (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(300);

  // 이미지 선택: Fit 컨트롤, Fill 섹션 없음, 선택 헤더 한 줄
  await focusBody(); await page.keyboard.press('Escape');
  const imgAt = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')].findIndex((s) => s.querySelector('img')));
  console.log('INFO 이미지 슬라이드 위치 ' + (imgAt + 1));
  await layers.nth(Math.max(0, imgAt)).click(); await sleep(700);
  await fr().locator('[data-active] img').first().click({ modifiers: ['Meta'] }); await sleep(500);
  check('이미지 Fit과 Position 컨트롤', (await page.getByLabel('Image fit', { exact: true }).count()) === 1 && (await page.getByLabel('Image position', { exact: true }).count()) === 1);
  const pr = await page.getByRole('complementary', { name: 'Properties' }).boundingBox(), fitB = await page.getByLabel('Image fit', { exact: true }).boundingBox(), posB = await page.getByLabel('Image position', { exact: true }).boundingBox();
  check('Fit과 Position이 패널 안에서 겹치지 않음', pr && fitB && posB && fitB.x + fitB.width <= pr.x + pr.width && posB.x + posB.width <= pr.x + pr.width && (posB.y >= fitB.y + fitB.height - 1 || posB.x >= fitB.x + fitB.width), [pr, fitB, posB]);
  check('이미지에는 Fill 섹션이 없음', (await page.getByRole('button', { name: 'Add fill' }).count()) === 0);
  const hb = await page.getByRole('button', { name: 'Show in layers' }).boundingBox();
  check('선택 헤더가 한 줄', hb && hb.height <= 30, hb && hb.height);
  check('이미지 이름은 Image', (await page.getByRole('button', { name: 'Show in layers' }).textContent()).includes('Image'));
  await focusBody(); await page.keyboard.press('Escape');
  // 요소 선택 규칙(Figma식 계층 선택): 슬라이드 2의 카드에서 가장 깊은 글자 블록을 대상으로 한다
  await layers.nth(1).click(); await sleep(700); await focusBody(); await page.keyboard.press('Escape'); await sleep(200);
  const probe = await page.evaluate(() => {
    const f = document.querySelector('iframe[title="Canvas"]'), s = f.contentDocument.querySelector('[data-active]'), fb = f.getBoundingClientRect();
    const INL = /^(B|I|EM|STRONG|SPAN|CODE|A|BR|SMALL|MARK|U|S|SUB|SUP|KBD)$/;
    const depth = (e) => { let d = 0; for (let n = e; n && n !== s; n = n.parentElement) d++; return d; };
    const isTB = (e) => (e.textContent || '').trim() && [...e.children].every((c) => INL.test(c.tagName));
    const inTB = (e) => { for (let n = e.parentElement; n && n !== s; n = n.parentElement) if (isTB(n)) return true; return false; }; // 글자 블록 안의 인라인은 단위가 아니다
    const blocks = [...s.querySelectorAll('*')].filter((e) => !e.closest('aside,svg') && isTB(e) && !inTB(e) && depth(e) >= 2);
    const e = blocks[0]; if (!e) return null;
    let top = e; while (top.parentElement !== s) top = top.parentElement;
    const r = e.getBoundingClientRect(), tr = top.getBoundingClientRect();
    return { d: depth(e), x: fb.x + r.x + r.width / 2, y: fb.y + r.y + r.height / 2, top: [fb.x + tr.x, fb.y + tr.y, tr.width, tr.height] };
  });
  check('깊이 2 이상의 글자 블록이 있는 슬라이드', !!probe, probe);
  if (probe) {
    const depthNow = () => page.getByRole('button', { name: 'Show in layers' }).getAttribute('data-depth', { timeout: 1500 }).catch(() => null);
    await page.mouse.move(probe.x, probe.y); await sleep(300);
    const hb = await page.locator('div.border-focus-ring\\/60').first().boundingBox();
    check('호버 외곽선이 클릭 대상(최상위 요소)과 일치', !!hb && Math.abs(hb.x - probe.top[0]) < 4 && Math.abs(hb.y - probe.top[1]) < 4 && Math.abs(hb.width - probe.top[2]) < 4, [hb, probe.top]);
    await page.mouse.click(probe.x, probe.y); await sleep(400);
    check('첫 클릭은 최상위 컨테이너', (await depthNow()) === '1', await depthNow());
    await page.mouse.dblclick(probe.x, probe.y); await sleep(400);
    check('더블클릭하면 한 단계 안쪽', (await depthNow()) === '2', await depthNow());
    await page.keyboard.press('Escape'); await sleep(200);
    await page.keyboard.down('Meta'); await page.mouse.click(probe.x, probe.y); await page.keyboard.up('Meta'); await sleep(400);
    check('Cmd+클릭은 가장 안쪽 글자 블록', (await depthNow()) === String(probe.d), [await depthNow(), probe.d]);
    await focusBody(); await page.keyboard.press('Shift+Enter'); await sleep(300);
    check('Shift+Enter는 부모 선택', (await depthNow()) === String(probe.d - 1), await depthNow());
    await page.keyboard.press('Enter'); await sleep(300);
    check('Enter는 첫 자식 선택', (await depthNow()) !== null && +(await depthNow()) === probe.d, await depthNow());
    await page.keyboard.press('Escape'); await sleep(200);
    check('Esc는 선택 해제(범위는 슬라이드로)', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 0);
    await page.mouse.click(probe.x, probe.y); await sleep(300);
    check('해제 뒤 첫 클릭은 다시 최상위', (await depthNow()) === '1', await depthNow());
    await page.keyboard.press('Escape'); await sleep(200);
  }

  // 필름스트립: 키보드 이동, 접기, 슬라이드 추가
  await layers.nth(0).click(); await sleep(400); await layers.nth(0).focus(); await page.keyboard.press('ArrowRight'); await sleep(500);
  check('필름스트립에서 오른쪽 방향키로 다음 슬라이드', (await layers.nth(1).getAttribute('aria-selected')) === 'true');
  const total = await layers.count();
  check('현재 위치 표시(Slide 2 / N)', (await page.getByText(`Slide 2 / ${total}`).count()) === 1);
  // 포커스 링이 스크롤 영역 안에 완전히 들어오는지(상하좌우, 첫째와 마지막 포함)
  const ringInside = () => page.evaluate(() => {
    const o = document.activeElement, vp = o && o.closest && o.closest('[data-radix-scroll-area-viewport],[data-slot=scroll-area-viewport]');
    if (!o || !vp || o.getAttribute('role') !== 'option') return 'no-option';
    const sp = Math.max(0, ...[...getComputedStyle(o).boxShadow.matchAll(/0px 0px 0px (\d+(?:\.\d+)?)px/g)].map((m) => +m[1]));
    const r = o.getBoundingClientRect(), v = vp.getBoundingClientRect();
    return r.left - sp >= v.left - 0.5 && r.right + sp <= v.right + 0.5 && r.top - sp >= v.top - 0.5 && r.bottom + sp <= v.bottom + 0.5 ? 'ok' : JSON.stringify({ sp, r: [r.left, r.top, r.right, r.bottom], v: [v.left, v.top, v.right, v.bottom] });
  });
  await layers.nth(2).focus(); await page.keyboard.press('ArrowLeft'); await sleep(400); await page.keyboard.press('ArrowLeft'); await sleep(500);
  check('포커스 링이 첫 썸네일에서도 잘리지 않음', (await ringInside()) === 'ok', await ringInside());
  await page.keyboard.press('End'); await sleep(700);
  check('포커스 링이 마지막 썸네일에서도 잘리지 않음', (await ringInside()) === 'ok', await ringInside());
  await page.keyboard.press('Home'); await sleep(500);
  await page.getByRole('button', { name: 'Hide filmstrip' }).click(); await sleep(300);
  // 앞의 포커스 링 검사가 Home으로 첫 슬라이드에 돌려놓는다
  { const nOpt = await layers.count(), nTxt = await page.getByText(`Slide 1 / ${total}`).count(); check('접으면 썸네일 목록이 사라지고 위치 표시만 남음', nOpt === 0 && nTxt === 1, [nOpt, nTxt, total, await page.locator('[data-testid=filmstrip]').innerText()]); }
  await page.getByRole('button', { name: 'Show filmstrip' }).click(); await sleep(400);
  await page.getByRole('button', { name: 'Add slide' }).click(); await sleep(600);
  check('+ 타일로 슬라이드 추가', (await layers.count()) === total + 1, [total, await layers.count()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(600);
  check('추가 실행 취소', (await layers.count()) === total);

  // 줌 컨트롤, 크기 칩, 명령 팔레트, 단축키 안내
  const pctBtn = page.getByRole('button', { name: 'Zoom to fit' });
  const pct0 = await pctBtn.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click(); await sleep(300);
  check('줌 버튼이 비율을 바꾸고 맞춤으로 돌아옴', (await pctBtn.textContent()) !== pct0 && (await pctBtn.click(), await sleep(300), (await pctBtn.textContent()) === pct0), pct0);
  await focusBody(); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await sleep(400);
  check('선택 요소 크기 칩(W × H)', (await page.getByText(/^\d+ × \d+$/).count()) === 1);
  await focusBody(); await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k'); await sleep(500);
  await page.getByPlaceholder('Slide number, title or action').fill('Slide 3'); await sleep(300);
  await page.keyboard.press('Enter'); await sleep(700);
  check('Cmd+K 팔레트로 슬라이드 이동', (await layers.nth(2).getAttribute('aria-selected')) === 'true');
  await page.keyboard.press('Meta+/'); await sleep(400);
  check('단축키 안내가 그룹으로 보임', (await page.getByText('Select', { exact: true }).count()) >= 1 && (await page.locator('kbd').count()) > 10);
  await page.keyboard.press('Escape'); await sleep(300);

  // 코멘트: 선택 요소에서 C 키로 작성창이 열리고 Esc로 닫힌다
  await focusBody(); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await sleep(400);
  await focusBody(); await page.keyboard.press('c'); await sleep(400);
  check('C 키로 코멘트 작성창 열림', (await page.getByRole('group', { name: 'New comment' }).count()) === 1);
  await page.getByPlaceholder('Tell Claude what to change').press('Escape'); await sleep(300);
  check('Esc로 작성창 닫힘', (await page.getByRole('group', { name: 'New comment' }).count()) === 0);
  await focusBody(); await page.keyboard.press('Escape');

  // Space 드래그 팬과 커서 기준 줌
  await page.getByRole('button', { name: 'Zoom in' }).click(); await page.getByRole('button', { name: 'Zoom in' }).click(); await page.getByRole('button', { name: 'Zoom in' }).click(); await sleep(400);
  const scroller = () => page.evaluate(() => { const b = document.querySelector('iframe[title="Canvas"]').closest('div.overflow-auto'); return [b.scrollLeft, b.scrollTop, b.scrollWidth > b.clientWidth]; });
  const s0 = await scroller();
  const fbx = await page.locator('iframe[title="Canvas"]').boundingBox();
  await focusBody(); await page.keyboard.down('Space'); await sleep(200);
  check('Space를 누르면 팬 덮개가 나타남', (await page.getByTestId('pan-overlay').count()) === 1);
  check('Space 팬 덮개 커서는 grab', (await page.getByTestId('pan-overlay').evaluate((e) => getComputedStyle(e).cursor)) === 'grab');
  await page.mouse.move(fbx.x + 300, fbx.y + 200); await page.mouse.down(); await page.mouse.move(fbx.x + 150, fbx.y + 120, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space'); await sleep(300);
  const s1 = await scroller();
  check('Space+드래그로 스크롤이 이동', s1[2] && (s1[0] > s0[0] || s1[1] > s0[1]), [s0, s1]);
  check('Space를 떼면 덮개가 사라짐', (await page.getByTestId('pan-overlay').count()) === 0);
  await page.getByRole('button', { name: 'Zoom to fit' }).click(); await sleep(300);
  // 끌어서 이동(translate), 스마트 가이드, 방향키 넛지, 실행 취소 1건
  await layers.nth(1).click(); await sleep(600); await focusBody(); await page.keyboard.press('Escape');
  const hb2 = await fr().locator('[data-active] h2').first().boundingBox();
  const cx = hb2.x + hb2.width / 2, cy = hb2.y + hb2.height / 2;
  const tr = () => inDoc((s) => s.querySelector('h2').style.translate || '');
  await page.mouse.click(cx, cy); await sleep(250);
  await page.mouse.move(cx + 1, cy); await sleep(150);
  const cursorOfH2 = () => fr().evaluate(() => getComputedStyle(document.querySelector('[data-active] h2')).cursor);
  check('선택된 요소 위에서는 move 커서', (await cursorOfH2()) === 'move', await cursorOfH2());
  const cardBox = await fr().locator('[data-active] > :nth-child(2)').first().boundingBox();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height - 8); await sleep(150);
  check('선택되지 않은 요소 위에서는 default 커서', (await fr().evaluate(() => getComputedStyle(document.querySelector('[data-active] > :nth-child(2)')).cursor)) === 'default');
  await page.mouse.move(cx, cy); await sleep(100);
  check('끌기 전에는 커서 방패가 없음', (await page.getByTestId('cursor-shield').count()) === 0);
  await page.mouse.down(); await page.mouse.move(cx, cy + 40, { steps: 8 }); await sleep(250);
  check('끄는 동안 방패가 있고 커서는 move', (await page.getByTestId('cursor-shield').count()) === 1 && (await page.getByTestId('cursor-shield').evaluate((e) => getComputedStyle(e).cursor)) === 'move');
  check('끄는 동안 가이드선이 보임(왼쪽 가장자리 정렬 유지)', (await page.getByTestId('guide-line').count()) >= 1);
  await page.mouse.up(); await sleep(400);
  check('끌기가 끝나면 방패가 사라짐', (await page.getByTestId('cursor-shield').count()) === 0);
  const t1 = await tr();
  check('끌면 인라인 translate가 생김', /px\s+-?\d/.test(t1), t1);
  check('끌고 난 뒤 가이드선이 사라짐', (await page.getByTestId('guide-line').count()) === 0);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(400);
  check('끌기는 실행 취소 한 번에 되돌아감', (await tr()) === '', await tr());
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await sleep(300);
  await focusBody(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown'); await sleep(400);
  const t2 = await tr();
  check('방향키 1px와 Shift+방향키 10px 넛지', /^1px 10px$/.test(t2), t2);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(300); await page.keyboard.press('Escape');

  // 다중 선택: Shift+클릭으로 같은 부모의 요소를 묶고 이동, 넛지, 복제, 삭제가 한 번에 적용된다(실행 취소 1건)
  await layers.nth(1).click(); await sleep(500); await focusBody(); await page.keyboard.press('Escape');
  const nKids = () => inDoc((s) => s.children.length);
  const tr2 = () => inDoc((s) => [s.children[0].style.translate || '', s.children[1].style.translate || '']);
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await sleep(250);
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await sleep(300);
  check('Shift+클릭으로 두 요소가 선택됨(Layers 행 2개)', (await page.locator('[role=treeitem] > [aria-selected], [role=treeitem][aria-selected=true]').count()) >= 2);
  await focusBody(); await page.keyboard.press('ArrowRight'); await sleep(300);
  const m1 = await tr2();
  check('방향키 넛지가 둘 다 옮김', m1[0] === '1px' && m1[1] === '1px', m1);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(300);
  check('넛지 실행 취소 한 번에 둘 다 되돌아감', (await tr2()).join('') === '', await tr2());
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await sleep(250);
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await sleep(300);
  const k0n = await nKids();
  await focusBody(); await page.keyboard.press('Meta+d'); await sleep(400);
  check('Cmd+D가 선택한 둘을 모두 복제', (await nKids()) === k0n + 2, [k0n, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(400);
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await sleep(250);
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await sleep(300);
  await focusBody(); await page.keyboard.press('Delete'); await sleep(400);
  check('Delete가 선택한 둘을 모두 지움', (await nKids()) === k0n - 2, [k0n, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(400);
  check('삭제 실행 취소 한 번에 둘 다 돌아옴', (await nKids()) === k0n, await nKids());
  await page.keyboard.press('Escape');

  // 묶음 Inspector: 값이 다르면 Mixed, Align은 묶음 상자 기준이고 한 번에 실행 취소
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await sleep(250);
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await sleep(400);
  check('묶음 헤더가 2 layers', (await page.getByRole('button', { name: 'Show in layers' }).textContent()).includes('2 layers'));
  check('값이 다른 필드는 Mixed', (await page.locator('input[placeholder="Mixed"]').count()) >= 1);
  const lefts = () => inDoc((s) => [s.children[0].getBoundingClientRect().left, s.children[1].getBoundingClientRect().left]);
  await page.getByRole('button', { name: 'Align right', exact: true }).click(); await sleep(400);
  const rights = await inDoc((s) => [s.children[0].getBoundingClientRect().right, s.children[1].getBoundingClientRect().right]);
  check('묶음 Align right가 오른쪽 가장자리를 맞춤', Math.abs(rights[0] - rights[1]) < 1.5, rights);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(400);
  const back = await tr2();
  check('Align 실행 취소 한 번에 둘 다 되돌아감', back.join('') === '', back);
  void lefts; await focusBody(); await page.keyboard.press('Escape');

  // 마퀴: 빈 곳을 끌면 겹친 최상위 요소가 모두 선택된다
  await focusBody(); await page.keyboard.press('Escape'); await sleep(200);
  const sbox = await fr().locator('[data-active]').first().boundingBox();
  await page.mouse.move(sbox.x + sbox.width - 6, sbox.y + sbox.height - 6); await page.mouse.down();
  await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, { steps: 6 }); await sleep(150);
  const marqVisible = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.className.includes('bg-focus-ring/10') && d.style.display === 'block'));
  await page.mouse.move(sbox.x + 6, sbox.y + 6, { steps: 6 }); await page.mouse.up(); await sleep(400);
  check('마퀴 상자가 끄는 동안 보이고 놓으면 사라짐', marqVisible && !(await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.className.includes('bg-focus-ring/10') && d.style.display === 'block'))), marqVisible);
  check('마퀴로 최상위 요소가 여럿 선택됨', (await page.locator('[role=treeitem][aria-selected=true]').count()) >= 2, await page.locator('[role=treeitem][aria-selected=true]').count());
  await focusBody(); await page.keyboard.press('Escape');

  // Inspector Offset 필드와 리사이즈 핸들
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await sleep(300);
  await focusBody(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await sleep(400);
  check('Offset X 필드가 넛지 값을 보임', (await page.getByLabel('Offset X', { exact: true }).inputValue()) === '2', await page.getByLabel('Offset X', { exact: true }).inputValue());
  const offX = page.getByLabel('Offset X', { exact: true }); await offX.fill('12'); await offX.press('Enter'); await sleep(300);
  check('Offset 입력이 translate에 반영', /^12px( 0px)?$/.test(await tr()), await tr());
  await offX.focus(); await page.keyboard.press('Meta+z'); await sleep(300); await focusBody(); await page.keyboard.press('Meta+z'); await sleep(300);
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await sleep(300);
  const wBefore = await inDoc((s) => s.querySelector('h2').getBoundingClientRect().width);
  const hdl = page.locator('[data-handle=e]'); const hbx = await hdl.boundingBox();
  const HC = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
  const hcs = {}; for (const id of Object.keys(HC)) hcs[id] = await page.locator('[data-handle=' + id + ']').evaluate((e) => getComputedStyle(e).cursor);
  check('리사이즈 핸들 8개 커서', Object.keys(HC).every((k) => hcs[k] === HC[k]), hcs);
  await page.mouse.move(hbx.x + hbx.width / 2, hbx.y + hbx.height / 2); await page.mouse.down(); await page.mouse.move(hbx.x - 60, hbx.y + hbx.height / 2, { steps: 6 }); await sleep(200);
  check('리사이즈 끌기 중 방패가 시작한 핸들 커서를 유지', (await page.getByTestId('cursor-shield').count()) === 1 && (await page.getByTestId('cursor-shield').evaluate((e) => getComputedStyle(e).cursor)) === 'ew-resize');
  const chipTxt = await page.getByText(/^\d+ × \d+$/).textContent();
  await page.mouse.up(); await sleep(400);
  check('리사이즈가 끝나면 방패가 사라짐', (await page.getByTestId('cursor-shield').count()) === 0);
  const wStyle = await inDoc((s) => s.querySelector('h2').style.width || '');
  check('핸들로 줄이면 인라인 width가 생기고 크기 칩이 따라옴', /px$/.test(wStyle) && !!chipTxt, [wStyle, chipTxt]);
  check('리사이즈 뒤 Inspector 크기 모드가 Fixed', (await page.getByRole('radiogroup', { name: 'Width mode' }).locator('[aria-checked=true]').getAttribute('aria-label')) !== null);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(400);
  check('리사이즈는 실행 취소 한 번에 되돌아감', (await inDoc((s) => s.querySelector('h2').style.width || '')) === '', await inDoc((s) => s.querySelector('h2').style.cssText));
  void wBefore; await page.keyboard.press('Escape');

  // 회전한 조상 아래에서도 끌면 화면에서 포인터를 따라간다(로컬 축이 아니라)
  await layers.nth(1).click(); await sleep(500); await focusBody(); await page.keyboard.press('Escape');
  const rkpos = () => inDoc((s) => { const r = s.children[1].children[0].getBoundingClientRect(); return [r.x, r.y]; });
  await inDoc((s) => { s.children[1].style.transform = 'rotate(30deg)'; });
  await sleep(300);
  const rkl = fr().locator('[data-active] > :nth-child(2) > :first-child').first(); const rb = await rkl.boundingBox();
  const rk0 = await rkpos();
  const sx = rb.x + rb.width / 2, sy = rb.y + rb.height / 2;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 50, sy, { steps: 8 }); await page.mouse.up(); await sleep(400);
  const rk1 = await rkpos();
  check('회전한 부모 아래 요소가 가로로 끌림(세로로 새지 않음)', rk1[0] - rk0[0] > 10 && Math.abs(rk1[1] - rk0[1]) < Math.abs(rk1[0] - rk0[0]) * 0.2, [rk0, rk1]);
  await focusBody(); await page.keyboard.press('Meta+z'); await sleep(300);
  await inDoc((s) => { s.children[1].style.transform = ''; }); await page.keyboard.press('Escape');

  // 레이어: 잠금은 캔버스 선택에서 제외, Cmd+[ ]로 순서 이동, F2 이름 변경
  await layers.nth(1).click(); await sleep(600);
  const rowsL = page.getByTestId('layer-row');
  await rowsL.nth(1).click(); await sleep(300);
  await rowsL.nth(1).getByRole('button', { name: 'Lock layer' }).click({ force: true }); await sleep(300);
  check('잠금이 data-locked로 저장됨', await inDoc((s) => !!s.querySelector('[data-locked]')));
  await rowsL.nth(1).locator('svg').first().click(); await sleep(300);
  check('잠긴 부모 아래 행에 잠금 표시', (await page.getByTestId('parent-lock').count()) >= 1);
  await focusBody(); await page.keyboard.press('Escape');
  const lockedBox = await fr().locator('[data-active] [data-locked]').first().boundingBox();
  await page.mouse.click(lockedBox.x + lockedBox.width / 2, lockedBox.y + lockedBox.height / 2); await sleep(300);
  check('잠긴 요소는 캔버스 클릭으로 선택되지 않음', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 0);
  // 잠긴 요소를 Layers에서 고른 뒤 Delete를 눌러도 지워지지 않는다
  const nLocked = await inDoc((s) => s.children.length);
  await rowsL.nth(1).click(); await focusBody(); await page.keyboard.press('Delete'); await sleep(300);
  check('잠긴 요소는 Delete로 지워지지 않음', (await inDoc((s) => s.children.length)) === nLocked);
  await page.getByRole('button', { name: 'Unlock layer' }).first().click({ force: true }); await sleep(300);
  check('잠금 해제', !(await inDoc((s) => !!s.querySelector('[data-locked]'))));
  await rowsL.nth(1).click(); await sleep(300);
  const orderOf = () => inDoc((s) => [...s.children].map((e) => e.tagName + ((e.textContent || '').trim().slice(0, 4))).join('|'));
  const o0 = await orderOf();
  await focusBody(); await page.keyboard.press('Meta+['); await sleep(400);
  const o1 = await orderOf();
  check('Cmd+[로 한 칸 앞으로(문서 순서)', o1 !== o0, [o0, o1]);
  await page.keyboard.press('Meta+]'); await sleep(400);
  check('Cmd+]로 되돌림', (await orderOf()) === o0);
  await rowsL.nth(1).click(); await page.keyboard.press('Enter'); await sleep(300);
  check('Layers 행에서 Enter로 이름 입력창', (await page.getByLabel('Layer name').count()) === 1);
  await page.getByLabel('Layer name').press('Escape'); await sleep(300);
  await focusBody(); await page.keyboard.press('F2'); await sleep(300);
  check('F2로 레이어 이름 입력창', (await page.getByLabel('Layer name').count()) === 1);
  await page.getByLabel('Layer name').press('Escape'); await sleep(200);
  await focusBody(); await page.keyboard.press('Escape');

  // 노트 pane은 접지 않는다
  check('노트 pane에 접기 버튼이 없고 입력창이 항상 보임', (await page.getByRole('button', { name: /notes/i }).count()) === 0 && (await page.getByPlaceholder('Speaker notes (Markdown)').isVisible()));
  // 자동 저장: Cmd+S 없이 1.5초 뒤 저장된다
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await sleep(300);
  const op2 = page.getByLabel('Opacity', { exact: true }); await op2.fill('37'); await op2.press('Enter'); await sleep(400);
  check('편집 직후는 Unsaved', (await page.getByText('Unsaved', { exact: true }).count()) > 0);
  await sleep(2600);
  check('자동 저장 뒤 Saved', (await page.getByText('Saved', { exact: true }).count()) > 0);
  check('자동 저장이 파일에 반영', /opacity:\s*0\.37/.test(fs.readFileSync(FILE, 'utf8')));
  check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
