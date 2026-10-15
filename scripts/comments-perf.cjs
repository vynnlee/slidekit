/* 코멘트가 많을 때의 성능 측정(300개, 상태 섞음). 통과 기준은 넉넉한 한도이고, 수치는 출력해서 HANDOFF에 적는다.
   패널 열기, 목록 스크롤, 핀과 필름스트립 점(슬라이드 1에 100개), Send all, 상태 변경 한 번의 반응 시간과 긴 작업(50ms 이상)을 잰다.
   덱은 decks/_e2e-comments-perf 사본이고 끝에 지운다. 마우스와 키 입력은 실제 브라우저에서 한다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3245 node scripts/comments-perf.cjs */
const { launch } = require('./lib/pw.cjs');
const fs = require('fs');
const { makeTestDeck } = require('./lib/test-deck.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3245';
const J = { 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const N = 300, PINS = 100;

(async () => {
  const t = makeTestDeck('comments-perf');
  let browser;
  try {
    browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('slidekit.tip.editor', '1'); } catch {} });
    const page = await ctx.newPage();
    const api = (p, b) => fetch(`${BASE}${p}`, { method: 'POST', headers: J, body: JSON.stringify({ deck: t.folder, ...b }) });
    const open = async () => {
      await page.goto(`${BASE}/edit/${t.id}`);
      await page.getByTestId('filmstrip').waitFor();
      await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
    };
    // 시드: 슬라이드 1의 보이는 제목에 100개(핀), 나머지는 슬라이드 2 이후에 전체 코멘트
    await open();
    const head = await page.frames().find((f) => f.url().startsWith('blob:')).evaluate(() => {
      const slide = document.querySelector('section[data-slide]');
      const h = [...slide.querySelectorAll('h1, h2')].find((x) => x.getBoundingClientRect().height > 0 && x.textContent.trim());
      const parts = [];
      for (let e = h; e && e !== slide; e = e.parentElement) { const tag = e.tagName.toLowerCase(); const same = [...e.parentElement.children].filter((x) => x.tagName === e.tagName); parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag); }
      return { path: parts.join(' > '), text: h.textContent.trim().slice(0, 60) };
    });
    const ids = [];
    for (let i = 0; i < N; i++) {
      const onSlide1 = i < PINS;
      const r = await (await api('/api/comments', { slide: onSlide1 ? 1 : 2 + (i % 5), path: onSlide1 ? head.path : '', excerpt: onSlide1 ? head.text : '', text: `성능 측정 코멘트 ${i}: 제목을 조금 줄여 주세요. 같은 문장을 반복해서 길이를 맞춘다.`, hold: i % 15 === 0 })).json();
      ids.push(r.id);
    }
    // 상태 섞기: 5개 중 하나씩 전달됨, 작업 중, 답, 해결 + 서명 없음(파일에서 서명 제거)
    for (let i = 0; i < N; i++) {
      const id = ids[i], k = i % 7;
      if (k === 2 || k === 3 || k === 4) await api(`/api/comments/${id}/delivered`, {});
      if (k === 3) await api(`/api/comments/${id}/ack`, {});
      if (k === 4 || k === 5) await api(`/api/comments/${id}/reply`, { reply: '고쳤습니다' });
      if (k === 5) await api(`/api/comments/${id}/resolve`, { resolved: true });
    }
    const arr = JSON.parse(fs.readFileSync(t.commentsFile, 'utf8'));
    arr.forEach((c, i) => { if (i % 7 === 6) delete c.sig; });
    fs.writeFileSync(t.commentsFile, JSON.stringify(arr));
    console.log(`시드: 코멘트 ${arr.length}개, 슬라이드 1에 ${PINS}개`);

    // 긴 작업(50ms 이상)과 프레임 간격을 모으는 도구
    const hook = () => page.evaluate(() => {
      window.__long = []; window.__frames = []; window.__obs?.disconnect();
      window.__obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); });
      try { window.__obs.observe({ entryTypes: ['longtask'] }); } catch {}
      let last = performance.now(); window.__run = true;
      const tick = (n) => { window.__frames.push(n - last); last = n; if (window.__run) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const stats = () => page.evaluate(() => { window.__run = false; const f = window.__frames.slice(2).sort((a, b) => a - b); return { long: window.__long, frames: f.length, p50: Math.round(f[Math.floor(f.length / 2)] ?? 0), p95: Math.round(f[Math.floor(f.length * 0.95)] ?? 0), max: Math.round(f.at(-1) ?? 0) }; });
    const fmt = (s) => `긴 작업 ${s.long.length}건(최대 ${Math.max(0, ...s.long)}ms), 프레임 p50 ${s.p50}ms p95 ${s.p95}ms 최대 ${s.max}ms`;

    // 1) 패널 열기: 새로 열어 Comments 탭을 눌러 목록 300개가 그려질 때까지
    await open();
    await hook();
    const t0 = Date.now();
    await page.getByRole('tab', { name: /^Comments/ }).click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid=comments-panel] li[data-comment-id]').length >= n, N, { timeout: 20000 });
    const openMs = Date.now() - t0;
    const sOpen = await stats();
    console.log(`패널 열기 ${openMs}ms: ${fmt(sOpen)}`);
    check('패널 열기 3초 이내', openMs < 3000, openMs);

    // 2) 목록 스크롤: 패널의 스크롤 영역을 위에서 아래로 2초 동안
    await hook();
    await page.evaluate(async () => {
      const li = document.querySelector('[data-testid=comments-panel] li[data-comment-id]');
      let sc = li; while (sc && !(sc.scrollHeight > sc.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      const el = sc || document.scrollingElement; const max = el.scrollHeight - el.clientHeight; const t0 = performance.now();
      await new Promise((res) => { const step = (n) => { const p = Math.min(1, (n - t0) / 2000); el.scrollTop = max * p; if (p < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    });
    const sScroll = await stats();
    console.log(`목록 스크롤 2초: ${fmt(sScroll)}`);
    check('스크롤 중 프레임 p95 500ms 이내(마우스가 가만히 있어도 내용이 지나가며 hover가 바뀐다)', sScroll.p95 < 500, sScroll);

    // 2-2) 목록 위로 마우스를 옮기기: 항목마다 hover 상태가 바뀌어 편집기 전체가 다시 그려지는 비용(20칸)
    await page.evaluate(() => { const el = [...document.querySelectorAll('[data-testid=comments-panel] li[data-comment-id]')][0]; let sc = el; while (sc && !(sc.scrollHeight > sc.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement; (sc || document.scrollingElement).scrollTop = 0; });
    await sleep(300);
    await hook();
    const rows = page.locator('[data-testid=comments-panel] li[data-comment-id]');
    const t5 = Date.now();
    for (let i = 0; i < 20; i++) { const b = await rows.nth(i % 6).boundingBox(); if (b) await page.mouse.move(b.x + 20, b.y + 10); }
    const hoverMs = Date.now() - t5;
    const sHover = await stats();
    console.log(`목록 위 마우스 이동 20번 ${hoverMs}ms: ${fmt(sHover)}`);
    check('마우스 이동 20번에 긴 작업(200ms 이상)이 없다(hover가 편집기 전체를 다시 그리지 않는다)', Math.max(0, ...sHover.long) < 200, sHover.long);

    // 3) 슬라이드 1: 캔버스 핀 100개와 필름스트립 점. 다른 슬라이드에서 슬라이드 1로 돌아오는 시간
    const tile = (i) => page.locator('[data-testid=filmstrip] [role=option]').nth(i);
    await tile(1).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-comment-pin]').length === 0 || true);
    await hook();
    const t1 = Date.now();
    await tile(0).click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-comment-pin]').length >= n, PINS - 5, { timeout: 20000 }); // 보류와 해결까지 모두 핀이 된다
    const pinMs = Date.now() - t1;
    await sleep(1000); // 핀 위치 갱신(60ms 간격 타이머)이 도는 동안의 한가한 부하
    const sPins = await stats();
    console.log(`슬라이드 1로 이동해 핀 ${await page.locator('[data-comment-pin]').count()}개 표시 ${pinMs}ms: ${fmt(sPins)}`);
    check('핀 100개 표시 2.5초 이내', pinMs < 2500, pinMs);

    // 4) 상태 변경 한 번: 첫 코멘트에 E(해결)를 눌러 상태가 바뀌고 다음 프레임이 그려질 때까지
    const first = page.locator('[data-testid=comments-panel] [data-comment-main]').first();
    await first.focus();
    const id1 = await first.evaluate((e) => e.closest('li').getAttribute('data-comment-id'));
    const before = await page.evaluate((id) => document.querySelector(`li[data-comment-id="${id}"]`).getAttribute('data-state'), id1);
    await hook();
    const t2 = await page.evaluate(() => performance.now());
    await page.keyboard.press('e');
    await page.waitForFunction(([id, b]) => document.querySelector(`li[data-comment-id="${id}"]`)?.getAttribute('data-state') !== b, [id1, before], { timeout: 10000 });
    const t3 = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(performance.now()))));
    const stateMs = Math.round(t3 - t2);
    const sState = await stats();
    console.log(`상태 변경(E) 한 번 키 입력부터 다음 프레임까지 ${stateMs}ms: ${fmt(sState)}`);
    check('상태 변경이 1.5초 이내에 보인다', stateMs < 1500, stateMs);

    // 5) Send all: 보류 20개를 풀고 목록이 갱신될 때까지(채널 없이 서버가 보류만 푼다)
    const heldBefore = await page.locator('[data-testid=comments-panel] li[data-state="held"]').count();
    await hook();
    const t4 = Date.now();
    await page.getByRole('button', { name: /^Send all to Claude/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-state="held"]').length < 11, null, { timeout: 15000 }); // 한 번에 10개까지
    const sendMs = Date.now() - t4;
    const sSend = await stats();
    console.log(`Send all(보류 ${heldBefore}개 중 10개) ${sendMs}ms: ${fmt(sSend)}`);
    check('Send all이 3초 이내에 반영된다', sendMs < 3000, sendMs);

    check('긴 작업(1.5초 이상)이 없다', [sOpen, sScroll, sPins, sState, sSend].every((s) => Math.max(0, ...s.long) < 1500), [sOpen.long, sScroll.long, sPins.long, sState.long, sSend.long]);
  } catch (e) { fail++; console.log('FAIL 예외 ' + e); }
  finally { if (browser) await browser.close(); t.cleanup(); }
  console.log(fail ? `${fail} failed` : 'all passed');
  process.exit(fail ? 1 : 0);
})();
