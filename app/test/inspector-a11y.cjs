/* 편집기 오른쪽 패널(Inspector) 키보드와 접근성 검증. 결과는 PASS/FAIL 줄과 마지막 결함 표로 나온다.
   덱은 사본(decks/_e2e-a11y)만 쓴다. 실제 덱 쓰기 없음(Meta+s를 누르지 않는다).
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3241 [AXE=<axe.min.js>] node app/test/inspector-a11y.cjs
   AXE가 없으면 /tmp 아래 axe-core를 찾고, 그래도 없으면 대비 검사는 건너뛴다. */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), cp = require('child_process');
const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3241';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const defects = []; // [심각도, 상태, 내용, 담당]
let fail = 0;
const OWNER = { nofocus: 'app-dev(공용 컴포넌트)', name: 'editor-dev(Inspector.tsx)', order: 'editor-dev(Inspector.tsx)', value: 'app-dev(number-field)', undo: 'editor-dev(Inspector.tsx)', persist: 'app-dev(inspector-section)', width: 'editor-dev(Inspector.tsx)', contrast: 'app-dev(공용 컴포넌트)' };
const check = (sev, kind, state, name, ok, extra) => {
  if (!ok) { fail++; defects.push([sev, state, name + (extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 200)), OWNER[kind] || '확인 필요']); }
  console.log((ok ? 'PASS ' : 'FAIL ') + `[${state}] ${name}` + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra).slice(0, 200)));
};
const findAxe = () => {
  if (process.env.AXE) return process.env.AXE;
  const r = cp.spawnSync('sh', ['-c', "ls /tmp/claude-501/*/*/scratchpad/axe/node_modules/axe-core/axe.min.js /tmp/claude-501/*/*/scratchpad/*/node_modules/axe-core/axe.min.js 2>/dev/null | head -1"]);
  return r.stdout.toString().trim() || null;
};

(async () => {
  const t = makeTestDeck('a11y');
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const open = async () => {
    await page.goto(`${BASE}/edit/${t.id}`);
    await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
    await page.getByTestId('filmstrip').waitFor(); // 편집기 화면이 그려졌다
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // 레이아웃이 자리를 잡은 뒤
  };
  const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
  const panelSel = 'aside[aria-label]:last-of-type';
  const panel = () => page.locator('aside[aria-label="Properties"]');

  // 패널 안의 조작 요소를 모은다.
  const controls = () => panel().evaluate((root) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const visibleText = (e) => { const c = e.cloneNode(true); c.querySelectorAll('[aria-hidden=true],[hidden]').forEach((n) => n.remove()); return (c.textContent || '').trim(); };
    const nameOf = (e) => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent) || (e.labels && e.labels[0]?.textContent) || e.getAttribute('title') || visibleText(e) || e.getAttribute('placeholder') || '').trim();
    return [...root.querySelectorAll('input,button,select,textarea,[role=radio],[role=tab],[role=combobox],[role=switch],[role=slider],[tabindex]')]
      .filter(vis).map((e) => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), name: nameOf(e), disabled: e.disabled || e.getAttribute('aria-disabled') === 'true', tab: e.tabIndex, label: e.getAttribute('aria-label') }));
  });

  // Tab 순서와 포커스 링: 패널 첫 요소에서 Tab을 눌러 패널을 벗어날 때까지 기록한다.
  const tabWalk = async (state) => {
    await panel().evaluate((root) => { const f = root.querySelector('input,button,[role=tab],[tabindex="0"]'); f && f.focus(); });
    const probe = () => page.evaluate(() => {
      const e = document.activeElement; const aside = document.querySelector('aside[aria-label="Properties"]');
      if (!e || !aside || !aside.contains(e)) return null;
      const r = e.getBoundingClientRect();
      let ring = false, n = e;
      for (let k = 0; k < 4 && n && !ring; k++, n = n.parentElement) {
        const s = getComputedStyle(n);
        ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
      }
      const c = e.cloneNode(true); c.querySelectorAll('[aria-hidden=true]').forEach((x) => x.remove());
      return { name: e.getAttribute('aria-label') || (c.textContent || '').trim().slice(0, 24) || e.tagName, top: Math.round(r.top), left: Math.round(r.left), ring, id: e.getAttribute('aria-label') + '|' + Math.round(r.top) + '|' + Math.round(r.left) };
    });
    const seq = [];
    let stuck = 0;
    for (let i = 0; i < 80; i++) {
      const info = await probe();
      if (!info) break;
      if (seq.length && seq.at(-1).id === info.id) { if (++stuck >= 2) break; } else stuck = 0;
      if (!seq.length || seq.at(-1).id !== info.id) seq.push(info);
      await page.keyboard.press('Tab');
    }
    const left = await probe();
    if (stuck >= 2) {
      check('높음', 'order', state, 'Tab 키가 패널 안에서 포커스를 다음 컨트롤로 옮긴다(캔버스 선택 순환에 가로채이지 않는다)', false, { stuckOn: seq.at(-1)?.name, stops: seq.length, hint: 'Editor.tsx keyRef의 Tab 처리(typing 조건에 button, tab, radio가 빠짐)' });
    } else check('높음', 'order', state, 'Tab 키가 패널 안에서 포커스를 다음 컨트롤로 옮긴다(캔버스 선택 순환에 가로채이지 않는다)', true);
    // 포커스 링과 시각 순서는 DOM 순서의 컨트롤을 직접 focus()해서 본다(Tab 가로채임과 별개로 검사).
    await page.keyboard.press('Shift'); // 키보드 모달리티로 바꿔 :focus-visible이 적용되게 한다
    const dom = await panel().evaluate((root) => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !e.disabled; };
      // 탭은 포커스만으로 활성화되어 패널 내용이 바뀌므로 맨 뒤에서 검사한다.
      const sel = 'input,button,select,textarea,[role=radio],[role=tab],[role=combobox],[role=switch],[tabindex="0"]';
      const els = [...root.querySelectorAll(sel)].filter(vis).filter((e) => !e.querySelector(sel) && e.getAttribute('role') !== 'tabpanel').sort((a, b) => (a.getAttribute('role') === 'tab') - (b.getAttribute('role') === 'tab'));
      // 위치는 포커스(스크롤)가 일어나기 전에 한 번에 읽는다. 스크롤 영역은 맨 위로 되돌려 둔다.
      root.querySelectorAll('*').forEach((n) => { if (n.scrollTop) n.scrollTop = 0; });
      const pos = new Map(els.map((e) => [e, e.getBoundingClientRect()]));
      return els.map((e) => {
        e.focus();
        const r = pos.get(e);
        let ring = false, n = e;
        for (let k = 0; k < 4 && n && !ring; k++, n = n.parentElement) {
          const s = getComputedStyle(n);
          ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
        }
        const c = e.cloneNode(true); c.querySelectorAll('[aria-hidden=true]').forEach((x) => x.remove());
        return { name: e.getAttribute('aria-label') || (c.textContent || '').trim().slice(0, 24) || e.tagName, top: Math.round(r.top + r.height / 2), left: Math.round(r.left), ring, focused: document.activeElement === e, tab: e.getAttribute('role') === 'tab' };
      });
    });
    const unfocusable = dom.filter((d) => !d.focused).map((d) => d.name);
    check('높음', 'nofocus', state, '모든 컨트롤이 focus() 가능하다', unfocusable.length === 0, unfocusable);
    const noRing = dom.filter((d) => d.focused && !d.ring && !d.tab).map((d) => d.name); // 탭은 아래 tabRing에서 따로 본다
    check('높음', 'nofocus', state, '모든 컨트롤에 포커스 링(outline 또는 box-shadow)이 보인다', noRing.length === 0, noRing);
    const bad = [];
    const ordered = dom.filter((d) => !d.tab); // 탭은 검사 순서상 맨 뒤에 둔 것이라 순서 검사에서 뺀다
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1], b = ordered[i], dy = b.top - a.top;
      if (dy < -24 || (Math.abs(dy) <= 8 && b.left < a.left - 2)) bad.push(`${a.name}(${a.left},${a.top}) -> ${b.name}(${b.left},${b.top})`);
    }
    check('중간', 'order', state, 'DOM(Tab) 순서가 시각 순서(위에서 아래, 왼쪽에서 오른쪽)와 같다', bad.length === 0, bad.slice(0, 5));
    await page.getByRole('tab', { name: 'Design' }).click().catch(() => {}); await sleep(300); // 탭 포커스로 바뀐 패널을 되돌린다
    return dom;
  };

  // Fluid 탭의 포커스 링은 outline이 아니라 탭 목록 안의 별도 요소이고 :focus-visible일 때만 켜진다.
  // 그래서 프로그램 focus()가 아니라 실제 Shift+Tab으로 탭에 도달해서 링 요소가 탭 바깥에 있는지 본다.
  const tabRing = async (state) => {
    const ok = await panel().evaluate((root) => {
      const tabs = [...root.querySelectorAll('[role=tab]')];
      if (!tabs.length) return false;
      const after = [...root.querySelectorAll('input,button,[role=radio]')].filter((e) => !tabs.includes(e) && e.getBoundingClientRect().width > 0 && (tabs.at(-1).compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (!after[0]) return false;
      after[0].focus(); return true;
    });
    // 탭 패널(tabIndex 0, 표준 동작)이 탭 앞에 끼므로 Shift+Tab을 최대 3번 누른다.
    let onTab = false;
    for (let i = 0; i < 3 && ok && !onTab; i++) {
      await page.keyboard.press('Shift+Tab'); await sleep(150);
      onTab = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab');
    }
    const act = await page.evaluate(() => { const e = document.activeElement; return e ? (e.getAttribute('aria-label') || e.getAttribute('role') || e.tagName) + '|' + (e.textContent || '').trim().slice(0, 20) : null; });
    check('높음', 'order', state, 'Shift+Tab으로 키보드가 탭에 도달한다', onTab, { ok, active: act });
    if (!onTab) return;
    const g = await page.evaluate(() => {
      const t = document.activeElement, tr = t.getBoundingClientRect();
      const ring = [...t.closest('[role=tablist]').querySelectorAll('*')].find((e) => /focus-ring/.test(String(e.className)) && getComputedStyle(e).pointerEvents === 'none' && e.getBoundingClientRect().width > 0);
      if (!ring) return null;
      const b = ring.getBoundingClientRect();
      return { left: tr.left - b.left, top: tr.top - b.top, right: b.right - tr.right, bottom: b.bottom - tr.bottom };
    });
    check('높음', 'nofocus', state, '키보드로 탭에 도달하면 포커스 링 요소가 탭 바깥에 보인다', !!g && g.left >= 0.5 && g.top >= 0.5 && g.right >= 0.5 && g.bottom >= 0.5, g);
  };

  // 필름스트립(section[data-testid=filmstrip]): listbox 이름과 방향, 옵션 이름과 선택, roving tabindex, 화살표와 Home/End, 포커스 링.
  const filmstrip = async () => {
    const root = page.locator('[data-testid="filmstrip"]');
    if (!(await root.count())) return console.log('SKIP 필름스트립: 이 레이아웃에는 없음');
    const lb = root.locator('[role="listbox"]');
    check('높음', 'name', 'filmstrip', '필름스트립에 이름 있는 listbox가 있다(스크롤 영역 이름)', (await lb.count()) === 1 && !!(await lb.getAttribute('aria-label')), await lb.getAttribute('aria-label'));
    check('낮음', 'name', 'filmstrip', 'listbox 방향이 horizontal이다', (await lb.getAttribute('aria-orientation')) === 'horizontal');
    const opts = lb.locator('[role="option"]');
    const n = await opts.count();
    const info = await opts.evaluateAll((l) => l.map((e) => ({ name: e.getAttribute('aria-label'), sel: e.getAttribute('aria-selected'), tab: e.tabIndex })));
    check('높음', 'name', 'filmstrip', '모든 옵션에 이름(aria-label)이 있다', info.every((i) => !!i.name), info.filter((i) => !i.name).length);
    check('중간', 'name', 'filmstrip', '선택된 옵션이 정확히 하나다(aria-selected)', info.filter((i) => i.sel === 'true').length === 1, info.filter((i) => i.sel === 'true').length);
    check('중간', 'order', 'filmstrip', 'roving tabindex: tabindex 0인 옵션은 선택된 하나뿐이다', info.filter((i) => i.tab === 0).length === 1 && info.find((i) => i.tab === 0)?.sel === 'true', info.filter((i) => i.tab === 0).length);
    if (n < 3) return;
    const selIdx = () => opts.evaluateAll((l) => l.findIndex((e) => e.getAttribute('aria-selected') === 'true'));
    const selIs = async (i) => { for (let k = 0; k < 40 && (await selIdx()) !== i; k++) await sleep(100); }; // 키 입력 뒤 선택이 바뀔 때까지 조건으로 기다린다
    const focusSel = async () => { await opts.nth(await selIdx()).focus(); };
    await page.keyboard.press('Shift'); // 키보드 모달리티
    await opts.nth(0).click(); await selIs(0); await focusSel();
    await page.keyboard.press('ArrowRight'); await selIs(1);
    check('높음', 'value', 'filmstrip', '→는 다음 슬라이드를 선택하고 포커스가 함께 이동한다', (await selIdx()) === 1 && (await opts.nth(1).evaluate((e) => e === document.activeElement)), await selIdx());
    await page.keyboard.press('ArrowLeft'); await selIs(0);
    check('높음', 'value', 'filmstrip', '←는 이전 슬라이드를 선택한다', (await selIdx()) === 0, await selIdx());
    await page.keyboard.press('End'); await selIs(n - 1);
    check('중간', 'value', 'filmstrip', 'End는 마지막 슬라이드를 선택한다', (await selIdx()) === n - 1, [await selIdx(), n]);
    await page.keyboard.press('Home'); await selIs(0);
    check('중간', 'value', 'filmstrip', 'Home은 첫 슬라이드를 선택한다', (await selIdx()) === 0, await selIdx());
    const ring = await opts.nth(0).evaluate((e) => { let n = e, ok = false; for (let k = 0; k < 3 && n && !ok; k++, n = n.parentElement) { const s = getComputedStyle(n); ok = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (!!s.boxShadow && s.boxShadow !== 'none') || /ring|focus/.test(String(n.className)); } return ok; });
    check('높음', 'nofocus', 'filmstrip', '포커스된 옵션에 포커스 링이 있다', ring);
    const scroll = await root.evaluate((e) => { const vp = e.querySelector('[data-radix-scroll-area-viewport]') || e; return { hOverflow: vp.scrollWidth > vp.clientWidth, pageH: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
    check('중간', 'width', 'filmstrip', '필름스트립이 페이지 가로 스크롤을 만들지 않는다', !scroll.pageH, scroll);
  };

  const audit = async (state) => {
    const cs = await controls();
    const unnamed = cs.filter((c) => !c.name).map((c) => c.tag + (c.role ? `[${c.role}]` : ''));
    check('높음', 'name', state, '모든 컨트롤에 접근 가능한 이름이 있다', unnamed.length === 0, unnamed);
    const iconOnly = cs.filter((c) => c.tag === 'button' && c.name && !c.label && c.name.length <= 1).map((c) => c.name);
    check('낮음', 'name', state, '아이콘 버튼은 aria-label이 있다(텍스트 한 글자 제외)', iconOnly.length === 0, iconOnly);
    // radio와 tab은 roving tabindex(그룹당 한 곳만 0)가 정상이라 제외한다.
    const unreachable = cs.filter((c) => !c.disabled && c.tab < 0 && c.tag !== 'div' && c.role !== 'radio' && c.role !== 'tab').map((c) => c.name);
    check('중간', 'nofocus', state, 'tabindex -1 로 키보드에서 빠진 컨트롤이 없다(radio 그룹 제외)', unreachable.filter((n) => n).length === 0, unreachable);
    const seq = await tabWalk(state);
    if (state === 'slide' || state === 'text') await tabRing(state);
    check('중간', 'order', state, '패널에 Tab 정지점이 있다', seq.length > 0, seq.length);
    // 좁은 폭(256px): 가로 스크롤과 잘림
    const w = await panel().evaluate((root) => {
      const old = [root.style.width, root.style.minWidth, root.style.maxWidth];
      root.style.width = root.style.minWidth = root.style.maxWidth = '256px';
      const clipped = [...root.querySelectorAll('*')].filter((e) => {
        const s = getComputedStyle(e); const r = e.getBoundingClientRect();
        return r.width > 0 && e.scrollWidth > e.clientWidth + 1 && s.overflowX === 'visible' && s.textOverflow !== 'ellipsis' && e.children.length === 0 && (e.textContent || '').trim();
      }).map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 20));
      const hscroll = root.scrollWidth > root.clientWidth + 1;
      // 컨트롤이 패널 경계를 넘거나 같은 행의 이웃과 겹치는지(256px 폭). 위치는 한 번에 읽는다.
      const ab = root.getBoundingClientRect();
      const cs = [...root.querySelectorAll('input,button,select,textarea,[role=radio],[role=combobox],[role=switch]')]
        .map((e) => ({ e, r: e.getBoundingClientRect(), n: e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 18) || e.tagName }))
        .filter((c) => c.r.width > 0 && c.r.height > 0 && getComputedStyle(c.e).visibility !== 'hidden');
      const over = cs.filter((c) => c.r.right > ab.right + 0.5 || c.r.left < ab.left - 0.5).map((c) => `${c.n}(${Math.round(c.r.left)}~${Math.round(c.r.right)})`);
      const overlap = [];
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j];
        if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
        const sameRow = Math.abs((a.r.top + a.r.height / 2) - (b.r.top + b.r.height / 2)) < Math.min(a.r.height, b.r.height) / 2;
        const gap = Math.max(a.r.left, b.r.left) - Math.min(a.r.right, b.r.right);
        if (sameRow && gap < -0.5) overlap.push(`${a.n} x ${b.n}`);
      }
      [root.style.width, root.style.minWidth, root.style.maxWidth] = old;
      return { clipped: [...new Set(clipped)], hscroll, over: [...new Set(over)], overlap: [...new Set(overlap)] };
    });
    check('중간', 'width', state, '256px 폭에서 가로 스크롤이 없다', !w.hscroll);
    check('중간', 'width', state, '256px 폭에서 컨트롤이 패널 경계 밖으로 나가지 않는다', w.over.length === 0, w.over.slice(0, 6));
    check('중간', 'width', state, '256px 폭에서 같은 행의 컨트롤끼리 겹치지 않는다', w.overlap.length === 0, w.overlap.slice(0, 6));
    check('중간', 'width', state, '256px 폭에서 텍스트가 말줄임 없이 잘리지 않는다', w.clipped.length === 0, w.clipped);
    // 대비 4.5:1
    const axePath = findAxe();
    if (axePath) {
      await page.evaluate(fs.readFileSync(axePath, 'utf8'));
      const v = await page.evaluate(async () => {
        const aside = document.querySelector('aside[aria-label="Properties"]');
        const r = await axe.run(aside, { runOnly: ['color-contrast'], resultTypes: ['violations'] });
        return r.violations.flatMap((x) => x.nodes.map((n) => `${n.target.join(' ').slice(0, 50)} ${(n.any[0]?.message || '').slice(0, 70)}`));
      });
      check('중간', 'contrast', state, '텍스트 대비 4.5:1 이상(axe color-contrast)', v.length === 0, v.slice(0, 4));
    } else if (state === 'slide') console.log('SKIP 대비 검사: axe-core를 찾지 못함(AXE=경로 지정)');
  };

  try {
    await open();
    // 1) 슬라이드 선택 상태(요소 선택 없음)
    await page.keyboard.press('Escape'); await sleep(300);
    await audit('slide');

    // 2) 텍스트 요소
    const h = fr().locator('[data-active] h1, [data-active] h2').first();
    await h.click({ modifiers: ['Meta'] }); await sleep(400); // 계층 선택: Cmd+클릭은 가장 안쪽 단위를 바로 고른다
    await audit('text');
    await h.click({ modifiers: ['Meta'] }); await sleep(400); // 계층 선택: Cmd+클릭은 가장 안쪽 단위를 바로 고른다 // Tab 순환으로 선택이 바뀌었을 수 있어 다시 고른다

    // 숫자 필드 동작: Rotation(-360..360, step 1)과 Opacity(0..100)
    const field = (n) => panel().getByRole('textbox', { name: n, exact: true });
    const num = async (n) => parseFloat(await field(n).inputValue());
    const canvasOpacity = () => h.evaluate((e) => +getComputedStyle(e).opacity * 100);
    const canvasInlineHasBad = () => h.evaluate((e) => /NaN|undefined|null/.test(e.getAttribute('style') || ''));
    if (await field('Opacity').count()) {
      await field('Opacity').focus();
      const o0 = await num('Opacity');
      const key = async (k, d, name) => {
        const before = await num('Opacity');
        await page.keyboard.press(k); await sleep(80);
        const after = await num('Opacity');
        check('높음', 'value', 'text', `Opacity ${name} 증감`, Math.abs(after - before - d) < 0.051 || (d > 0 && after === 100) || (d < 0 && after === 0), [before, after, d]);
      };
      await field('Opacity').fill('50'); await field('Opacity').press('Enter'); await sleep(200);
      await field('Opacity').focus();
      await key('ArrowUp', 1, '↑'); await key('ArrowDown', -1, '↓');
      await key('Shift+ArrowUp', 10, 'Shift+↑'); await key('Shift+ArrowDown', -10, 'Shift+↓');
      await key('Alt+ArrowUp', 0.1, 'Alt+↑'); await key('Alt+ArrowDown', -0.1, 'Alt+↓');
      await page.keyboard.press('Enter'); await sleep(200);
      check('중간', 'value', 'text', 'Enter로 커밋하고 포커스가 빠진다', !(await field('Opacity').evaluate((e) => e === document.activeElement)));
      check('높음', 'value', 'text', 'Opacity 패널 값과 캔버스 값이 일치', Math.abs((await canvasOpacity()) - (await num('Opacity'))) < 0.6, [await canvasOpacity(), await num('Opacity')]);
      // Esc 취소
      const keep = await num('Opacity');
      await field('Opacity').focus(); await page.keyboard.type('7'); await page.keyboard.press('Escape'); await sleep(200);
      check('높음', 'value', 'text', 'Esc는 입력을 취소하고 값을 되돌린다', (await num('Opacity')) === keep && Math.abs((await canvasOpacity()) - keep) < 0.6, [keep, await num('Opacity')]);
      // 잘못된 값
      for (const bad of ['abc', '--5', '12abc']) {
        await field('Opacity').focus(); await page.keyboard.press('Meta+a'); await page.keyboard.type(bad); await page.keyboard.press('Enter'); await sleep(200);
        const v = await field('Opacity').inputValue();
        check('높음', 'value', 'text', `잘못된 값 "${bad}"이 값을 깨뜨리지 않는다`, /^-?\d+(\.\d+)?$/.test(v) && !(await canvasInlineHasBad()), v);
      }
      await field('Opacity').focus(); await page.keyboard.press('Meta+a'); await page.keyboard.type('-30'); await page.keyboard.press('Enter'); await sleep(200);
      check('높음', 'value', 'text', '음수는 min(0) 아래로 내려가지 않는다', (await num('Opacity')) >= 0, await num('Opacity'));
      await field('Opacity').focus(); await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter'); await sleep(200);
      const emptyV = await field('Opacity').inputValue();
      check('중간', 'value', 'text', '빈 값 커밋은 NaN이나 빈 칸이 아니라 속성 해제(기본값 표시)다', /^\d/.test(emptyV) && !(await canvasInlineHasBad()), emptyV);

      // 스크럽 한 번 = undo 한 건, Cmd+Z / Shift+Cmd+Z가 패널과 캔버스에 일치
      await field('Opacity').focus(); await page.keyboard.press('Meta+a'); await page.keyboard.type('80'); await page.keyboard.press('Enter'); await sleep(1400); // 편집기가 0.8초 안의 같은 변경을 한 undo로 묶으므로 간격을 둔다
      const start = await num('Opacity');
      const lab = field('Opacity').locator('xpath=preceding-sibling::span[1]');
      const bb = await lab.boundingBox();
      if (bb) {
        await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
        for (let i = 1; i <= 6; i++) { await page.mouse.move(bb.x + bb.width / 2 - i * 4, bb.y + bb.height / 2, { steps: 2 }); }
        await page.mouse.up(); await sleep(400);
        const scrubbed = await num('Opacity');
        check('중간', 'undo', 'text', '스크럽이 값을 바꿨다(검증 전제)', scrubbed !== start, [start, scrubbed]);
        const reselect = async (label) => {
          const kept = (await field('Opacity').count()) > 0;
          check('중간', 'undo', 'text', `${label} 뒤에도 요소 선택과 패널이 유지된다`, kept);
          if (!kept) { await h.click({ modifiers: ['Meta'] }); await sleep(500); }
        };
        await page.keyboard.press('Meta+z'); await sleep(500);
        await reselect('Cmd+Z');
        check('높음', 'undo', 'text', '스크럽 한 번이 Cmd+Z 한 번으로 모두 되돌려진다', (await num('Opacity')) === start, [start, await num('Opacity')]);
        check('높음', 'undo', 'text', 'Cmd+Z 뒤 패널 값과 캔버스 값이 일치', Math.abs((await canvasOpacity()) - (await num('Opacity'))) < 0.6, [await canvasOpacity(), await num('Opacity')]);
        await page.keyboard.press('Meta+Shift+z'); await sleep(500);
        await reselect('Shift+Cmd+Z');
        check('높음', 'undo', 'text', 'Shift+Cmd+Z가 스크럽 값을 복원하고 캔버스와 일치', (await num('Opacity')) === scrubbed && Math.abs((await canvasOpacity()) - scrubbed) < 0.6, [scrubbed, await num('Opacity'), await canvasOpacity()]);
      } else check('중간', 'undo', 'text', 'Opacity 라벨(스크럽 핸들) 위치를 찾았다', false);
    } else check('중간', 'value', 'text', 'Opacity 필드가 있다', false);

    // 3) 이미지와 컨테이너: 사본 덱에서 찾아 선택한다. 못 찾으면 건너뛴다.
    const pickBy = async (state, selector) => {
      const idx = await fr().evaluate((sel) => [...document.querySelectorAll('#sk-stage > [data-slide]')].findIndex((s) => s.querySelector(sel)), selector);
      if (idx < 0) return console.log(`SKIP ${state}: 사본 덱에 ${selector} 요소가 없음`);
      // 슬라이드 선택: 필름스트립 옵션이 있으면 그것을, 없으면(이전 레이아웃) 좌측 draggable 행을 쓴다.
      const strip = page.locator('[data-testid="filmstrip"] [role="option"]');
      await ((await strip.count()) ? strip : page.locator('[draggable="true"]')).nth(idx).click(); await sleep(700);
      // 컨테이너는 Layers 행(자식이 있는 행)을 눌러 정확히 고른다. 행이 없으면 아래 좌표 클릭을 쓴다.
      if (state === 'container') {
        const row = page.getByTestId('layer-row').filter({ has: page.locator('button[aria-label=Expand], button[aria-label=Collapse]') }).first();
        if (await row.count()) { await row.click({ position: { x: 70, y: 10 } }).catch(() => {}); await sleep(500); return audit(state); }
      }
      const el = fr().locator(`[data-active] ${selector}`).first();
      const box = await el.boundingBox().catch(() => null);
      if (!box) return console.log(`SKIP ${state}: 요소가 보이지 않음`);
      // 컨테이너는 가장자리 안쪽 모서리를 눌러 자식이 아닌 자신을 고른다
      // 이미지는 Cmd+클릭으로 가장 안쪽 단위를, 컨테이너는 일반 클릭으로 슬라이드의 직계 자식을 고른다.
      if (state !== 'container') await page.keyboard.down('Meta');
      await page.mouse.click(box.x + (state === 'container' ? 3 : box.width / 2), box.y + (state === 'container' ? 3 : box.height / 2));
      if (state !== 'container') await page.keyboard.up('Meta'); await sleep(500);
      await audit(state);
    };
    await pickBy('image', 'img');
    await pickBy('container', 'div > div');

    // 필름스트립과 1024px 폭
    await filmstrip();
    await page.setViewportSize({ width: 1024, height: 768 }); await sleep(600);
    const narrow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, strip: (() => { const e = document.querySelector('[data-testid="filmstrip"]'); if (!e) return null; const r = e.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.left >= -1; })() }));
    check('중간', 'width', '1024px', '1024px 폭에서 페이지에 가로 스크롤이 없다', !narrow.page, narrow);
    check('중간', 'width', '1024px', '1024px 폭에서 필름스트립이 화면 안에 있다', narrow.strip !== false, narrow);
    await page.setViewportSize({ width: 1440, height: 900 }); await sleep(500);

    // 4) 코멘트 탭
    await page.getByRole('tab', { name: /^Comments/ }).click(); await sleep(300);
    await audit('comments');
    await page.getByRole('tab', { name: 'Design' }).click(); await sleep(300);

    // 5) 섹션은 접지 않는다: 접기 버튼(aria-expanded)이 없다
    await fr().locator('[data-active] h1, [data-active] h2').first().click({ modifiers: ['Meta'] }); await sleep(500);
    check('중간', 'persist', 'persist', '섹션 헤더에 접기 버튼이 없다', (await panel().locator('[aria-controls^="inspector-section-"]').count()) === 0);

    check('높음', 'name', 'page', '페이지 오류 없음', errors.length === 0, errors);
  } catch (e) {
    fail++; defects.push(['높음', 'script', '검증 스크립트 예외: ' + String(e).slice(0, 160), '스크립트(channel-dev)']); console.log('FAIL 예외 ' + e);
  } finally {
    await browser.close();
    t.cleanup();
  }
  if (defects.length) {
    console.log('\n결함 표 (심각도 | 상태 | 내용 | 담당)');
    for (const d of defects.sort((a, b) => ['높음', '중간', '낮음'].indexOf(a[0]) - ['높음', '중간', '낮음'].indexOf(b[0]))) console.log(d.join(' | '));
  }
  console.log(fail ? `${fail} failed` : 'all passed');
  process.exit(fail ? 1 : 0);
})();
