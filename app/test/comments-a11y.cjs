/* 코멘트 화면의 키보드와 접근성 검증.
   패널에서 Tab, 방향키, J와 K로 목록을 훑고 E(해결), Delete(삭제와 Undo), Enter(그 슬라이드로 이동), Send all을 키보드로 하고,
   같은 요소의 핀이 겹치지 않고 각각 포커스되며, 상태가 색이 아니라 글자로도 구분되고, 작성창은 Esc로 닫혀 포커스가 돌아오는지 본다.
   AXE가 있으면 상태를 모두 펼친 화면에서 serious 이상 위반(색 대비 포함)이 없는지도 본다.
   덱은 decks/_e2e-comments-a11y 사본이고 끝에 지운다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3245 [AXE=<axe.min.js>] node comments-a11y.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs');
const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3245';
const AXE = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, 'utf8') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra).slice(0, 1200))); };
const J = { 'Content-Type': 'application/json' };

(async () => {
  const t = makeTestDeck('comments-a11y');
  let browser;
  try {
    browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('slidekit.tip.editor', '1'); } catch {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
    const api = (p, b) => fetch(`${BASE}${p}`, { method: 'POST', headers: J, body: JSON.stringify({ deck: t.folder, ...b }) });
    const ready = async () => {
      await page.goto(`${BASE}/edit/${t.id}`);
      await page.getByTestId('filmstrip').waitFor();
      await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
      await page.getByRole('tab', { name: /^Comments/ }).click();
    };

    // 시드: 슬라이드 1의 보이는 첫 제목에 상태별 코멘트, 슬라이드 2 전체에 하나
    await ready();
    const head = await fr().evaluate(() => {
      const slide = document.querySelector('section[data-slide]');
      const h = [...slide.querySelectorAll('h1, h2')].find((x) => x.getBoundingClientRect().height > 0 && x.textContent.trim());
      const parts = [];
      for (let e = h; e && e !== slide; e = e.parentElement) { const tag = e.tagName.toLowerCase(); const same = [...e.parentElement.children].filter((x) => x.tagName === e.tagName); parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag); }
      return { path: parts.join(' > '), text: h.textContent.trim().slice(0, 60) };
    });
    const mk = async (text, extra = {}) => (await (await api('/api/comments', { slide: 1, path: head.path, excerpt: head.text, text, ...extra })).json()).id;
    const held = await mk('보류한 코멘트', { hold: true });
    const waiting = await mk('대기 코멘트');
    const sent = await mk('전달된 코멘트'); await api(`/api/comments/${sent}/delivered`, {});
    const working = await mk('작업 중 코멘트'); await api(`/api/comments/${working}/delivered`, {}); await api(`/api/comments/${working}/ack`, {});
    const replied = await mk('답이 달린 코멘트'); await api(`/api/comments/${replied}/delivered`, {}); await api(`/api/comments/${replied}/reply`, { reply: '고쳤습니다' });
    const resolved = await mk('해결한 코멘트'); await api(`/api/comments/${resolved}/reply`, { reply: '고쳤습니다' }); await api(`/api/comments/${resolved}/resolve`, { resolved: true });
    const arr = JSON.parse(fs.readFileSync(t.commentsFile, 'utf8'));
    arr.push({ id: 'unv1', slide: 1, path: head.path, excerpt: head.text, text: '서명 없는 코멘트', status: 'open', createdAt: new Date().toISOString() });
    fs.writeFileSync(t.commentsFile, JSON.stringify(arr));
    const onSlide2 = await (await api('/api/comments', { slide: 2, path: '', excerpt: '', text: '둘째 슬라이드 코멘트' })).json();

    await ready();
    const panel = page.getByTestId('comments-panel');
    const items = panel.locator('li[data-comment-id]');
    const states = ['held', 'waiting', 'sent', 'working', 'replied', 'resolved', 'unverified'];
    await items.nth(7).waitFor({ timeout: 8000 }).catch(() => {});
    check('코멘트 8개가 목록에 있다', (await items.count()) === 8, await items.count());

    // 1) 상태는 색이 아니라 글자로도 구분된다(각 항목에 상태 이름이 보인다)
    const LABEL = { held: 'Held', waiting: 'Waiting', sent: 'Sent to Claude', working: 'Claude is working', replied: 'Replied', resolved: 'Resolved', unverified: 'Unverified' };
    const rows = await items.evaluateAll((l) => l.map((e) => ({ state: e.getAttribute('data-state'), text: e.textContent })));
    for (const s of states) check(`상태 ${s}: 항목에 "${LABEL[s]}" 글자가 있다`, rows.some((r) => r.state === s && r.text.includes(LABEL[s])), rows.filter((r) => r.state === s));
    const pinLabels = await page.locator('[data-comment-pin]').evaluateAll((l) => l.map((e) => e.getAttribute('aria-label')));
    check('핀의 이름에 번호와 상태 글자가 있다', pinLabels.length >= 6 && pinLabels.every((n) => /^Comment \d+, (Held|Waiting|Sent to Claude|Claude is working|Replied|Resolved|Unverified): /.test(n)), pinLabels);

    // 2) 같은 요소의 핀은 겹치지 않고 각각 키보드 포커스를 받는다
    const boxes = await page.locator('[data-comment-pin]').evaluateAll((l) => l.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    let overlap = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) overlap = true; }
    check('같은 요소의 핀이 서로 겹치지 않는다', boxes.length > 1 && !overlap, boxes);
    const firstPin = page.locator('[data-comment-pin]').first();
    await firstPin.focus();
    check('핀이 포커스를 받는다', await firstPin.evaluate((e) => e === document.activeElement));
    await page.keyboard.press('Tab');
    check('Tab으로 다음 핀으로 간다', await page.evaluate(() => document.activeElement?.hasAttribute('data-comment-pin')));

    // 3) 패널 키보드: 목록 안 이동(J, K, 화살표), E 해결, Delete 삭제와 Undo, Enter로 슬라이드 이동
    const mains = panel.locator('[data-comment-main]');
    await mains.first().focus();
    const idxOfFocus = () => mains.evaluateAll((l) => l.findIndex((e) => e === document.activeElement));
    await page.keyboard.press('ArrowDown');
    check('아래 화살표가 다음 코멘트로 간다', (await idxOfFocus()) === 1, await idxOfFocus());
    await page.keyboard.press('k');
    check('K가 이전 코멘트로 간다', (await idxOfFocus()) === 0, await idxOfFocus());
    await page.keyboard.press('j');
    check('J가 다음 코멘트로 간다', (await idxOfFocus()) === 1, await idxOfFocus());
    const focusedId = () => page.evaluate(() => document.activeElement?.closest('li')?.getAttribute('data-comment-id'));
    const cur = await focusedId();
    await page.keyboard.press('e');
    check('E가 해결 처리한다', await page.waitForFunction((id) => document.querySelector(`li[data-comment-id="${id}"]`)?.getAttribute('data-state') === 'resolved', cur, { timeout: 5000 }).then(() => true, () => false));
    await page.keyboard.press('e');
    check('E를 다시 누르면 해결이 풀린다', await page.waitForFunction((id) => document.querySelector(`li[data-comment-id="${id}"]`)?.getAttribute('data-state') !== 'resolved', cur, { timeout: 5000 }).then(() => true, () => false));
    const before = await items.count();
    await mains.nth(2).focus();
    const delId = await focusedId();
    await page.keyboard.press('Delete');
    check('Delete가 코멘트를 지운다', await page.waitForFunction((n) => document.querySelectorAll('[data-testid=comments-panel] li[data-comment-id]').length === n, before - 1, { timeout: 5000 }).then(() => true, () => false));
    check('지운 뒤 포커스가 목록 안에 남는다', await page.evaluate(() => !!document.activeElement?.closest('[data-testid=comments-panel]')));
    await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
    check('Undo로 되살아난다', await page.waitForFunction((id) => !!document.querySelector(`li[data-comment-id="${id}"]`), delId, { timeout: 5000 }).then(() => true, () => false));
    const selected = () => page.locator('[data-testid=filmstrip] [role=option]').evaluateAll((l) => l.findIndex((e) => e.getAttribute('aria-selected') === 'true'));
    const li2 = panel.locator(`li[data-comment-id="${onSlide2.id}"] [data-comment-main]`);
    await li2.focus();
    await page.keyboard.press('Enter');
    check('Enter가 그 코멘트의 슬라이드(2)로 이동한다', await (async () => { for (let i = 0; i < 30; i++) { if ((await selected()) === 1) return true; await sleep(100); } return false; })(), await selected());

    // 4) Send all을 키보드로(보류가 있으면 버튼이 나온다)
    const sendAll = page.getByRole('button', { name: /^Send all to Claude/ });
    await sendAll.focus();
    await page.keyboard.press('Enter');
    check('Send all이 키보드 Enter로 보류를 푼다', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-state="held"]').length === 0, null, { timeout: 5000 }).then(() => true, () => false));

    // 5) 작성창: C로 열고 Esc로 닫으면 포커스가 body로 사라지지 않는다
    await fr().locator('[data-active] h1, [data-active] h2').first().click({ modifiers: ['Meta'] });
    await page.keyboard.press('c');
    const box = page.getByRole('textbox', { name: 'Comment' });
    check('C가 작성창을 열고 입력창에 포커스가 있다', await box.waitFor({ timeout: 3000 }).then(() => box.evaluate((e) => e === document.activeElement), () => false));
    await page.keyboard.press('Escape');
    check('Esc가 작성창을 닫는다', await page.getByRole('group', { name: 'New comment' }).waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false));
    const active = await page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, inBody: a === document.body }; });
    check('Esc 뒤 포커스가 문서 body로 사라지지 않는다', !active.inBody, active);

    // 6) axe: 상태를 모두 펼친 화면
    if (AXE) {
      await page.getByRole('tab', { name: /^Comments/ }).click();
      await page.evaluate(AXE);
      // 코멘트 패널과 캔버스 핀만 본다(필름스트립 같은 다른 화면의 위반은 그 화면의 검증이 맡는다). 범위 밖 위반은 INFO로만 적는다.
      const run = (ctxArg) => page.evaluate(([c]) => axe.run(c ?? document, { resultTypes: ['violations'] }), [ctxArg]);
      const serious = (r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const brief = (l) => l.map((v) => ({ id: v.id, n: v.nodes.length, first: v.nodes[0].target.join(' ').slice(0, 90), msg: (v.nodes[0].any[0] || v.nodes[0].all[0] || {}).message, html: v.nodes[0].html.slice(0, 260) }));
      const inScope = serious(await run({ include: [['[data-testid=comments-panel]'], ['[data-comment-pin]']] }));
      check('axe: 코멘트 패널과 핀(모든 상태) serious 이상 위반 없음', inScope.length === 0, brief(inScope));
      const whole = serious(await run(null)).filter((v) => !inScope.some((x) => x.id === v.id));
      if (whole.length) console.log('INFO axe: 범위 밖(다른 화면) 위반 ' + JSON.stringify(brief(whole)).slice(0, 900));
    } else console.log('SKIP axe: AXE가 없어 접근성 규칙 검사는 하지 않았다');
    check('페이지 오류 없음', errors.length === 0, errors);
  } catch (e) { fail++; console.log('FAIL 예외 ' + e); }
  finally { if (browser) await browser.close(); t.cleanup(); }
  console.log(fail ? `${fail} failed` : 'all passed');
  process.exit(fail ? 1 : 0);
})();
