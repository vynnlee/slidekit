/* 코멘트 모드 브라우저 검증(spec/COMMENT-MODE.md): 켜고 끄기, 호버 윤곽, 클릭으로 요소 코멘트, 드래그로 영역 코멘트(이미지 생성), 8px 미만은 클릭, Esc 순서,
   모드 중 편집 차단, 키보드 영역 지정(A, 방향키, Enter), 작성창의 Add(Enter)와 Send now(Cmd+Enter)와 Shift+Enter 줄바꿈과 한글 조합, 체크 상자 삭제.
   덱은 decks/_e2e-comment-mode 사본이고 끝에 지운다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3245 node comment-mode.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:3245';
const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra).slice(0, 300))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasChrome = !!process.env.CHROME || fs.existsSync('/Applications/Google Chrome.app');

(async () => {
  const t = makeTestDeck('comment-mode');
  let browser;
  try {
    browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('slidekit.tip.editor', '1'); } catch {} });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const posts = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/comments') && r.method() === 'POST') posts.push(JSON.parse(r.postData())); });
    await page.goto(`${BASE}/edit/${t.id}`);
    await page.getByTestId('filmstrip').waitFor();
    await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
    const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
    const layer = page.getByTestId('comment-mode-layer');
    const toggle = page.getByRole('button', { name: 'Comment mode' });
    const comments = async () => (await (await fetch(`${BASE}/api/comments?deck=${t.folder}`)).json());
    // 슬라이드 안의 요소 상자를 페이지 좌표로
    const heading = async () => { const ib = await page.locator('iframe[title="Canvas"]').boundingBox(); const r = await fr().evaluate(() => { const h = [...document.querySelectorAll('[data-active] h1, [data-active] h2')].find((x) => x.getBoundingClientRect().height > 0); const b = h.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }); return { x: ib.x + r.x, y: ib.y + r.y, w: r.w, h: r.h }; };
    const slideBox = async () => { const ib = await page.locator('iframe[title="Canvas"]').boundingBox(); const r = await fr().evaluate(() => { const b = document.querySelector('[data-active]').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }); return { x: ib.x + r.x, y: ib.y + r.y, w: r.w, h: r.h }; };
    const composer = page.getByRole('group', { name: 'New comment' });
    const fileBefore = fs.readFileSync(t.file, 'utf8');

    // 1) 켜고 끄기: 툴바 토글, Shift+C, Esc
    check('코멘트 모드 토글 단추가 있고 꺼져 있다', (await toggle.getAttribute('aria-pressed')) === 'false' && (await layer.count()) === 0);
    await toggle.click();
    check('토글을 누르면 모드 층이 뜨고 aria-pressed가 true', await layer.waitFor({ timeout: 3000 }).then(() => true, () => false) && (await toggle.getAttribute('aria-pressed')) === 'true');
    check('모드 알약과 켜짐 안내(aria-live)', (await page.getByText(/^Comment mode\. Click an element or drag an area/).count()) === 1 && /Comment mode on\./.test(await page.getByTestId('comment-mode-status').textContent()));
    check('모드 층이 포커스를 받고 커서가 crosshair', await layer.evaluate((e) => e === document.activeElement && getComputedStyle(e).cursor === 'crosshair'));
    await page.keyboard.press('Escape');
    check('Esc가 모드를 끈다', await layer.waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false));
    await page.keyboard.press('Shift+C');
    check('Shift+C가 모드를 켠다', await layer.waitFor({ timeout: 3000 }).then(() => true, () => false));
    await page.keyboard.press('Shift+C');
    check('Shift+C가 모드를 끈다', await layer.waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false));

    // 2) C: 선택이 없으면 모드, 선택이 있으면 작성창(모드 아님)
    await page.keyboard.press('c');
    check('선택이 없을 때 C는 모드를 켠다', await layer.waitFor({ timeout: 3000 }).then(() => true, () => false));
    await page.keyboard.press('Escape');
    await layer.waitFor({ state: 'detached' });
    const h0 = await heading();
    await fr().locator('[data-active] h1, [data-active] h2').first().click({ modifiers: ['Meta'] });
    await page.keyboard.press('c');
    check('선택이 있을 때 C는 지금처럼 작성창(모드 아님)', await composer.waitFor({ timeout: 3000 }).then(() => true, () => false) && (await layer.count()) === 0);
    await page.keyboard.press('Escape');
    await composer.waitFor({ state: 'detached' }).catch(() => {});

    // 3) 모드: 호버 윤곽과 클릭으로 요소 코멘트, Add는 Enter(보류), 모드는 유지
    await toggle.click(); await layer.waitFor();
    const hb = await heading();
    await page.mouse.move(hb.x + hb.w / 2, hb.y + hb.h / 2);
    check('호버하면 요소 윤곽과 이름 칩이 보인다', await page.waitForFunction(() => { const b = document.querySelector('[data-testid=comment-hover]'); return b && getComputedStyle(b).display !== 'none' && b.textContent.trim().length > 0; }, null, { timeout: 3000 }).then(() => true, () => false));
    await page.mouse.click(hb.x + hb.w / 2, hb.y + hb.h / 2);
    check('클릭하면 그 요소에 작성창이 열린다', await composer.waitFor({ timeout: 3000 }).then(() => true, () => false));
    check('작성창에 Add와 Send now 단추와 힌트가 있고 체크 상자는 없다', (await page.getByRole('button', { name: 'Add', exact: true }).count()) === 1 && (await page.getByRole('button', { name: 'Send now', exact: true }).count()) === 1 && /Enter: add\. Cmd\+Enter: send now\. Shift\+Enter: new line\./.test(await composer.textContent()) && (await page.getByLabel(/Hold until I send all/).count()) === 0 && (await composer.getByRole('checkbox').count()) === 0);
    const box = page.getByRole('textbox', { name: 'Comment' });
    await box.fill('첫째 줄');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('둘째 줄');
    check('Shift+Enter는 줄바꿈이다', (await box.inputValue()) === '첫째 줄\n둘째 줄');
    await box.evaluate((e) => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))); // 한글 조합 중 Enter
    await sleep(300);
    check('한글 조합 중 Enter는 보내지 않는다', posts.length === 0 && (await composer.count()) === 1);
    await page.keyboard.press('Enter');
    await composer.waitFor({ state: 'detached', timeout: 5000 });
    check('Enter는 Add: 보류(hold)로 저장되고 본문의 줄바꿈이 간다', posts.length === 1 && posts[0].hold === true && posts[0].text === '첫째 줄\n둘째 줄' && !!posts[0].path && !posts[0].region && posts[0].step >= 1, posts[0]);
    check('Add 뒤에도 모드가 유지된다', (await layer.count()) === 1);
    check('목록에 Held로 나타난다', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-state="held"]').length === 1, null, { timeout: 5000 }).then(() => true, () => false));

    // 4) Send now: Cmd+Enter(보류 아님)
    await page.mouse.click(hb.x + hb.w / 2, hb.y + hb.h / 2);
    await composer.waitFor();
    await page.getByRole('textbox', { name: 'Comment' }).fill('바로 보내기');
    await page.keyboard.press('Meta+Enter');
    await composer.waitFor({ state: 'detached', timeout: 5000 });
    check('Cmd+Enter는 Send now: 보류가 아니다', posts.length === 2 && !posts[1].hold && posts[1].text === '바로 보내기', posts[1]);
    check('Send now는 Waiting(채널 없음)', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-state="waiting"]').length >= 1, null, { timeout: 5000 }).then(() => true, () => false));

    // 5) 8px 미만은 클릭, 이상은 드래그(영역), Esc로 드래그 취소
    await page.mouse.move(hb.x + 20, hb.y + 5); await page.mouse.down(); await page.mouse.move(hb.x + 23, hb.y + 7); await page.mouse.up();
    check('8px 미만 움직임은 클릭(요소 코멘트)', await composer.waitFor({ timeout: 3000 }).then(() => true, () => false) && (await page.getByTestId('area-placeholder').count()) === 0);
    await page.keyboard.press('Escape');
    await composer.waitFor({ state: 'detached' });
    check('작성창을 Esc로 닫아도 모드는 유지된다', (await layer.count()) === 1);
    const sb = await slideBox();
    await page.mouse.move(sb.x + sb.w * 0.2, sb.y + sb.h * 0.2); await page.mouse.down(); await page.mouse.move(sb.x + sb.w * 0.5, sb.y + sb.h * 0.5, { steps: 4 });
    check('드래그 중에는 점선 사각형이 보인다', await page.waitForFunction(() => { const b = document.querySelector('[data-testid=comment-drag]'); return b && getComputedStyle(b).display !== 'none'; }, null, { timeout: 2000 }).then(() => true, () => false));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await sleep(300);
    check('드래그 중 Esc는 그 드래그만 취소(작성창 없음, 모드 유지)', (await composer.count()) === 0 && (await layer.count()) === 1);

    // 6) 영역 드래그 -> 영역 코멘트(Add), region과 overlap과 이미지
    await page.mouse.move(sb.x + sb.w * 0.05, sb.y + sb.h * 0.1); await page.mouse.down(); await page.mouse.move(sb.x + sb.w * 0.6, sb.y + sb.h * 0.45, { steps: 6 }); await page.mouse.up();
    check('드래그를 놓으면 영역 작성창(자리표시자)이 열린다', await composer.waitFor({ timeout: 3000 }).then(() => true, () => false) && /Area, \d+ elements?/.test(await composer.textContent()));
    await page.getByRole('textbox', { name: 'Comment' }).fill('영역 코멘트');
    await page.keyboard.press('Meta+Enter');
    await composer.waitFor({ state: 'detached', timeout: 5000 });
    const reg = posts.at(-1);
    check('영역 코멘트: path는 비고 region이 0~1 정규화이며 overlap과 step이 간다', reg.path === '' && reg.region && reg.region.x >= 0 && reg.region.x + reg.region.w <= 1.0001 && reg.region.w > 0.4 && Array.isArray(reg.overlap) && reg.step >= 1, reg);
    const area = page.getByTestId('area-info').first();
    check('목록에 Area 표시', await area.waitFor({ timeout: 5000 }).then(() => true, () => false) && /Area/.test(await area.textContent()));
    if (hasChrome) {
      check('이미지가 만들어지면 목록에 썸네일이 보인다', await page.waitForFunction(() => !!document.querySelector('[data-testid=area-info] img'), null, { timeout: 15000 }).then(() => true, () => false));
      const saved = (await comments()).find((c) => c.region);
      check('서버에 image ready와 파일', saved?.image === 'ready' && fs.existsSync(require('path').join(t.dir, '.comments', `${saved.id}.png`)), saved);
    } else console.log('SKIP 이미지 생성: Chrome이 없다');

    // 7) 모드 중 편집 차단: 요소 끌기와 Delete가 덱을 바꾸지 않는다
    await page.mouse.move(hb.x + hb.w / 2, hb.y + hb.h / 2); await page.mouse.down(); await page.mouse.move(hb.x + hb.w / 2 + 120, hb.y + hb.h / 2 + 80, { steps: 4 }); await page.mouse.up();
    await page.keyboard.press('Escape'); await composer.waitFor({ state: 'detached' }).catch(() => {});
    await page.keyboard.press('Delete');
    await sleep(1800); // 자동 저장 간격
    check('모드 중 끌기와 Delete는 덱 파일을 바꾸지 않는다', fs.readFileSync(t.file, 'utf8') === fileBefore);

    // 8) 키보드 영역: Tab으로 요소, A로 조절 상자, 방향키 이동, Shift+방향키 크기, Enter 확정, Esc 취소
    if ((await composer.count()) === 0 && (await layer.count()) === 0) await toggle.click();
    await layer.focus();
    await page.keyboard.press('Tab');
    check('Tab이 요소를 가리킨다(윤곽과 안내)', await page.waitForFunction(() => { const b = document.querySelector('[data-testid=comment-hover]'); return b && getComputedStyle(b).display !== 'none'; }, null, { timeout: 2000 }).then(() => true, () => false) && /Enter to comment/.test(await page.getByTestId('comment-mode-status').textContent()));
    await page.keyboard.press('a');
    const areaBox = page.getByTestId('comment-area');
    check('A가 조절 상자를 만들고 위치와 크기를 읽어 준다', await page.waitForFunction(() => { const b = document.querySelector('[data-testid=comment-area]'); return b && getComputedStyle(b).display !== 'none'; }, null, { timeout: 2000 }).then(() => true, () => false) && await page.waitForFunction(() => /Area \d+ by \d+ pixels at \d+, \d+\./.test(document.querySelector('[data-testid=comment-mode-status]').textContent), null, { timeout: 2000 }).then(() => true, () => false));
    const w0 = (await areaBox.boundingBox()).width, x0 = (await areaBox.boundingBox()).x;
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
    const b1 = await areaBox.boundingBox();
    check('방향키는 옮기고 Shift+방향키는 크기를 바꾼다', b1.x > x0 && b1.width > w0, { x0, x1: b1.x, w0, w1: b1.width });
    await page.keyboard.press('Escape');
    check('조절 중 Esc는 상자만 취소하고 모드는 유지', (await composer.count()) === 0 && (await layer.count()) === 1 && (await areaBox.evaluate((e) => getComputedStyle(e).display)) === 'none');
    await page.keyboard.press('Tab'); await page.keyboard.press('a'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Enter');
    check('Enter가 키보드 영역을 확정해 영역 작성창이 열린다', await composer.waitFor({ timeout: 3000 }).then(() => true, () => false) && (await page.getByTestId('area-placeholder').count()) === 1);
    await page.getByRole('textbox', { name: 'Comment' }).fill('키보드 영역');
    await page.keyboard.press('Enter');
    await composer.waitFor({ state: 'detached', timeout: 5000 });
    const kb = posts.at(-1);
    check('키보드 영역 코멘트도 region과 hold(Add)로 간다', !!kb.region && kb.hold === true && kb.path === '', kb);

    // 9) 끝내기: Esc 두 번이 아니라 Esc 한 번(작성창이 없을 때)
    await page.keyboard.press('Escape');
    check('Esc가 모드를 끈다(마지막)', await layer.waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false));
    check('페이지 오류 없음', errors.length === 0, errors);
  } catch (e) { fail++; console.log('FAIL 예외 ' + e); }
  finally { if (browser) await browser.close(); t.cleanup(); }
  console.log(fail ? `${fail} failed` : 'all passed');
  process.exit(fail ? 1 : 0);
})();
