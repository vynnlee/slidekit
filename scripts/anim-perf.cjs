// 단계 전환 성능과 안정성 측정(기준선과 구현 뒤 비교). 워크숍 덱과 슬라이드 안내 덱의 단계 있는 장에서 단계 전환 1회마다
// ① 메인 스레드 스크립트 시간(CDP ScriptDuration) ② 긴 작업(>50ms) 수 ③ rAF 프레임 간격 p50/p95 ④ 전환 직후 노드, 이벤트 리스너, JS 힙을 잰다.
// CPU는 1배와 4배로 잰다. 덱은 읽기만 한다(서버가 정적으로 준다). 500회 이동 뒤 노드와 리스너가 늘지 않는지도 본다(누수).
// 사용: BASE=<앱 서버> node scripts/anim-perf.cjs  (러너 단계 anim-perf, slow)
//   ANIM_OUT=<json 경로>   측정값을 저장한다(기준선으로 쓴다).
//   ANIM_BASE=<json 경로>  비교할 기준선(기본 scripts/anim-perf.baseline.json).
// 합격선: 긴 작업 0(CPU 1배), 500회 이동 뒤 노드와 리스너 증가 0, ANIM_BASE가 있으면 p95가 기준선의 110% + 34ms 이내, 스크립트와 스타일 시간 중앙값이 기준선의 2배 이내, 노드 수 105% 이내(scripts/anim-perf.baseline.json, 구현 전에 잰 값).
// 주의: taskpolicy -b(낮은 우선순위)로 돌리면 macOS가 타이머를 합쳐 rAF가 약 5fps(200ms 간격)로 떨어져 프레임 수치가 무의미하다. 이 단계는 낮은 우선순위 없이 잠금 안에서 돌린다(약 1분, 브라우저 1개). 헤드리스 소프트웨어 렌더링이라 절대값은 크고(p95 약 130ms) 비교용이다.
const fs = require('fs');
// 낮은 우선순위(taskpolicy -b)에서는 macOS가 타이머를 합쳐 rAF가 약 5fps(200ms 간격)로 떨어진다. 러너 단계는 SLIDEKIT_NORMAL_PRIORITY로 낮은 우선순위 없이 돌고,
// 공용 브라우저 서버(낮은 우선순위로 떠 있다) 대신 자기 브라우저를 띄운다. 트레이스도 끈다(측정을 흔든다). 약 1분, 브라우저 1개다.
delete process.env.SLIDEKIT_PW_WS;
delete process.env.SLIDEKIT_TRACE_DIR;
const { launch } = require('./lib/pw.cjs');
const BASE = process.env.BASE;
const DECKS = (process.env.ANIM_DECKS || 'vibe-coding-workshop,slidekit-guide').split(',');
const RATES = (process.env.ANIM_RATES || '1,4').split(',').map(Number);
const TRANSITIONS = Number(process.env.ANIM_N || 12); // 장 하나에서 재는 전환 횟수(앞으로 한 번, 뒤로 한 번 번갈아)
const LEAK_MOVES = Number(process.env.ANIM_LEAK || 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && extra !== undefined ? '  ' + JSON.stringify(extra) : '')); };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

(async () => {
  const browser = await launch();
  const baseFile = process.env.ANIM_BASE || require('path').join(__dirname, 'anim-perf.baseline.json');
  const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : null;
  const result = {};
  for (const deck of DECKS) {
    for (const rate of RATES) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Performance.enable');
      const url = `${BASE}/decks/${deck}/index.html`;
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      // 단계가 둘 이상인 첫 장
      const stepped = await page.evaluate(() => [...document.querySelectorAll('#sk-stage > [data-slide]')].map((s, i) => ({ n: i + 1, steps: Math.max(1, ...[...s.querySelectorAll('[data-step]')].map((e) => Number(e.getAttribute('data-step')) || 1)) })).filter((x) => x.steps >= 2));
      // 덱 내용은 사용자가 바꾼다(커밋된 워크숍 덱에는 선언형 단계 장이 없을 수 있다). 단계 장이 없는 덱은 실패가 아니라 건너뛴다.
      if (!stepped.length) { if (rate === RATES[0]) console.log(`INFO [${deck}] 단계 있는 장 없음, 이 덱은 건너뜀`); await ctx.close(); continue; }
      const slide = stepped[0];
      await page.goto(`${url}#${slide.n}`, { waitUntil: 'load' });
      await page.reload({ waitUntil: 'load' });
      await sleep(800);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.mouse.click(640, 360).catch(() => {});
      const metrics = async () => { const { metrics: m } = await cdp.send('Performance.getMetrics'); return Object.fromEntries(m.map((x) => [x.name, x.value])); };
      const gc = async () => { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); };
      await page.evaluate(() => {
        window.__perf = { long: 0, frames: [], rec: false };
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (window.__perf.rec) window.__perf.long++; }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
        let last = 0;
        const loop = (t) => { if (window.__perf.rec) { if (last) window.__perf.frames.push(t - last); last = t; } else last = 0; requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      });
      const scripts = [], tasks = [], layouts = [], frames = []; let longTasks = 0;
      for (let i = 0; i < TRANSITIONS; i++) {
        const key = i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft';
        const m0 = await metrics();
        await page.evaluate(() => { window.__perf.long = 0; window.__perf.frames = []; window.__perf.rec = true; });
        await page.keyboard.press(key);
        await sleep(900); // 전환(360ms)과 뒷정리가 끝날 때까지
        const r = await page.evaluate(() => { window.__perf.rec = false; return { long: window.__perf.long, frames: window.__perf.frames }; });
        const m1 = await metrics();
        scripts.push((m1.ScriptDuration - m0.ScriptDuration) * 1000);
        tasks.push((m1.TaskDuration - m0.TaskDuration) * 1000);
        layouts.push((m1.LayoutDuration - m0.LayoutDuration) * 1000 + (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000);
        longTasks += r.long; frames.push(...r.frames);
      }
      await gc();
      const after = await metrics();
      const row = {
        deck, rate, slide: slide.n, steps: slide.steps, transitions: TRANSITIONS,
        scriptMsMedian: round(pct(scripts, 0.5)), scriptMsMax: round(Math.max(...scripts)), taskMsMedian: round(pct(tasks, 0.5)), styleLayoutMsMedian: round(pct(layouts, 0.5)),
        longTasks, frameP50: round(pct(frames, 0.5)), frameP95: round(pct(frames, 0.95)), frameMax: round(Math.max(0, ...frames)), frameMean: round(frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)), slowFramePct: round(100 * frames.filter((f) => f > 33.4).length / Math.max(1, frames.length), 1), frameCount: frames.length,
        nodes: after.Nodes, listeners: after.JSEventListeners, heapKB: Math.round(after.JSHeapUsedSize / 1024),
      };
      // 누수: 앞뒤로 많이 움직인 뒤 노드와 리스너(CPU 1배에서만 잰다. 빨리 누르되 매번 한 단계)
      if (rate === 1) {
        await gc(); const b = await metrics();
        for (let i = 0; i < LEAK_MOVES; i++) { await page.keyboard.press(i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft'); if (i % 25 === 24) await sleep(50); }
        await sleep(1200); await gc(); const a = await metrics();
        row.leak = { moves: LEAK_MOVES, nodes: a.Nodes - b.Nodes, listeners: a.JSEventListeners - b.JSEventListeners, heapKB: Math.round((a.JSHeapUsedSize - b.JSHeapUsedSize) / 1024) };
      }
      result[`${deck}@${rate}x`] = row;
      console.log(JSON.stringify(row));
      check(`[${deck} ${rate}x] 페이지 오류 없음`, errors.length === 0, errors);
      if (rate === 1) {
        check(`[${deck} 1x] 긴 작업(>50ms) 0`, row.longTasks === 0, row.longTasks);
        check(`[${deck} 1x] ${LEAK_MOVES}회 이동 뒤 노드와 리스너가 늘지 않는다`, row.leak.nodes <= 0 && row.leak.listeners <= 0, row.leak);
      }
      const b0 = base && base[`${deck}@${rate}x`];
      if (b0) {
        // 프레임 수치는 헤드리스 소프트웨어 렌더링이라 실행마다 크게 흔들린다(같은 코드 3회: p95 100~133ms, 평균 55~110ms). 눈금(16.7ms) 두 개의 여유를 둔다.
        check(`[${deck} ${rate}x] 프레임 p95가 기준선(${b0.frameP95}ms)의 110% + 34ms 이내`, row.frameP95 <= b0.frameP95 * 1.1 + 34, [row.frameP95, b0.frameP95]);
        // 스크립트와 작업 시간은 안정적이다(같은 코드 3회: 스크립트 중앙값 0.7~2.3ms).
        check(`[${deck} ${rate}x] 전환 1회의 스크립트 시간 중앙값이 기준선(${b0.scriptMsMedian}ms)의 2배 + 1ms 이내`, row.scriptMsMedian <= b0.scriptMsMedian * 2 + 1, [row.scriptMsMedian, b0.scriptMsMedian]);
        check(`[${deck} ${rate}x] 스타일과 레이아웃 시간 중앙값이 기준선(${b0.styleLayoutMsMedian}ms)의 2배 + 1ms 이내`, row.styleLayoutMsMedian <= b0.styleLayoutMsMedian * 2 + 1, [row.styleLayoutMsMedian, b0.styleLayoutMsMedian]);
        if (b0.nodes) check(`[${deck} ${rate}x] 전환 뒤 노드 수가 기준선(${b0.nodes})의 105% 이내`, row.nodes <= b0.nodes * 1.05, [row.nodes, b0.nodes]);
      }
      await ctx.close();
    }
  }
  check('측정된 덱이 하나 이상 있다', Object.keys(result).length > 0, Object.keys(result));
  if (process.env.ANIM_OUT) fs.writeFileSync(process.env.ANIM_OUT, JSON.stringify(result, null, 1));
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
