/* 큰 덱에서 편집기의 응답을 잰다(슬라이드 80장, 요소 많은 슬라이드, Layers 1000행). 수치를 INFO로 찍고 넉넉한 한도만 검사한다.
   한도는 느린 기계(낮은 우선순위)에서도 통과하도록 잡은 "눈에 띄게 멈춤" 기준이다. 실행: bun scripts/test.ts --only editor-perf */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-perf', slides: 2 });
  const { fs, FILE, T, BASE, check, page, settle, focusBody, fr, cond, layers, rowsL } = H;
  // 80장 덱: 장마다 요소 40개. 마지막(80번째) 장은 요소 1000개(Layers 행 시험).
  const html = fs.readFileSync(FILE, 'utf8');
  const first = html.search(/<section\b[^>]*\bdata-slide\b/);
  const tail = html.lastIndexOf('</section>') + '</section>'.length;
  const card = (i, k) => `<div style="position:absolute;left:${(k % 40) * 46}px;top:${120 + Math.floor(k / 40) * 36}px;width:44px;height:32px"><p>Item ${i}-${k}</p></div>`; // 모두 슬라이드 안에 들어가게 촘촘히(넘침 경고가 대량으로 뜨지 않게)
  const sec = (i, count) => `<section data-slide="p${i}"><h2>Perf slide ${i}</h2>${Array.from({ length: count }, (_, k) => card(i, k)).join('')}</section>`;
  const body = Array.from({ length: 80 }, (_, i) => sec(i + 1, i === 79 ? 1000 : i === 78 ? 150 : 40)).join('\n');
  fs.writeFileSync(FILE, html.slice(0, first) + body + html.slice(tail));
  const ms = (t0) => Math.round(performance.now() - t0);
  const info = (label, v) => console.log('INFO ' + label + ' ' + v + 'ms');

  // 1. 열기: 이동 시작부터 첫 슬라이드가 그려질 때까지
  let t0 = performance.now();
  await page.goto(BASE + '/edit/' + T.id);
  await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active] h2'); }, null, { timeout: 60000 });
  const open = ms(t0); info('80장 덱 열기', open);
  check('열기 15초 이내', open < 15000, open);
  await settle();
  check('필름스트립 타일이 가상화됨(DOM 타일 80 미만)', (await layers.count()) <= 80);

  // 2. 선택 응답: 요소를 눌러 선택 외곽선이 뜨기까지
  const pt = await fr().evaluate(() => { const r = document.querySelector('[data-active] > div').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const box = await page.locator('iframe[title="Canvas"]').boundingBox();
  t0 = performance.now();
  await page.mouse.click(box.x + pt[0], box.y + pt[1]);
  await page.locator('.border-2.border-focus-ring').first().waitFor({ state: 'visible', timeout: 10000 });
  const sel = ms(t0); info('요소 선택 응답', sel);
  check('선택 응답 2초 이내', sel < 2000, sel);

  // 3. 드래그 중 프레임: 40걸음 이동하는 동안 상위 문서의 긴 작업(50ms 초과)과 프레임 간격 최댓값
  await page.evaluate(() => { window.__lt = []; window.__gaps = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch {} });
  await page.mouse.move(box.x + pt[0], box.y + pt[1]); await page.mouse.down();
  for (let i = 1; i <= 40; i++) { await page.mouse.move(box.x + pt[0] + i * 4, box.y + pt[1] + i * 2); }
  await page.mouse.up(); await settle();
  const drag = await page.evaluate(() => ({ longest: Math.round(Math.max(0, ...window.__lt)), n: window.__lt.length, maxGap: Math.round(Math.max(...window.__gaps)) }));
  console.log('INFO 드래그 긴 작업 ' + drag.n + '건, 최장 ' + drag.longest + 'ms, 프레임 간격 최대 ' + drag.maxGap + 'ms');
  check('드래그 중 프레임 간격 최대 1초 이내', drag.maxGap < 1000, drag);
  await page.keyboard.press('Meta+z'); await settle();

  let prof = null;
  if (process.env.PROFILE === '1') { prof = await page.context().newCDPSession(page); await prof.send('Profiler.enable'); await prof.send('Profiler.start'); }
  // 4a. 현실적인 큰 슬라이드(요소 150개): 79번째 슬라이드로 이동해 Layers 행이 그려지기까지
  await layers.first().click(); await page.keyboard.press('End'); await settle();
  t0 = performance.now();
  await page.keyboard.press('ArrowLeft'); // 80번째에서 79번째로
  await cond(() => document.querySelectorAll('[data-testid=layer-row]').length > 140 && document.querySelectorAll('[data-testid=layer-row]').length < 400, null, 20000);
  const lay150 = ms(t0); info('Layers 150행 슬라이드로 이동', lay150);
  check('Layers 150행 이동 4초 이내', lay150 < 4000, lay150);
  // 4. Layers 1000행: 80번째 슬라이드로 가서 행이 그려지기까지
  t0 = performance.now();
  await page.keyboard.press('ArrowRight'); // 79번째에서 80번째(요소 1000개)로
  await cond(() => document.querySelectorAll('[data-testid=layer-row]').length > 900, null, 40000);
  const rows = await rowsL.count(); const lay = ms(t0); info('Layers 1000행 슬라이드로 이동(행 ' + rows + '개 DOM)', lay);
  if (prof) {
    const { profile } = await prof.send('Profiler.stop'); const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
    const parent = new Map(); profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
    const via = new Map(); profile.samples.forEach((id, i) => { const n = byId.get(id); if (!/getBoundingClientRect|pathOf|setAttribute/.test(n.callFrame.functionName)) return; let q = parent.get(id), chain = []; for (let d = 0; q && d < 4; d++) { const m = byId.get(q); chain.push(m.callFrame.functionName + ':' + m.callFrame.lineNumber); q = parent.get(q); } const k = n.callFrame.functionName + ' < ' + chain.join(' < '); via.set(k, (via.get(k) || 0) + (dt[i] || 0)); });
    console.log('VIA ' + [...via.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => Math.round(v / 1000) + 'ms ' + k).join(' | '));
    console.log('PROFILE ' + [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => Math.round(v / 1000) + 'ms ' + k).join(' | '));
  }
  check('Layers 행이 그려짐', rows > 100, rows);
  check('Layers 1000행 이동 30초 이내(개발 빌드 기준, 극단 사례)', lay < 30000, lay);

  console.log('INFO 넘침 후보 수 ' + await fr().evaluate(() => { const sl = document.querySelector('[data-active]'), sr = sl.getBoundingClientRect(); return [...sl.children].filter((c) => { const r = c.getBoundingClientRect(); return r.right > sr.right + 2 || r.bottom > sr.bottom + 2 || r.left < sr.left - 2 || r.top < sr.top - 2; }).length + '/' + sl.children.length + ' sl ' + Math.round(sr.width) + 'x' + Math.round(sr.height); }));
  // 4b. 1000행 위에서 호버 10번(행 위로 마우스를 옮길 때마다 트리가 다시 그려지는지)
  const r0 = await rowsL.nth(5).boundingBox();
  if (process.env.PROFILE === 'hover') { prof = await page.context().newCDPSession(page); await prof.send('Profiler.enable'); await prof.send('Profiler.start'); }
  await page.evaluate(() => { window.__lt.length = 0; });
  t0 = performance.now();
  for (let i = 0; i < 10; i++) { await page.mouse.move(r0.x + 40, r0.y + 3 + (i % 4) * 28); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); }
  const hov = Math.round(ms(t0) / 10); info('Layers 1000행 호버 1회 평균', hov);
    if (prof) {
      const { profile } = await prof.send('Profiler.stop'); const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
      const parent = new Map(); profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
      const via = new Map(); profile.samples.forEach((id, i) => { const n = byId.get(id); if (!/getBoundingClientRect|pathOf|setAttribute/.test(n.callFrame.functionName)) return; let q = parent.get(id), chain = []; for (let d = 0; q && d < 4; d++) { const m = byId.get(q); chain.push(m.callFrame.functionName + ':' + m.callFrame.lineNumber); q = parent.get(q); } const k = n.callFrame.functionName + ' < ' + chain.join(' < '); via.set(k, (via.get(k) || 0) + (dt[i] || 0)); });
      console.log('VIA ' + [...via.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => Math.round(v / 1000) + 'ms ' + k).join(' | '));
      console.log('PROFILE ' + [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => Math.round(v / 1000) + 'ms ' + k).join(' | '));
    }
  const hlt = await page.evaluate(() => ({ n: window.__lt.length, longest: Math.round(Math.max(0, ...window.__lt)) }));
  console.log('INFO 호버 중 긴 작업 ' + hlt.n + '건, 최장 ' + hlt.longest + 'ms(0이면 트리가 다시 그려지지 않음)');
  check('호버가 트리를 다시 그리지 않음(긴 작업 300ms 이내)', hlt.longest < 300, hlt);

  // 5. 찾기: 80장 전체에서 한 글자 찾기 응답
  await focusBody(); await page.keyboard.press('Meta+f');
  if (process.env.PROFILE === 'find') { prof = await page.context().newCDPSession(page); await prof.send('Profiler.enable'); await prof.send('Profiler.start'); }
  t0 = performance.now();
  await page.getByLabel('Find', { exact: true }).fill('Item');
  await cond(() => /\d+ of \d+ in/.test(document.querySelector('[data-testid=find-count]')?.textContent || ''), null, 20000);
  const find = ms(t0);
  if (prof && process.env.PROFILE === 'find') { const { profile } = await prof.send('Profiler.stop'); const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n])); profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0)); }); console.log('PROFILE ' + [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => Math.round(v / 1000) + 'ms ' + k).join(' | ')); } info('찾기(80장, 요소 약 4천 개)', find);
  check('찾기 응답 6초 이내(개발 빌드, 요소 약 4천 개)', find < 6000, find);
  await H.finish();
})();
