/* 단계 애니메이션의 안정성 시험(ANIMATION.md 5절). 덱 decks/_anim-stress를 만들고 끝나면 지운다. 서버 불필요(file://).
   1) 무작위 이동 퍼즈: 방향키, 해시 점프, 청중 창 동기화를 시드 고정으로 섞고, 매번 멈춘 뒤 불변식을 본다
      - 비활성 슬라이드(떠나는 중 제외)의 자손은 하나도 visible이 아니다(상속 숨김을 뚫는 일 없음)
      - 활성 슬라이드에서 단계 요소가 보이는 것은 정확히 N <= 단계 < M일 때다
      - 정지 뒤에 data-step-run, data-step-instant, data-leaving, will-change 같은 임시 상태가 남지 않는다
   2) CPU 속도 1배, 4배, 8배에서 같은 불변식(느린 기계에서 전환이 겹쳐도 깨지지 않는다)
   3) 긴 작업(50ms 초과)은 건수만 INFO로 출력한다(환경 잡음과 섞이므로 단언하지 않는다). 대신 큰 덱의 이동 한 번의 비용(중앙값, p90)을 단언한다
   4) 누수: 이동 수백 번 뒤 DOM 노드 수와 이벤트 리스너 수가 처음과 같다
   5) 호환: 단계가 있는 덱(vibe-coding-workshop 읽기 전용 사본, slidekit-guide)을 이전 엔진(ANIM_BASE, 기본 c11afe0)과 같은 순서로 걸어 상태, 안내 문장, 직접 만든 stepper 호출 로그를 비교
   환경 변수: ANIM_MOVES, ANIM_SEEDS, ANIM_RATES, ANIM_REPEAT(같은 시드를 되풀이해 발생률을 잼), ANIM_TRACE(긴 작업이 나오면 Chrome 트레이스로 스크립트, 스타일, 레이아웃, 페인트, GC를 구분), ANIM_ONLY_COMPAT, ANIM_SKIP_COMPAT
   사용: PW=<playwright-core> CHROME=<headless shell> node engine/test/anim-stress.cjs   (ANIM_MOVES로 이동 횟수, 기본 150) */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), DECKROOT = process.env.ANIM_DECKROOT || ROOT /* 엔진 후보를 비교할 때: engine/을 가진 다른 폴더 */, DIR = path.join(DECKROOT, 'decks', '_anim-stress'), OLD = '/tmp/sk-anim-old';
const MOVES = Number(process.env.ANIM_MOVES || 150), BASE_REV = process.env.ANIM_BASE || 'c11afe0';
let fail = 0; const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 600))); };
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* 짧은 시간 토큰으로 시험을 빠르게 한다(전환 로직은 같다). 요소는 다양하게: 등장만, 퇴장만, 둘 다, 지연, 별칭, 변수 */
const mk = (n) => {
  const els = [
    '<p data-step="2" class="e">in2</p>', '<p data-step-out="3" class="e">out3</p>', '<p data-step="2" data-step-out="4" class="e">in2out4</p>',
    '<p data-step="3" style="--sk-step-delay:60ms" class="e">in3delay</p>', '<p data-step="2" data-step-effect="left" class="e">left</p>',
    '<p data-step="3" data-step-out="5" style="--sk-away-x:80px;--sk-away-scale:.6" class="e">vars</p>', '<p data-step="2" data-step-effect="none" class="e">none</p>',
    '<p data-step="4" data-step-effect="blur" class="e">blur</p>', '<div data-step="2" class="e"><span style="visibility:visible">inner visible</span></div>',
  ];
  return `<section data-slide="content"><h2>s${n}</h2>${els.slice(0, 3 + (n % 7)).join('')}</section>`;
};
const html = `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>as</title>
<script type="application/json" id="deck-meta">{ "title": "as", "id": "anim-stress" }</script><link rel="stylesheet" href="../../engine/slidekit.css">
<style>:root { --sk-step-ms: 50ms; }</style></head><body>${Array.from({ length: 12 }, (_, i) => (i === 0 ? '<section data-slide="cover"><h1>c</h1></section>' : mk(i))).join('')}
<script src="../../engine/slidekit.js"></script></body></html>`;

const invariants = (p) => p.evaluate(() => {
  const bad = [], stage = document.getElementById('sk-stage');
  /* 그려지는가: visibility가 hidden이거나 content-visibility:hidden 조상 아래(렌더 건너뜀)이면 보이지 않는다 */
  const shown = (e) => (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : getComputedStyle(e).visibility !== 'hidden');
  const slides = [...stage.children].filter((e) => e.hasAttribute && e.hasAttribute('data-slide'));
  const act = slides.find((s) => s.hasAttribute('data-active'));
  for (const s of slides) {
    if (s === act) continue;
    for (const e of [s, ...s.querySelectorAll('*')]) if (shown(e)) { bad.push('inactive visible: ' + (e.textContent || e.tagName).slice(0, 20)); break; }
  }
  const live = (document.getElementById('sk-live') || {}).textContent || '', m = live.match(/(?:단계|step) (\d+) \/ (\d+)/);
  const k = m ? Number(m[1]) : 1;
  if (act) for (const e of act.querySelectorAll('[data-step],[data-step-out]')) {
    const n = Number(e.getAttribute('data-step') || 1), o = e.hasAttribute('data-step-out') ? Number(e.getAttribute('data-step-out')) : Infinity;
    const want = k >= n && k < o, got = shown(e) && Number(getComputedStyle(e).opacity) > 0.99;
    if (want !== got) bad.push(`step ${k}: "${e.textContent.slice(0, 12)}" want ${want} got ${got}`);
  }
  for (const s of slides) {
    for (const a of ['data-step-run', 'data-step-instant', 'data-leaving']) if (s.hasAttribute(a)) bad.push('leftover ' + a);
    for (const e of s.querySelectorAll('[data-step],[data-step-out]')) { const w = getComputedStyle(e).willChange; if (w !== 'auto') bad.push('will-change ' + w); }
  }
  return bad.slice(0, 5);
});
const settle = (p) => p.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 8000 }).then(() => sleep(220)); /* will-change 정리 타이머(전환 + 150ms)까지 */

(async () => {
  const b = await launch();
  try {
    fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'index.html'), html);
    const file = 'file://' + path.join(DIR, 'index.html');
    const RATES = (process.env.ANIM_RATES || '1,4,8').split(',').map(Number), SEEDS = (process.env.ANIM_SEEDS || '1,2,3').split(',').map(Number), REPEAT = Number(process.env.ANIM_REPEAT || 1);
    if (!process.env.ANIM_ONLY_COMPAT) for (const rate of RATES) {
      for (const seed of (rate === 1 ? SEEDS : [SEEDS[0]]).flatMap((x) => Array(REPEAT).fill(x))) {
        const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
        const a = await ctx.newPage(), v = await ctx.newPage(), errs = [];
        a.on('pageerror', (e) => errs.push(String(e))); v.on('pageerror', (e) => errs.push(String(e)));
        const cdp = await ctx.newCDPSession(a); await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        await a.addInitScript(() => { window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration) + 'ms@' + Math.round(e.startTime)); }).observe({ entryTypes: ['longtask'] }); } catch (e) {} });
        await a.goto(file + '?sync=1#1'); await v.goto(file + '?sync=1#1'); await a.waitForSelector('#sk-stage'); await v.waitForSelector('#sk-stage'); await settle(a);
        const counters = async () => { await cdp.send('HeapProfiler.collectGarbage'); return cdp.send('Memory.getDOMCounters'); };
        const before = await counters();
        await a.evaluate(() => { window.__long.length = 0; }); // only the long tasks during the moves count (not page load or the garbage collection the counters force)
        const R = rng(seed * 7919 + rate), n = rate === 1 ? MOVES : Math.min(MOVES, 60), log = [];
        let bad = [], traceEvents = null;
        if (process.env.ANIM_TRACE && rate === 1) { traceEvents = []; cdp.on('Tracing.dataCollected', (e) => traceEvents.push(...e.value)); await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8,blink', transferMode: 'ReportEvents' }); }
        for (let i = 0; i < n && !bad.length; i++) {
          const r = R(), page = R() < 0.25 ? v : a;
          let op;
          if (r < 0.40) op = 'ArrowRight'; else if (r < 0.70) op = 'ArrowLeft'; else if (r < 0.82) op = R() < 0.5 ? 'burst:ArrowRight' : 'burst:ArrowLeft'; else op = '#' + (1 + Math.floor(R() * 12));
          log.push(op);
          if (op[0] === '#') await page.evaluate((h) => { location.hash = h; }, op);
          else if (op.startsWith('burst:')) { for (let j = 0; j < 3; j++) await page.keyboard.press(op.slice(6)); } /* 같은 방향 3연타: 전환이 끝나기 전에 취소와 재시작이 겹친다 */
          else await page.keyboard.press(op);
          if (R() < 0.5) await sleep(Math.floor(R() * 90)); /* 전환 도중에 다음 입력이 오는 경우 */
          if (i % 4 === 3 || i === n - 1) { await settle(a); await settle(v); bad = (await invariants(a)).concat((await invariants(v)).map((x) => 'audience ' + x)); }
        }
        const long = await a.evaluate(() => window.__long || []);
        if (traceEvents) {
          const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r)); await cdp.send('Tracing.end'); await done;
          const runs = traceEvents.filter((e) => e.name === 'RunTask' && e.ph === 'X' && e.dur > 50000);
          for (const r of runs.slice(0, 3)) {
            const inside = traceEvents.filter((e) => e.ph === 'X' && e.pid === r.pid && e.tid === r.tid && e.ts >= r.ts && e.ts + e.dur <= r.ts + r.dur && e.name !== 'RunTask');
            const by = {}; for (const e of inside) by[e.name] = (by[e.name] || 0) + e.dur;
            console.log(`INFO 트레이스 rate=${rate} seed=${seed}: ${Math.round(r.dur / 1000)}ms 작업, 안의 이벤트(ms): ` + Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k} ${Math.round(v / 1000)}`).join(', '));
          }
          if (!runs.length) console.log(`INFO 트레이스 rate=${rate} seed=${seed}: 50ms 넘는 작업 없음(긴 작업 ${long.length}건 보고)`);
        }
        check(`퍼즈 rate=${rate} seed=${seed} (${n}회 이동, 연타와 청중 동기화 포함): 불변식 위반 0`, bad.length === 0 && errs.length === 0, { bad, errs, seed, rate, moves: log.length, last12: log.slice(-12), all: bad.length || errs.length ? log.join(',') : undefined });
        if (rate === 1) console.log(`INFO 긴 작업(>50ms) rate=1 seed=${seed}: ${long.length}건${long.length ? ' ' + JSON.stringify(long.slice(0, 8)) : ''} (정보만: 환경 잡음과 섞이는 값이라 단언하지 않는다. 같은 시드를 ANIM_REPEAT로 되풀이하고 ANIM_TRACE로 원인을 가른다)`);
        /* 누수: 처음 상태로 돌아가 정리한 뒤 노드와 리스너 수 */
        await a.evaluate(() => { location.hash = '#1'; }); await settle(a); await settle(v);
        const after = await counters();
        if (seed === 1) check(`누수 없음 rate=${rate}: DOM 노드 ${before.nodes}->${after.nodes}, 리스너 ${before.jsEventListeners}->${after.jsEventListeners}`, after.nodes === before.nodes && after.jsEventListeners <= before.jsEventListeners, { before, after });
        await ctx.close();
      }
    }
    /* 이동 한 번의 비용(큰 덱): 슬라이드 40장 x 요소 300개(약 12000노드)에서 방향키 이동 한 번(keydown 처리 + 강제 스타일/레이아웃)의 중앙값과 p90.
       기준 측정(2026-10-15, mac-cloud)은 중앙값 4~6ms, p90 8~9ms라 여유 2~3배로 단언한다: 중앙값 15ms, p90 25ms. 환경 스파이크는 최대치에만 나와서 이 두 값에는 거의 영향이 없다. */
    if (!process.env.ANIM_ONLY_COMPAT && !process.env.ANIM_SKIP_COST) {
      const big = `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>c</title><script type="application/json" id="deck-meta">{ "title": "c" }</script><link rel="stylesheet" href="../../engine/slidekit.css"></head><body>${Array.from({ length: 40 }, (_, i) => `<section data-slide="content"><h2>s${i}</h2>${Array.from({ length: 300 }, (_, k) => `<p${k % 20 === 0 ? ' data-step="2"' : ''}>item ${i} ${k}</p>`).join('')}</section>`).join('')}<script src="../../engine/slidekit.js"></script></body></html>`;
      const CDIR = path.join(DECKROOT, 'decks', '_anim-cost'); fs.rmSync(CDIR, { recursive: true, force: true }); fs.mkdirSync(CDIR, { recursive: true }); fs.writeFileSync(path.join(CDIR, 'index.html'), big);
      try {
        const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }), p = await ctx.newPage();
        await p.goto('file://' + path.join(CDIR, 'index.html') + '#1'); await p.waitForSelector('#sk-stage'); await sleep(800);
        const ms = await p.evaluate(async () => { const out = []; for (let i = 0; i < 60; i++) { const t0 = performance.now(); document.dispatchEvent(new KeyboardEvent('keydown', { key: i % 30 < 15 ? 'ArrowRight' : 'ArrowLeft', bubbles: true })); void document.body.offsetHeight; out.push(performance.now() - t0); await new Promise((r) => setTimeout(r, 30)); } return out; });
        ms.sort((x, y) => x - y);
        const med = ms[30], p90 = ms[54];
        console.log(`INFO 큰 덱(40장 x 300요소) 이동 한 번: 중앙값 ${med.toFixed(1)}ms, p90 ${p90.toFixed(1)}ms, 최대 ${ms[59].toFixed(1)}ms`);
        check(`이동 한 번의 비용(큰 덱, 약 12000노드): 중앙값 ${med.toFixed(1)}ms <= 15ms, p90 ${p90.toFixed(1)}ms <= 25ms`, med <= 15 && p90 <= 25, { med, p90, max: ms[59] });
        await ctx.close();
      } finally { fs.rmSync(CDIR, { recursive: true, force: true }); }
    }
    /* 호환: 단계가 있는 덱(사용자 덱 vibe-coding-workshop, 안내 덱 slidekit-guide)을 이전 엔진과 새 엔진으로 같은 이동 순서로 걸어 비교한다(읽기 전용 사본, 사용자 덱은 건드리지 않는다).
       각 슬라이드: 점프 -> 앞으로 끝까지 -> 뒤로 처음까지 -> 다시 점프. 지점마다 해시, 안내 문장(슬라이드 n / N, 단계 k / S: info.steps와 활성 단계), 선언형 요소의 계산 상태,
       SlideKit.stepper로 등록한 직접 만든 stepper의 호출 로그(메서드 이름, 인자, 반환 값의 순서와 횟수)를 기록해 두 엔진의 기록이 같아야 한다. */
    if (!process.env.ANIM_SKIP_COMPAT) {
      fs.rmSync(OLD, { recursive: true, force: true }); fs.mkdirSync(path.join(OLD, 'engine'), { recursive: true });
      let okOld = true;
      for (const f of ['slidekit.js', 'slidekit.css']) { const g = cp.spawnSync('git', ['show', `${BASE_REV}:engine/${f}`], { cwd: ROOT, encoding: 'utf8' }); if (g.status !== 0) okOld = false; else fs.writeFileSync(path.join(OLD, 'engine', f), g.stdout); }
      if (!okOld) console.log('SKIP 호환 비교(기준 엔진 ' + BASE_REV + '을 git에서 못 읽음)');
      else for (const name of ['vibe-coding-workshop', 'slidekit-guide']) {
        const src = path.join(ROOT, 'decks', name, 'index.html');
        if (!fs.existsSync(src)) continue;
        fs.mkdirSync(path.join(OLD, 'decks', name), { recursive: true }); fs.copyFileSync(src, path.join(OLD, 'decks', name, 'index.html'));
        const walk = async (url) => {
          const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } }); await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
          const p = await ctx.newPage();
          /* SlideKit.stepper를 감싸 등록된 stepper의 호출을 기록한다(엔진이 SlideKit을 만들기 전에 껍데기를 둔다) */
          await p.addInitScript(() => {
            window.__calls = []; let real = null; const SK = {};
            Object.defineProperty(SK, 'stepper', { configurable: true, enumerable: true,
              set(fn) { real = fn; },
              get() { return (el, impl) => { const w = {}; for (const k of Object.keys(impl)) w[k] = (...a) => { const r = impl[k](...a); window.__calls.push(k + '(' + a.map((x) => JSON.stringify(x)).join(',') + ')=' + JSON.stringify(r)); return r; }; return real(el, w); }; } });
            window.SlideKit = SK;
          });
          await p.goto(url + '#1'); await p.waitForSelector('#sk-stage'); await sleep(600);
          const total = await p.evaluate(() => document.querySelectorAll('#sk-stage > [data-slide]').length), out = [];
          const rec = async (label) => {
            await p.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 8000 }).catch(() => {}); await sleep(120);
            const st = await p.evaluate(() => {
              const id = (m) => (m === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : m);
              const act = document.querySelector('#sk-stage > [data-active]');
              const els = act ? [...act.querySelectorAll('[data-step]')].map((e) => { const c = getComputedStyle(e); return c.visibility[0] + '|' + c.opacity + '|' + id(c.transform) + '|' + c.filter; }).join(';') : '';
              const calls = window.__calls.splice(0).join(' ');
              return { h: location.hash, live: (document.getElementById('sk-live') || {}).textContent || '', els, calls };
            });
            out.push(label + ' ' + JSON.stringify(st));
            return st;
          };
          let withSteps = 0, declarative = 0, custom = 0, points = 0;
          for (let n = 1; n <= total; n++) {
            await p.evaluate((n) => { location.hash = '#' + n; }, n); await sleep(80);
            const a = await rec(`#${n} jump`);
            if (!/단계 \d+ \/ \d+/.test(a.live) && !a.els && !a.calls) continue;
            withSteps++; if (a.els) declarative++; if (a.calls) custom++;
            let moves = 0;
            for (; moves < 15; moves++) { await p.keyboard.press('ArrowRight'); const r = await rec(`#${n} fwd${moves + 1}`); points++; if (r.h !== '#' + n) break; }
            await p.keyboard.press('ArrowLeft'); await rec(`#${n} back0`); points++;
            for (let m = 0; m < moves; m++) { await p.keyboard.press('ArrowLeft'); const r = await rec(`#${n} back${m + 1}`); points++; if (r.h !== '#' + n) break; }
            await p.evaluate((n) => { location.hash = '#' + n; }, n); await sleep(80); await rec(`#${n} jump-again`); points++;
          }
          await ctx.close(); return { out, total, withSteps, declarative, custom, points };
        };
        const oldW = await walk('file://' + path.join(OLD, 'decks', name, 'index.html'));
        const newW = await walk('file://' + src);
        const diff = oldW.out.findIndex((x, i) => x !== newW.out[i]);
        console.log(`INFO 호환 표 ${name}: 슬라이드 ${oldW.total}장, 단계 있는 장 ${oldW.withSteps}(선언형 ${oldW.declarative}, 직접 만든 stepper ${oldW.custom}), 비교 지점 ${oldW.out.length}개(이동 ${oldW.points}회)`);
        check(`호환: ${name}의 모든 슬라이드에서 점프, 앞으로, 뒤로, 다시 점프 뒤 해시, 안내 문장(단계 수와 활성 단계), 선언형 상태, 직접 만든 stepper 호출 로그가 이전 엔진(${BASE_REV})과 같다`,
          oldW.out.length > 0 && oldW.out.length === newW.out.length && diff < 0, diff >= 0 ? { at: diff, old: oldW.out[diff], now: newW.out[diff] } : { old: oldW.out.length, now: newW.out.length });
      }
    }
  } finally {
    await b.close(); fs.rmSync(DIR, { recursive: true, force: true }); fs.rmSync(OLD, { recursive: true, force: true });
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(DIR, { recursive: true, force: true }); process.exit(2); });
