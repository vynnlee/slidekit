/* 코멘트 흐름 브라우저 검증.
   편집기에서 C 키로 작성창을 열어 코멘트를 쓰고(Cmd+Enter), 채널이 없을 때의 안내와 대기 상태를 보고,
   가짜 채널 소비자가 연결해 전달 표시(Sent to Claude)와 답을 보내면 패널, 핀, 알림이 갱신되는지,
   필터와 해결, 파일 변경에 따른 캔버스 새로고침을 확인한다.
   덱은 decks/_e2e-comments로 복사해 쓰고 끝나면 지운다. 실행 전에 앱 서버가 떠 있어야 한다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3244 node comments-e2e.cjs */
const { launch } = require('../../scripts/lib/pw.cjs'); // 러너의 공용 브라우저 서버에 연결한다(없으면 직접 띄운다)
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:3244';
const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra).slice(0, 240))); };
const json = { 'Content-Type': 'application/json' };

(async () => {
  const t = makeTestDeck('comments'); // 실제 덱은 건드리지 않는다
  const DECK = t.folder;
  const abort = new AbortController();
  let browser;
  try {
    browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/edit/${t.id}`);
    await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
    await page.getByTestId('filmstrip').waitFor(); // 편집기 화면이 그려졌다
    const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
    const panel = page.getByTestId('comments-panel');
    const items = panel.locator('li[data-comment-id]');
    const stateIs = (s, n = 1) => page.waitForFunction(([s, n]) => document.querySelectorAll(`[data-testid=comments-panel] li[data-state="${s}"]`).length === n, [s, n], { timeout: 15000 }).then(() => true, () => false);

    // 채널이 없을 때: 안내와 복사 버튼
    await page.getByRole('tab', { name: /^Comments/ }).click();
    await page.getByTestId('channel-help').waitFor({ timeout: 8000 }).then(() => check('채널 미연결: 연결 안내와 명령 복사 버튼', true), () => check('채널 미연결: 연결 안내와 명령 복사 버튼', false));
    check('안내에 실행 명령이 있다', /--dangerously-load-development-channels server:slidekit/.test(await page.getByTestId('channel-help').textContent()));
    check('빈 상태 문구에 C 키 안내', /press C/.test(await panel.textContent()));

    // C 키로 작성창을 열고 Cmd+Enter로 전송
    await fr().locator('[data-active] h1, [data-active] h2').first().click({ modifiers: ['Meta'] });
    await page.locator('.border-2.border-focus-ring').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}); // 선택 윤곽이 보이면 선택 완료
    await page.keyboard.press('c');
    let box = page.getByRole('textbox', { name: 'Comment' });
    await box.waitFor({ timeout: 1500 }).catch(() => {});
    if (!(await box.count())) { await page.getByRole('button', { name: 'Comment', exact: true }).click(); await box.waitFor({ timeout: 3000 }).catch(() => {}); box = page.getByRole('textbox', { name: 'Comment' }); }
    check('C 키(또는 툴바 버튼)로 작성창이 열린다', (await box.count()) === 1);
    await page.getByRole('button', { name: 'Make this shorter' }).click();
    check('빠른 문구 칩이 입력창을 채운다(글이 있으면 칩은 사라진다)', (await box.inputValue()) === 'Make this shorter' && (await page.getByRole('group', { name: 'Quick comments' }).count()) === 0);
    check('연결 안 됨 안내가 작성창에도 보인다', /not connected/i.test(await page.getByRole('group', { name: 'New comment' }).textContent()));
    await box.fill('E2E 코멘트입니다');
    const posted = page.waitForResponse((r) => r.url().endsWith('/api/comments') && r.request().method() === 'POST');
    await page.keyboard.press('Meta+Enter');
    const resp = await posted;
    check('Cmd+Enter가 POST /api/comments를 보낸다(200)', resp.status() === 200, resp.status());
    const reqBody = JSON.parse(resp.request().postData());
    check('요청에 덱, 슬라이드, 경로, 본문', reqBody.deck === DECK && reqBody.slide >= 1 && !!reqBody.path && reqBody.text === 'E2E 코멘트입니다', reqBody);
    await page.getByRole('group', { name: 'New comment' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    check('전송 뒤 작성창이 닫힌다', (await page.getByRole('group', { name: 'New comment' }).count()) === 0);
    check('Waiting 상태로 목록에 나타난다', await stateIs('waiting'));
    const pin = page.locator('[data-comment-pin]');
    check('캔버스에 번호 핀이 있고 이름에 번호와 상태가 있다', (await pin.count()) === 1 && /^Comment 1, Waiting: E2E/.test((await pin.getAttribute('aria-label')) ?? ''), await pin.getAttribute('aria-label'));

    // 가짜 채널 소비자: /api/events?client=channel 로 연결, 연결 때 대기 코멘트를 따라잡아 전달 표시, 잠시 뒤 답한다.
    const delivered = [];
    (async () => {
      const res = await fetch(`${BASE}/api/events?client=channel`, { signal: abort.signal });
      const handle = async (deck, c) => {
        if (deck !== DECK || delivered.includes(c.id)) return;
        delivered.push(c.id);
        await fetch(`${BASE}/api/comments/${c.id}/delivered`, { method: 'POST', headers: json, body: JSON.stringify({ deck }) });
        await sleep(1200); // Sent to Claude 상태를 관찰할 수 있게 전달 표시와 답 사이에 둔 간격(조건 대기는 폴링이라 이보다 짧으면 놓칠 수 있다)
        await fetch(`${BASE}/api/comments/${c.id}/reply`, { method: 'POST', headers: json, body: JSON.stringify({ deck, reply: 'E2E 답변입니다' }) });
      };
      for (const c of await (await fetch(`${BASE}/api/comments?deck=${DECK}`)).json()) if (c.status === 'open' && !c.deliveredAt) handle(DECK, c);
      let buf = '';
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.split('\n').find((l) => l.startsWith('event: ')) !== 'event: comment') continue; // comments(전체 교체) 이벤트와 구분한다
          const { deck, comment } = JSON.parse(block.split('\n').find((l) => l.startsWith('data: ')).slice(6));
          handle(deck, comment);
        }
      }
    })().catch(() => {});

    check('채널이 연결되면 안내가 사라지고 연결됨 표시', await page.waitForFunction(() => !document.querySelector('[data-testid=channel-help]') && /Claude connected/.test(document.body.textContent), null, { timeout: 8000 }).then(() => true, () => false));
    check('따라잡기 전달 뒤 Sent to Claude 상태', await stateIs('sent'));
    check('핀 이름도 Sent to Claude로 바뀐다', /Sent to Claude/.test((await pin.getAttribute('aria-label')) ?? ''), await pin.getAttribute('aria-label'));

    // 답: 패널, 핀, 알림
    check('답이 도착하면 Replied 상태', await stateIs('replied'));
    check('답변 본문이 코멘트 아래에 보인다', /E2E 답변입니다/.test(await items.first().textContent()));
    const toastText = page.getByText(/Claude replied on slide \d+/);
    await toastText.first().waitFor({ timeout: 5000 }).then(() => check('답변 도착 알림(토스트)이 뜨고 슬라이드 번호가 있다', true), () => check('답변 도착 알림(토스트)이 뜨고 슬라이드 번호가 있다', false));
    const saved = JSON.parse(fs.readFileSync(t.commentsFile, 'utf8'));
    check('comments.json에 deliveredAt, done, reply', saved.length === 1 && !!saved[0].deliveredAt && saved[0].status === 'done' && saved[0].reply === 'E2E 답변입니다', saved);

    // 해결과 필터
    await page.getByRole('button', { name: /^Resolve comment 1/ }).click();
    check('Resolve 하면 Resolved 상태', await stateIs('resolved'));
    check('Resolved 필터가 1건, Open 필터가 0건', await (async () => {
      await page.getByRole('button', { name: /^Resolved/ }).click(); const a = await items.count();
      await page.getByRole('button', { name: /^Open/ }).click(); const b = await items.count();
      await page.getByRole('button', { name: /^All/ }).click();
      return a === 1 && b === 0;
    })());
    check('해결 상태가 파일에 저장된다', JSON.parse(fs.readFileSync(t.commentsFile, 'utf8'))[0].resolved === true);
    await page.getByRole('button', { name: /^Reopen comment 1/ }).click();
    check('Reopen 하면 Replied로 돌아온다', await stateIs('replied'));

    // 호버 양방향 하이라이트: 목록에 올리면 핀이 커진다
    await items.first().hover();
    await page.waitForFunction(() => /scale-125/.test(document.querySelector('[data-comment-pin]')?.className ?? ''), null, { timeout: 2000 }).catch(() => {});
    check('목록 호버가 핀을 강조한다', /scale-125/.test((await pin.getAttribute('class')) ?? ''));

    // 키보드: J/K와 화살표로 코멘트 사이를 옮기고 E로 해결과 되돌리기
    await fetch(`${BASE}/api/comments`, { method: 'POST', headers: json, body: JSON.stringify({ deck: DECK, slide: 1, path: 'h1', excerpt: 'k', text: '키보드 확인용' }) });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-comment-id]').length === 2, null, { timeout: 8000 }).catch(() => {});
    const mains = panel.locator('[data-comment-main]');
    const focused = (i) => mains.nth(i).evaluate((e) => e === document.activeElement);
    await mains.first().focus(); await page.keyboard.press('j');
    check('J로 다음 코멘트에 포커스', await focused(1));
    await page.keyboard.press('k');
    check('K로 이전 코멘트에 포커스', await focused(0));
    await page.keyboard.press('ArrowDown');
    check('아래 화살표도 다음 코멘트로 이동(슬라이드 이동으로 새지 않는다)', await focused(1));
    await page.keyboard.press('e');
    check('E로 해결', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-state="resolved"]').length === 1, null, { timeout: 5000 }).then(() => true, () => false));
    await page.keyboard.press('e');
    check('E를 다시 누르면 해결 취소', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-state="resolved"]').length === 0, null, { timeout: 5000 }).then(() => true, () => false));

    // Delete 키: 지우고 Undo 토스트로 되살린다
    await mains.nth(1).focus();
    await page.keyboard.press('Delete');
    check('Delete로 코멘트가 지워진다', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-comment-id]').length === 1, null, { timeout: 5000 }).then(() => true, () => false));
    check('지운 뒤 포커스가 남은 코멘트로 간다', await focused(0));
    await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
    check('Undo로 되살아난다', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-comment-id]').length === 2, null, { timeout: 5000 }).then(() => true, () => false));

    // 우클릭 메뉴(패널 항목과 핀): INTERACTION 2.5
    await items.first().click({ button: 'right' });
    const menu = page.getByRole('menu');
    await menu.waitFor({ timeout: 3000 }).then(() => check('패널 항목 우클릭이 메뉴를 연다', true), () => check('패널 항목 우클릭이 메뉴를 연다', false));
    const names = await menu.getByRole('menuitem').allTextContents();
    check('패널 메뉴 항목과 순서: Resolve, Copy text, Delete(Open in panel 없음)', /^Resolve/.test(names[0] ?? '') && names.some((n) => /^Copy text/.test(n)) && /^Delete/.test(names.at(-1) ?? '') && !names.some((n) => /Open in panel/.test(n)), names);
    await page.keyboard.press('Escape');
    await pin.first().click({ button: 'right' });
    await menu.waitFor({ timeout: 3000 }).catch(() => {});
    const pinNames = await menu.getByRole('menuitem').allTextContents();
    check('핀 메뉴 맨 위가 Open in panel', /^Open in panel/.test(pinNames[0] ?? ''), pinNames);
    await menu.getByRole('menuitem', { name: /^Resolve/ }).click();
    check('핀 메뉴의 Resolve가 해결 처리한다', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-state="resolved"]').length === 1, null, { timeout: 5000 }).then(() => true, () => false));
    await items.first().click({ button: 'right' });
    await menu.getByRole('menuitem', { name: /^Reopen/ }).click();
    check('패널 메뉴의 Reopen이 되돌린다', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-state="resolved"]').length === 0, null, { timeout: 5000 }).then(() => true, () => false));
    await items.first().click({ button: 'right' });
    await menu.getByRole('menuitem', { name: /^Delete/ }).click();
    check('패널 메뉴의 Delete가 지우고 Undo로 되살아난다', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-comment-id]').length === 1, null, { timeout: 5000 }).then(() => true, () => false));
    await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
    check('Undo 뒤 코멘트가 둘이다', await page.waitForFunction(() => document.querySelectorAll('[data-testid=comments-panel] li[data-comment-id]').length === 2, null, { timeout: 5000 }).then(() => true, () => false));

    // 파일 변경 -> 캔버스 새로고침
    const src = fs.readFileSync(t.file, 'utf8');
    const title = (await fr().locator('[data-active] h1, [data-active] h2').first().textContent()).trim();
    fs.writeFileSync(t.file, src.replace(new RegExp(`(<h[12][^>]*>)${title}<`), '$1E2E 외부 수정<')); // <title>이 아니라 제목 요소를 고친다
    let refreshed = false;
    for (let i = 0; i < 80 && !refreshed; i++) {
      refreshed = await page.evaluate(() => { const f = document.querySelector('iframe[title="Canvas"]'); return !!(f && f.contentDocument && /E2E 외부 수정/.test(f.contentDocument.body.textContent)); }).catch(() => false);
      if (!refreshed) await sleep(100);
    }
    check('deck-changed로 캔버스가 새로고침', refreshed, { title, fileHas: fs.readFileSync(t.file, 'utf8').includes('E2E 외부 수정') });
    check('페이지 오류 없음', errors.length === 0, errors);
  } catch (e) {
    fail++; console.log('FAIL 예외 ' + e);
  } finally {
    abort.abort();
    if (browser) await browser.close();
    t.cleanup();
  }
  console.log(fail ? `${fail} failed` : 'all passed');
  process.exit(fail ? 1 : 0);
})();
