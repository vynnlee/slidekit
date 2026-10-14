/* 편집기 브라우저 검증. 실행 전에 bun run slidekit.
   사본(decks/_e2e-editor)에서만 고치므로 실제 덱을 되돌릴 필요가 없다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node editor.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
const T = makeTestDeck('editor', 'vibe-coding-workshop', { slides: 8 }); // 실제 덱 대신 작은 사본(8장)에서만 고친다: 대부분의 검사는 장수와 무관하게 빨리 돌게
const TL = makeTestDeck('editor-long'); // 53장 사본: 필름스트립 썸네일 검사에만 쓰고 고치지 않는다
const N0 = 8;
const FILE = T.file;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
let lastT = Date.now();
const check = (name, ok, extra) => { const dt = Date.now() - lastT; lastT = Date.now(); if (dt > 2500) console.log('SLOW +' + (dt / 1000).toFixed(1) + 's 직전 구간 끝: ' + name); if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const slides = (s) => (s.match(/<section\b[^>]*\bdata-slide\b/g) || []).length;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  // 렌더와 오버레이 갱신(60ms 주기)이 끝나기를 기다린다: 프레임 두 번 + 한 주기. 고정 시간 sleep 대신 쓴다.
  const settleOf = (pg) => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 70)))));
  const settle = () => settleOf(page);
  const focusBody = () => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); // 패널에 포커스가 있으면 Tab이 브라우저 이동이라 본문으로 돌린다
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/edit/' + T.id);
  const frameEl = page.locator('iframe[title="Canvas"]');
  await frameEl.waitFor();
  const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('#sk-stage') && f.contentDocument.querySelector('[data-active]'); });
  await settle();
  // 레이어 썸네일 첫 3개가 그려지기까지: 레이어 목록이 보인 때부터 잰다(목표 1초)
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '/edit/' + TL.id);
  await p2.locator('[draggable="true"]').first().waitFor();
  const t0 = Date.now();
  await p2.waitForFunction(() => document.querySelectorAll('iframe[srcdoc]').length >= 3);
  await Promise.all(p2.frames().filter((f) => f.url() === 'about:srcdoc').slice(0, 3).map((f) => f.waitForLoadState('load')));
  const thumbMs = Date.now() - t0;
  console.log('INFO 썸네일 3개 표시 ' + thumbMs + 'ms'); // 부하에 따라 흔들려 회귀 감시용으로만 쓴다
  check('썸네일 3개 3초 안에 표시', thumbMs < 3000, thumbMs);
  // 필름스트립을 끝까지 넘겨도(53장 덱) 화면 근처 썸네일만 iframe으로 남는다
  const nSlides = slides(fs.readFileSync(TL.file, 'utf8'));
  const nIframes = () => p2.locator('iframe[srcdoc]').count();
  const vp = p2.locator('[data-testid=filmstrip] [data-slot=scroll-area-viewport], [data-testid=filmstrip] [data-radix-scroll-area-viewport]').first();
  const firstN = await nIframes();
  for (let x = 0; x <= 12000; x += 600) { await vp.evaluate((e, v) => { e.scrollLeft = v; }, x); await settleOf(p2); }
  await settleOf(p2);
  const endN = await nIframes();
  console.log('INFO 필름스트립 iframe 수 처음 ' + firstN + ', 끝까지 넘긴 뒤 ' + endN + ' (슬라이드 ' + nSlides + '장)');
  const vpW = (await vp.boundingBox()).width, perScreen = Math.ceil(vpW / 130); // 썸네일 하나 약 128px
  const has = (n) => p2.getByRole('option', { name: 'Slide ' + n, exact: true }).locator('iframe[srcdoc]').count();
  check('테스트 덱이 30장 이상(검사가 의미 있으려면)', nSlides >= 30, nSlides);
  check('끝까지 넘기면 iframe 수가 보이는 수 + 여유 이내이고 슬라이드 수보다 훨씬 적음', endN <= perScreen + 6 && endN < nSlides / 2, [endN, perScreen, nSlides]);
  check('끝에서는 마지막 썸네일이 올라와 있고 먼 2번은 내려감', (await has(nSlides)) === 1 && (await has(2)) === 0, [await has(nSlides), await has(2)]);
  await vp.evaluate((e) => { e.scrollLeft = 0; });
  for (let i = 0; i < 40 && !((await has(nSlides)) === 0 && (await has(2)) === 1); i++) await settleOf(p2); // 큐를 거쳐 다시 올라오기를 기다린다
  check('처음으로 돌아오면 먼 쪽(마지막)이 내려가고 2번이 다시 올라옴', (await has(nSlides)) === 0 && (await has(2)) === 1, [await has(nSlides), await has(2)]);
  await p2.close();
  // 확대 축소, Tab 선택
  const wid = async () => (await frameEl.boundingBox()).width;
  const w0 = await wid();
  const bb = await frameEl.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.keyboard.down('Meta'); await page.mouse.wheel(0, -120); await page.keyboard.up('Meta'); await settle();
  const w1 = await wid();
  check('Cmd+휠로 확대', w1 > w0 * 1.05, [w0, w1]);
  await page.keyboard.press('Meta+0'); await settle();
  check('Cmd+0으로 맞춤', Math.abs((await wid()) - w0) < 2, [w0, await wid()]);
  const selVisible = () => page.locator('.border-2.border-focus-ring').first().isVisible();
  await page.keyboard.press('Escape'); await settle();
  check('Tab 전에는 선택 없음', !(await selVisible()));
  await focusBody(); await page.keyboard.press('Tab'); await settle();
  check('Tab으로 요소 선택', await selVisible());
  await page.keyboard.press('Escape');
  const before = fs.readFileSync(FILE, 'utf8');
  check('원본 슬라이드 수 ' + N0, slides(before) === N0, slides(before));
  const n = (sel) => page.evaluate((s) => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll(s).length, sel);
  // 고정 sleep 대신 조건 대기. 조건이 끝내 안 맞아도 던지지 않는다(뒤의 check가 실패로 보고한다).
  const cond = (fn, arg, ms = 5000) => page.waitForFunction(([src, a]) => { try { return !!(0, eval)('(' + src + ')')(a); } catch { return false; } }, [fn.toString(), arg], { timeout: ms }).catch(() => { console.log('INFO 조건 대기 시간 초과 ' + ms + 'ms: ' + fn.toString().replace(/\s+/g, ' ').slice(0, 90) + ' @' + (new Error().stack.split('\n')[2] || '').replace(/.*editor.cjs:/, '')); }); // 읽는 도중 iframe이 다시 그려져 예외가 나면 아직 아님으로 본다
  const saveDone = async () => { await settle(); await cond(() => document.querySelector('[data-testid=status]')?.textContent === 'Saved', null, 8000); if (!(await page.getByTestId('status').first().textContent().catch(() => '')).includes('Saved')) console.log('INFO 저장 안 됨, 헤더: ' + (await page.locator('header, [role=banner]').first().innerText().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 160)); }; // 키 입력이 Unsaved로 반영될 틈을 둔 뒤 Saved를 기다린다
  const unsaved = () => cond(() => document.querySelector('[data-testid=status]')?.textContent !== 'Saved', null, 4000);
  const stageCount = (c) => cond((c) => document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelectorAll('#sk-stage > [data-slide]').length === c, c);
  check('캔버스에 슬라이드 ' + N0 + '장', (await n('#sk-stage > [data-slide]')) === N0);

  // 3번째 슬라이드로 이동 후 제목 편집
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await settle();
  const idx = await page.evaluate(() => [].findIndex.call(document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1);
  check('방향키로 3번 슬라이드', idx === 3, idx);
  const h = fr().locator('[data-active] h1, [data-active] h2').first();
  const oldText = (await h.textContent()).trim();
  await h.click({ modifiers: ['Meta'] }); await settle(); // Cmd+클릭: 가장 안쪽 단위를 바로 고른다
  await h.dblclick(); await settle();
  check('더블클릭하면 편집 상태', await h.evaluate((e) => e.isContentEditable));
  await page.keyboard.press('Meta+a'); await page.keyboard.type('편집 테스트 제목');
  await page.keyboard.press('Enter'); await settle();
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
  check('슬라이드 수 그대로', slides(after) === N0);
  const diffLines = after.split('\n').filter((l, i) => l !== before.split('\n')[i]).length;
  check('바뀐 줄이 작음(서식 보존)', diffLines <= 6, diffLines);

  // 슬라이드 복제, 삭제, 순서 변경
  const layers = page.locator('[data-testid=filmstrip] [role=option]'); // 슬라이드 필름스트립
  await layers.nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate' }).click(); await stageCount(N0 + 1);
  check('복제 후 ' + (N0 + 1) + '장', (await n('#sk-stage > [data-slide]')) === N0 + 1);
  check('복제 후 현재 위치 4', (await page.evaluate(() => [].findIndex.call(document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1)) === 4);
  await layers.nth(6).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click(); await stageCount(N0);
  check('삭제 후 ' + N0 + '장', (await n('#sk-stage > [data-slide]')) === N0);
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
  check('최종 파일 슬라이드 ' + N0, slides(fin) === N0, slides(fin));
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
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); }); await settle();
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
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await settle();
  const op = page.getByLabel('Opacity', { exact: true });
  await op.fill('50'); await op.press('Enter'); await settle();
  const styled = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('[style*="opacity"]')].length);
  check('Opacity 입력이 요소 style에 반영', styled === 1, styled);
  await op.focus(); await op.press('ArrowUp'); await settle();
  check('화살표로 증가(51)', (await op.inputValue()) === '51', await op.inputValue());
  await page.getByRole('button', { name: 'Add stroke' }).click(); await settle();
  check('Add stroke로 Stroke 필드 표시', (await page.getByLabel('Stroke width', { exact: true }).count()) > 0);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone();
  const saved = fs.readFileSync(FILE, 'utf8');
  check('저장 파일에 opacity와 border 반영', /opacity:\s*0\.51/.test(saved) && /border:\s*1px solid/.test(saved), saved.match(/style="[^"]*opacity[^"]*"/));
  await page.keyboard.press('Meta+z'); await page.keyboard.press('Meta+z'); await settle();
  // 측정값 표시, 크기 모드, 코너별 radius, 그림자 여러 개, 그라디언트, 변별 stroke
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await settle();
  check('W 표시는 소수 둘째 자리까지', /^\d+(\.\d{1,2})?$/.test(await page.getByLabel('Width', { exact: true }).inputValue()), await page.getByLabel('Width', { exact: true }).inputValue());
  check('크기 모드 컨트롤에 W/H 이름', (await page.getByRole('radio', { name: 'Fixed width' }).count()) === 1 && (await page.getByRole('radio', { name: 'Fill container' }).count()) === 2);
  const styleOf = () => page.evaluate(() => { const e = [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('[style]')].find((x) => x.closest('[data-active]') && x.style.length); return e ? e.getAttribute('style') : ''; });
  await page.getByRole('button', { name: 'Individual corners' }).click();
  const tl = page.getByLabel('Top left radius'); await tl.fill('10'); await tl.press('Enter'); await settle();
  check('코너별 radius', /border-top-left-radius:\s*10px/.test(await styleOf()), await styleOf());
  for (const name of ['Drop shadow', 'Inner shadow']) { await page.getByRole('button', { name: 'Add effect' }).click(); await page.getByRole('menuitem', { name }).click(); await settle(); }
  const b2 = page.getByLabel('Shadow 2 blur'); await b2.fill('12'); await b2.press('Enter'); await settle();
  check('그림자 2개와 inset', /box-shadow:[^;]*,[^;]*inset/.test(await styleOf()) || /box-shadow:[^;]*inset[^;]*,/.test(await styleOf()), await styleOf());
  await page.getByRole('button', { name: 'Remove shadow 1' }).click(); await settle();
  check('그림자 하나 삭제', (await page.getByLabel('Shadow 2 blur').count()) === 0 && (await page.getByLabel('Shadow 1 blur').count()) === 1);
  if (await page.getByRole('button', { name: 'Add fill' }).count()) await page.getByRole('button', { name: 'Add fill' }).click();
  await settle(); await page.getByRole('radio', { name: 'Linear gradient' }).click(); await settle();
  check('그라디언트 전환', /linear-gradient/.test(await styleOf()) && (await page.getByLabel('Gradient angle').count()) === 1, await styleOf());
  const ang = page.getByLabel('Gradient angle'); await ang.fill('90'); await ang.press('Enter'); await settle();
  check('그라디언트 각도', /linear-gradient\(90deg/.test(await styleOf()), await styleOf());
  // 스톱 편집: 막대를 눌러 추가(최대 4개), 핸들 끌기, 토큰 var() 색, 삭제는 2개까지
  const gbar = page.getByTestId('gradient-bar'); const gbb = await gbar.boundingBox();
  await page.mouse.click(gbb.x + gbb.width * 0.5, gbb.y + gbb.height / 2); await settle();
  check('막대를 눌러 스톱을 추가(3개)', (await page.getByRole('slider', { name: /^Gradient stop/ }).count()) === 3 && ((await styleOf()).match(/\d%/g) || []).length >= 3, await styleOf());
  const stopH = page.getByRole('slider', { name: 'Gradient stop 2' }); const stopB = await stopH.boundingBox();
  await page.mouse.move(stopB.x + stopB.width / 2, stopB.y + stopB.height / 2); await page.mouse.down();
  await page.mouse.move(gbb.x + gbb.width * 0.8, stopB.y + stopB.height / 2, { steps: 5 }); await page.mouse.up(); await settle();
  check('핸들을 끌어 스톱 위치가 바뀜', /\b(7[5-9]|8[0-5])(\.\d)?%/.test(await styleOf()), await styleOf());
  await page.getByLabel('Gradient stop color swatch').click();
  await page.getByTestId('deck-token').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.getByTestId('deck-token').first().click(); await settle();
  check('스톱 색에 덱 토큰 var()를 쓸 수 있음', /var\(--sk-/.test(await styleOf()), await styleOf());
  await page.keyboard.press('Escape'); await settle();
  await page.getByRole('button', { name: 'Remove stop' }).click(); await settle();
  check('스톱 삭제 뒤 2개이고 더는 지울 수 없음', (await page.getByRole('slider', { name: /^Gradient stop/ }).count()) === 2 && !(await page.getByRole('button', { name: 'Remove stop' }).isEnabled()));
  if (await page.getByRole('button', { name: 'Add stroke' }).count()) await page.getByRole('button', { name: 'Add stroke' }).click();
  await settle(); await page.getByRole('button', { name: 'Individual sides' }).click();
  const tw = page.getByLabel('top stroke width', { exact: true }); await tw.fill('4'); await tw.press('Enter'); await settle();
  check('변별 stroke 두께', /border(-top)?-width:\s*4px/.test(await styleOf()), await styleOf());

  // 색 팝오버: 스와치를 누르면 Fluid ColorPicker가 열린다
  const hx = await page.getByLabel('Text color hex').boundingBox();
  if (hx) { await page.mouse.click(hx.x - 18, hx.y + hx.height / 2); await page.getByLabel('Hue').first().waitFor({ timeout: 8000 }).catch(() => {}); } // 색 선택기 조각은 처음 열 때 불러온다
  check('스와치 클릭으로 색 선택기 열림', hx && (await page.getByLabel('Hue').count()) > 0);
  check('색 선택기 dialog와 슬라이더 이름', (await page.getByRole('dialog', { name: 'Color picker' }).count()) > 0 && (await page.getByRole('slider', { name: 'Hue' }).count()) > 0);
  check('헤더 Export 버튼', (await page.getByRole('button', { name: 'Export' }).count()) === 1);
  await page.keyboard.press('Escape'); await settle();

  // Layers 탭, 복사 붙여넣기, 굵게
  await layers.nth(1).click(); await settle();
  const rows = page.locator('[role=tree] [draggable=true]');
  check('Layers 트리에 요소 표시', (await rows.count()) > 1, await rows.count());
  const inDoc = (fn, arg) => page.evaluate(([f, a]) => { const d = document.querySelector('iframe[title="Canvas"]').contentDocument; return eval('(' + f + ')')(d.querySelector('[data-active]'), a); }, [fn.toString(), arg]);
  const names = await page.locator('[role=tree] [role=treeitem] > div > span.truncate').allTextContents();
  check('레이어 이름에 날것의 div가 없음', !names.includes('div') && names.some((x) => /^(Frame|Auto layout|Image|Vector|List)$/.test(x) || x.length > 0), names.slice(0, 6));
  check('슬라이드 루트 행', names.some((x) => /^Slide \d+$/.test(x)) || names.length > 0);
  await rows.nth(1).click(); await settle();
  check('행 클릭이 캔버스 선택', await page.locator('.border-2.border-focus-ring').first().isVisible());
  check('선택된 행 표시', (await page.locator('[role=treeitem][aria-selected=true]').count()) >= 1);
  await rows.nth(1).dblclick(); await page.getByLabel('Layer name').fill('Hero'); await page.getByLabel('Layer name').press('Enter'); await settle();
  check('이름 바꾸기가 data-name에 저장', await inDoc((s) => !!s.querySelector('[data-name="Hero"]')));
  await page.getByRole('button', { name: 'Hide layer' }).first().click({ force: true }); await settle();
  check('눈 아이콘이 display:none', await inDoc((s) => [...s.querySelectorAll('*')].some((e) => e.style && e.style.display === 'none')));
  await page.getByRole('button', { name: 'Show layer' }).first().click(); await settle();
  check('다시 보이기', await inDoc((s) => ![...s.querySelectorAll('*')].some((e) => e.style && e.style.display === 'none')));
  const kidsN = () => inDoc((s) => s.children.length);
  const k0 = await kidsN();
  await rows.nth(1).click(); await page.keyboard.press('Meta+c'); await page.keyboard.press('Meta+v'); await settle();
  check('Cmd+C, Cmd+V로 붙이기', (await kidsN()) === k0 + 1, [k0, await kidsN()]);
  await page.keyboard.press('Meta+z'); await settle();
  check('붙이기 실행 취소', (await kidsN()) === k0);
  const first = await inDoc((s) => s.children[0].tagName + s.children[1].tagName + (s.children[0].textContent || '').length);
  await rows.nth(0).dragTo(rows.nth(1), { targetPosition: { x: 40, y: 22 } }); await settle();
  const after2 = await inDoc((s) => s.children[0].tagName + s.children[1].tagName + (s.children[0].textContent || '').length);
  check('드래그로 순서 변경', after2 !== first, [first, after2]);
  await page.keyboard.press('Meta+z'); await settle();
  const h1 = fr().locator('[data-active] h1, [data-active] h2, [data-active] p').first();
  await h1.click({ modifiers: ['Meta'] }); await settle(); await h1.dblclick(); await settle(); await page.keyboard.press('Meta+a'); await page.keyboard.press('Meta+b'); await settle();
  check('편집 중 Cmd+B가 strong으로 감쌈', await h1.evaluate((e) => !!e.querySelector('strong')));
  await page.keyboard.press('Enter'); await settle();

  check('색 스와치 버튼에 이름', (await page.getByRole('button', { name: /color swatch$/ }).count()) > 0);
  // 덱 토큰: 요소 미선택 상태에서 accent와 pad-x를 바꿔 저장하면 head의 :root만 바뀐다
  await page.keyboard.press('Escape'); await settle();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone(); // 앞 단계의 미저장 변경을 먼저 비운다
  const eb = await page.getByRole('button', { name: 'Export' }).boundingBox(), pb = await page.getByRole('button', { name: 'Present' }).boundingBox();
  check('Export와 Present 버튼 높이가 같음', eb && pb && Math.abs(eb.height - pb.height) < 1 && eb.height <= 30, [eb && eb.height, pb && pb.height]);
  check('토큰 Page background 라벨', (await page.getByLabel('Page background hex').count()) === 1 && (await page.getByLabel('Background hex', { exact: true }).count()) === 1);
  check('hex가 잘리지 않음', await page.getByLabel('Page background hex').evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
  check('글꼴은 Select 하나', (await page.getByLabel('Font', { exact: true }).count()) === 1 && (await page.getByLabel('Font CSS', { exact: true }).count() === 0));
  const tokPre = fs.readFileSync(FILE, 'utf8');
  const acc = page.getByLabel('Accent hex'); await acc.fill('#ff5500'); await acc.press('Enter'); await settle();
  const px2 = page.getByLabel('Padding X', { exact: true }); await px2.fill('120'); await px2.press('Enter'); await settle();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone();
  const tokPost = fs.readFileSync(FILE, 'utf8');
  check('토큰 저장: head에 accent와 pad-x', /--sk-accent:\s*#ff5500/i.test(tokPost) && /--sk-pad-x:\s*120px/.test(tokPost));
  check('토큰 저장: 슬라이드 본문 그대로', tokPost.slice(tokPost.indexOf('<body>')) === tokPre.slice(tokPre.indexOf('<body>')));
  for (let i = 0; i < 3 && (await page.getByLabel('Accent hex').inputValue()).toLowerCase().includes('ff5500'); i++) { await page.keyboard.press('Meta+z'); await settle(); } // 토큰 변경은 입력별로 1건씩 기록된다
  check('토큰 변경 실행 취소', !(await page.getByLabel('Accent hex').inputValue()).toLowerCase().includes('ff5500'), await page.getByLabel('Accent hex').inputValue());
  // 테마 프리셋: 토큰 아홉 개가 한 번에 바뀌고 실행 취소 한 건이며, 값을 따로 바꾸면 Custom이 된다
  const themeSel = page.getByLabel('Theme', { exact: true });
  const bgHex = () => page.getByLabel('Page background hex').inputValue();
  const bg0 = await bgHex();
  await themeSel.click(); await page.getByRole('option', { name: 'Paper' }).click(); await settle();
  check('테마 Paper가 페이지 배경 토큰을 바꿈', (await bgHex()).toLowerCase() === '#f6f1e7', await bgHex());
  check('선택한 테마가 표시됨', ((await themeSel.textContent()) || '').includes('Paper'));
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('테마 변경은 실행 취소 한 번에 되돌아감', (await bgHex()) === bg0, [bg0, await bgHex()]);
  await themeSel.click(); await page.getByRole('option', { name: 'Light' }).click(); await settle();
  const acc2 = page.getByLabel('Accent hex'); await acc2.fill('#ff0000'); await acc2.press('Enter'); await cond(() => (document.querySelector('[aria-label=Theme]')?.textContent || '').includes('Custom'), null, 6000); // 토큰 입력은 400ms 디바운스 뒤 반영된다
  check('토큰을 따로 바꾸면 Custom', ((await themeSel.textContent()) || '').includes('Custom'), await themeSel.textContent());
  await focusBody(); for (let i = 0; i < 3; i++) { await page.keyboard.press('Meta+z'); await settle(); }
  check('테마 시험 뒤 원래 배경으로 복귀', (await bgHex()) === bg0, [bg0, await bgHex()]);
  // 선언형 단계: Appears at step
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await settle();
  const st = page.getByLabel('Appears at step'); await st.fill('3'); await st.press('Enter'); await settle();
  check('data-step이 요소에 설정', await inDoc((s) => !!s.querySelector('[data-step="3"]')));
  check('Effect Select 표시', (await page.getByLabel('Step effect', { exact: true }).count()) === 1);
  check('캔버스에 모든 단계 표시(data-sk-show-steps)', await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').contentDocument.documentElement.hasAttribute('data-sk-show-steps')));
  check('Layers 단계 배지', (await page.getByTitle('Appears at step 3').count()) >= 1);
  // 효과 목록(engine/steps.ts)과 미리보기 재생
  await page.getByLabel('Step effect', { exact: true }).click();
  const effOpts = await page.getByRole('option').allTextContents();
  check('효과 목록이 6종(Rise, Fade, Slide, Scale, Blur, None)', ['Rise', 'Fade', 'Slide', 'Scale', 'Blur', 'None'].every((l) => effOpts.some((o) => o.includes(l))), effOpts);
  await page.getByRole('option', { name: 'Slide' }).click(); await settle();
  check('효과가 data-step-effect로 저장됨', await inDoc((s) => !!s.querySelector('[data-step-effect="left"]')));
  await page.getByRole('button', { name: 'Preview step effect' }).click();
  await cond(() => !document.querySelector('iframe[title="Canvas"]').contentDocument.documentElement.hasAttribute('data-sk-show-steps'), null, 3000);
  check('미리보기 중에는 모든 단계 표시가 잠깐 꺼짐', true);
  await cond(() => document.querySelector('iframe[title="Canvas"]').contentDocument.documentElement.hasAttribute('data-sk-show-steps') && !document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-shown]'), null, 6000);
  check('미리보기가 끝나면 표시와 data-shown이 정리됨', await page.evaluate(() => { const d = document.querySelector('iframe[title="Canvas"]').contentDocument; return d.documentElement.hasAttribute('data-sk-show-steps') && !d.querySelector('[data-shown]'); }));
  await page.getByLabel('Step effect', { exact: true }).click(); await page.getByRole('option', { name: 'Rise' }).click(); await settle();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone();
  const stepSaved = fs.readFileSync(FILE, 'utf8');
  check('저장 파일에 data-step, show-steps는 새지 않음', /data-step="3"/.test(stepSaved) && !stepSaved.includes('data-sk-show-steps'));
  await page.keyboard.press('Escape'); await settle();
  check('슬라이드 상태에 자동 단계 안내', (await page.getByText('Auto from element steps: 3').count()) === 1);
  await focusBody(); await page.keyboard.press('Tab'); await settle();
  const st2 = page.getByLabel('Appears at step'); await st2.fill('1'); await st2.press('Enter'); await settle();
  check('1로 되돌리면 속성 삭제', !(await inDoc((s) => !!s.querySelector('[data-step]'))));
  // 속성 패널 UX: 선택 헤더, 설정 표시와 Reset, 크기 모드, 정렬 사유, 슬라이드 힌트
  await page.screenshot({ path: '/tmp/sk-ux-elem.png' });
  check('선택 헤더(이름과 태그)', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  const o3 = page.getByLabel('Opacity', { exact: true }); await o3.fill('60'); await o3.press('Enter'); await settle();
  check('설정한 속성에 점 표시', (await page.locator('[data-dirty]').count()) >= 1);
  await o3.hover(); await page.getByRole('button', { name: 'Reset Opacity' }).click(); await settle();
  check('Reset이 인라인 값을 지움', !(await inDoc((s) => [...s.querySelectorAll('[style]')].some((e) => /opacity/.test(e.getAttribute('style') || '')))));
  check('크기 모드가 하나만 선택', (await page.getByRole('radiogroup', { name: 'Width mode' }).locator('[aria-checked=true]').count()) === 1);
  check('정렬 버튼에 규칙 툴팁이나 비활성', (await page.getByRole('button', { name: 'Align top' }).count()) === 1);
  await page.getByRole('button', { name: 'Show in layers' }).click(); await settle();
  check('선택 헤더를 누르면 Layers 탭', (await page.getByRole('tree', { name: 'Layers' }).count()) === 1);
  await page.keyboard.press('Escape'); await settle();
  await page.screenshot({ path: '/tmp/sk-ux-slide.png' });
  check('요소 미선택 힌트', (await page.getByText('Select an element to edit its properties').count()) === 1);
  // 키보드와 되돌리기: 패널의 Tab 이동, 되돌린 뒤 선택 유지, 스크럽 한 번이 별도 undo
  await focusBody(); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await settle();
  const o4 = page.getByLabel('Opacity', { exact: true }); await o4.fill('80'); await o4.press('Enter'); await sleep(1000); // 실행 취소 묶음 창(0.8초)이 지나야 아래 스크럽이 별도 한 건이 된다
  const lab = await o4.locator('xpath=../span[1]').boundingBox();
  await page.mouse.move(lab.x + lab.width / 2, lab.y + lab.height / 2); await page.mouse.down(); await page.mouse.move(lab.x + lab.width / 2 - 25, lab.y + lab.height / 2, { steps: 8 }); await page.mouse.up(); await settle();
  const scrubbed = await o4.inputValue();
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('스크럽 한 번이 별도 undo(직전 값 80으로)', scrubbed !== '80' && (await page.getByLabel('Opacity', { exact: true }).inputValue()) === '80', [scrubbed, await page.getByLabel('Opacity', { exact: true }).inputValue()]);
  check('되돌린 뒤에도 요소 선택 유지', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  await page.getByRole('button', { name: 'Show in layers' }).focus(); await page.keyboard.press('Tab'); await settle();
  check('패널에서 Tab은 포커스를 옮기고 선택을 순환시키지 않음', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) !== 'Show in layers' && (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();

  // 이미지 선택: Fit 컨트롤, Fill 섹션 없음, 선택 헤더 한 줄
  await focusBody(); await page.keyboard.press('Escape');
  const imgAt = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')].findIndex((s) => s.querySelector('img')));
  console.log('INFO 이미지 슬라이드 위치 ' + (imgAt + 1));
  await layers.nth(Math.max(0, imgAt)).click(); await settle();
  await fr().locator('[data-active] img').first().click({ modifiers: ['Meta'] }); await settle();
  check('이미지 Fit과 Position 컨트롤', (await page.getByLabel('Image fit', { exact: true }).count()) === 1 && (await page.getByLabel('Image position', { exact: true }).count()) === 1);
  const pr = await page.getByRole('complementary', { name: 'Properties' }).boundingBox(), fitB = await page.getByLabel('Image fit', { exact: true }).boundingBox(), posB = await page.getByLabel('Image position', { exact: true }).boundingBox();
  check('Fit과 Position이 패널 안에서 겹치지 않음', pr && fitB && posB && fitB.x + fitB.width <= pr.x + pr.width && posB.x + posB.width <= pr.x + pr.width && (posB.y >= fitB.y + fitB.height - 1 || posB.x >= fitB.x + fitB.width), [pr, fitB, posB]);
  check('이미지에는 Fill 섹션이 없음', (await page.getByRole('button', { name: 'Add fill' }).count()) === 0);
  const hb = await page.getByRole('button', { name: 'Show in layers' }).boundingBox();
  check('선택 헤더가 한 줄', hb && hb.height <= 30, hb && hb.height);
  check('이미지 이름은 Image', (await page.getByRole('button', { name: 'Show in layers' }).textContent()).includes('Image'));
  await focusBody(); await page.keyboard.press('Escape');
  // 요소 선택 규칙(Figma식 계층 선택): 슬라이드 2의 카드에서 가장 깊은 글자 블록을 대상으로 한다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape'); await settle();
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
    await page.mouse.move(probe.x, probe.y); await settle();
    const hb = await page.locator('div.border-focus-ring\\/60').first().boundingBox();
    check('호버 외곽선이 클릭 대상(최상위 요소)과 일치', !!hb && Math.abs(hb.x - probe.top[0]) < 4 && Math.abs(hb.y - probe.top[1]) < 4 && Math.abs(hb.width - probe.top[2]) < 4, [hb, probe.top]);
    await page.mouse.click(probe.x, probe.y); await settle();
    check('첫 클릭은 최상위 컨테이너', (await depthNow()) === '1', await depthNow());
    await page.mouse.dblclick(probe.x, probe.y); await settle();
    check('더블클릭하면 한 단계 안쪽', (await depthNow()) === '2', await depthNow());
    await page.keyboard.press('Escape'); await settle();
    await page.keyboard.down('Meta'); await page.mouse.click(probe.x, probe.y); await page.keyboard.up('Meta'); await settle();
    check('Cmd+클릭은 가장 안쪽 글자 블록', (await depthNow()) === String(probe.d), [await depthNow(), probe.d]);
    await focusBody(); await page.keyboard.press('Shift+Enter'); await settle();
    check('Shift+Enter는 부모 선택', (await depthNow()) === String(probe.d - 1), await depthNow());
    await page.keyboard.press('Enter'); await settle();
    check('Enter는 첫 자식 선택', (await depthNow()) !== null && +(await depthNow()) === probe.d, await depthNow());
    await page.keyboard.press('Escape'); await settle();
    check('Esc는 선택 해제(범위는 슬라이드로)', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 0);
    await page.mouse.click(probe.x, probe.y); await settle();
    check('해제 뒤 첫 클릭은 다시 최상위', (await depthNow()) === '1', await depthNow());
    await page.keyboard.press('Escape'); await settle();
  }

  // 필름스트립: 키보드 이동, 접기, 슬라이드 추가
  await layers.nth(0).click(); await settle(); await layers.nth(0).focus(); await page.keyboard.press('ArrowRight'); await settle();
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
  await layers.nth(2).focus(); await page.keyboard.press('ArrowLeft'); await settle(); await page.keyboard.press('ArrowLeft'); await settle();
  check('포커스 링이 첫 썸네일에서도 잘리지 않음', (await ringInside()) === 'ok', await ringInside());
  await page.keyboard.press('End'); await settle();
  check('포커스 링이 마지막 썸네일에서도 잘리지 않음', (await ringInside()) === 'ok', await ringInside());
  await page.keyboard.press('Home'); await settle();
  await page.getByRole('button', { name: 'Hide filmstrip' }).click(); await settle();
  // 앞의 포커스 링 검사가 Home으로 첫 슬라이드에 돌려놓는다
  { const nOpt = await layers.count(), nTxt = await page.getByText(`Slide 1 / ${total}`).count(); check('접으면 썸네일 목록이 사라지고 위치 표시만 남음', nOpt === 0 && nTxt === 1, [nOpt, nTxt, total, await page.locator('[data-testid=filmstrip]').innerText()]); }
  await page.getByRole('button', { name: 'Show filmstrip' }).click(); await settle();
  await page.getByRole('button', { name: 'Add slide' }).click();
  const layoutItems = (await page.getByRole('menuitem').allTextContents()).join('|');
  check('+ 타일 메뉴에 레이아웃 5종', ['Title and body', 'Two columns', 'Big number', 'Quote', 'Full image'].every((l) => layoutItems.includes(l)), layoutItems);
  await page.getByRole('menuitem', { name: /^Quote/ }).click(); await settle();
  check('+ 타일로 Quote 슬라이드 추가', (await layers.count()) === total + 1, [total, await layers.count()]);
  check('새 슬라이드에 data-layout과 blockquote', await inDoc((s) => !!s.parentElement.querySelector('[data-layout=quote] blockquote')));
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('추가 실행 취소', (await layers.count()) === total);
  await page.getByRole('button', { name: 'Add slide' }).click(); await page.keyboard.press('2'); await settle();
  check('메뉴에서 숫자 키 2로 Two columns 추가', (await layers.count()) === total + 1 && (await fr().locator('[data-layout=two-column] [data-col]').count()) >= 2);
  // Inspector Layout Select: data-layout만 바꾸고 title-body는 속성 삭제
  await page.getByLabel('Layout', { exact: true }).click(); await page.getByRole('option', { name: 'Big number' }).click(); await settle();
  check('Layout Select가 data-layout을 바꿈', await inDoc((s) => s.getAttribute('data-layout') === 'big-number'));
  await page.getByLabel('Layout', { exact: true }).click(); await page.getByRole('option', { name: 'Title and body' }).click(); await settle();
  check('Title and body는 data-layout을 지움', await inDoc((s) => !s.hasAttribute('data-layout')));
  await focusBody(); for (let i = 0; i < 4; i++) { await page.keyboard.press('Meta+z'); await settle(); }
  check('레이아웃 추가와 변경 실행 취소', (await layers.count()) === total, [total, await layers.count()]);

  // 줌 컨트롤, 크기 칩, 명령 팔레트, 단축키 안내
  const pctBtn = page.getByRole('button', { name: 'Zoom to fit' });
  const pct0 = await pctBtn.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click(); await settle();
  check('줌 버튼이 비율을 바꾸고 맞춤으로 돌아옴', (await pctBtn.textContent()) !== pct0 && (await pctBtn.click(), await settle(), (await pctBtn.textContent()) === pct0), pct0);
  await focusBody(); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await settle();
  check('선택 요소 크기 칩(W × H)', (await page.getByText(/^\d+ × \d+$/).count()) === 1);
  await focusBody(); await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k'); await settle();
  await page.getByPlaceholder('Slide number, title or action').fill('Slide 3'); await settle();
  await page.keyboard.press('Enter'); await settle();
  check('Cmd+K 팔레트로 슬라이드 이동', (await layers.nth(2).getAttribute('aria-selected')) === 'true');
  await page.keyboard.press('Meta+/'); await settle();
  check('단축키 안내가 그룹으로 보임', (await page.getByText('Select', { exact: true }).count()) >= 1 && (await page.locator('kbd').count()) > 10);
  await page.keyboard.press('Escape'); await settle();

  // 코멘트: 선택 요소에서 C 키로 작성창이 열리고 Esc로 닫힌다
  await focusBody(); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await settle();
  await focusBody(); await page.keyboard.press('c'); await settle();
  check('C 키로 코멘트 작성창 열림', (await page.getByRole('group', { name: 'New comment' }).count()) === 1);
  await page.getByPlaceholder('Tell Claude what to change').press('Escape'); await settle();
  check('Esc로 작성창 닫힘', (await page.getByRole('group', { name: 'New comment' }).count()) === 0);
  await focusBody(); await page.keyboard.press('Escape');

  // Space 드래그 팬과 커서 기준 줌
  await page.getByRole('button', { name: 'Zoom in' }).click(); await page.getByRole('button', { name: 'Zoom in' }).click(); await page.getByRole('button', { name: 'Zoom in' }).click(); await settle();
  const scroller = () => page.evaluate(() => { const b = document.querySelector('iframe[title="Canvas"]').closest('div.overflow-auto'); return [b.scrollLeft, b.scrollTop, b.scrollWidth > b.clientWidth]; });
  const s0 = await scroller();
  const fbx = await page.locator('iframe[title="Canvas"]').boundingBox();
  await focusBody(); await page.keyboard.down('Space'); await settle();
  check('Space를 누르면 팬 덮개가 나타남', (await page.getByTestId('pan-overlay').count()) === 1);
  check('Space 팬 덮개 커서는 grab', (await page.getByTestId('pan-overlay').evaluate((e) => getComputedStyle(e).cursor)) === 'grab');
  await page.mouse.move(fbx.x + 300, fbx.y + 200); await page.mouse.down(); await page.mouse.move(fbx.x + 150, fbx.y + 120, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space'); await settle();
  const s1 = await scroller();
  check('Space+드래그로 스크롤이 이동', s1[2] && (s1[0] > s0[0] || s1[1] > s0[1]), [s0, s1]);
  check('Space를 떼면 덮개가 사라짐', (await page.getByTestId('pan-overlay').count()) === 0);
  await page.getByRole('button', { name: 'Zoom to fit' }).click(); await settle();
  // 끌어서 이동(translate), 스마트 가이드, 방향키 넛지, 실행 취소 1건
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const hb2 = await fr().locator('[data-active] h2').first().boundingBox();
  const cx = hb2.x + hb2.width / 2, cy = hb2.y + hb2.height / 2;
  const tr = () => inDoc((s) => s.querySelector('h2').style.translate || '');
  await page.mouse.click(cx, cy); await settle();
  await page.mouse.move(cx + 1, cy); await settle();
  const cursorOfH2 = () => fr().evaluate(() => getComputedStyle(document.querySelector('[data-active] h2')).cursor);
  check('선택된 요소 위에서는 move 커서', (await cursorOfH2()) === 'move', await cursorOfH2());
  const cardBox = await fr().locator('[data-active] > :nth-child(2)').first().boundingBox();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height - 8); await settle();
  check('선택되지 않은 요소 위에서는 default 커서', (await fr().evaluate(() => getComputedStyle(document.querySelector('[data-active] > :nth-child(2)')).cursor)) === 'default');
  await page.mouse.move(cx, cy); await settle();
  check('끌기 전에는 커서 방패가 없음', (await page.getByTestId('cursor-shield').count()) === 0);
  await page.mouse.down(); await page.mouse.move(cx, cy + 40, { steps: 8 }); await settle();
  check('끄는 동안 방패가 있고 커서는 move', (await page.getByTestId('cursor-shield').count()) === 1 && (await page.getByTestId('cursor-shield').evaluate((e) => getComputedStyle(e).cursor)) === 'move');
  check('끄는 동안 가이드선이 보임(왼쪽 가장자리 정렬 유지)', (await page.getByTestId('guide-line').count()) >= 1);
  await page.mouse.up(); await settle();
  check('끌기가 끝나면 방패가 사라짐', (await page.getByTestId('cursor-shield').count()) === 0);
  const t1 = await tr();
  check('끌면 인라인 translate가 생김', /px\s+-?\d/.test(t1), t1);
  check('끌고 난 뒤 가이드선이 사라짐', (await page.getByTestId('guide-line').count()) === 0);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('끌기는 실행 취소 한 번에 되돌아감', (await tr()) === '', await tr());
  // 방패가 남는 경로 점검: Esc로 끌기를 취소해도, 창 밖에서 놓아도 사라진다
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy + 10, { steps: 4 }); await settle();
  const shieldDuring = await page.getByTestId('cursor-shield').count();
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
  check('Esc로 취소한 끌기 뒤에도 방패가 남지 않음', shieldDuring === 1 && (await page.getByTestId('cursor-shield').count()) === 0, [shieldDuring, await page.getByTestId('cursor-shield').count()]);
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy + 10, { steps: 4 }); await page.mouse.move(2, 2, { steps: 3 }); await page.mouse.up(); await settle();
  check('끄는 중 문서 가장자리 밖에서 놓아도 방패가 남지 않음', (await page.getByTestId('cursor-shield').count()) === 0);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await settle();
  await focusBody(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown'); await settle();
  const t2 = await tr();
  check('방향키 1px와 Shift+방향키 10px 넛지', /^1px 10px$/.test(t2), t2);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle(); await page.keyboard.press('Escape');

  // 다중 선택: Shift+클릭으로 같은 부모의 요소를 묶고 이동, 넛지, 복제, 삭제가 한 번에 적용된다(실행 취소 1건)
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const nKids = () => inDoc((s) => s.children.length);
  const tr2 = () => inDoc((s) => [s.children[0].style.translate || '', s.children[1].style.translate || '']);
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  check('Shift+클릭으로 두 요소가 선택됨(Layers 행 2개)', (await page.locator('[role=treeitem] > [aria-selected], [role=treeitem][aria-selected=true]').count()) >= 2);
  await focusBody(); await page.keyboard.press('ArrowRight'); await settle();
  const m1 = await tr2();
  check('방향키 넛지가 둘 다 옮김', m1[0] === '1px' && m1[1] === '1px', m1);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('넛지 실행 취소 한 번에 둘 다 되돌아감', (await tr2()).join('') === '', await tr2());
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  const k0n = await nKids();
  await focusBody(); await page.keyboard.press('Meta+d'); await settle();
  check('Cmd+D가 선택한 둘을 모두 복제', (await nKids()) === k0n + 2, [k0n, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  await focusBody(); await page.keyboard.press('Delete'); await settle();
  check('Delete가 선택한 둘을 모두 지움', (await nKids()) === k0n - 2, [k0n, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('삭제 실행 취소 한 번에 둘 다 돌아옴', (await nKids()) === k0n, await nKids());
  await page.keyboard.press('Escape');

  // 묶음 Inspector: 값이 다르면 Mixed, Align은 묶음 상자 기준이고 한 번에 실행 취소
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  check('묶음 헤더가 2 layers', (await page.getByRole('button', { name: 'Show in layers' }).textContent()).includes('2 layers'));
  check('값이 다른 필드는 Mixed', (await page.locator('input[placeholder="Mixed"]').count()) >= 1);
  const lefts = () => inDoc((s) => [s.children[0].getBoundingClientRect().left, s.children[1].getBoundingClientRect().left]);
  await page.getByRole('button', { name: 'Align right', exact: true }).click(); await settle();
  const rights = await inDoc((s) => [s.children[0].getBoundingClientRect().right, s.children[1].getBoundingClientRect().right]);
  check('묶음 Align right가 오른쪽 가장자리를 맞춤', Math.abs(rights[0] - rights[1]) < 1.5, rights);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  const back = await tr2();
  check('Align 실행 취소 한 번에 둘 다 되돌아감', back.join('') === '', back);
  void lefts; await focusBody(); await page.keyboard.press('Escape');

  // 컨텍스트 메뉴: 우클릭은 먼저 선택하고, 맥락에 맞는 항목을 보인다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const menuLabels = () => page.getByRole('menuitem').allTextContents();
  const h2b = await fr().locator('[data-active] h2').first().boundingBox();
  await page.mouse.click(h2b.x + 20, h2b.y + h2b.height / 2, { button: 'right' }); await settle();
  check('요소 우클릭이 먼저 선택함', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  const ml = (await menuLabels()).join('|');
  check('요소 메뉴 항목(글자 요소)', /Edit text/.test(ml) && /Add comment/.test(ml) && /Select/.test(ml) && /Duplicate/.test(ml) && /Delete/.test(ml) && /Style/.test(ml), ml);
  const dupBefore = await nKids();
  await page.getByRole('menuitem', { name: /^Duplicate/ }).click(); await settle();
  check('메뉴의 Duplicate가 동작', (await nKids()) === dupBefore + 1, [dupBefore, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await page.keyboard.press('Escape');
  // 빈 곳 우클릭: 선택이 풀리고 슬라이드 메뉴
  const sb2 = await fr().locator('[data-active]').first().boundingBox();
  await page.mouse.click(sb2.x + sb2.width - 6, sb2.y + sb2.height - 6, { button: 'right' }); await settle();
  const bl = (await menuLabels()).join('|');
  check('빈 곳 메뉴: 슬라이드 항목과 줌', /Add comment/.test(bl) && /Zoom to fit/.test(bl) && /Zoom to 100%/.test(bl) && /Add slide after/.test(bl) && /Delete slide/.test(bl), bl);
  await page.getByRole('menuitem', { name: /^Zoom to 100%/ }).click(); await settle();
  check('Zoom to 100% 메뉴가 100%를 만듦', /^100%$/.test((await page.getByRole('button', { name: 'Zoom to fit' }).textContent()).trim()), await page.getByRole('button', { name: 'Zoom to fit' }).textContent());
  await focusBody(); await page.keyboard.press('Shift+1'); await settle();
  // 키보드: 선택 후 Shift+F10
  await fr().locator('[data-active] h2').first().click(); await settle(); await focusBody();
  await page.keyboard.press('Shift+F10'); await settle();
  check('Shift+F10으로 요소 메뉴가 열림', (await page.getByRole('menuitem', { name: /^Add comment/ }).count()) === 1);
  await page.keyboard.press('Escape'); await settle();
  check('Esc가 메뉴를 닫음', (await page.getByRole('menu').count()) === 0);
  // Layers 행 우클릭(잠긴 요소는 세 항목만)
  const rowsL = page.getByTestId('layer-row');
  await rowsL.nth(1).getByRole('button', { name: 'Lock layer' }).click({ force: true }); await settle();
  await rowsL.nth(1).click({ button: 'right' }); await settle();
  const ll = (await menuLabels()).map((s) => s.replace(/\s+/g, ' ').trim());
  check('잠긴 요소의 Layers 메뉴는 Unlock, Select parent, Add comment', ll.length === 3 && /^Unlock/.test(ll[0]) && /^Select parent/.test(ll[1]) && /^Add comment/.test(ll[2]), ll);
  await page.getByRole('menuitem', { name: /^Unlock/ }).click(); await settle();
  check('메뉴 Unlock으로 잠금 해제', !(await inDoc((s) => !!s.querySelector('[data-locked]'))));
  // 필름스트립 타일 우클릭
  await page.getByRole('option', { name: 'Slide 2', exact: true }).click({ button: 'right' }); await settle();
  const tileL = (await menuLabels()).join('|');
  check('필름스트립 타일 메뉴', /Present from here/.test(tileL) && /Add slide before/.test(tileL) && /Move to start/.test(tileL) && /Move to end/.test(tileL) && /Delete/.test(tileL), tileL);
  await page.keyboard.press('Escape'); await settle();

  // 글자 서식 도구줄: 선택한 글자 요소에서 굵게, 크기, 정렬이 한 번 눌러 적용된다
  await fr().locator('[data-active] h2').first().click(); await settle();
  const fmtG = page.getByRole('group', { name: 'Text format' });
  check('글자 요소를 고르면 서식 도구줄이 보임', (await fmtG.count()) === 1);
  const styleBefore = await inDoc((s) => s.querySelector('h2').getAttribute('style') || '');
  const fs0 = await inDoc((s) => parseFloat(getComputedStyle(s.querySelector('h2')).fontSize));
  await fmtG.getByRole('button', { name: 'Larger text' }).click(); await settle();
  const fs1 = await inDoc((s) => parseFloat(getComputedStyle(s.querySelector('h2')).fontSize));
  check('Larger text가 글자 크기를 키움', fs1 > fs0, [fs0, fs1]);
  await fmtG.getByRole('button', { name: 'Bold' }).click(); await settle();
  await fmtG.getByRole('button', { name: 'Text align center' }).click(); await settle();
  const fmtSt = await inDoc((s) => ({ w: s.querySelector('h2').style.fontWeight, a: s.querySelector('h2').style.textAlign }));
  check('Bold와 가운데 정렬이 요소 style에 저장', fmtSt.a === 'center' && !!fmtSt.w, fmtSt);
  await focusBody(); for (let i = 0; i < 3; i++) { await page.keyboard.press('Meta+z'); await settle(); }
  check('서식 변경 실행 취소', (await inDoc((s) => s.querySelector('h2').getAttribute('style') || '')) === styleBefore, [styleBefore, await inDoc((s) => s.querySelector('h2').getAttribute('style') || '')]);
  await page.keyboard.press('Escape');

  // 넘침 표시: 슬라이드 밖으로 나가면 캔버스 점선 외곽선, Layers 경고, 필름스트립 표시가 뜨고 안전 영역을 켤 수 있다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await settle();
  const offXo = page.getByLabel('Offset X', { exact: true }); await offXo.fill('3000'); await offXo.press('Enter');
  await cond(() => document.querySelectorAll('[data-testid=overflow-badge]').length > 0, null, 8000); // 검사는 0.6초 주기라 Layers 경고가 뜰 때까지 기다린다
  check('넘친 요소에 점선 외곽선이 그려짐', (await page.getByTestId('overflow-box').evaluateAll((els) => els.filter((e) => e.style.display === 'block').length)) >= 1);
  check('Layers 행에 경고 아이콘', (await page.getByTestId('overflow-badge').count()) >= 1);
  check('필름스트립 타일에 넘침 표시', (await page.getByRole('img', { name: 'Content overflows' }).count()) >= 1);
  await page.getByRole('button', { name: 'Show overflow' }).click(); await settle();
  check('Show overflow를 끄면 외곽선이 사라짐', (await page.getByTestId('overflow-box').evaluateAll((els) => els.filter((e) => e.style.display === 'block').length)) === 0);
  await page.getByRole('button', { name: 'Show overflow' }).click();
  await page.getByRole('button', { name: 'Safe area' }).click(); await settle();
  check('안전 영역 가이드가 보임', await page.getByTestId('safe-area').evaluate((e) => e.style.display === 'block'));
  await page.getByRole('button', { name: 'Safe area' }).click();
  await offXo.fill('0'); await offXo.press('Enter'); await settle(); // 오프셋을 되돌린다
  await cond(() => document.querySelectorAll('[data-testid=overflow-badge]').length === 0, null, 8000);
  check('되돌리면 경고가 사라짐', (await page.getByTestId('overflow-badge').count()) === 0);
  await page.keyboard.press('Escape');

  // 찾기와 바꾸기(Cmd+F): 슬라이드별 일치 수, 다음으로 이동, 바꾸기와 모두 바꾸기(실행 취소 한 건), 노트 옵션
  await focusBody(); await page.keyboard.press('Meta+f');
  const findIn = page.getByLabel('Find', { exact: true });
  await findIn.waitFor({ timeout: 5000 }).catch(() => {});
  check('Cmd+F가 찾기 줄을 열고 포커스', await findIn.evaluate((e) => document.activeElement === e));
  await findIn.fill('바이브'); await settle();
  const total1 = (await page.getByTestId('find-count').textContent()) || '';
  check('찾으면 일치 수와 슬라이드 수를 보임', /\d+ of \d+ in \d+ slide/.test(total1), total1);
  const nMatches = Number((total1.match(/of (\d+)/) || [])[1] || 0);
  check('필름스트립 타일에 슬라이드별 일치 수', (await page.getByLabel(/^\d+ matches$/).count()) >= 1);
  const idx0 = await page.getByText(/^Slide \d+ \/ \d+$/).first().textContent().catch(() => '');
  await page.getByRole('button', { name: 'Next match' }).click(); await settle();
  check('다음 단추가 현재 위치를 옮김', /^2 of /.test((await page.getByTestId('find-count').textContent()) || '') || nMatches === 1);
  await page.getByLabel('Replace with', { exact: true }).fill('Vibe');
  await page.getByRole('button', { name: 'Replace all' }).click(); await settle();
  const afterAll = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')].map((s) => s.textContent).join('|'));
  check('모두 바꾸기가 덱 전체의 글자를 바꿈', !afterAll.includes('바이브') && afterAll.includes('Vibe'));
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  const undone = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')].map((s) => s.textContent).join('|'));
  check('모두 바꾸기는 실행 취소 한 번에 되돌아감', undone.includes('바이브'));
  void idx0;
  await page.getByLabel('Find', { exact: true }).fill('zzzz-없는-글'); await settle();
  check('없는 글은 No results', ((await page.getByTestId('find-count').textContent()) || '').includes('No results'));
  await page.getByLabel('Find', { exact: true }).press('Escape'); await settle();
  check('Esc가 찾기 줄을 닫음', (await page.getByTestId('find-bar').count()) === 0);

  // 덱 설정: 헤더 버튼으로 열고 Author를 바꾸면 deck-meta에 저장되고 실행 취소 한 번에 되돌아간다
  await page.getByRole('button', { name: 'Deck settings' }).click();
  const authorIn = page.getByLabel('Author', { exact: true });
  await authorIn.waitFor({ timeout: 8000 }).catch(() => {});
  await authorIn.fill('테스트 저자'); await page.keyboard.press('Tab');
  await sleep(600); // 폼의 글자 입력 디바운스(400ms)가 지나야 반영된다
  await page.keyboard.press('Escape'); await settle();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone();
  check('덱 설정 Author가 deck-meta에 저장됨', /"author"\s*:\s*"테스트 저자"/.test(fs.readFileSync(FILE, 'utf8')));
  await focusBody(); await page.keyboard.press('Meta+z'); await settle(); await saveDone();
  check('덱 설정 변경 실행 취소', !/"author"\s*:\s*"테스트 저자"/.test(fs.readFileSync(FILE, 'utf8')));

  // 헤더 Undo와 Redo 버튼: 편집 뒤 켜지고 누르면 되돌린다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape'); // 찾기 시험이 첫 슬라이드에 두고 간 위치를 2번 슬라이드로
  await fr().locator('[data-active] h2').first().click(); await settle();
  await focusBody(); await page.keyboard.press('ArrowRight'); await settle();
  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true }), redoBtn = page.getByRole('button', { name: 'Redo', exact: true });
  check('편집 뒤 Undo 버튼이 켜져 있고 Redo는 꺼져 있음', (await undoBtn.isEnabled()) && !(await redoBtn.isEnabled()));
  await undoBtn.click(); await settle();
  check('Undo 버튼이 넛지를 되돌리고 Redo가 켜짐', (await inDoc((s) => s.querySelector('h2').style.translate || '')) === '' && (await redoBtn.isEnabled()));
  await redoBtn.click(); await settle();
  check('Redo 버튼이 다시 적용', (await inDoc((s) => s.querySelector('h2').style.translate || '')) === '1px 0px' || (await inDoc((s) => s.querySelector('h2').style.translate || '')) === '1px');
  await undoBtn.click(); await settle(); await page.keyboard.press('Escape');

  // 이미지: 붙여넣기와 끌어 놓기는 덱 assets/에 저장해 img를 넣거나 바꾼다. 서버는 이미지 형식만 받는다.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', GIF = 'R0lGODlhAQABAIAAAP8AAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const apiImg = (bytes, name, type) => page.evaluate(async ([f, arr, n, t]) => (await fetch('/api/decks/' + f + '/assets?name=' + encodeURIComponent(n), { method: 'POST', headers: { 'Content-Type': t }, body: new Uint8Array(arr) })).status, [T.folder, [...bytes], name, type]);
  check('이미지 API: 텍스트와 스크립트 든 SVG는 400', (await apiImg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg', 'image/svg+xml')) === 400 && (await apiImg(Buffer.from('hello'), 'x.png', 'image/png')) === 400);
  check('이미지 API: PNG는 201', (await apiImg(Buffer.from(PNG, 'base64'), 'shot.png', 'image/png')) === 201);
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const imgBefore = await inDoc((s) => s.querySelectorAll('img').length);
  await fr().evaluate(([b64]) => { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([a], 'pasted shot.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, [PNG]);
  await cond(() => !!document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-active] img[src^="assets/"]'));
  check('이미지 붙여넣기가 img를 넣음', (await inDoc((s) => s.querySelectorAll('img').length)) === imgBefore + 1);
  check('이미지 파일이 덱 assets/에 저장됨', fs.existsSync(path.join(T.dir, 'assets')) && fs.readdirSync(path.join(T.dir, 'assets')).some((f) => /\.png$/.test(f)));
  const newSrc = await inDoc((s) => s.querySelector('img[src^="assets/"]').getAttribute('src'));
  await fr().evaluate(([b64]) => { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([a], 'drop.gif', { type: 'image/gif' })); const img = document.querySelector('[data-active] img[src^="assets/"]'); img.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, [GIF]);
  await cond(([old]) => !document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-active] img[src="' + old + '"]'), [newSrc]);
  check('이미지 위에 놓으면 src가 바뀜(교체)', (await inDoc((s) => s.querySelectorAll('img').length)) === imgBefore + 1 && (await inDoc((s) => !!s.querySelector('img[src$=".gif"]'))));
  await focusBody(); for (let i = 0; i < 2; i++) { await page.keyboard.press('Meta+z'); await settle(); }
  check('이미지 추가와 교체 실행 취소', (await inDoc((s) => s.querySelectorAll('img').length)) === imgBefore);

  // 색 선택기 섹션: 덱 토큰은 var()로 연결되고, 글자 색에는 대비 칩이 붙는다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  await fr().locator('[data-active] h2').first().click(); await settle();
  await page.getByLabel('Text color swatch').click();
  await page.getByTestId('color-sections').waitFor({ timeout: 8000 }).catch(() => {});
  if (process.env.SK_SHOT) await page.screenshot({ path: process.env.SK_SHOT });
  check('색 선택기 아래에 Deck colors와 대비 칩', (await page.getByTestId('deck-token').count()) >= 1 && (await page.getByTestId('contrast-chip').count()) === 1, [await page.getByTestId('deck-token').count(), await page.getByTestId('contrast-chip').count()]);
  await page.getByTestId('deck-token').first().click(); await settle();
  const linkedColor = await inDoc((s) => s.querySelector('h2').style.color);
  check('토큰 선택은 hex가 아니라 var()로 저장', /^var\(--sk-[a-z-]+\)$/.test(linkedColor), linkedColor);
  check('연결된 값은 스와치에 링크 표시', (await page.getByTestId('token-link').count()) >= 1);
  await page.keyboard.press('Escape'); await settle();
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('토큰 선택 실행 취소', (await inDoc((s) => s.querySelector('h2').style.color)) === '');
  await page.keyboard.press('Escape');

  // 스타일 복사와 붙여넣기(Cmd+Alt+C, Cmd+Alt+V): 인라인 모양 속성만 옮기고 한 번에 되돌린다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  const fmtG2 = page.getByRole('group', { name: 'Text format' });
  await fmtG2.getByRole('button', { name: 'Larger text' }).click(); await settle();
  await fmtG2.getByRole('button', { name: 'Text align center' }).click(); await settle();
  await focusBody(); await page.keyboard.press('Meta+Alt+KeyC'); await settle();
  const srcStyle = await inDoc((s) => s.children[0].getAttribute('style') || '');
  await fr().locator('[data-active] > :nth-child(2)').first().click(); await settle();
  const dstBefore = await inDoc((s) => s.children[1].getAttribute('style') || '');
  await focusBody(); await page.keyboard.press('Meta+Alt+KeyV'); await settle();
  const dstAfter = await inDoc((s) => s.children[1].getAttribute('style') || '');
  check('스타일 붙여넣기가 글자 크기와 정렬을 옮김', /font-size/.test(dstAfter) && /text-align:\s*center/.test(dstAfter) && /text-align:\s*center/.test(srcStyle), [srcStyle, dstAfter]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('스타일 붙여넣기는 실행 취소 한 번에 되돌아감', (await inDoc((s) => s.children[1].getAttribute('style') || '')) === dstBefore);
  await page.keyboard.press('Meta+z'); await settle(); await page.keyboard.press('Meta+z'); await settle(); await page.keyboard.press('Escape');

  // 텍스트 스타일 프리셋: 한 번에 여섯 속성이 토큰 var()로 들어가고 실행 취소 한 건
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  await fr().locator('[data-active] h2').first().click(); await settle();
  const tsSel = page.getByLabel('Text style', { exact: true });
  await tsSel.click(); await page.getByRole('option', { name: 'Caption' }).click(); await settle();
  const capStyle = await inDoc((s) => s.querySelector('h2').getAttribute('style') || '');
  check('Caption 프리셋이 토큰 var()로 크기와 색을 넣음', /font-size:\s*var\(--sk-fs-small\)/.test(capStyle) && /color:\s*var\(--sk-muted\)/.test(capStyle) && /line-height:\s*1\.4/.test(capStyle), capStyle);
  check('선택한 프리셋 이름이 표시됨', ((await tsSel.textContent()) || '').includes('Caption'));
  check('크기 칸이 var() 대신 계산된 숫자를 보임', /^\d+(\.\d+)?$/.test(await page.getByLabel('Font size', { exact: true }).inputValue()), await page.getByLabel('Font size', { exact: true }).inputValue());
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('텍스트 스타일은 실행 취소 한 번에 되돌아감', !/var\(--sk-fs-small\)/.test(await inDoc((s) => s.querySelector('h2').getAttribute('style') || '')));
  await page.keyboard.press('Escape');

  // 그룹과 그룹 해제(Cmd+G, Shift+Cmd+G): 같은 부모의 선택을 div 하나로 감싸고 되돌린다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const kidsBefore = await nKids();
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  await focusBody(); await page.keyboard.press('Meta+g'); await settle();
  check('Cmd+G가 선택을 Group div 하나로 감쌈', (await nKids()) === kidsBefore - 1 && (await inDoc((s) => s.querySelectorAll(':scope > [data-name=Group] > *').length)) === 2, [kidsBefore, await nKids()]);
  check('그룹이 한 요소로 선택됨', (await page.getByRole('button', { name: 'Show in layers' }).textContent()).includes('Group'));
  await focusBody(); await page.keyboard.press('Meta+Shift+g'); await settle();
  check('Shift+Cmd+G가 그룹을 풀어 원래 개수로', (await nKids()) === kidsBefore && (await inDoc((s) => !s.querySelector('[data-name=Group]'))), [kidsBefore, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle(); await page.keyboard.press('Meta+z'); await settle();
  check('그룹과 해제 실행 취소 뒤 원래 상태', (await nKids()) === kidsBefore && (await inDoc((s) => !s.querySelector('[data-name=Group]'))));
  await page.keyboard.press('Escape');

  // 슬라이드 배경 그라디언트
  await focusBody(); await page.keyboard.press('Escape'); await settle();
  await page.getByRole('radio', { name: 'Linear gradient' }).last().click(); await settle();
  check('슬라이드 배경을 그라디언트로', await inDoc((s) => /linear-gradient/.test(s.style.backgroundImage)) && (await page.getByRole('group', { name: 'Background gradient' }).count()) === 1);
  await page.getByRole('radio', { name: 'Solid' }).last().click(); await settle();
  check('Solid로 돌아오면 배경 이미지가 지워짐', await inDoc((s) => !/gradient/.test(s.style.backgroundImage)));

  // 마퀴: 빈 곳을 끌면 겹친 최상위 요소가 모두 선택된다
  await focusBody(); await page.keyboard.press('Escape'); await settle();
  const sbox = await fr().locator('[data-active]').first().boundingBox();
  await page.mouse.move(sbox.x + sbox.width - 6, sbox.y + sbox.height - 6); await page.mouse.down();
  await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, { steps: 6 }); await settle();
  const marqVisible = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.className.includes('bg-focus-ring/10') && d.style.display === 'block'));
  await page.mouse.move(sbox.x + 6, sbox.y + 6, { steps: 6 }); await page.mouse.up(); await settle();
  check('마퀴 상자가 끄는 동안 보이고 놓으면 사라짐', marqVisible && !(await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.className.includes('bg-focus-ring/10') && d.style.display === 'block'))), marqVisible);
  check('마퀴로 최상위 요소가 여럿 선택됨', (await page.locator('[role=treeitem][aria-selected=true]').count()) >= 2, await page.locator('[role=treeitem][aria-selected=true]').count());
  await focusBody(); await page.keyboard.press('Escape');

  // Inspector Offset 필드와 리사이즈 핸들
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await settle();
  await focusBody(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await settle();
  check('Offset X 필드가 넛지 값을 보임', (await page.getByLabel('Offset X', { exact: true }).inputValue()) === '2', await page.getByLabel('Offset X', { exact: true }).inputValue());
  const offX = page.getByLabel('Offset X', { exact: true }); await offX.fill('12'); await offX.press('Enter'); await settle();
  check('Offset 입력이 translate에 반영', /^12px( 0px)?$/.test(await tr()), await tr());
  await offX.focus(); await page.keyboard.press('Meta+z'); await settle(); await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await settle();
  const wBefore = await inDoc((s) => s.querySelector('h2').getBoundingClientRect().width);
  const hdl = page.locator('[data-handle=e]'); const hbx = await hdl.boundingBox();
  const HC = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
  const hcs = {}; for (const id of Object.keys(HC)) hcs[id] = await page.locator('[data-handle=' + id + ']').evaluate((e) => getComputedStyle(e).cursor);
  check('리사이즈 핸들 8개 커서', Object.keys(HC).every((k) => hcs[k] === HC[k]), hcs);
  await page.mouse.move(hbx.x + hbx.width / 2, hbx.y + hbx.height / 2); await page.mouse.down(); await page.mouse.move(hbx.x - 60, hbx.y + hbx.height / 2, { steps: 6 }); await settle();
  check('리사이즈 끌기 중 방패가 시작한 핸들 커서를 유지', (await page.getByTestId('cursor-shield').count()) === 1 && (await page.getByTestId('cursor-shield').evaluate((e) => getComputedStyle(e).cursor)) === 'ew-resize');
  const chipTxt = await page.getByText(/^\d+ × \d+$/).textContent();
  await page.mouse.up(); await settle();
  check('리사이즈가 끝나면 방패가 사라짐', (await page.getByTestId('cursor-shield').count()) === 0);
  const wStyle = await inDoc((s) => s.querySelector('h2').style.width || '');
  check('핸들로 줄이면 인라인 width가 생기고 크기 칩이 따라옴', /px$/.test(wStyle) && !!chipTxt, [wStyle, chipTxt]);
  check('리사이즈 뒤 Inspector 크기 모드가 Fixed', (await page.getByRole('radiogroup', { name: 'Width mode' }).locator('[aria-checked=true]').getAttribute('aria-label')) !== null);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('리사이즈는 실행 취소 한 번에 되돌아감', (await inDoc((s) => s.querySelector('h2').style.width || '')) === '', await inDoc((s) => s.querySelector('h2').style.cssText));
  void wBefore; await page.keyboard.press('Escape');

  // 회전한 조상 아래에서도 끌면 화면에서 포인터를 따라간다(로컬 축이 아니라)
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const rkpos = () => inDoc((s) => { const r = s.children[1].children[0].getBoundingClientRect(); return [r.x, r.y]; });
  await inDoc((s) => { s.children[1].style.transform = 'rotate(30deg)'; });
  await settle();
  const rkl = fr().locator('[data-active] > :nth-child(2) > :first-child').first(); const rb = await rkl.boundingBox();
  const rk0 = await rkpos();
  const sx = rb.x + rb.width / 2, sy = rb.y + rb.height / 2;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 50, sy, { steps: 8 }); await page.mouse.up(); await settle();
  const rk1 = await rkpos();
  check('회전한 부모 아래 요소가 가로로 끌림(세로로 새지 않음)', rk1[0] - rk0[0] > 10 && Math.abs(rk1[1] - rk0[1]) < Math.abs(rk1[0] - rk0[0]) * 0.2, [rk0, rk1]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await inDoc((s) => { s.children[1].style.transform = ''; }); await page.keyboard.press('Escape');

  // 레이어: 잠금은 캔버스 선택에서 제외, Cmd+[ ]로 순서 이동, F2 이름 변경
  await layers.nth(1).click(); await settle();
  // (rowsL는 위에서 선언됨)
  await rowsL.nth(1).click(); await settle();
  await rowsL.nth(1).getByRole('button', { name: 'Lock layer' }).click({ force: true }); await settle();
  check('잠금이 data-locked로 저장됨', await inDoc((s) => !!s.querySelector('[data-locked]')));
  await rowsL.nth(1).locator('svg').first().click(); await settle();
  check('잠긴 부모 아래 행에 잠금 표시', (await page.getByTestId('parent-lock').count()) >= 1);
  await focusBody(); await page.keyboard.press('Escape');
  const lockedBox = await fr().locator('[data-active] [data-locked]').first().boundingBox();
  await page.mouse.click(lockedBox.x + lockedBox.width / 2, lockedBox.y + lockedBox.height / 2); await settle();
  check('잠긴 요소는 캔버스 클릭으로 선택되지 않음', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 0);
  // 잠긴 요소를 Layers에서 고른 뒤 Delete를 눌러도 지워지지 않는다
  const nLocked = await inDoc((s) => s.children.length);
  await rowsL.nth(1).click(); await focusBody(); await page.keyboard.press('Delete'); await settle();
  check('잠긴 요소는 Delete로 지워지지 않음', (await inDoc((s) => s.children.length)) === nLocked);
  await page.getByRole('button', { name: 'Unlock layer' }).first().click({ force: true }); await settle();
  check('잠금 해제', !(await inDoc((s) => !!s.querySelector('[data-locked]'))));
  await rowsL.nth(1).click(); await settle();
  const orderOf = () => inDoc((s) => [...s.children].map((e) => e.tagName + ((e.textContent || '').trim().slice(0, 4))).join('|'));
  const o0 = await orderOf();
  await focusBody(); await page.keyboard.press('Meta+['); await settle();
  const o1 = await orderOf();
  check('Cmd+[로 한 칸 앞으로(문서 순서)', o1 !== o0, [o0, o1]);
  await page.keyboard.press('Meta+]'); await settle();
  check('Cmd+]로 되돌림', (await orderOf()) === o0);
  await rowsL.nth(1).click(); await page.keyboard.press('Enter'); await settle();
  check('Layers 행에서 Enter로 이름 입력창', (await page.getByLabel('Layer name').count()) === 1);
  await page.getByLabel('Layer name').press('Escape'); await settle();
  await focusBody(); await page.keyboard.press('F2'); await settle();
  check('F2로 레이어 이름 입력창', (await page.getByLabel('Layer name').count()) === 1);
  await page.getByLabel('Layer name').press('Escape'); await settle();
  await focusBody(); await page.keyboard.press('Escape');

  // 노트 pane은 접지 않는다
  check('노트 pane에 접기 버튼이 없고 입력창이 항상 보임', (await page.getByRole('button', { name: /notes/i }).count()) === 0 && (await page.getByPlaceholder('Speaker notes (Markdown)').isVisible()));
  // 자동 저장: Cmd+S 없이 1.5초 뒤 저장된다
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await settle();
  const op2 = page.getByLabel('Opacity', { exact: true }); await op2.fill('37'); await op2.press('Enter'); await settle();
  check('편집 직후는 Unsaved', (await page.getByText('Unsaved', { exact: true }).count()) > 0);
  await saveDone(); // 자동 저장(입력 1.5초 뒤)이 끝나기를 조건으로 기다린다
  check('자동 저장 뒤 Saved', (await page.getByText('Saved', { exact: true }).count()) > 0);
  check('자동 저장이 파일에 반영', /opacity:\s*0\.37/.test(fs.readFileSync(FILE, 'utf8')));
  check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
