/* Animation 탭의 성능: 요소 100개와 단계 20개인 슬라이드에서 탭 전환, 재생 헤드 이동, 막대 끌기를 잰다.
   합격 기준: 끄는 동안과 헤드 이동 중에 캔버스 iframe을 다시 만들지 않고(data-shown과 data-away 토글만), 끌기 중 긴 작업(50ms 초과)과 프레임 간격(p95)을 잰다.
   수치는 INFO로 찍고 넉넉한 한도만 검사한다. CPU_SLOW로 부하를 흉내 낸다. 실행: CPU_SLOW=4 bun scripts/test.ts --only editor-anim-perf */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-anim-perf', slides: 2 });
  const { fs, FILE, T, BASE, check, page, settle, finish } = H;
  const html = fs.readFileSync(FILE, 'utf8');
  const first = html.search(/<section\b[^>]*\bdata-slide\b/), tail = html.lastIndexOf('</section>') + '</section>'.length;
  const el = (k) => `<div data-step="${2 + (k % 19)}"${k % 3 === 0 ? ` data-step-out="${Math.min(21, 4 + (k % 19))}"` : ''} style="position:absolute;left:${(k % 10) * 180}px;top:${120 + Math.floor(k / 10) * 80}px;width:160px;height:60px"><p>Item ${k}</p></div>`;
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

  // 2. 재생 헤드 이동: 머리글을 연달아 눌러 캔버스가 그 단계로 바뀌기까지
  const marks = await page.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch {} window.__gaps = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; });
  const headers = page.locator('[data-testid=anim-scroll] [role=columnheader] button');
  t0 = performance.now();
  for (const k of [1, 5, 10, 15, 20, 3, 12, 20]) { await headers.nth(k - 1).click(); await page.waitForFunction((n) => document.querySelector('[data-testid=anim-step-label]')?.textContent === `Step ${n} of 20`, k, { timeout: 10000 }); }
  const head = Math.round(ms(t0) / 8); console.log('INFO 재생 헤드 이동 1회 평균 ' + head + 'ms(클릭부터 라벨과 캔버스 갱신까지, 8회)');
  check('헤드 이동 1회 1초 이내', head < 1000, head);
  const shown = await page.evaluate(() => { const d = document.querySelector('iframe[title="Canvas"]').contentDocument; return [d.querySelectorAll('[data-step][data-shown]').length, d.querySelectorAll('[data-step][data-away]').length]; });
  check('헤드가 가리키는 단계의 요소만 data-shown이고 나머지는 data-away', shown[0] + shown[1] >= 100, shown);

  // 3. 막대 끌기: 40걸음 동안 긴 작업과 프레임 간격
  await page.evaluate(() => { window.__lt.length = 0; window.__gaps.length = 0; });
  const bar = page.getByTestId('anim-bar').nth(0), hb = await bar.locator('[data-testid=anim-handle-in]').boundingBox();
  const x = hb.x + 2, y = hb.y + hb.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(x + (i % 20) * 3, y);
  await page.mouse.up(); await settle();
  const drag = await page.evaluate(() => { const g = [...window.__gaps].sort((a, b) => a - b); return { long: window.__lt.length, longest: Math.round(Math.max(0, ...window.__lt)), p95: Math.round(g[Math.floor(g.length * 0.95)] || 0), max: Math.round(g[g.length - 1] || 0) }; });
  console.log(`INFO 막대 끌기 40걸음: 긴 작업 ${drag.long}건(최장 ${drag.longest}ms), 프레임 간격 p95 ${drag.p95}ms, 최대 ${drag.max}ms`);
  check('끄는 동안 프레임 간격 p95가 250ms 이내', drag.p95 < 250, drag);
  const ifr2 = await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').__sk);
  check('탭 전환, 헤드 이동, 끌기 동안 캔버스 iframe을 다시 만들지 않음', ifr2 === ifr, [ifr, ifr2]);
  await finish();
})();
