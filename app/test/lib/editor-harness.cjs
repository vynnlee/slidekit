/* 편집기 브라우저 검증의 공용 하네스. editor-*.cjs가 쓴다.
   startEditor({ name, slides })가 작은 덱 사본(기본 8장, decks/_e2e-<name>)을 만들고 편집기를 열어 준비되기를 기다린 뒤 도구를 돌려준다.
   각 파일은 서버와 덱을 한 번만 불러 자기 영역의 검사를 모두 하고 finish()로 끝낸다. 실제 덱은 건드리지 않는다. */
const fs = require('fs'), path = require('path');
const { launch } = require('../../../scripts/lib/pw.cjs');
const { makeTestDeck } = require('../../../scripts/lib/test-deck.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slides = (s) => (s.match(/<section\b[^>]*\bdata-slide\b/g) || []).length;

async function startEditor({ name, slides: nSlides = 8 } = {}) {
  const T = makeTestDeck(name, 'sample', { slides: nSlides });
  const FILE = T.file;
  let fail = 0, lastT = Date.now();
  const check = (label, ok, extra) => {
    const dt = Date.now() - lastT; lastT = Date.now();
    if (dt > 2500) console.log('SLOW +' + (dt / 1000).toFixed(1) + 's 직전 구간 끝: ' + label);
    if (!ok) fail++;
    console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra)));
  };
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('slidekit.tip.editor', '1'); } catch {} }); // 첫 열기 안내 카드는 상단 가운데를 가려 클릭을 가로채므로 닫힌 상태로 시작한다(카드 검사는 별도)
  const page = await ctx.newPage();
  // 부하 재현: CPU_SLOW=4처럼 주면 이 페이지의 CPU를 그 배수로 늦춘다(조건 대기가 느린 환경에서도 버티는지 보는 용도)
  if (process.env.CPU_SLOW) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_SLOW) }); }
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
  // 고정 sleep 대신 조건 대기. 조건이 끝내 안 맞아도 던지지 않는다(뒤의 check가 실패로 보고한다).
  const cond = (fn, arg, ms = 5000) => page.waitForFunction(([src, a]) => { try { return !!(0, eval)('(' + src + ')')(a); } catch { return false; } }, [fn.toString(), arg], { timeout: ms }).catch(() => { console.log('INFO 조건 대기 시간 초과 ' + ms + 'ms: ' + fn.toString().replace(/\s+/g, ' ').slice(0, 90)); }); // 읽는 도중 iframe이 다시 그려져 예외가 나면 아직 아님으로 본다
  const saveDone = async () => { await settle(); await cond(() => document.querySelector('[data-testid=status]')?.textContent === 'Saved', null, 8000); };
  const unsaved = () => cond(() => document.querySelector('[data-testid=status]')?.textContent !== 'Saved', null, 4000);
  const n = (sel) => page.evaluate((s) => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll(s).length, sel);
  const stageCount = (c) => cond((c) => document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelectorAll('#sk-stage > [data-slide]').length === c, c);
  const layers = page.locator('[data-testid=filmstrip] [role=option]'); // 슬라이드 필름스트립
  // 현재 슬라이드(data-active) 안에서 함수를 돌린다. fn은 (슬라이드 요소, 인자)를 받는다.
  const inDoc = (fn, arg) => page.evaluate(([f, a]) => { const d = document.querySelector('iframe[title="Canvas"]').contentDocument; return eval('(' + f + ')')(d.querySelector('[data-active]'), a); }, [fn.toString(), arg]);
  const nKids = () => inDoc((s) => s.children.length);
  const rowsL = page.getByTestId('layer-row');
  // 2번 슬라이드를 고르고 선택을 비운다(영역별 검사의 공통 출발점)
  const goSlide2 = async () => { await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape'); };
  const finish = async () => {
    check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3));
    await browser.close();
    process.exit(fail ? 1 : 0);
  };
  return { fs, path, BASE, T, FILE, N0: nSlides, sleep, slides, check, browser, ctx, page, settle, settleOf, focusBody, errors, frameEl, fr, cond, saveDone, unsaved, n, stageCount, layers, inDoc, nKids, rowsL, goSlide2, finish };
}

module.exports = { startEditor, sleep, slides };
