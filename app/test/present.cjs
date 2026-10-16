/* 발표 흐름 브라우저 검증: 발표자 화면, ?sync=1 발표 창, 키, 타이머, 동기화, 창 닫힘, 외장 모니터 없음 폴백.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node present.cjs */
const { launch, tick } = require('../../scripts/lib/pw.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
// 편집 테스트가 건드리지 않도록 전용 덱(30장)을 만들어 쓰고 끝에 지운다.
const DECK = '_e2e-present', ID = 'e2e-present', TOTAL = 30;
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'decks', DECK);
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${ID}</title>
<script type="application/json" id="deck-meta">{ "title": "${ID}", "id": "${ID}" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"></head><body>
<section data-slide="cover"><h1>Cover</h1><aside data-notes>Notes for cover</aside></section>
${Array.from({ length: TOTAL - 1 }, (_, i) => i === 3 ? '<section data-slide="chapter" data-title="Middle"><h1>Middle</h1></section>' : `<section data-slide="content"><h2>Slide ${i + 2}</h2></section>`).join('\n')}
<script src="../../engine/slidekit.js"></script></body></html>`);
// 노트가 하나도 없는 덱: 발표 전 점검이 한 번 묻는다.
const DECK2 = '_e2e-present-nonotes', ID2 = 'e2e-present-nonotes', DIR2 = path.join(__dirname, '..', '..', 'decks', DECK2);
fs.mkdirSync(DIR2, { recursive: true });
fs.writeFileSync(path.join(DIR2, 'index.html'), fs.readFileSync(path.join(DIR, 'index.html'), 'utf8').replaceAll(ID, ID2).replace(/<aside data-notes>[^<]*<\/aside>/, ''));
// 슬라이드가 0장인 덱: 빈 칸 대신 안내와 편집기로 가는 단추가 보인다.
const DECK3 = '_e2e-present-zero', ID3 = 'e2e-present-zero', DIR3 = path.join(__dirname, '..', '..', 'decks', DECK3);
fs.mkdirSync(DIR3, { recursive: true });
fs.writeFileSync(path.join(DIR3, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${ID3}</title><script type="application/json" id="deck-meta">{ "title": "${ID3}", "id": "${ID3}" }</script><link rel="stylesheet" href="../../engine/slidekit.css"></head><body><script src="../../engine/slidekit.js"></script></body></html>`);
// 단계(data-step) 요소와 visibility:visible 자손이 있는 덱: 빠르게 앞뒤로 움직인 뒤 비활성 슬라이드의 요소가 보이지 않는지 본다.
const DECK4 = '_e2e-present-steps', ID4 = 'e2e-present-steps', DIR4 = path.join(__dirname, '..', '..', 'decks', DECK4);
fs.mkdirSync(DIR4, { recursive: true });
fs.writeFileSync(path.join(DIR4, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${ID4}</title><script type="application/json" id="deck-meta">{ "title": "${ID4}", "id": "${ID4}" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"></head><body>
<section data-slide="cover"><h1>Cover</h1><aside data-notes>Notes for cover</aside></section>
<section data-slide="content"><h2>Steps</h2><figure data-step="2" style="visibility:visible">Photo</figure><div data-step="2" style="--sk-step-delay:200ms">Delayed</div><p data-step="3" data-step-out="4">Third</p><span data-step-out="3">Exiting</span><div style="visibility:visible">Always</div></section>
<section data-slide="content"><h2>Plain</h2><span style="visibility:visible;transition:visibility 2s">Late</span></section>
<section data-slide="content"><h2>Four</h2></section>
<script src="../../engine/slidekit.js"></script></body></html>`);
process.on('exit', () => { fs.rmSync(DIR, { recursive: true, force: true }); fs.rmSync(DIR2, { recursive: true, force: true }); fs.rmSync(DIR3, { recursive: true, force: true }); fs.rmSync(DIR4, { recursive: true, force: true }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
let __last = Date.now(); // TIMING=1이면 직전 검사 이후 1.5초 넘게 걸린 구간을 보여 준다(느린 단계 찾기)
const check = (name, ok, extra) => { if (process.env.TIMING) { const n = Date.now(); if (n - __last > 1500) console.log('SLOW +' + (n - __last) + 'ms before: ' + name); __last = n; } if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };

// getScreenDetails 모킹: 미지원, 거부, 모니터 하나뿐
const MOCKS = {
  unsupported: `delete window.getScreenDetails;`,
  denied: `window.getScreenDetails = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));`,
  'single screen': `{ const s = { availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 800 }; window.getScreenDetails = async () => ({ screens: [s], currentScreen: s }); }`,
};

(async () => {
  const browser = await launch();
  const errors = [];
  let first = true;
  for (const [name, mock] of Object.entries(MOCKS)) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(mock);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/present/${ID}`);
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    check(`[${name}] 발표자 화면이 슬라이드 수를 읽는다`, await until(async () => (await counter()) === `1 / ${TOTAL}`), await counter().catch(() => null));

    if (first) {
      // 키 이동, 타이머, 장 위치
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      check('방향키로 이동', await until(async () => (await counter()) === `3 / ${TOTAL}`), await counter());
      await page.keyboard.press('ArrowLeft');
      check('왼쪽 키로 되돌아감', await until(async () => (await counter()) === `2 / ${TOTAL}`));
      const timer = () => page.locator('[role=timer]').first().innerText();
      await page.clock.install(); // 이후 시간은 tick으로 앞당긴다(실시간 대기 없음)
      await page.keyboard.press('t'); await tick(page, 2300); await page.keyboard.press('t');
      const t1 = await timer();
      check('T로 타이머 시작과 정지', /^00:00:0[12]$/.test(t1), t1);
      await tick(page, 1500);
      check('정지하면 시간이 멈춘다', (await timer()) === t1);
      await page.keyboard.press('r');
      check('R 한 번은 리셋하지 않고 안내한다', (await timer()) === t1 && (await page.getByText('Press R again to reset the timer').count()) === 1, await timer());
      await page.keyboard.press('r');
      check('R 두 번째로 리셋', (await timer()) === '00:00:00', await timer());
      await page.keyboard.press('+');
      const size = () => page.locator('[aria-label="Speaker notes"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      const s1 = await size(); await page.keyboard.press('-'); await page.keyboard.press('-');
      check('+ - 로 노트 크기 조절', (await size()) === s1 - 4, [s1, await size()]);
      first = false;
    }

    // 발표 시작: 외장 모니터가 없거나 권한이 없으면 일반 새 창으로 열린다
    const base = Number((await counter()).split(' / ')[0]);
    const popupP = ctx.waitForEvent('page', { timeout: 5000 });
    await page.getByRole('button', { name: 'Present' }).click();
    const pop = await popupP.catch(() => null);
    check(`[${name}] 폴백으로 발표 창이 열린다`, !!pop);
    if (!pop) { await ctx.close(); continue; }
    pop.on('pageerror', (e) => errors.push(String(e)));
    check(`[${name}] 발표 창은 ?sync=1 덱 페이지`, pop.url().includes(`/decks/${DECK}/`) && pop.url().includes('sync=1'), pop.url());
    await pop.waitForLoadState('load');
    const note = { unsupported: 'Display access unavailable', denied: 'Display access unavailable', 'single screen': 'No external display found' }[name];
    check(`[${name}] 폴백 사유 표시`, await until(async () => ((await page.getByRole('status').filter({ hasText: note }).innerText()) || '').includes(note)), await page.getByRole('status').filter({ hasText: note }).innerText().catch(() => null));
    check(`[${name}] 발표 창 열림 표시`, await until(async () => (await page.getByText('Presentation window open').count()) === 1));
    // 위치 복원, 양방향 동기화, 닫힘 표시는 변형마다 되풀이할 필요가 없어 첫 변형(unsupported)에서만 본다(폴백 사유와 창 열림은 모두 본다).
    if (name !== 'unsupported') { await pop.close(); await ctx.close(); continue; }
    // 발표 창이 시작할 때 hello로 위치를 받는다
    const hash = () => new URL(pop.url()).hash;
    check(`[${name}] 발표 창이 발표자 위치로 맞춰진다`, await until(async () => hash() === `#${base}`), [hash(), base]);
    await page.bringToFront(); await page.keyboard.press('ArrowRight');
    check(`[${name}] 발표자 -> 발표 창 동기화`, await until(async () => hash() === `#${base + 1}`), hash());
    await pop.bringToFront(); await pop.keyboard.press('ArrowRight');
    await page.bringToFront();
    check(`[${name}] 발표 창 -> 발표자 동기화`, await until(async () => (await counter()) === `${base + 2} / ${TOTAL}`), await counter());
    if (name === 'unsupported') {
      // 발표 창이 매우 느릴 때(부하): 하트비트에 대한 늦은 답이 옛 위치를 싣고 와도 발표자 화면이 되돌아가지 않아야 한다
      const slow = await ctx.newCDPSession(pop); await slow.send('Emulation.setCPUThrottlingRate', { rate: 40 });
      const c0 = Number((await counter()).split(' / ')[0]);
      await page.bringToFront(); await page.keyboard.press('ArrowRight'); await sleep(250); await page.keyboard.press('ArrowRight');
      await until(async () => (await counter()) === `${c0 + 2} / ${TOTAL}`);
      await sleep(4500); // 느린 발표 창의 하트비트 답(옛 위치)이 도착할 시간
      check(`[${name}] 느린 발표 창의 늦은 답이 발표자 위치를 되돌리지 않는다`, (await counter()) === `${c0 + 2} / ${TOTAL}`, await counter());
      await slow.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      // 결정적 재현: 이동 직후(위치 갱신 전) 발표 창이 옛 위치를 알려 오는 경우를 같은 틱에 끼워 넣는다
      const c1 = Number((await counter()).split(' / ')[0]);
      await page.evaluate(({ id, c1 }) => {
        const bc = new BroadcastChannel(`slidekit:${id}`);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        bc.postMessage({ v: 1, from: 'e2e-stale', role: 'audience', type: 'state', slide: c1, step: 1 });
        setTimeout(() => bc.close(), 500);
      }, { id: ID, c1 });
      await sleep(1500);
      check(`[${name}] 이동 직후 도착한 옛 위치 보고는 따르지 않는다`, (await counter()) === `${c1 + 1} / ${TOTAL}`, await counter());
      // 결정적(느림에 의존하지 않음): 번호 n짜리 hello를 보낸 뒤 이동했다면, 시간 창이 지난 뒤에 도착한 re:n 답은 옛 위치라 따르지 않는다. 그 뒤의 hello 번호(새 답)는 따른다.
      const c2 = Number((await counter()).split(' / ')[0]);
      const helloN = await page.evaluate(({ id }) => new Promise((res) => {
        const bc = new BroadcastChannel(`slidekit:${id}`);
        bc.onmessage = (e) => { const m = e.data; if (m && m.type === 'hello' && m.role === 'presenter' && typeof m.n === 'number') { bc.close(); res(m.n); } };
        setTimeout(() => { bc.close(); res(null); }, 3000);
      }), { id: ID });
      check(`[${name}] 하트비트 hello에 번호 n이 붙는다`, typeof helloN === 'number', helloN);
      // 단계가 있는 장에서는 다음(ArrowRight)이 장 번호를 안 바꾸므로 이전(ArrowLeft)으로 장 번호가 바뀌게 한다
      await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
      const movedOk = await until(async () => (await counter()) === `${c2 - 1} / ${TOTAL}`);
      await sleep(2200); // 이동 후 1초, 하트비트 후 0.8초 창을 모두 넘긴다
      // 같은 채널을 듣는 실제 발표 창도 이 메시지를 받으므로, 다음 하트비트 직후(발표 창의 다음 답이 1초 뒤)에 넣고 곧바로 본다.
      await page.evaluate(({ id, c2, n }) => new Promise((res) => {
        const bc = new BroadcastChannel(`slidekit:${id}`);
        bc.onmessage = (e) => { const m = e.data; if (m && m.type === 'hello' && m.role === 'presenter') { bc.postMessage({ v: 1, from: 'e2e-late', role: 'audience', type: 'state', slide: c2, step: 1, re: n }); setTimeout(() => { bc.close(); res(); }, 100); } };
        setTimeout(() => { bc.close(); res(); }, 3000);
      }), { id: ID, c2, n: helloN });
      await sleep(300);
      check(`[${name}] 이동 전 hello(re:n)에 대한 늦은 답은 시간이 지나도 따르지 않는다`, movedOk && (await counter()) === `${c2 - 1} / ${TOTAL}`, [movedOk, await counter()]);
      await page.evaluate(({ id, c2 }) => { const bc = new BroadcastChannel(`slidekit:${id}`); bc.postMessage({ v: 1, from: 'e2e-plain', role: 'audience', type: 'state', slide: c2 + 3, step: 1 }); setTimeout(() => bc.close(), 500); }, { id: ID, c2 });
      check(`[${name}] re가 없는 보고는 지금처럼 따른다(옛 창 호환)`, await until(async () => (await counter()) === `${c2 + 3} / ${TOTAL}`), await counter());
    }
    await pop.close();
    check(`[${name}] 발표 창 닫힘 표시`, await until(async () => (await page.getByText('Presentation window closed').count()) === 1, 5000)); // 하트비트 유예(1.6초)를 포함
    await ctx.close();
  }
  // 이미 12번에 있는 발표 창에 발표자 화면이 붙으면 12번으로 시작한다. 보기를 꺼도 이동과 동기화가 유지된다. 반복 입력 무시.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const pop = await ctx.newPage();
    await pop.goto(`${BASE}/decks/${DECK}/index.html?sync=1#12`);
    await pop.waitForFunction(() => location.hash === '#12' && document.readyState === 'complete'); // 엔진이 동기화 채널을 연 뒤
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/present/${ID}`);
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    check('열려 있는 발표 창 위치(12)로 시작', await until(async () => (await counter()) === `12 / ${TOTAL}`), await counter().catch(() => null));
    await page.getByRole('switch', { name: 'Current slide' }).click();
    await page.getByRole('switch', { name: 'Next slide' }).click();
    await page.mouse.click(640, 780); // 스위치 포커스를 벗어난다(위젯에 포커스가 있으면 화살표와 단축키는 그 위젯의 것이다)
    await page.keyboard.press('ArrowRight');
    check('보기를 꺼도 방향키 이동이 유지된다', await until(async () => (await counter()) === `13 / ${TOTAL}`), await counter());
    check('보기를 꺼도 발표 창과 동기화된다', await until(async () => new URL(pop.url()).hash === '#13'), pop.url());
    await page.bringToFront(); // 발표 창이 늦게 떠서 포커스를 가져가면 키가 빠질 수 있다(다른 구간과 같게 앞으로 가져온다)
    await page.mouse.click(640, 780);
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
    await until(async () => (await counter()) !== `13 / ${TOTAL}`, 10000); // 부하 때 iframe 왕복이 늦을 수 있다
    await sleep(300); // 반복 입력이 더 넘기지 않는지 보려고 짧게 둔다(일어나지 않음 확인)
    check('방향키 반복 입력은 한 장만 넘긴다', (await counter()) === `14 / ${TOTAL}`, await counter());
    await page.keyboard.down('t'); await page.keyboard.down('t'); await page.keyboard.up('t');
    check('T 반복 입력은 한 번만 토글한다', await until(async () => (await page.locator('[role=timer]').first().innerText()) !== '00:00:00', 5000)); // 두 번 토글됐다면 시작하자마자 멈춰 0으로 남는다
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/present/${ID3}`, { waitUntil: 'domcontentloaded' });
    check('슬라이드 0장 덱은 안내와 편집기 단추를 보인다', await until(async () => (await page.getByText('This deck has no slides').count()) === 1 && (await page.getByRole('button', { name: 'Open in editor' }).count()) === 1));
    await page.getByRole('button', { name: 'Open in editor' }).click();
    check('Open in editor는 편집기로 간다', await until(async () => new URL(page.url()).pathname === `/edit/${ID3}`), page.url());
    await ctx.close();
  }
  // 발표 전 점검: 노트가 없으면 한 번 묻고(Cancel로 돌아가거나 Present anyway로 시작), 노트가 있으면 묻지 않는다
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/present/${ID2}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Before you present' });
    check('노트가 없으면 발표 전 점검이 묻는다', await until(async () => (await dlg.count()) === 1 && /No slide has speaker notes/.test(await dlg.innerText())));
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    check('Cancel은 발표를 시작하지 않는다', await until(async () => (await dlg.count()) === 0) && ctx.pages().length === 1);
    const popP = ctx.waitForEvent('page', { timeout: 8000 });
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    await page.getByRole('button', { name: 'Present anyway' }).click();
    check('Present anyway는 발표 창을 연다', !!(await popP.catch(() => null)));
    await ctx.close();
  }
  // 팔레트(Cmd+K)와 단축키 안내('?')
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/present/${ID}`, { waitUntil: 'domcontentloaded' });
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    await until(async () => (await counter()) === `1 / ${TOTAL}`);
    const pal = page.getByRole('dialog', { name: 'Search' });
    const openPal = async (q) => { await page.keyboard.press('Control+k'); await pal.getByRole('combobox').fill(q); };
    await openPal('12');
    check('Cmd+K 팔레트가 열리고 번호로 슬라이드를 찾는다', await until(async () => (await pal.getByRole('option', { name: /^12\. / }).count()) >= 1));
    await page.keyboard.press('Enter');
    check('Enter로 그 슬라이드로 이동', await until(async () => (await counter()) === `12 / ${TOTAL}`), await counter());
    check('팔레트는 이동 뒤 닫힌다', await until(async () => (await pal.count()) === 0));
    await openPal('2');
    check('숫자만 치면 번호가 그 숫자로 시작하는 슬라이드만 나온다(노트 속 숫자가 앞지르지 않음)', await until(async () => (await pal.getByRole('option', { name: /^\d+\. / }).count()) === 11) && (await pal.getByRole('option', { name: /^\d+\. / }).evaluateAll((els) => els.every((e) => /^2/.test(e.textContent)))), await pal.getByRole('option', { name: /^\d+\. / }).count());
    await page.keyboard.press('Escape'); await until(async () => (await pal.count()) === 0);
    await openPal('Notes for cover');
    await page.keyboard.press('Enter');
    check('노트 글자로 찾아 이동한다', await until(async () => (await counter()) === `1 / ${TOTAL}`), await counter());
    await openPal('Middle');
    check('팔레트: 장 제목으로 찾는다(그룹 Chapters)', await until(async () => (await pal.getByRole('option', { name: /^Middle\s*Chapter/ }).count()) >= 1));
    await pal.getByRole('option', { name: /^Middle\s*Chapter/ }).first().click();
    check('장을 고르면 그 장의 슬라이드(5번)로 간다', await until(async () => (await counter()) === `5 / ${TOTAL}`), await counter());
    await openPal('Content');
    check('슬라이드 항목에는 속한 장 이름이 붙는다', await until(async () => (await pal.getByRole('option', { name: /^6\. Content\s*Middle/ }).count()) >= 1));
    await page.keyboard.press('Escape');
    await until(async () => (await pal.count()) === 0);
    await openPal('cover'); await pal.getByRole('option', { name: /^1\./ }).first().click();
    await openPal('Hide notes'); await pal.getByRole('option', { name: /^Hide notes/ }).first().click();
    check('보기 토글: 노트 숨김', await until(async () => (await page.locator('[aria-label="Speaker notes"]').count()) === 0));
    await openPal('Show notes'); await pal.getByRole('option', { name: /^Show notes/ }).first().click();
    check('보기 토글: 노트 다시 보임', await until(async () => (await page.locator('[aria-label="Speaker notes"]').count()) === 1));
    await openPal('Start timer'); await pal.getByRole('option', { name: /^Start timer/ }).first().click();
    const timer = () => page.locator('[role=timer]').first().innerText();
    check('팔레트로 타이머를 시작한다', await until(async () => (await timer()) !== '00:00:00', 6000), await timer());
    check('타이머 시작을 스크린 리더 안내(aria-live)가 말한다', await until(async () => (await page.locator('[role=status][aria-live=polite].sr-only').innerText()) === 'Timer started'));
    await openPal('Reset timer'); await pal.getByRole('option', { name: /^Reset timer/ }).first().click();
    check('팔레트 리셋도 한 번은 확인을 요구한다', (await page.getByText('Choose Reset timer again to confirm').count()) >= 1 && (await timer()) !== '00:00:00');
    await openPal('Reset timer'); await pal.getByRole('option', { name: /^Reset timer/ }).first().click();
    check('두 번째 선택에서 리셋된다', await until(async () => (await timer()) === '00:00:00'), await timer());
    check('리셋도 안내한다', await until(async () => (await page.locator('[role=status][aria-live=polite].sr-only').innerText()) === 'Timer reset'));
    await openPal('Black screen'); await pal.getByRole('option', { name: /^Black screen/ }).first().click();
    check('발표 창이 없으면 가리기는 안내만 한다', await until(async () => (await page.getByText('Open the presentation window first').count()) >= 1));
    await until(async () => (await page.getByRole('dialog').count()) === 0); // 팔레트 닫힘 애니메이션이 끝나야 한 글자 단축키가 먹는다
    await page.mouse.click(640, 780);
    await page.keyboard.press('Shift+?');
    const help = page.getByRole('dialog', { name: 'Shortcuts' });
    check("'?'로 단축키 안내가 열린다", await until(async () => (await help.count()) === 1 && (await help.getByText('Search slides, chapters, and actions').count()) === 1));
    // 대화상자가 열려 있으면 한 글자 단축키가 뒤의 화면을 건드리지 않는다
    await until(async () => (await page.getByText(/again to confirm/).count()) === 0, 10000); // 앞 단계의 확인 안내가 사라진 뒤에 본다
    await page.keyboard.press('t'); await page.keyboard.press('r'); await sleep(1500);
    check('대화상자가 열려 있으면 T는 타이머를 켜지 않는다', (await timer()) === '00:00:00', await timer());
    check('대화상자가 열려 있으면 R은 리셋 확인을 띄우지 않는다', (await page.getByText(/again to confirm/).count()) === 0);
    check('+ 키캡이 비어 있지 않다("+, -")', await help.locator('kbd').evaluateAll((els) => els.every((k) => k.textContent.trim().length > 0)));
    await page.keyboard.press('Escape');
    check('Esc로 닫힌다', await until(async () => (await help.count()) === 0));
    // 한글 입력 상태(e.key가 ㅅ)에서도 물리 키 T로 타이머가 켜진다
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅅ', code: 'KeyT', bubbles: true })));
    check('한글 입력 상태에서도 T 단축키가 동작한다', await until(async () => (await timer()) !== '00:00:00', 6000), await timer());
    await ctx.close();
  }
  // 빠르게 앞뒤로 움직인 직후에도 비활성 슬라이드의 요소가 발표자 화면의 미리보기와 청중 창에 보이지 않는다
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(MOCKS.unsupported);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/present/${ID4}`, { waitUntil: 'domcontentloaded' });
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    await until(async () => (await counter()) === '1 / 4');
    const popupP = ctx.waitForEvent('page', { timeout: 5000 });
    await page.getByRole('button', { name: 'Present' }).click();
    const pop = await popupP.catch(() => null);
    check('[steps] 발표 창이 열린다', !!pop, pop ? '' : await page.evaluate(() => document.body.innerText.slice(0, 300)));
    if (pop) {
      const leaks = async () => {
        const out = [];
        for (const pg of [page, pop]) for (const fr of pg.frames()) {
          const n = await fr.evaluate(() => [...document.querySelectorAll('#sk-stage > [data-slide]:not([data-active]):not([data-leaving]) *')].filter((e) => getComputedStyle(e).visibility !== 'hidden').map((e) => e.textContent.slice(0, 12))).catch(() => []);
          if (n.length) out.push({ url: fr.url().slice(-40), n });
        }
        return out;
      };
      await page.bringToFront(); await page.mouse.click(640, 780);
      for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']) { await page.keyboard.press(k); await sleep(40); }
      let l = await leaks();
      check('빠르게 앞뒤로 움직인 직후 비활성 슬라이드의 요소가 보이지 않는다', l.length === 0, l);
      await sleep(1500);
      l = await leaks();
      check('잠시 뒤에도 보이지 않는다', l.length === 0, l);
      for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight']) { await page.keyboard.press(k); await sleep(40); }
      l = await leaks();
      check('단계 요소가 있는 슬라이드를 지나쳐도 보이지 않는다', l.length === 0, l);

      // 정지 상태 불변식: 활성 슬라이드의 단계 요소는 data-shown과 data-away 중 정확히 하나이고 모양(보임)이 그와 맞으며, 전환 표시(data-step-run)가 남지 않고, 비활성 슬라이드는 보이지 않는다
      const probe = (fr) => fr.evaluate(() => {
        const st = document.querySelector('#sk-stage'); if (!st) return null;
        const act = st.querySelector(':scope > [data-slide][data-active]');
        const viol = [], state = [];
        if (act) for (const e of act.querySelectorAll('[data-step],[data-step-out]')) {
          const sh = e.hasAttribute('data-shown'), aw = e.hasAttribute('data-away');
          const vis = e.checkVisibility({ visibilityProperty: true, opacityProperty: true });
          const t = e.textContent.trim().slice(0, 10);
          state.push(t + ':' + (sh ? 'S' : '') + (aw ? 'A' : ''));
          if (sh === aw) viol.push(t + ' shown/away not exclusive');
          else if (aw && vis) viol.push(t + ' away but visible');
          else if (sh && !vis) viol.push(t + ' shown but hidden');
        }
        if (st.querySelector('[data-step-run]')) viol.push('data-step-run left');
        for (const e of st.querySelectorAll(':scope > [data-slide]:not([data-active]):not([data-leaving]) *')) if (getComputedStyle(e).visibility !== 'hidden') viol.push('inactive visible ' + e.textContent.slice(0, 8));
        return { slide: act ? [...st.children].filter((c) => c.hasAttribute('data-slide')).indexOf(act) + 1 : 0, state: state.join(','), viol };
      });
      const probes = async () => {
        const out = [];
        for (const [who, pg] of [['presenter', page], ['audience', pop]]) for (const fr of pg.frames()) {
          const pr = await probe(fr).catch(() => null); if (!pr) continue;
          const title = who === 'presenter' ? await fr.frameElement().then((e) => e.getAttribute('title')).catch(() => '') : 'page';
          out.push({ who: who + ':' + title, ...pr });
        }
        return out;
      };
      const settled = async () => {
        let last = [];
        const ok = await until(async () => { last = await probes(); const cur = last.find((x) => x.who === 'presenter:Current slide'), aud = last.find((x) => x.who === 'audience:page');
          return last.length >= 3 && last.every((x) => !x.viol.length) && cur && aud && cur.slide === aud.slide && cur.state === aud.state; }, 9000);
        return { ok, last };
      };
      const pal = page.getByRole('dialog', { name: 'Search' });
      const key = async (k) => { await page.keyboard.press(k); };
      // 부하 때 Enter가 필터가 갱신되기 전에 눌려 다른 행을 고를 수 있어, 그 번호의 슬라이드에 닿을 때까지 다시 한다
      const jump = async (n) => {
        for (let t = 0; t < 4; t++) {
          await until(async () => (await page.getByRole('dialog').count()) === 0); await page.keyboard.press('Control+k');
          await pal.getByRole('combobox').fill(String(n));
          await until(async () => (await pal.getByRole('option', { name: new RegExp(`^${n}\\. `) }).count()) >= 1);
          await page.keyboard.press('Enter'); await until(async () => (await page.getByRole('dialog').count()) === 0);
          if (await until(async () => (await counter()).startsWith(`${n} / `), 3000)) return true;
        }
        return false;
      };
      await jump(1); // 앞의 빠른 이동이 어디에서 끝났든 표지에서 시작한다
      let st = await settled();
      check('[steps] 처음(표지) 정지 상태 불변식과 발표자, 청중 일치', st.ok, st.last);
      const nxt = st.last.find((x) => x.who === 'presenter:Next slide');
      check('[steps] 다음 슬라이드 미리보기는 1단계 상태(등장은 숨김, 퇴장 요소는 보임)', !!nxt && nxt.slide === 2 && nxt.state === 'Photo:A,Delayed:A,Third:A,Exiting:S', st.last);
      // 빠른 앞뒤 이동, 점프, 되감기 뒤 정지 상태(지연 200ms와 퇴장 포함)
      await page.bringToFront(); await page.mouse.click(640, 780);
      for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowLeft']) { await key(k); await sleep(30); }
      st = await settled(); check('[steps] 빠른 앞뒤 이동 뒤 정지 상태 불변식과 발표자, 청중 일치', st.ok, st.last);
      await jump(2); st = await settled(); check('[steps] 팔레트 점프(2번) 뒤 정지 상태', st.ok, st.last);
      await jump(1); st = await settled(); check('[steps] 팔레트 점프(표지) 뒤 정지 상태와 되감기 표시 정리', st.ok, st.last);
      await page.mouse.click(640, 780);

      // 스크린 리더 안내(청중 창의 polite 영역): 앞으로 새로 나타난 요소만 읽고 퇴장은 읽지 않으며 되감기는 요소 글자를 읽지 않는다
      await pop.evaluate(() => { window.__say = []; const el = document.querySelector('#sk-live'); if (el) new MutationObserver(() => { if (el.textContent) window.__say.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true }); });
      const said = () => pop.evaluate(() => window.__say.slice());
      const next = async (k) => { const n = (await said()).length; await key(k); await until(async () => (await said()).length > n); return (await said()).slice(n).join(' | '); };
      const a1 = await next('ArrowRight'); // 슬라이드 2, 단계 1
      const a2 = await next('ArrowRight'); // 단계 2: Photo, Delayed 등장
      const a3 = await next('ArrowRight'); // 단계 3: Third 등장, Exiting 퇴장
      const a4 = await next('ArrowRight'); // 단계 4: Third 퇴장
      const b3 = await next('ArrowLeft');  // 되감기
      check('[steps] 등장한 요소의 글자를 읽는다', /Photo/.test(a2) && /Delayed/.test(a2), [a1, a2, a3, a4, b3]);
      check('[steps] 등장과 퇴장이 같은 단계면 등장만 읽는다(Exiting을 읽지 않음)', /Third/.test(a3) && !/Exiting/.test(a3), [a1, a2, a3, a4, b3]);
      check('[steps] 퇴장만 있는 단계는 요소 글자를 읽지 않는다', !/Third|Exiting|Photo/.test(a4), a4);
      check('[steps] 되감기는 요소 글자를 읽지 않는다', !/Third|Exiting|Photo|Delayed/.test(b3), b3);
      check('[steps] 이동마다 안내는 한 번만(시끄럽지 않음)', [a1, a2, a3, a4, b3].every((t) => !t.includes(' | ')), [a1, a2, a3, a4, b3]);
      await jump(1); await settled();

      // 무작위 이동 퍼즈(시드 고정): 단계, 퇴장, 지연이 섞인 덱에서 키, 점프, 대기를 섞고 끝에서 정지 상태 불변식과 발표자, 청중 일치를 본다
      const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      for (const seed of [1, 2, 3]) {
        const R = rng(seed); const trace = [];
        for (let i = 0; i < 45; i++) {
          const r = R();
          if (r < 0.42) { trace.push('R'); await key('ArrowRight'); }
          else if (r < 0.8) { trace.push('L'); await key('ArrowLeft'); }
          else if (r < 0.9) { const n = 1 + Math.floor(R() * 4); trace.push('J' + n); await jump(n); }
          else { trace.push('w'); await sleep(Math.floor(R() * 300)); }
          await sleep(Math.floor(R() * 110));
        }
        st = await settled();
        check(`[steps] 무작위 이동 퍼즈(시드 ${seed}) 뒤 정지 상태 불변식과 발표자, 청중 일치`, st.ok, { trace: trace.join(''), last: st.last });
      }
    }
    await ctx.close();
  }
  // ?from=N: 그 장에서 시작, 범위 밖은 가장 가까운 장. 발표 시작은 현재 장부터.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const open = async (q) => { const pg = await ctx.newPage(); await pg.goto(`${BASE}/present/${ID}${q}`); return pg; };
    const cnt = (pg) => pg.getByText(/^\d+ \/ \d+$/).first().innerText();
    const p20 = await open('?from=20');
    check('?from=20이면 20번에서 시작', await until(async () => (await cnt(p20)) === `20 / ${TOTAL}`), await cnt(p20).catch(() => null));
    const popP = ctx.waitForEvent('page');
    await p20.getByRole('button', { name: 'Present' }).click();
    const pop = await popP;
    check('발표 시작은 현재 장(20)부터', await until(async () => new URL(pop.url()).hash === '#20'), pop.url());
    await pop.close();
    const big = await open('?from=999');
    check('범위 밖(큰 값)은 마지막 장', await until(async () => (await cnt(big)) === `${TOTAL} / ${TOTAL}`), await cnt(big).catch(() => null));
    await big.close(); await p20.close(); // 열린 발표자 화면끼리도 동기화되므로 닫고 확인한다
    const zero = await open('?from=0');
    check('범위 밖(0)은 첫 장', await until(async () => (await cnt(zero)) === `1 / ${TOTAL}`), await cnt(zero).catch(() => null));
    await ctx.close();
  }
  // 목표 시간, 초과 경고, 진행 바, 노트 크기 버튼, 라벨, 마지막 장 표시, 창 상태에 따른 버튼 이름
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.clock.install();
    await page.goto(`${BASE}/present/${ID}`);
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    await until(async () => (await counter()) === `1 / ${TOTAL}`);
    // 포커스된 위젯의 입력은 슬라이드 이동과 한 글자 단축키로 새지 않는다
    await page.getByRole('tab', { name: 'Slides' }).focus();
    await page.keyboard.press('ArrowRight'); await sleep(250);
    check('탭에서 화살표는 슬라이드를 넘기지 않는다', (await counter()) === `1 / ${TOTAL}`, await counter());
    await page.getByRole('button', { name: 'Reset timer' }).focus();
    await page.keyboard.press('t'); await page.clock.fastForward(3000);
    check('버튼에 포커스가 있으면 T는 타이머를 켜지 않는다', (await page.locator('[role=timer]').first().innerText()) === '00:00:00');
    await page.locator('body').focus();
    check('Current와 Next 라벨', (await page.getByText('Current', { exact: true }).count()) === 1 && (await page.getByText(/^Next/).count()) >= 1);
    check('슬라이드 진행 바', (await page.getByRole('progressbar', { name: 'Slide progress' }).getAttribute('aria-valuenow')) === '1');
    await page.getByLabel('Target minutes').fill('1');
    await page.keyboard.press('Tab');
    await page.mouse.click(640, 780);
    await page.keyboard.press('t');
    await page.clock.fastForward(10000);
    check('목표 시간이 있으면 남은 시간', await until(async () => /^00:5\d left$/.test(await page.getByText(/ left$/).first().innerText())), await page.getByText(/ left$/).first().innerText().catch(() => null));
    await page.clock.fastForward(60000);
    check('초과하면 over 문구', await until(async () => /^\+00:\d\d over$/.test(await page.getByText(/ over$/).first().innerText())), await page.getByText(/ over$/).count());
    // 리허설 요약: 슬라이드별 체류 시간(타이머가 돈 시간만)
    await page.getByRole('button', { name: 'Summary' }).click();
    const sd = page.getByRole('dialog');
    check('요약 다이얼로그', await until(async () => (await sd.getByText('Rehearsal summary').count()) === 1));
    check('총 시간과 목표 대비', /00:01:1[0-2]/.test(await sd.innerText()), await sd.innerText());
    check('가장 길었던 슬라이드', /1\.\s*cover[\s\S]*01:1[0-2]/i.test(await sd.innerText()), await sd.innerText());
    check('첫 리허설에는 비교가 없다', !(await sd.innerText()).includes('Last run'));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Summary' }).click(); // 두 번째 요약은 직전 기록과 비교한다
    check('다음 리허설 요약에 직전 기록과 비교', await until(async () => /Last run\s*00:01:1[0-2]/.test(await page.getByRole('dialog').innerText())), await page.getByRole('dialog').innerText());
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Auto-scroll notes' }).click();
    check('자동 스크롤 토글', (await page.getByRole('button', { name: 'Auto-scroll notes' }).getAttribute('aria-pressed')) === 'true');
    await page.getByRole('button', { name: 'Auto-scroll notes' }).click();
    const size0 = await page.locator('[aria-label="Speaker notes"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    await page.getByRole('button', { name: 'Larger notes' }).click();
    check('노트 A+ 버튼', (await page.locator('[aria-label="Speaker notes"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) === size0 + 2);
    for (let i = 0; i < TOTAL - 1; i++) await page.keyboard.press('ArrowRight');
    check('마지막 장에서 End of deck 표시', await until(async () => (await page.getByText('End of deck').count()) === 1));
    await ctx.close();
  }
  // 외장 화면(API 모킹): 권한 안내, 선택한 화면에 열기, 선택 기억, 타이머 시간 보정
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(`
      window.__opens = [];
      const open = window.open.bind(window);
      window.open = (u, n, f) => { window.__opens.push(f); return open(u, n, 'popup,width=640,height=400'); };
      const cur = { label: 'Laptop', availLeft: 0, availTop: 0, availWidth: 1280, availHeight: 800 };
      const a = { label: 'Projector', availLeft: 1280, availTop: 0, availWidth: 1920, availHeight: 1080 };
      const b = { label: 'TV', availLeft: 3200, availTop: 0, availWidth: 3840, availHeight: 2160 };
      navigator.permissions.query = async () => ({ state: 'prompt' });
      window.getScreenDetails = async () => { await new Promise((r) => setTimeout(r, 400)); return { screens: [cur, a, b], currentScreen: cur }; }; // 권한 창이 떠 있는 시간을 흉내 낸다
    `);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/present/${ID}`);
    await until(async () => (await page.getByRole('button', { name: 'Present', exact: true }).count()) === 1);
    check('권한 전에는 표시할 화면을 아직 모른다고 안내', (await page.getByRole('button', { name: 'Present', exact: true }).count()) === 1 && (await page.getByRole('combobox', { name: 'Presentation display' }).count()) === 0);
    await page.evaluate(() => { window.__notes = []; setInterval(() => { for (const e of document.querySelectorAll('[role=status]')) if (e.textContent && !window.__notes.includes(e.textContent)) window.__notes.push(e.textContent); }, 30); });
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    check('권한을 묻기 전에 한 줄 안내가 보인다', await until(async () => (await page.evaluate(() => window.__notes)).some((t) => /browser will ask to manage windows/.test(t))), await page.evaluate(() => window.__notes));
    check('첫 외장 화면(Projector)에 연다', await until(async () => (await page.evaluate(() => window.__opens)).some((f) => /left=1280,top=0,width=1920,height=1080/.test(f))), await page.evaluate(() => window.__opens));
    check('Presenting on Projector 표시', await until(async () => (await page.evaluate(() => window.__notes)).some((t) => t.includes('Presenting on Projector.'))), await page.evaluate(() => window.__notes)); // 이어서 전체화면 안내가 덮어쓸 수 있어 기록으로 본다
    check('화면이 둘 이상이면 선택기가 나온다', await until(async () => (await page.getByRole('combobox', { name: 'Presentation display' }).count()) === 1));
    await page.getByRole('combobox', { name: 'Presentation display' }).click();
    await page.getByRole('option', { name: 'TV' }).click();
    check('선택한 화면을 기억한다', (await page.evaluate(() => localStorage.getItem('slidekit:screen'))) === 'TV');
    await page.getByRole('button', { name: /Focus presentation|Present$/ }).click();
    check('다음 발표는 기억한 화면(TV)에 연다', await until(async () => (await page.evaluate(() => window.__opens)).some((f) => /left=3200,top=0,width=3840,height=2160/.test(f))), await page.evaluate(() => window.__opens));
    await ctx.close();
  }
  // 발표 창 하트비트: 이 페이지에서 연 창이 아니어도 열림과 닫힘과 재연결을 알아본다
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/present/${ID}`);
    await until(async () => (await page.getByText(/^\d+ \/ \d+$/).count()) >= 1);
    check('발표 창이 없으면 상태를 표시하지 않는다', (await page.getByText(/Presentation window (open|closed)/).count()) === 0);
    const w1 = await ctx.newPage();
    await w1.goto(`${BASE}/decks/${DECK}/index.html?sync=1`);
    check('따로 열린 발표 창을 하트비트로 알아본다', await until(async () => (await page.getByText('Presentation window open').count()) === 1, 8000));
    await w1.close();
    check('창이 닫히면 closed로 바뀐다', await until(async () => (await page.getByText('Presentation window closed').count()) === 1, 8000));
    const w2 = await ctx.newPage();
    await w2.goto(`${BASE}/decks/${DECK}/index.html?sync=1#5`);
    check('다시 열리면 open으로 돌아온다', await until(async () => (await page.getByText('Presentation window open').count()) === 1, 8000));
    check('재연결 안내 토스트', await until(async () => (await page.getByText('Presentation window reconnected').count()) >= 1, 6000));
    check('다시 열린 창이 발표자 위치(1)로 맞춰진다', await until(async () => new URL(w2.url()).hash === '#1', 8000), w2.url());
    // 가리기 상태: 엔진이 BroadcastChannel로 알리면 발표자 화면에 보인다
    await w2.evaluate((id) => { window.__bc = new BroadcastChannel('slidekit:' + id); window.__bc.postMessage({ v: 1, type: 'blank', from: 'test', mode: 'black' }); }, ID);
    check('발표 창이 가려지면 Blanked 표시', await until(async () => (await page.getByText('Blanked (black)').count()) === 1, 5000));
    await w2.evaluate(() => window.__bc.postMessage({ v: 1, type: 'blank', from: 'test', mode: null }));
    check('가리기가 풀리면 표시가 사라진다', await until(async () => (await page.getByText(/Blanked/).count()) === 0, 5000));
    await ctx.close();
  }
  // 타이머는 틱이 늦어도 시계 차이로 센다(백그라운드 탭 보정)
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.clock.install();
    await page.goto(`${BASE}/present/${ID}`);
    await until(async () => (await page.getByText(/^\d+ \/ \d+$/).count()) >= 1);
    await page.mouse.click(640, 780);
    await page.keyboard.press('t');
    await page.clock.fastForward(65000); // 한 번의 틱으로 65초가 지난 상황
    check('늦은 틱에도 경과 시간이 정확하다', await until(async () => /^00:01:0\d$/.test(await page.locator('[role=timer]').first().innerText())), await page.locator('[role=timer]').first().innerText());
    await ctx.close();
  }
  // 깨진 localStorage
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(`localStorage.setItem('slidekit:view', '{bad'); localStorage.setItem('slidekit:notes-size', 'abc');`);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/present/${ID}`);
    check('깨진 localStorage에도 화면이 뜬다', await until(async () => (await page.getByText(/^\d+ \/ \d+$/).count()) === 1));
    await ctx.close();
  }
  // 덱 목록 요청 실패는 화면에 보인다
  {
    const ctx = await browser.newContext();
    await ctx.route('**/api/decks', (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${BASE}/present/${ID}`);
    check('목록 요청 실패 표시', await until(async () => (await page.getByRole('alert').innerText()).includes('Could not load decks')));
    await ctx.close();
  }
  check('페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
