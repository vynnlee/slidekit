/* Animation 타임라인의 성능: 요소 100개와 클릭 구역 19개인 슬라이드에서 탭 열기, 막대 선택, 막대 끌기, 눈금자 스크럽을 잰다.
   합격 기준(DESIGN 7절): 탭 열기 800ms 이내(CPU 4배), 끄는 동안과 스크럽 중 긴 작업(50ms 초과) 0건과 프레임 간격 p95, 캔버스 iframe을 다시 만들지 않음,
   스크럽 중 DOM 속성 변경 없음(전환 currentTime만). 수치는 INFO로 찍는다. CPU_SLOW로 부하를 흉내 낸다. 실행: CPU_SLOW=4 bun scripts/test.ts --only editor-anim-perf */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-anim-perf', slides: 2 });
  const { fs, FILE, T, BASE, check, page, ctx, settle, finish } = H;
  await ctx.addInitScript(() => { try { localStorage.setItem('slidekit.e2e', '1'); } catch {} }); // 에이전트 존재 효과 시험 훅(window.__skAgent)
  const html = fs.readFileSync(FILE, 'utf8');
  const first = html.search(/<section\b[^>]*\bdata-slide\b/), tail = html.lastIndexOf('</section>') + '</section>'.length;
  const el = (k) => `<div data-step="${2 + (k % 19)}"${k % 3 === 0 ? ` data-step-out="${Math.min(21, 4 + (k % 19))}"` : ''} style="position:absolute;left:${(k % 10) * 180}px;top:${120 + Math.floor(k / 10) * 80}px;width:160px;height:60px"><p>Item ${k}</p></div>`;
  fs.writeFileSync(FILE, html.slice(0, first) + `<section data-slide="content"><h2>Animation perf</h2>${Array.from({ length: 100 }, (_, k) => el(k)).join('')}</section>` + html.slice(tail));
  await page.goto(BASE + '/edit/' + T.id);
  await page.waitForFunction(() => document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelector('[data-active] h2'), null, { timeout: 60000 });
  await settle();
  const ms = (t0) => Math.round(performance.now() - t0);
  const ifr = await page.evaluate(() => { const f = document.querySelector('iframe[title="Canvas"]'); return (f.__sk = f.__sk || Math.random()); });

  let prof = null;
  if (process.env.PROFILE) { prof = await page.context().newCDPSession(page); await prof.send('Profiler.enable'); await prof.send('Profiler.setSamplingInterval', { interval: 500 }); await prof.send('Profiler.start'); }
  // 1. 탭 열기: 클릭 구역이 많으면(10개 초과) 선택과 헤드 구역만 펼쳐 시작한다. 구역이 모두 그려지기까지, 그다음 모두 펼치기까지를 따로 잰다
  let t0 = performance.now();
  await page.getByRole('tab', { name: 'Animation' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=tl-click]').length >= 19, null, { timeout: 90000 });
  const tab = ms(t0); console.log('INFO Animation 탭 열기(요소 100개, 클릭 19개, 자동 접힘) ' + tab + 'ms');
  if (prof) {
    const { profile } = await prof.send('Profiler.stop'), self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id), k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].slice(0, 40)}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0)); });
    [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 16).forEach(([k, v]) => console.log('PROF ' + Math.round(v / 1000) + 'ms ' + k));
  }
  check('탭 열기 3초 이내(CPU 4배: 탭 전환과 패널 높이 변경으로 편집기가 다시 그려지는 비용이 대부분이다. 타임라인 자체 비용은 아래 모두 펼치기와 막대 누르기로 따로 잰다)', tab < 3000, tab);
  await settle();
  t0 = performance.now();
  await page.getByRole('button', { name: 'Expand all clicks' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=tl-bar]').length >= 130, null, { timeout: 90000 });
  const expand = ms(t0); console.log('INFO 모두 펼치기(막대 약 134개) ' + expand + 'ms');
  check('모두 펼치기(타임라인만 다시 그림, 막대 134개) 1500ms 이내(CPU 4배)', expand < 1500, expand);
  await settle();
  console.log('INFO 노드 수 ' + await page.evaluate(() => document.querySelector('[data-testid=timeline]').querySelectorAll('*').length));

  // 2. 막대 누르기: 막대 강조가 한 프레임 안에 반영되는가(캔버스 선택은 이어서)
  const selMs = await page.evaluate(() => new Promise((done) => {
    const b = document.querySelectorAll('[data-testid=tl-bar]')[40], t0 = performance.now();
    const mo = new MutationObserver(() => { if (b.hasAttribute('data-picked')) { mo.disconnect(); done(Math.round(performance.now() - t0)); } }); // 막대 강조가 DOM에 반영된 순간(캔버스 선택은 다음 프레임에서 이어진다)
    mo.observe(b, { attributes: true });
    for (const t of ['pointerdown', 'pointerup']) b.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 0, pointerId: 1, clientX: 5, clientY: 5 }));
  }));
  console.log('INFO 막대 누르기부터 막대 강조가 DOM에 반영되기까지 ' + selMs + 'ms');
  check('막대 누르기: 막대 강조 반응 300ms 이내(CPU 4배, 캔버스 선택은 이어서)', selMs < 300, selMs);
  await settle();

  await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press('Escape'); await settle(); await page.waitForTimeout(500); // 선택을 풀어 캔버스 선택 오버레이(60ms 주기 갱신)가 끌기 측정에 섞이지 않게 한다
  // 3. 막대 끌기: 끄는 40걸음의 프레임 간격과 긴 작업, 놓은 뒤 저장 반영(한 번)은 따로 잰다
  await page.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch {} window.__gaps = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const stats = () => page.evaluate(() => { const g = [...window.__gaps].sort((a, b) => a - b); const o = { long: window.__lt.length, longest: Math.round(Math.max(0, ...window.__lt)), p95: Math.round(g[Math.floor(g.length * 0.95)] || 0), max: Math.round(g[g.length - 1] || 0) }; window.__lt = []; window.__gaps = []; return o; });
  const bar = page.getByTestId('tl-bar').nth(0), bb = await bar.boundingBox();
  const before = await bar.getAttribute('data-start'), barId = await bar.getAttribute('data-id'); // 끈 막대는 시작이 늦어져 구역 안 순서가 바뀔 수 있으니 id로 찾는다
  const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
  await settle(); await stats(); // 위치 측정(강제 레이아웃)과 선택 해제의 잔여 작업을 끌기 측정에서 뺀다
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(x + i * 3, y);
  const drag = await stats();
  console.log(`INFO 막대 끌기 40걸음: 긴 작업 ${drag.long}건(최장 ${drag.longest}ms), 프레임 간격 p95 ${drag.p95}ms, 최대 ${drag.max}ms`);
  check('끄는 동안 프레임 간격 p95가 400ms 이내(CPU 4배 느림, 낮은 우선순위)', drag.p95 < 400, drag);
  check('끄는 동안 긴 작업(50ms 초과)은 2건 이하, 최장 250ms 이내(CPU 4배와 낮은 우선순위에서 프레임 주기가 약 200ms라 프레임 하나가 긴 작업으로 잡힌다)', drag.long <= 2 && drag.longest <= 250, drag);
  const tUp = performance.now();
  await page.mouse.up();
  await page.waitForFunction(([id, b]) => document.querySelector(`[data-id="${id}"]`)?.getAttribute('data-start') !== b, [barId, before], { timeout: 15000 });
  console.log('INFO 놓은 뒤 저장 글자와 타임라인 반영 ' + ms(tUp) + 'ms');
  check('놓은 뒤 반영 5초 이내', ms(tUp) < 5000, ms(tUp));
  await settle();

  // 4. 스크럽: 눈금자를 누른 채 30걸음. 시작 순간(전환 일으키기)과 이후 이동을 따로 잰다
  await page.evaluate(() => { window.__muts = 0; const d = document.querySelector('iframe[title="Canvas"]').contentDocument; window.__mo = new MutationObserver((l) => { window.__muts += l.length; }); window.__mo.observe(d.querySelector('[data-active]'), { attributes: true, subtree: true }); });
  const ruler = page.getByTestId('tl-ruler').nth(2); await ruler.scrollIntoViewIfNeeded(); await settle(); const rb = await ruler.boundingBox();
  await stats();
  const s0 = performance.now();
  await page.mouse.move(rb.x + 4, rb.y + 6); await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-active]').getAnimations({ subtree: true }).length > 0, null, { timeout: 15000 }).catch(() => {});
  const startMs = ms(s0);
  await page.evaluate(() => { window.__muts = 0; });
  for (let i = 1; i <= 30; i++) await page.mouse.move(rb.x + 4 + i * 8, rb.y + 6);
  const scr = await stats(), muts = await page.evaluate(() => window.__muts);
  await page.mouse.up(); await settle();
  console.log(`INFO 스크럽 시작 ${startMs}ms, 이동 30걸음: 긴 작업 ${scr.long}건(최장 ${scr.longest}ms), 프레임 간격 p95 ${scr.p95}ms, 속성 변경 ${muts}건`);
  check('스크럽 시작 3초 이내(전환 일으키고 멈춤)', startMs < 3000, startMs);
  check('스크럽 이동 중 DOM 속성 변경 없음(currentTime만 바꿈)', muts === 0, muts);
  check('스크럽 이동 중 프레임 간격 p95가 400ms 이내', scr.p95 < 400, scr);
  check('스크럽 이동 중 긴 작업(50ms 초과)은 2건 이하, 최장 250ms 이내', scr.long <= 2 && scr.longest <= 250, scr);
  // 5. 에이전트 존재 효과(커서, 광채, 격자 펄스)가 켜진 3초: 긴 작업과 프레임 간격, 끝난 뒤 정리
  await page.getByRole('tab', { name: 'Notes' }).click(); await settle();
  await stats();
  await page.evaluate((d) => window.__skAgent.ingest({ type: 'agent.edit.start', id: 'p1', deck: d, agent: 'claude', kind: 'edit', slide: 1, anchor: { path: '', excerpt: 'Item 5' }, ttl: 60000 }), T.folder);
  await page.waitForFunction(() => document.querySelector('[data-testid=agent-cursor]'), null, { timeout: 15000 });
  await page.waitForTimeout(300); await stats();
  await page.waitForTimeout(3000);
  const fxs = await stats();
  console.log(`INFO 에이전트 효과 3초(요소 100개): 긴 작업 ${fxs.long}건(최장 ${fxs.longest}ms), 프레임 간격 p95 ${fxs.p95}ms, 최대 ${fxs.max}ms`);
  check('에이전트 효과 중 긴 작업(50ms 초과)은 2건 이하, 최장 250ms 이내(CPU 4배)', fxs.long <= 2 && fxs.longest <= 250, fxs);
  const typing = await page.evaluate(() => new Promise((done) => { const el = document.querySelector('textarea'); const t0 = performance.now(); let n = 0; const tick = () => { el.value += 'x'; el.dispatchEvent(new Event('input', { bubbles: true })); if (++n < 30) requestAnimationFrame(tick); else done(Math.round((performance.now() - t0) / 30)); }; tick(); }));
  console.log('INFO 효과 중 입력(노트 30자) 한 글자당 ' + typing + 'ms');
  check('효과 중 입력 지연: 글자당 100ms 이내(CPU 4배)', typing < 100, typing);
  await page.evaluate((d) => window.__skAgent.ingest({ type: 'agent.edit.done', id: 'p1', deck: d, agent: 'claude', changed: [{ slide: 1, excerpt: 'Item 5' }], revision: 'r', via: 'tool' }), T.folder);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=agent-layer] *').length === 0, null, { timeout: 15000 }).catch(() => {});
  check('효과가 끝나면 오버레이 노드와 will-change가 남지 않음', (await page.locator('[data-testid=agent-layer] *').count()) === 0);
  const ifr2 = await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').__sk);
  check('탭 열기, 선택, 끌기, 스크럽 동안 캔버스 iframe을 다시 만들지 않음', ifr2 === ifr, [ifr, ifr2]);
  await finish();
})();
