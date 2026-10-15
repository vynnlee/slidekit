/* 도그푸딩: 에이전트 없이 편집기만으로 발표를 만들어 보며 마찰을 기록한다(클릭 수, 못 찾음, 기대와 다른 결과).
   빈 템플릿 덱 zz-dogfood를 만들고 끝나면 지운다. 사람이 하는 순서대로 UI를 쓴다. 실행: bun scripts/test.ts --only editor-dogfood (OUT에 스크린샷). */
const fs = require('fs'), path = require('path');
const { launch } = require('./lib/pw.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3200', OUT = process.env.OUT || '/tmp/slidekit-dogfood', NAME = 'zz-dogfood';
fs.mkdirSync(OUT, { recursive: true });
const dir = path.join(__dirname, '..', 'decks', NAME);
const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
process.on('exit', cleanup);

(async () => {
  cleanup();
  const log = (lvl, step, msg) => console.log(`FRICTION ${lvl} | ${step} | ${msg}`);
  const r = await fetch(BASE + '/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: NAME, title: 'Dogfood Talk', template: 'blank' }) });
  if (r.status !== 201) { console.log('FAIL 덱을 만들지 못함', r.status); process.exit(1); }
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (x) => x.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('slidekit.tip.editor', '1'); } catch {} });
  const page = await ctx.newPage();
  if (process.env.CPU_SLOW) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_SLOW) }); }
  const errs = [], cons = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', async (m) => { if (m.type() !== 'error') return; const parts = await Promise.all(m.args().map((a) => a.evaluate((x) => (x && x.stack) || (x && x.message) || String(x)).catch(() => ''))); cons.push(parts.join(' ').slice(0, 700)); });
  await page.addInitScript(() => { window.__c = { click: 0, key: 0 }; addEventListener('click', (e) => e.isTrusted && window.__c.click++, true); addEventListener('keydown', (e) => e.isTrusted && !['Shift', 'Meta', 'Control', 'Alt'].includes(e.key) && window.__c.key++, true); });
  await page.goto(BASE + '/edit/' + NAME);
  const frameEl = page.locator('iframe[title="Canvas"]'); await frameEl.waitFor();
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 90)))));
  await page.waitForFunction(() => document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelector('[data-active]'));
  await settle();
  const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
  const counts = () => page.evaluate(() => { const c = { ...window.__c }; window.__c.click = 0; window.__c.key = 0; return c; });
  const tiles = page.locator('[data-testid=filmstrip] [role=option]');
  const rect = async (sel) => { const b = await frameEl.boundingBox(); const q = await fr().evaluate((s) => { const e = document.querySelector('[data-active] ' + s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel); return q && { x: b.x + q.x, y: b.y + q.y, w: q.w, h: q.h }; };
  const stepOf = async (name, fn, budget) => {
    await counts(); let ok = true, err = '';
    try { await fn(); } catch (e) { ok = false; err = String(e).split('\n')[0].slice(0, 160); }
    const c = await counts(); const n = c.click + c.key;
    if (await page.getByText('Something went wrong.').count()) { ok = false; err = '화면이 오류 상자(Something went wrong)로 바뀜: ' + cons.slice(-2).join(' || ') + ' | ' + errs.slice(-1).join(''); await page.screenshot({ path: path.join(OUT, 'crash-' + name.split(' ')[0] + '.png') }).catch(() => {}); }
    console.log(`STEP ${ok ? 'ok  ' : 'FAIL'} ${name}: 클릭 ${c.click}, 키 ${c.key}${ok ? '' : ' | ' + err}`);
    if (!ok) { await page.screenshot({ path: path.join(OUT, 'fail-' + name.split(' ')[0] + '.png') }).catch(() => {}); console.log('INFO 화면의 레이블', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).filter((t) => /background|fill|type/i.test(t)).slice(0, 12)))); }
    if (!ok) log('막힘', name, err); else if (budget && n > budget) log('불편', name, `입력 ${n}번(기대 ${budget} 이하)`);
    return ok;
  };
  const editText = async (sel, text) => { const b = await rect(sel); if (!b) throw new Error('요소를 못 찾음 ' + sel); await page.mouse.dblclick(b.x + b.w / 2, b.y + b.h / 2); await page.keyboard.press('Meta+a'); await page.keyboard.type(text); await page.keyboard.press('Escape'); await settle(); };
  const palette = async (q) => { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press('Meta+k'); await settle(); await page.keyboard.type(q); await settle(); await page.keyboard.press('Enter'); await settle(); };
  await page.screenshot({ path: path.join(OUT, '1-start.png') });

  await stepOf('1 표지 제목과 부제 쓰기', async () => { await editText('h1', 'Dogfood: 편집기만으로 만든 발표'); await editText('p', '에이전트 없이 10장'); }, 14);
  await tiles.nth(1).click(); await settle();
  await stepOf('2 두 번째 슬라이드 제목과 본문 쓰기', async () => { await editText('h2', '오늘 다룰 것'); await editText('p', '입력, 레이아웃, 이미지, 발표'); }, 14);
  await stepOf('3 목록 만들기(팔레트 Insert bulleted list, 항목 쓰기, Cmd+D로 늘리기)', async () => {
    await palette('Insert bulleted list'); await page.keyboard.type('첫째'); await page.keyboard.press('Escape'); await settle();
    await page.keyboard.press('Meta+d'); await settle();
    const n = await fr().evaluate(() => document.querySelectorAll('[data-active] ul li').length);
    if (n < 4) throw new Error('목록 항목이 ' + n + '개');
  }, 10);
  await page.screenshot({ path: path.join(OUT, 'after-list.png') });
  const addLayout = async (label) => { await page.getByRole('button', { name: 'Add slide' }).click(); await page.getByRole('menuitem', { name: label }).click(); await settle(); };
  await stepOf('4 두 칼럼 슬라이드 추가', () => addLayout('Two columns'), 4);
  await stepOf('5 큰 숫자 슬라이드 추가', () => addLayout('Big number'), 4);
  await stepOf('6 인용 슬라이드 추가', () => addLayout('Quote'), 4);
  await stepOf('7 이미지 슬라이드 추가', () => addLayout('Full image'), 4);
  await page.screenshot({ path: path.join(OUT, '2-middle.png') });
  await stepOf('8 이미지 붙여넣기(끌어놓기)', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const b = await frameEl.boundingBox();
    await fr().evaluate(([b64]) => { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([a], 'pic.png', { type: 'image/png' })); const el = document.querySelector('[data-active]'); el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); }, [png.toString('base64')]);
    await settle();
    await page.waitForFunction(() => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-active] img'), null, { timeout: 8000 });
  });
  await stepOf('9 슬라이드 배경을 그라디언트로', async () => {
    await page.getByText(/^Slide \d+$/).first().click(); await settle(); // Layers의 Slide 행을 눌러야 슬라이드 속성이 보인다
    await page.getByRole('radio', { name: /gradient/i }).first().click(); await settle();
    await page.screenshot({ path: path.join(OUT, 'gradient.png') });
  }, 6);
  await stepOf('10 단계 등장: 요소에 Appears at step 2', async () => {
    await tiles.nth(1).click(); await settle();
    const b = await rect('p'); await page.mouse.click(b.x + 10, b.y + b.h / 2); await settle();
    const f = page.getByLabel('Appears at step'); await f.fill('2'); await f.press('Enter'); await settle();
  }, 8);
  await stepOf('11 발표자 노트 쓰기', async () => { await page.getByPlaceholder('Speaker notes (Markdown)').fill('여기서 목록을 읽는다'); await settle(); }, 3);
  await stepOf('12 테마 바꾸기', async () => {
    const themes = ['Paper', 'Dark', 'Light', 'Midnight blue', 'Mono', 'High contrast'];
    for (let i = 0; i < Number(process.env.THEME_ROUNDS || 1); i++) {
      if (i % 2) { await tiles.nth(i % 5).click(); const b = await rect('h1, h2, p, li'); if (b) await page.mouse.click(b.x + 10, b.y + b.h / 2); } // 요소를 고른 채로 바꾼다
      await palette('Theme: ' + themes[i % themes.length]);
      if (await page.getByText('Something went wrong.').count()) throw new Error('테마 ' + (i + 1) + '번째 변경에서 오류 경계: ' + await page.evaluate(() => (window.__skLastError || '').slice(0, 700)));
    }
  }, 6);
  await stepOf('13 슬라이드 순서 바꾸기(끌어서)', async () => {
    const a = await tiles.nth(5).boundingBox(), t = await tiles.nth(1).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(t.x + 8, t.y + t.height / 2, { steps: 8 }); await page.mouse.up(); await settle();
  }, 6);
  await stepOf('14 슬라이드를 맨 앞으로(팔레트)', async () => { await tiles.nth(3).click(); await palette('Move slide to start'); }, 8);
  await page.screenshot({ path: path.join(OUT, '3-done.png') });
  const popups = []; ctx.on('page', (p) => popups.push(p));
  await stepOf('15 발표 시작(Cmd+Enter)', async () => { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press('Meta+Enter'); await page.waitForTimeout(1500); if (!popups.length && !/present/.test(page.url())) throw new Error('발표 화면이 열리지 않음'); }, 3);
  console.log('INFO 슬라이드 수', await tiles.count().catch(() => '?'), '페이지 오류', JSON.stringify(errs.slice(0, 2)));
  await browser.close(); process.exit(0);
})().catch((e) => { console.log('FAIL', String(e).slice(0, 300)); process.exit(1); });
