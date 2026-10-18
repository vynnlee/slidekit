/* 엔진 실시간 갱신(refresh)의 안전 시험 (spec/LIVE-UPDATE.md). 서버 불필요(file://). 덱 decks/_refresh-test를 만들고 끝나면 지운다.
   발표자가 보내는 BroadcastChannel 메시지(role presenter, type refresh)를 시험이 직접 보내 엔진만 본다.
   1) 단위: 바뀌지 않은 슬라이드는 DOM 노드가 그대로, 바뀐 것만 교체, 위치 유지, 현재 슬라이드 삭제는 범위 안, 단계 제한,
      거절(잘못된 목록과 HTML과 과대 크기와 발표자가 아닌 역할)은 DOM을 하나도 안 바꿈, 섹션 안 <script>는 실행되지 않음, 덱 스타일 교체, 전체 보기(열린 채와 닫힌 채)
   2) 퍼즈(시드 고정): 핫 스왑(수정, 삽입, 삭제, 순서 바꿈, 단계 켜기와 끄기, 현재 슬라이드 삭제)을 방향키와 해시 점프와 섞고, 매번 멈춘 뒤 engine-anim 불변식
      (활성 하나, 비활성 슬라이드의 자손은 안 보임, 단계 요소는 N <= 단계 < M일 때만 보임, 임시 상태 data-step-run과 data-step-instant과 data-leaving과 will-change가 안 남음)과
      순서, 활성 슬라이드가 기대한 것인지, 안 바뀐 노드의 보존을 본다
   3) 누수: 퍼즈를 마친 뒤 처음 목록으로 돌아오면 노드 수와 리스너 수가 처음과 같다
   환경 변수: RF_OPS(퍼즈 갱신 횟수, 기본 120), RF_SEEDS(기본 1,2). 낮은 우선순위의 mac-cloud에서는 시드 하나가 5분 걸려 단계 상한(900초)에 걸린다
   사용: PW=<playwright-core> CHROME=<headless shell> node engine/test/refresh.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'decks', '_refresh-test');
const OPS = Number(process.env.RF_OPS || 120);
let fail = 0; const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 600))); };
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 모델: 슬라이드 {id, rev, steps}. 지문은 id:rev:steps, 같은 지문이면 같은 소스다. */
const sec = (it) => `<section data-slide="content" data-id="${it.id}" data-rev="${it.rev}"><h2>T${it.id}</h2><p>body r${it.rev}</p>${it.steps ? '<p data-step="2" class="e">a</p><p data-step="3" class="e">b</p>' : ''}</section>`;
const fp = (it) => `${it.id}:${it.rev}:${it.steps ? 1 : 0}`;
const msg = (list, pos, extra) => ({ v: 1, from: 'rf-presenter', role: 'presenter', type: 'refresh', slides: list.map((it) => ({ fp: fp(it), html: sec(it) })), pos, ...extra });
const initial = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, rev: 0, steps: i % 3 === 1 }));
const page = `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>rf</title>
<script type="application/json" id="deck-meta">{ "title": "rf", "id": "refresh-test" }</script><link rel="stylesheet" href="../../engine/slidekit.css">
<style>:root { --sk-step-ms: 50ms; } .mark { color: red }</style></head><body>${initial.map(sec).join('')}
<script src="../../engine/slidekit.js"></script></body></html>`;

const invariants = (p) => p.evaluate(() => {
  const bad = [], stage = document.getElementById('sk-stage');
  const shown = (e) => (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : getComputedStyle(e).visibility !== 'hidden');
  const slides = [...stage.children].filter((e) => e.hasAttribute && e.hasAttribute('data-slide'));
  const acts = slides.filter((s) => s.hasAttribute('data-active')), act = acts[0];
  if (acts.length !== 1) bad.push('active count ' + acts.length);
  for (const s of slides) {
    if (s === act) continue;
    for (const e of [s, ...s.querySelectorAll('*')]) if (shown(e)) { bad.push('inactive visible: ' + (e.textContent || e.tagName).slice(0, 20)); break; }
  }
  if (act) {
    const els = [...act.querySelectorAll('[data-step]')], k = 1 + els.filter((e) => shown(e) && Number(getComputedStyle(e).opacity) > 0.99).length;
    els.forEach((e, i) => { const got = shown(e) && Number(getComputedStyle(e).opacity) > 0.99; if (got !== i < k - 1) bad.push('step ' + k + ': 보이는 요소가 앞에서부터 이어지지 않음(' + i + ')'); }); /* 이 시험의 단계 요소는 문서 순서가 단계 순서다 */
  }
  for (const s of slides) {
    for (const a of ['data-step-run', 'data-step-instant', 'data-leaving']) if (s.hasAttribute(a)) bad.push('leftover ' + a);
    for (const e of s.querySelectorAll('[data-step],[data-step-out]')) { const w = getComputedStyle(e).willChange; if (w !== 'auto') bad.push('will-change ' + w); }
  }
  return bad.slice(0, 5);
});
const settle = (p) => p.waitForFunction(() => document.getAnimations().length === 0 && !document.querySelector('[data-step-run]'), null, { timeout: 30000, polling: 100 }).catch(() => {}).then(() => sleep(50));
const state = (p) => p.evaluate(() => {
  const stage = document.getElementById('sk-stage'), slides = [...stage.children].filter((e) => e.hasAttribute && e.hasAttribute('data-slide'));
  const act = slides.find((s) => s.hasAttribute('data-active'));
  const shown = (e) => e.checkVisibility({ visibilityProperty: true }) && Number(getComputedStyle(e).opacity) > 0.99;
  return { order: slides.map((s) => s.getAttribute('data-id') + ':' + s.getAttribute('data-rev')), cur: act ? Number(act.getAttribute('data-id')) : null, curIdx: slides.indexOf(act), step: act ? 1 + [...act.querySelectorAll('[data-step]')].filter(shown).length : 0, html: stage.innerHTML };
});
const send = (p, m) => p.evaluate((m) => { const bc = new BroadcastChannel('slidekit:refresh-test'); bc.postMessage(m); setTimeout(() => bc.close(), 50); }, m).then(() => sleep(30));
const tag = (p) => p.evaluate(() => { [...document.getElementById('sk-stage').children].forEach((e) => { if (e.hasAttribute('data-slide')) e.__t = 1; }); });
const tagged = (p) => p.evaluate(() => [...document.getElementById('sk-stage').children].filter((e) => e.hasAttribute('data-slide')).map((e) => (e.__t ? e.getAttribute('data-id') + ':' + e.getAttribute('data-rev') : null)));
const metric = async (cdp) => { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); const { metrics } = await cdp.send('Performance.getMetrics'); return Object.fromEntries(metrics.map((x) => [x.name, x.value])); };

(async () => {
  const b = await launch();
  try {
    fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'index.html'), page);
    const url = 'file://' + path.join(DIR, 'index.html') + '?sync=1#3';
    const mk = async () => { const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }), p = await ctx.newPage(), errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); await p.goto(url); await p.waitForSelector('#sk-stage [data-active]'); await sleep(200); return { ctx, p, errs }; };

    /* ---- 1) 단위 ---- */
    {
      const { ctx, p, errs } = await mk();
      let st = await state(p);
      check('시작: 3번 슬라이드가 활성', st.cur === 3 && st.curIdx === 2, [st.cur, st.curIdx]);
      await tag(p);
      const list = initial.map((x) => ({ ...x })); list[5].rev = 1; /* 6번만 수정 */
      await send(p, msg(list, { slide: 3, step: 1 }, { base: initial.map(fp) })); /* 처음 메시지의 base를 엔진이 믿는다 */
      st = await state(p);
      check('수정한 슬라이드만 바뀐다(6번 r1)', st.order[5] === '6:1' && st.order.filter((o, i) => i !== 5).every((o) => o.endsWith(':0')), st.order);
      const t = await tagged(p);
      check('안 바뀐 슬라이드는 DOM 노드가 그대로, 바뀐 것은 새 노드', t.filter((x, i) => i !== 5).every(Boolean) && t[5] === null, t);
      check('현재 슬라이드(3번)가 그대로 활성', st.cur === 3);
      /* 현재 앞에 끼움: 위치는 새 번호 */
      await tag(p);
      const ins = [{ id: 20, rev: 0, steps: false }, ...list];
      await send(p, msg(ins, { slide: 4, step: 1 }));
      st = await state(p);
      check('앞에 끼워도 같은 슬라이드(id 3)가 활성이고 기존 노드는 그대로', st.cur === 3 && st.curIdx === 3 && (await tagged(p)).filter(Boolean).length === 8, [st.cur, st.curIdx]);
      /* 현재 슬라이드 삭제 */
      const del = ins.filter((x) => x.id !== 3);
      await send(p, msg(del, { slide: 4, step: 1 }));
      st = await state(p);
      check('현재 슬라이드를 지우면 pos가 가리키는 자리가 활성', st.order.length === 8 && st.curIdx === 3, [st.curIdx, st.order.length]);
      /* 위치가 범위를 넘으면 마지막, 0이나 이상한 값은 첫 장 */
      await send(p, msg(del, { slide: 999, step: 1 })); st = await state(p);
      check('범위 밖 slide는 마지막 장', st.curIdx === 7, st.curIdx);
      await send(p, msg(del, { slide: -4, step: 'x' })); st = await state(p);
      check('이상한 slide는 첫 장 근처로(1 이상)', st.curIdx >= 0 && st.curIdx <= 7, st.curIdx);
      /* 단계: 단계가 있는 슬라이드(id 2는 steps)에서 단계 제한 */
      await send(p, msg(del, { slide: del.findIndex((x) => x.id === 2) + 1, step: 99 })); await settle(p); st = await state(p);
      check('단계 수를 넘는 step은 마지막 단계(3)로 제한', st.cur === 2 && st.step === 3, [st.cur, st.step]);
      check('불변식(단위 끝)', (await invariants(p)).length === 0, await invariants(p));
      /* 거절은 아무것도 안 바꾼다 */
      const before = (await state(p)).html;
      const bad = [
        ['목록이 배열이 아님', { ...msg(del, { slide: 1 }), slides: 'x' }],
        ['빈 목록', { ...msg(del, { slide: 1 }), slides: [] }],
        ['html이 문자열이 아님', { ...msg(del, { slide: 1 }), slides: [{ fp: 'a', html: 1 }] }],
        ['섹션이 아닌 html', { ...msg(del, { slide: 1 }), slides: [{ fp: 'zz1', html: '<div data-slide="content">x</div>' }] }],
        ['data-slide 없는 섹션', { ...msg(del, { slide: 1 }), slides: [{ fp: 'zz2', html: '<section>x</section>' }] }],
        ['섹션 둘', { ...msg(del, { slide: 1 }), slides: [{ fp: 'zz3', html: '<section data-slide="content">a</section><section data-slide="content">b</section>' }] }],
        ['지문이 너무 김', { ...msg(del, { slide: 1 }), slides: [{ fp: 'x'.repeat(65), html: '<section data-slide="content">a</section>' }] }],
        ['스타일 형식 오류', { ...msg(del, { slide: 1 }), styles: [1] }],
        ['발표자가 아닌 역할', { ...msg(list, { slide: 1 }), role: 'audience' }],
        ['버전이 다름', { ...msg(list, { slide: 1 }), v: 2 }],
        ['과대 목록(2001장)', { ...msg(del, { slide: 1 }), slides: Array.from({ length: 2001 }, (_, i) => ({ fp: 'f' + i, html: '<section data-slide="content">a</section>' })) }],
        ['유효한 것 뒤에 깨진 항목(원자성)', { ...msg(del, { slide: 1 }), slides: [...del.map((it) => ({ fp: fp(it), html: sec(it) })), { fp: 'q', html: '<p>no</p>' }] }],
      ];
      for (const [name, m] of bad) { await send(p, m); check(`거절: ${name}(DOM 불변)`, (await state(p)).html === before); }
      /* 섹션 안 script는 실행되지 않는다 */
      const withScript = [...del.slice(0, 7), { id: 77, rev: 0, steps: false }];
      const m = msg(withScript, { slide: 1, step: 1 }); m.slides[7].html = '<section data-slide="content" data-id="77" data-rev="0"><h2>T77</h2><script>window.__ran = 1</script></section>';
      await send(p, m); await sleep(200);
      check('섹션 안 <script>는 실행되지 않고 제거된다(인라인 on* 속성은 덱 원본 로드와 같게 그대로 둔다)', (await p.evaluate(() => !window.__ran && !document.querySelector('[data-id="77"] script'))));
      /* 덱 스타일 교체: 개수가 같을 때만 */
      await send(p, msg(del, { slide: 1 }, { styles: [':root { --sk-step-ms: 50ms; } .mark { color: blue }'] }));
      check('덱 스타일이 교체된다', await p.evaluate(() => document.head.querySelector('style').textContent.includes('blue')));
      await send(p, msg(del, { slide: 1 }, { styles: ['a', 'b'] }));
      check('스타일 개수가 다르면 건드리지 않는다', await p.evaluate(() => document.head.querySelector('style').textContent.includes('blue')));
      /* 전체 보기: 닫힌 채는 열 때 새로 만들고, 열린 채는 바로 */
      await p.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', bubbles: true }))); await sleep(150);
      const n1 = await p.evaluate(() => document.querySelectorAll('.sk-thumb').length);
      check('전체 보기 썸네일 수가 슬라이드 수와 같다(열기 전 갱신 반영)', n1 === 8, n1);
      const more = [...del, { id: 30, rev: 0, steps: false }];
      await send(p, msg(more, { slide: 1 })); await sleep(100);
      check('전체 보기가 열린 채 갱신하면 썸네일이 바로 따라온다', (await p.evaluate(() => document.querySelectorAll('.sk-thumb').length)) === 9);
      await p.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))); await sleep(100);
      check('페이지 오류 없음(단위)', errs.length === 0, errs);
      await ctx.close();
    }

    /* ---- 2) 퍼즈와 3) 누수 ---- */
    for (const seed of (process.env.RF_SEEDS || '1,2').split(',').map(Number)) {
      const { ctx, p, errs } = await mk(), r = rng(seed), cdp = await ctx.newCDPSession(p);
      await cdp.send('Performance.enable');
      await send(p, msg(initial, { slide: 3, step: 1 }, { base: initial.map(fp) })); await settle(p);
      const base = await metric(cdp);
      let list = initial.map((x) => ({ ...x })), nextId = 100, viol = [], longs = 0;
      await p.evaluate(() => { try { new PerformanceObserver((l) => { window.__long = (window.__long || 0) + l.getEntries().length; }).observe({ entryTypes: ['longtask'] }); } catch (e) {} });
      const batch = async (n) => {
      for (let i = 0; i < n; i++) {
          /* 섞기: 방향키와 해시 점프 */
          const mv = Math.floor(r() * 4);
          if (mv === 0) await p.keyboard.press('ArrowRight'); else if (mv === 1) await p.keyboard.press('ArrowLeft'); else if (mv === 2) await p.evaluate((h) => { location.hash = '#' + h; }, 1 + Math.floor(r() * list.length));
          await settle(p);
          const st0 = await state(p);
          await tag(p);
          const curId = st0.cur, curStep = st0.step;
          const op = Math.floor(r() * 7), k = Math.floor(r() * list.length);
          const next = list.map((x) => ({ ...x }));
          if (op === 0) next[k].rev++;
          else if (op === 1) next.splice(k, 0, { id: nextId++, rev: 0, steps: r() < 0.4 });
          else if (op === 2 && next.length > 3) next.splice(k, 1);
          else if (op === 3) { const j = Math.floor(r() * next.length), [x] = next.splice(k, 1); next.splice(j, 0, x); }
          else if (op === 4) { next[k].steps = !next[k].steps; next[k].rev++; }
          else if (op === 5 && next.length > 3) { const ci = next.findIndex((x) => x.id === curId); if (ci >= 0) next.splice(ci, 1); } /* 현재 슬라이드 삭제 */
          /* op 6과 나머지: 같은 목록을 다시 보냄(아무것도 안 바뀜) */
          let ci = next.findIndex((x) => x.id === curId), slidePos = ci >= 0 ? ci + 1 : Math.min(st0.curIdx + 1, next.length), wantStep = Math.max(1, Math.min(ci >= 0 && next[ci].steps ? 3 : 1, curStep));
          if (ci < 0) { slidePos = Math.min(st0.curIdx + 1, next.length); wantStep = 1; }
          await send(p, msg(next, { slide: slidePos, step: curStep }));
          await settle(p);
          const st = await state(p), inv = await invariants(p), tg = await tagged(p);
          const wantOrder = next.map((x) => x.id + ':' + x.rev);
          if (JSON.stringify(st.order) !== JSON.stringify(wantOrder)) viol.push(['order', i, op]);
          if (st.curIdx !== slidePos - 1) viol.push(['curIdx', i, op, st.curIdx, slidePos - 1]);
          if (ci >= 0 && st.cur !== curId) viol.push(['cur', i, op]);
          if (ci >= 0 && st.step !== wantStep && next[ci].steps) viol.push(['step', i, op, st.step, wantStep]);
          const keepWant = wantOrder.map((o) => (list.some((x) => x.id + ':' + x.rev === o) ? o : null));
          if (JSON.stringify(tg) !== JSON.stringify(keepWant)) viol.push(['reuse', i, op]);
          if (inv.length) viol.push(['inv', i, op, inv]);
          list = next;
          if (viol.length > 5) break;
        }
      };
      await batch(OPS);
      longs = await p.evaluate(() => window.__long || 0);
      check(`퍼즈 seed ${seed}: ${OPS}번 핫 스왑(순서, 활성, 단계, 노드 보존, 불변식)`, viol.length === 0, viol.slice(0, 3));
      console.log(`INFO seed ${seed}: 긴 작업 ${longs}건(단언 안 함, 환경 잡음과 섞임)`);
      /* 누수: 처음 목록으로 돌아온 뒤 한 번 더 퍼즈를 하고 돌아와도 노드와 리스너가 늘지 않는다(분리된 노드가 수거되기 전의 잔여 몇 개는 허용) */
      await send(p, msg(initial, { slide: 3, step: 1 })); await settle(p);
      const m1 = await metric(cdp);
      list = initial.map((x) => ({ ...x }));
      await batch(Math.max(40, OPS >> 1));
      await send(p, msg(initial, { slide: 3, step: 1 })); await settle(p);
      const m2 = await metric(cdp);
      check(`누수 seed ${seed}: 처음과 비슷하고(노드 +12 이내, 리스너 같음) 두 번째 퍼즈 뒤 더 늘지 않는다`, m1.Nodes - base.Nodes <= 12 && m2.Nodes - m1.Nodes <= 6 && m1.JSEventListeners === base.JSEventListeners && m2.JSEventListeners === base.JSEventListeners, [base.Nodes, m1.Nodes, m2.Nodes, base.JSEventListeners, m1.JSEventListeners, m2.JSEventListeners]);
      check(`퍼즈 seed ${seed}: 페이지 오류 없음`, errs.length === 0, errs.slice(0, 3));
      await ctx.close();
    }
  } finally {
    fs.rmSync(DIR, { recursive: true, force: true });
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
