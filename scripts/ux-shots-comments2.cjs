/* 코멘트 흐름 후속 스크린샷: 상태 칩 여섯 가지, 핀 겹침, 우클릭 메뉴(패널 위와 아래, 핀), 삭제 Undo 토스트, 연결 끊김, 작성창.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3245 OUT=<폴더> [VIEWPORT=1440x900|390x844] node scripts/ux-shots-comments2.cjs
   테스트 덱 사본에서만 동작하고 저장 단축키는 누르지 않는다. 좁은 폭(800 미만)에서는 속성 패널을 Toggle details로 연다. */
const { launch } = require('./lib/pw.cjs');
const fs = require('fs'), path = require('path');
const { makeTestDeck } = require('./lib/test-deck.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3245';
const OUT = process.env.OUT || path.join('/tmp/slidekit-shots', new Date().toISOString().replace(/[:.]/g, '-'));
const [W, H] = (process.env.VIEWPORT || '1440x900').split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = { 'Content-Type': 'application/json' };

(async () => {
  const t = makeTestDeck('ux-comments2');
  fs.mkdirSync(OUT, { recursive: true });
  const saved = [];
  let browser;
  try {
    browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('slidekit.tip.editor', '1'); } catch {} }); // 처음 여는 안내 카드가 화면을 가리지 않게
    const page = await ctx.newPage();
    const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
    const api = (p, b) => fetch(`${BASE}${p}`, { method: 'POST', headers: J, body: JSON.stringify({ deck: t.folder, ...b }) });
    let n = 0;
    const shot = async (name) => { await sleep(350); const f = path.join(OUT, `${String(++n).padStart(2, '0')}-${name}-${W}.png`); await page.screenshot({ path: f }); saved.push(f); };
    const open = async () => {
      await page.goto(`${BASE}/edit/${t.id}`);
      await page.getByTestId('filmstrip').waitFor();
      await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
      if (W < 800) { await page.getByRole('button', { name: 'Toggle details' }).click(); await sleep(400); }
      await page.getByRole('tab', { name: /^Comments/ }).click().catch(() => {});
    };

    // 코멘트: 슬라이드 1의 제목에 여럿(핀 겹침), 상태 여섯 가지, 슬라이드 전체 코멘트(path 비어 있음)
    await page.goto(`${BASE}/edit/${t.id}`);
    await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
    // 보이는 첫 제목의 경로를 앱과 같은 규칙(tag:nth-of-type을 ' > '로 이음)으로 만든다. 슬라이드의 직계 자식이 아니면 핀이 숨는다.
    const head = await fr().evaluate(() => {
      const slide = document.querySelector('section[data-slide]');
      const h = [...slide.querySelectorAll('h1, h2')].find((x) => x.getBoundingClientRect().height > 0 && x.textContent.trim());
      if (!h) return null;
      const parts = [];
      for (let e = h; e && e !== slide; e = e.parentElement) { const tag = e.tagName.toLowerCase(); const same = [...e.parentElement.children].filter((x) => x.tagName === e.tagName); parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag); }
      return { tag: parts.join(' > '), text: h.textContent.trim().slice(0, 60) };
    });
    const mk = async (text, path_ = head.tag, slide = 1) => ((await (await api('/api/comments', { slide, path: path_, excerpt: head.text, text })).json())).id;
    const a = await mk('대기 중인 코멘트입니다');
    const b = await mk('전달된 코멘트입니다'); await api(`/api/comments/${b}/delivered`, {});
    const c = await mk('Claude가 작업 중인 코멘트입니다'); await api(`/api/comments/${c}/delivered`, {}); await api(`/api/comments/${c}/ack`, {});
    const d = await mk('답변이 달린 코멘트입니다'); await api(`/api/comments/${d}/delivered`, {}); await api(`/api/comments/${d}/reply`, { reply: '제목을 한 줄로 줄였습니다.' });
    const e = await mk('해결한 코멘트입니다'); await api(`/api/comments/${e}/reply`, { reply: '고쳤습니다.' }); await api(`/api/comments/${e}/resolve`, { resolved: true });
    await mk('슬라이드 전체에 거는 코멘트입니다. 이 슬라이드가 복잡합니다.', '');
    const arr = JSON.parse(fs.readFileSync(t.commentsFile, 'utf8'));
    arr.push({ id: 'unv1', slide: 1, path: head.tag, excerpt: head.text, text: '서명이 없는 코멘트입니다', status: 'open', createdAt: new Date().toISOString() });
    fs.writeFileSync(t.commentsFile, JSON.stringify(arr));

    await open();
    await shot('panel-states');
    const items = page.locator('[data-testid=comments-panel] li[data-comment-id]');
    // 우클릭 메뉴: 패널 첫 항목, 패널 맨 아래 항목(아래쪽 가장자리에서 뒤집힘)
    await items.first().click({ button: 'right' }); await shot('menu-panel-top'); await page.keyboard.press('Escape');
    await items.last().scrollIntoViewIfNeeded(); await items.last().click({ button: 'right' }); await shot('menu-panel-bottom'); await page.keyboard.press('Escape');
    // 핀: 좁은 폭에서는 속성 패널이 캔버스를 덮으니 닫는다
    if (W < 800) { await page.getByRole('button', { name: 'Toggle details' }).click(); await sleep(400); }
    console.log('가로 넘침:', JSON.stringify(await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth, scrollX }))));
    const pins = page.locator('[data-comment-pin]');
    if (W >= 800) await page.getByRole('tab', { name: /^Comments/ }).click().catch(() => {});
    await shot('pins');
    if (await pins.count()) { await pins.first().click({ button: 'right' }); await shot('menu-pin'); await page.keyboard.press('Escape'); }
    else console.warn('WARN menu-pin: 핀이 보이지 않음');
    // 삭제 Undo 토스트
    if (W < 800) { await page.getByRole('button', { name: 'Toggle details' }).click(); await sleep(400); }
    await items.first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Delete/ }).click().catch(() => console.warn('WARN delete: 메뉴 항목을 못 누름'));
    await shot('delete-toast');
    // 작성창(요소 선택 후 C), 연결 끊김
    if (W >= 800) {
      await fr().locator('[data-active] h1, [data-active] h2').first().click({ modifiers: ['Meta'] });
      await page.keyboard.press('c'); await shot('composer-chips'); await page.keyboard.press('Escape');
    }
    await page.route('**/api/ping', (r) => r.abort());
    if (await page.getByRole('status').filter({ hasText: /unreachable/i }).waitFor({ timeout: 20000 }).then(() => true, () => false)) await shot('disconnected');
    else console.warn('WARN disconnected: 안내가 20초 안에 안 보임');
  } finally {
    if (browser) await browser.close();
    t.cleanup();
  }
  console.log('저장된 파일:\n' + saved.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
