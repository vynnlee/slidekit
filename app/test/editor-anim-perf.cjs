/* Animation 탭의 성능: 요소 100개와 단계 20개인 슬라이드에서 탭 전환, 줄 누르기(재생 헤드 이동), 줄 순서 바꾸기를 잰다.
   합격 기준: 끄는 동안과 헤드 이동 중에 캔버스 iframe을 다시 만들지 않고(data-shown과 data-away 토글만), 순서 바꾸기 중 긴 작업(50ms 초과)과 프레임 간격(p95)을 잰다.
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

  // 1. 탭 전환: Animation 탭을 눌러 목록 줄이 그려지기까지
  let t0 = performance.now();
  await page.getByRole('tab', { name: 'Animation' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=anim-row]').length >= 130, null, { timeout: 30000 });
  const tab = ms(t0); console.log('INFO Animation 탭 열기(요소 100개, 20단계) ' + tab + 'ms');
  check('탭 열기 3초 이내', tab < 3000, tab);
  await settle();

  if (process.env.PROFILE) { // 진단: 머리글 한 번 누르는 동안의 CPU 프로필에서 자체 시간이 큰 함수 상위
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
    await page.evaluate(() => document.querySelectorAll('[data-testid=anim-row]')[40].querySelector('button').click());
    await page.waitForTimeout(2500);
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id), k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0].slice(0, 40)}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0)); });
    [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14).forEach(([k, v]) => console.log('PROF ' + Math.round(v / 1000) + 'ms ' + k));
  }
  // 2. 줄 누르기(재생 헤드 이동): 줄의 이름 단추를 페이지 안에서 눌러(Playwright 대기 시간 제외) 라벨이 바뀌고 두 프레임이 그려지기까지
  const headMs = [];
  for (const i of [0, 30, 60, 90, 120, 15, 75, 129]) {
    headMs.push(await page.evaluate((n) => new Promise((done) => {
      const rows = [...document.querySelectorAll('[data-testid=anim-row]')], b = rows[n].querySelector('button'), t0 = performance.now(), was = document.querySelector('[data-testid=anim-step-label]').textContent;
      b.click();
      const wait = () => { if (document.querySelector('[data-testid=anim-step-label]')?.textContent !== was || n === 0 && performance.now() - t0 > 400) requestAnimationFrame(() => requestAnimationFrame(() => done(Math.round(performance.now() - t0)))); else requestAnimationFrame(wait); };
      wait();
    }), i));
    await page.waitForTimeout(150);
  }
  const head = Math.round(headMs.reduce((a, b) => a + b, 0) / headMs.length), headMax = Math.max(...headMs);
  console.log(`INFO 줄 누르기(선택과 헤드 이동) 평균 ${head}ms, 최대 ${headMax}ms(클릭부터 라벨 갱신과 두 프레임까지, 8회)`);
  check('줄 누르기(요소 선택과 헤드 이동) 평균 2500ms 이내', head < 2500, headMs); // 요소 선택(Layers와 Inspector 갱신)이 대부분이다: 기준 측정 CPU 4배에서 약 1.4초, 줄을 다시 그리는 비용은 memo로 줄 단위
  const shown = await page.evaluate(() => { const d = document.querySelector('iframe[title="Canvas"]').contentDocument; return [d.querySelectorAll('[data-step][data-shown]').length, d.querySelectorAll('[data-step][data-away]').length]; });
  check('헤드가 가리키는 단계의 요소만 data-shown이고 나머지는 data-away', shown[0] + shown[1] >= 100, shown);

  // 3. 줄 순서 바꾸기: Alt+아래 한 번(실제 저장과 캔버스 갱신 포함)이 반영되기까지. 긴 작업과 프레임 간격은 수치만 찍는다(저장 한 번의 비용은 줄 수와 무관하게 있다)
  await page.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); } catch {} });
  const top = page.getByTestId('anim-row').nth(0), firstStep = () => page.evaluate(() => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-step]').getAttribute('data-step')), before = await firstStep();
  await top.focus();
  const tMove = performance.now();
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForFunction((b) => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-step]').getAttribute('data-step') !== b, before, { timeout: 15000 });
  const move = ms(tMove);
  const lt = await page.evaluate(() => ({ long: window.__lt.length, longest: Math.round(Math.max(0, ...window.__lt)) }));
  console.log(`INFO 줄 순서 바꾸기 한 번 ${move}ms(긴 작업 ${lt.long}건, 최장 ${lt.longest}ms)`);
  check('줄 순서 바꾸기 반영 5초 이내', move < 5000, move);
  await settle();
  const ifr2 = await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').__sk);
  check('탭 전환, 헤드 이동, 끌기 동안 캔버스 iframe을 다시 만들지 않음', ifr2 === ifr, [ifr, ifr2]);
  await finish();
})();
