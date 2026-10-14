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
  await ctx.addInitScript(() => { try { localStorage.setItem('slidekit.tip.editor', '1'); } catch {} }); // 첫 열기 안내 카드가 상단 가운데를 가리지 않게(카드 검사는 별도)
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
  // 첫 열기 안내 카드: 카드가 열린 첫 상태에서 필름스트립 타일, Layers 행, 줌 단추, 노트, Inspector 탭과 겹치지 않는다(상자 교차와 중심점 hit-test 둘 다)
  {
    const ctxT = await browser.newContext({ viewport: { width: 1440, height: 900 } }); // 카드를 닫아 두지 않은 새 컨텍스트
    await ctxT.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const pt = await ctxT.newPage();
    await pt.goto(BASE + '/edit/' + T.id);
    await pt.getByRole('region', { name: 'Editor tips' }).waitFor({ timeout: 10000 }).catch(() => {});
    await pt.locator('[data-testid=layer-row]').first().waitFor({ timeout: 10000 }).catch(() => {});
    const tipRes = await pt.evaluate(() => {
      const tip = document.querySelector('[aria-label="Editor tips"]');
      if (!tip) return { shown: false };
      const tr = tip.getBoundingClientRect();
      const targets = { 'filmstrip tile': '[data-testid=filmstrip] [role=option]', 'layers row': '[data-testid=layer-row]', 'zoom in': '[aria-label="Zoom in"]', 'zoom to fit': '[aria-label="Zoom to fit"]', notes: '[placeholder="Speaker notes (Markdown)"]', 'inspector tab': '[role=tab]' };
      const out = { shown: true, overlap: [], covered: [] };
      for (const [name, sel] of Object.entries(targets)) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.left < tr.right && tr.left < r.right && r.top < tr.bottom && tr.top < r.bottom) out.overlap.push(name);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && tip.contains(hit)) out.covered.push(name);
      }
      return out;
    });
    check('첫 열기 안내 카드가 보임', tipRes.shown, tipRes);
    check('안내 카드가 필름스트립, Layers, 줌, 노트, Inspector와 겹치지 않음', tipRes.shown && tipRes.overlap.length === 0 && tipRes.covered.length === 0, tipRes);
    await ctxT.close();
  }
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
  const inDoc = (fn, arg) => page.evaluate(([f, a]) => { const d = document.querySelector('iframe[title="Canvas"]').contentDocument; return eval('(' + f + ')')(d.querySelector('[data-active]'), a); }, [fn.toString(), arg]); // 현재 슬라이드 안에서 함수를 돌린다
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
  await focusBody(); for (let i = 0; i < 4 && (await layers.count()) !== total; i++) { await page.keyboard.press('Meta+z'); await settle(); } // 추가한 슬라이드가 사라질 때까지만 되돌린다
  check('레이아웃 추가와 변경 실행 취소', (await layers.count()) === total, [total, await layers.count()]);
  // 코멘트: 선택 요소에서 C 키로 작성창이 열리고 Esc로 닫힌다
  await focusBody(); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await settle();
  await focusBody(); await page.keyboard.press('c'); await settle();
  check('C 키로 코멘트 작성창 열림', (await page.getByRole('group', { name: 'New comment' }).count()) === 1);
  await page.getByPlaceholder('Tell Claude what to change').press('Escape'); await settle();
  check('Esc로 작성창 닫힘', (await page.getByRole('group', { name: 'New comment' }).count()) === 0);
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
