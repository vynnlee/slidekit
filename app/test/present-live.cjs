/* 발표 화면 실시간 갱신 브라우저 검증 (spec/LIVE-UPDATE.md): 덱 파일을 밖에서 고치면 발표자 화면과 청중 창이 위치를 유지한 채 갱신되는지.
   전용 덱(_e2e-live)을 만들어 고치고 끝에 지운다. 청중 창은 새로고침되지 않아야 한다(전체화면 유지).
   1) 정책: Auto는 현재와 다음 슬라이드가 안 바뀌면 조용히 반영, 바뀌면 칩과 Apply(U), 청중이 없으면 바로 반영. Ask는 항상 칩. Off는 아무것도 안 함
   2) 위치: 현재 앞에 끼우면 같은 슬라이드에 머물고, 현재를 지우면 가까운 슬라이드로 옮기며 토스트, 단계 위치 유지
   3) 스크립트가 바뀌면 바꿔 끼우지 않고 Reload 칩만
   4) 무작위 편집 퍼즈(시드 고정): 발표자, 청중 창, 리모컨 상태의 위치가 늘 같다
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node app/test/present-live.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const DECK = '_e2e-live', ID = 'e2e-live';
const DIR = path.join(__dirname, '..', '..', 'decks', DECK), FILE = path.join(DIR, 'index.html');
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra).slice(0, 500))); };
const until = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };

/* 모델: {id, rev, steps}. 슬라이드는 "Slide <id> r<rev>" 제목. 본문 지문은 id와 rev가 정한다. */
const sec = (it) => `<section data-slide="content"><h2>Slide ${it.id} r${it.rev}</h2>${it.steps ? '<p data-step="2" class="e">a</p><p data-step="3" class="e">b</p>' : ''}<aside data-notes>notes ${it.id}</aside></section>`;
const doc = (list, script = '') => `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${ID}</title>
<script type="application/json" id="deck-meta">{ "title": "${ID}", "id": "${ID}" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"><style>:root { --sk-step-ms: 50ms; }</style></head><body>
${list.map(sec).join('\n')}
<script src="../../engine/slidekit.js"></script>${script}</body></html>`;
const initial = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, rev: 0, steps: i === 2 }));
const write = (list, script) => fs.writeFileSync(FILE, doc(list, script)); // 같은 바이트 길이라도 mtime이 바뀌게 매번 새로 쓴다
fs.mkdirSync(DIR, { recursive: true });
write(initial);
process.on('exit', () => fs.rmSync(DIR, { recursive: true, force: true }));

(async () => {
  const browser = await launch();
  const errors = [];
  /* 한 번 열면 발표자 화면(wantAudience이면 청중 창도)을 띄우고 위치를 앞으로 보낸다 */
  const open = async (mode, wantAudience, startAt = 1) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript((m) => { try { localStorage.setItem('slidekit:live-update', m); } catch {} }, mode);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/present/' + ID);
    await page.getByText(/^\d+ \/ \d+$/).first().waitFor();
    const counter = () => page.getByText(/^\d+ \/ \d+$/).first().innerText();
    let pop = null;
    if (wantAudience) {
      const pp = ctx.waitForEvent('page', { timeout: 8000 });
      await page.getByRole('button', { name: 'Present' }).click();
      pop = await pp; pop.on('pageerror', (e) => errors.push(String(e)));
      await pop.waitForURL((u) => u.href.includes('sync=1'), { timeout: 10000 }); // 팝업 이벤트는 첫 이동 전에 온다
      await pop.waitForLoadState('load');
      await pop.evaluate(() => { window.__tok = 1; });
    }
    await page.bringToFront();
    for (let i = 1; i < startAt; i++) await page.keyboard.press('ArrowRight');
    await until(async () => (await counter()) === `${startAt} / ${(await counter()).split(' / ')[1]}`);
    if (pop) await until(async () => (await pop.evaluate(() => document.querySelector('[data-active] h2')?.textContent)) !== null);
    await page.evaluate(() => { const f = document.querySelector('iframe'); if (f && f.contentWindow) f.contentWindow.__tok = 1; });
    const curTitle = () => page.locator('iframe').first().contentFrame().locator('[data-active] h2').innerText();
    const popTitle = () => pop.evaluate(() => document.querySelector('[data-active] h2')?.textContent);
    const hasTitle = (t) => page.locator('iframe').first().contentFrame().locator('h2').allInnerTexts().then((a) => a.includes(t));
    const chip = () => page.getByText(/^Deck (updated|code changed)/);
    return { ctx, page, pop, counter, curTitle, popTitle, hasTitle, chip };
  };
  const tok = (v) => v.page.locator('iframe').first().contentFrame().locator('html').evaluate(() => window.__tok === 1);

  /* ---- Auto: 현재와 다음이 안 바뀌면 조용히 ---- */
  {
    write(initial);
    const v = await open('auto', true, 2); await sleep(500);
    check('시작: 발표자와 청중 창이 슬라이드 2', (await v.counter()).startsWith('2 / ') && (await v.curTitle()) === 'Slide 2 r0' && (await v.popTitle()) === 'Slide 2 r0');
    const l = initial.map((x) => ({ ...x })); l[6].rev = 1; /* 7번만 수정(현재 2와 다음 3이 아님) */
    write(l);
    check('Auto: 안 보이는 슬라이드 수정은 칩 없이 반영된다(발표자 화면)', await until(async () => await v.hasTitle('Slide 7 r1')));
    check('Auto: 청중 창에도 반영된다', await until(async () => (await v.pop.evaluate(() => [...document.querySelectorAll('h2')].map((h) => h.textContent))).includes('Slide 7 r1')));
    check('Auto: 칩이 뜨지 않는다', (await v.chip().count()) === 0);
    check('Auto: 위치가 그대로이고 두 창 모두 새로고침되지 않았다', (await v.counter()) === '2 / 8' && (await v.popTitle()) === 'Slide 2 r0' && (await v.pop.evaluate(() => window.__tok === 1)) && (await tok(v)));
    /* 현재 슬라이드 수정: 칩이 뜨고 Apply 전에는 안 바뀐다 */
    const l2 = l.map((x) => ({ ...x })); l2[1].rev = 1;
    write(l2);
    check('Auto: 현재 슬라이드 수정은 칩이 뜬다', await until(async () => (await v.chip().count()) === 1));
    check('칩: 문구에 바뀐 슬라이드 번호', (await v.chip().innerText()).includes('Slide 2 changed'));
    await sleep(600);
    check('칩이 떠 있는 동안 발표자 화면과 청중 창은 그대로', (await v.curTitle()) === 'Slide 2 r0' && (await v.popTitle()) === 'Slide 2 r0');
    await v.page.bringToFront(); await v.page.keyboard.press('u');
    check('U로 반영하면 두 창의 현재 슬라이드가 새 내용이고 칩이 사라진다', await until(async () => (await v.curTitle()) === 'Slide 2 r1' && (await v.popTitle()) === 'Slide 2 r1' && (await v.chip().count()) === 0));
    check('반영 뒤 위치 유지와 새로고침 없음', (await v.counter()) === '2 / 8' && (await v.pop.evaluate(() => window.__tok === 1)) && (await tok(v)));
    /* 현재 앞에 끼움: 같은 슬라이드에 머문다 */
    const l3 = [{ id: 20, rev: 0, steps: false }, ...l2];
    write(l3);
    check('앞에 끼워도 같은 슬라이드에 머문다(번호만 3으로)', await until(async () => (await v.counter()) === '3 / 9' && (await v.curTitle()) === 'Slide 2 r1' && (await v.popTitle()) === 'Slide 2 r1'), [await v.counter(), await v.curTitle()]);
    /* 현재 삭제: 칩 → Apply → 토스트와 가까운 슬라이드 */
    const l4 = l3.filter((x) => x.id !== 2);
    write(l4);
    check('현재 슬라이드를 지우면 칩이 뜬다', await until(async () => (await v.chip().count()) === 1));
    await v.page.getByRole('button', { name: /^Apply/ }).click();
    check('Apply 뒤: 가까운 슬라이드로 옮기고 토스트로 알린다', await until(async () => (await v.counter()) === '2 / 8' && (await v.page.getByText(/Slide 3 was removed\. Moved to slide 2\./).count()) === 1), [await v.counter()]);
    check('청중 창도 같은 슬라이드', await until(async () => (await v.popTitle()) === (await v.curTitle())), [await v.curTitle(), await v.popTitle()]);
    await v.ctx.close();
  }

  /* ---- 단계 유지 ---- */
  {
    write(initial);
    const v = await open('auto', true, 3); await sleep(500);
    await v.page.bringToFront(); await v.page.keyboard.press('ArrowRight'); await v.page.keyboard.press('ArrowRight'); await sleep(900); /* 3번 슬라이드의 3단계 */
    const stepShown = () => v.page.locator('iframe').first().contentFrame().locator('[data-active] [data-step]').evaluateAll((els) => els.filter((e) => e.checkVisibility({ visibilityProperty: true }) && Number(getComputedStyle(e).opacity) > 0.99).length);
    check('3번 슬라이드의 3단계(단계 요소 둘이 보임)', await until(async () => (await stepShown()) === 2));
    const l = initial.map((x) => ({ ...x })); l[6].rev = 1;
    write(l);
    check('단계 유지: 다른 슬라이드를 고쳐도 같은 슬라이드와 3단계', await until(async () => (await v.page.locator('iframe').first().contentFrame().locator('h2').allInnerTexts()).includes('Slide 7 r1')) && (await v.counter()) === '3 / 8' && (await stepShown()) === 2);
    await v.ctx.close();
  }

  /* ---- 청중이 없으면 현재 슬라이드도 바로 ---- */
  {
    write(initial);
    const v = await open('auto', false, 2); await sleep(500);
    const l = initial.map((x) => ({ ...x })); l[1].rev = 1;
    write(l);
    check('청중 창도 리모컨도 없으면 현재 슬라이드 수정도 바로 반영(칩 없음)', await until(async () => (await v.curTitle()) === 'Slide 2 r1') && (await v.chip().count()) === 0);
    await v.ctx.close();
  }

  /* ---- Ask와 Off ---- */
  {
    write(initial);
    const v = await open('ask', false, 2); await sleep(500);
    const l = initial.map((x) => ({ ...x })); l[6].rev = 1;
    write(l);
    check('Ask: 안 보이는 수정도 칩이 뜬다', await until(async () => (await v.chip().count()) === 1));
    await sleep(500);
    check('Ask: Apply 전에는 안 바뀐다', !(await v.hasTitle('Slide 7 r1')));
    await v.page.getByRole('button', { name: /^Apply/ }).click();
    check('Ask: Apply 하면 반영된다', await until(async () => await v.hasTitle('Slide 7 r1')) && (await v.chip().count()) === 0);
    await v.ctx.close();
    write(initial);
    const o = await open('off', false, 2); await sleep(500);
    write(l);
    await sleep(3000);
    check('Off: 아무 일도 하지 않는다(칩도 반영도 없음)', (await o.chip().count()) === 0 && !(await o.hasTitle('Slide 7 r1')));
    await o.ctx.close();
  }

  /* ---- 스크립트가 바뀌면 Reload 칩만 ---- */
  {
    write(initial);
    const v = await open('auto', false, 2); await sleep(500);
    write(initial, '<script>window.__x = 1</script>');
    check('스크립트 변경: Reload 칩이 뜬다', await until(async () => (await v.page.getByText('Deck code changed').count()) === 1 && (await v.page.getByRole('button', { name: 'Reload' }).count()) === 1));
    check('스크립트 변경: 슬라이드는 바뀌지 않고 위치도 그대로', (await v.counter()) === '2 / 8' && (await v.curTitle()) === 'Slide 2 r0');
    await v.ctx.close();
  }

  /* ---- 무작위 편집 퍼즈: 발표자 화면, 청중 창, 리모컨 상태가 늘 같은 위치 ---- */
  for (const seed of (process.env.PL_SEEDS || '1,2').split(',').map(Number)) {
    const r = rng(seed);
    let list = initial.map((x) => ({ ...x })), nextId = 100;
    write(list);
    const v = await open(seed % 2 ? 'auto' : 'ask', true, 1); await sleep(500);
    /* 리모컨: 상태 JSON을 서버에서 읽는 대신 발표자 화면이 올리는 상태와 같은 값(카운터)으로 본다 */
    const bad = [];
    for (let i = 0; i < 14; i++) {
      await v.page.bringToFront();
      const mv = Math.floor(r() * 3);
      if (mv === 0) await v.page.keyboard.press('ArrowRight'); else if (mv === 1) await v.page.keyboard.press('ArrowLeft');
      await sleep(700);
      const op = Math.floor(r() * 5), k = Math.floor(r() * list.length), next = list.map((x) => ({ ...x }));
      if (op === 0) next[k].rev++;
      else if (op === 1) next.splice(k, 0, { id: nextId++, rev: 0, steps: false });
      else if (op === 2 && next.length > 4) next.splice(k, 1);
      else if (op === 3) { const j = Math.floor(r() * next.length), [x] = next.splice(k, 1); next.splice(j, 0, x); }
      write(next); list = next;
      /* 칩이 뜨면 Apply 한다. 뜨지 않아도 반영될 때까지 기다린다 */
      const titles = () => v.page.locator('iframe').first().contentFrame().locator('h2').allInnerTexts();
      const want = list.map((x) => `Slide ${x.id} r${x.rev}`);
      const done = await until(async () => {
        if ((await v.chip().count()) === 1) await v.page.getByRole('button', { name: /^Apply/ }).click().catch(() => {});
        return JSON.stringify(await titles()) === JSON.stringify(want);
      }, 12000);
      if (!done) { bad.push(['not-applied', i, op]); break; }
      await sleep(600);
      const c = await v.counter(), n = Number(c.split(' / ')[0]), tot = Number(c.split(' / ')[1]);
      const cur = await v.curTitle(), popT = await v.popTitle();
      if (tot !== list.length) bad.push(['total', i, c]);
      if (cur !== want[n - 1]) bad.push(['cur', i, cur, want[n - 1]]);
      if (popT !== cur) bad.push(['audience', i, popT, cur]);
      if (!(await v.pop.evaluate(() => window.__tok === 1))) bad.push(['reload', i]);
    }
    check(`퍼즈 seed ${seed}: 발표자, 청중 창이 늘 같은 슬라이드이고 내용과 장 수가 맞으며 청중 창은 새로고침되지 않는다`, bad.length === 0, bad.slice(0, 3));
    await v.ctx.close();
  }

  check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
