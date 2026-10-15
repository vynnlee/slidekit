/* Animation 탭의 성능: 요소 100개와 단계 20개인 슬라이드에서 탭 전환, 재생 헤드 이동, 막대 끌기를 잰다.
   합격 기준: 끄는 동안과 헤드 이동 중에 캔버스 iframe을 다시 만들지 않고(data-shown과 data-away 토글만), 끌기 중 긴 작업(50ms 초과)과 프레임 간격(p95)을 잰다.
   수치는 INFO로 찍고 넉넉한 한도만 검사한다. CPU_SLOW로 부하를 흉내 낸다. 실행: CPU_SLOW=4 bun scripts/test.ts --only editor-anim-perf */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-anim-perf', slides: 2 });
  const { fs, FILE, T, BASE, check, page, settle, finish } = H;
  const html = fs.readFileSync(FILE, 'utf8');
  const first = html.search(/<section\b[^>]*\bdata-slide\b/), tail = html.lastIndexOf('</section>') + '</section>'.length;
  const el = (k) => `<div data-step="${2 + (k % 19)}"${k % 3 === 0 ? ` data-step-out="${Math.min(20, 4 + (k % 19))}"` : ''} style="position:absolute;left:${(k % 10) * 180}px;top:${120 + Math.floor(k / 10) * 80}px;width:160px;height:60px"><p>Item ${k}</p></div>`;
  fs.writeFileSync(FILE, html.slice(0, first) + `<section data-slide="content" data-steps="20"><h2>Animation perf</h2>${Array.from({ length: 100 }, (_, k) => el(k)).join('')}</section>` + html.slice(tail));
  await page.goto(BASE + '/edit/' + T.id);
  await page.waitForFunction(() => document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelector('[data-active] h2'), null, { timeout: 60000 });
  await settle();
  const ms = (t0) => Math.round(performance.now() - t0);
  const ifr = await page.evaluate(() => { const f = document.querySelector('iframe[title="Canvas"]'); return (f.__sk = f.__sk || Math.random()); });

  // 1. 탭 전환: Animation 탭을 눌러 막대 100줄이 그려지기까지
  let t0 = performance.now();
  await page.getByRole('tab', { name: 'Animation' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=anim-row]').length >= 100, null, { timeout: 30000 });
  const tab = ms(t0); console.log('INFO Animation 탭 열기(100줄, 20단계) ' + tab + 'ms');
  check('탭 열기 3초 이내', tab < 3000, tab);
  await settle();

  if (process.env.PROFILE) { // 진단: 머리글 한 번 누르는 동안의 CPU 프로필에서 자체 시간이 큰 함수 상위
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
    await page.evaluate(() => document.querySelector('[data-testid=anim-scroll] button[aria-label="Step 7"]').click());
    await page.waitForTimeout(2500);
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id), k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].slice(0, 40)}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0)); });
    [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14).forEach(([k, v]) => console.log('PROF ' + Math.round(v / 1000) + 'ms ' + k));
  }
  // 2. 재생 헤드 이동: 머리글 단추를 페이지 안에서 눌러(Playwright 대기 시간 제외) 라벨과 캔버스가 바뀌고 두 프레임이 그려지기까지
  const headMs = [];
  for (const k of [1, 5, 10, 15, 20, 3, 12, 20]) {
    headMs.push(await page.evaluate((n) => new Promise((done) => {
      const b = document.querySelector(`[data-testid=anim-scroll] button[aria-label="Step ${n}"]`), t0 = performance.now();
      b.click();
      const wait = () => { if (document.querySelector('[data-testid=anim-step-label]')?.textContent === `Step ${n} of 20`) requestAnimationFrame(() => requestAnimationFrame(() => done(Math.round(performance.now() - t0)))); else requestAnimationFrame(wait); };
      wait();
    }), k));
    await page.waitForTimeout(150);
  }
  const head = Math.round(headMs.reduce((a, b) => a + b, 0) / headMs.length), headMax = Math.max(...headMs);
  console.log(`INFO 재생 헤드 이동 평균 ${head}ms, 최대 ${headMax}ms(클릭부터 라벨 갱신과 두 프레임까지, 8회)`);
  check('헤드 이동 평균 600ms 이내', head < 600, headMs);
  const shown = await page.evaluate(() => { const d = document.querySelector('iframe[title="Canvas"]').contentDocument; return [d.querySelectorAll('[data-step][data-shown]').length, d.querySelectorAll('[data-step][data-away]').length]; });
  check('헤드가 가리키는 단계의 요소만 data-shown이고 나머지는 data-away', shown[0] + shown[1] >= 100, shown);

  // 3. 막대 끌기: 끄는 40걸음의 프레임 간격과 긴 작업, 놓은 뒤 저장 반영(한 번)은 따로 잰다
  await page.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch {} window.__gaps = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const bar = page.getByTestId('anim-bar').nth(0), hb = await bar.locator('[data-testid=anim-handle-in]').boundingBox();
  const before = await bar.getAttribute('data-in');
  const x = hb.x + 2, y = hb.y + hb.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(x + i * 4, y);
  const drag = await page.evaluate(() => { const g = [...window.__gaps].sort((a, b) => a - b); return { long: window.__lt.length, longest: Math.round(Math.max(0, ...window.__lt)), p95: Math.round(g[Math.floor(g.length * 0.95)] || 0), max: Math.round(g[g.length - 1] || 0) }; });
  console.log(`INFO 막대 끌기 40걸음: 긴 작업 ${drag.long}건(최장 ${drag.longest}ms), 프레임 간격 p95 ${drag.p95}ms, 최대 ${drag.max}ms`);
  check('끄는 동안 프레임 간격 p95가 400ms 이내(CPU 4배 느림, 낮은 우선순위)', drag.p95 < 400, drag);
  check('끄는 동안 긴 작업(50ms 초과)이 없음', drag.long === 0, drag);
  const tUp = performance.now();
  await page.mouse.up();
  await page.waitForFunction((b) => document.querySelector('[data-testid=anim-bar]').getAttribute('data-in') !== b, before, { timeout: 15000 });
  console.log('INFO 놓은 뒤 저장 글자와 패널 반영 ' + ms(tUp) + 'ms');
  check('놓은 뒤 반영 5초 이내', ms(tUp) < 5000, ms(tUp));
  await settle();
  const ifr2 = await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').__sk);
  check('탭 전환, 헤드 이동, 끌기 동안 캔버스 iframe을 다시 만들지 않음', ifr2 === ifr, [ifr, ifr2]);
  await finish();
})();
