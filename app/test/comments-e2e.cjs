/* 코멘트 흐름 브라우저 검증: 편집기에서 코멘트 작성 -> 가짜 채널 소비자가 SSE로 받아 reply -> 패널에 답 표시 -> 파일 변경 시 캔버스 새로고침.
   덱은 decks/_e2e-comments로 복사해 쓰고 끝나면 지운다. 실행 전에 앱 서버가 떠 있어야 한다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3244 node comments-e2e.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:3244';
const DECKS = path.join(__dirname, '..', '..', 'decks');
const DECK = '_e2e-comments';
const DIR = path.join(DECKS, DECK);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.cpSync(path.join(DECKS, 'vibe-coding-workshop'), DIR, { recursive: true });
  fs.rmSync(path.join(DIR, 'comments.json'), { force: true });
  // 편집기 주소는 덱 id를 쓰므로 복사본의 id를 바꾼다
  const f0 = path.join(DIR, 'index.html');
  fs.writeFileSync(f0, fs.readFileSync(f0, 'utf8').replace('"id": "vibe-coding-workshop"', `"id": "${DECK}"`));
  const abort = new AbortController();
  let browser;
  try {
    // 가짜 채널 소비자: comment 이벤트를 받으면 reply API를 부른다.
    const seen = [];
    (async () => {
      const res = await fetch(`${BASE}/api/events`, { signal: abort.signal });
      let buf = '';
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!/^event: comment$/m.test(block)) continue;
          const { deck, comment } = JSON.parse(block.match(/^data: (.*)$/m)[1]);
          if (deck !== DECK) continue;
          seen.push(comment);
          await sleep(500);
          await fetch(`${BASE}/api/comments/${comment.id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deck, reply: 'E2E 답변입니다' }) });
        }
      }
    })().catch(() => {});
    await sleep(500);

    browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/edit/${DECK}`);
    await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
    await sleep(800);
    const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));

    // 요소 선택 -> 코멘트 작성
    await fr().locator('[data-active] h1, [data-active] h2').first().click();
    await sleep(300);
    await page.getByRole('button', { name: 'Comment' }).first().click();
    await page.getByPlaceholder('Comment').fill('E2E 코멘트입니다');
    const posted = page.waitForResponse((r) => r.url().endsWith('/api/comments') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Send' }).click();
    const resp = await posted;
    check('POST /api/comments가 200', resp.status() === 200, resp.status());
    const reqBody = JSON.parse(resp.request().postData());
    check('요청에 덱, 슬라이드, 경로, 본문', reqBody.deck === DECK && reqBody.slide >= 1 && !!reqBody.path && reqBody.text === 'E2E 코멘트입니다', reqBody);
    await sleep(1500);
    check('소비자가 SSE로 코멘트 수신', seen.length === 1 && seen[0].text === 'E2E 코멘트입니다', seen.length);

    // 답이 패널에 실시간 표시된다(새로고침 없이)
    await page.getByText('E2E 답변입니다').waitFor({ timeout: 5000 }).then(() => check('답변이 코멘트 패널에 표시', true), () => check('답변이 코멘트 패널에 표시', false));
    const saved = JSON.parse(fs.readFileSync(path.join(DIR, 'comments.json'), 'utf8'));
    check('comments.json이 done과 reply 기록', saved.length === 1 && saved[0].status === 'done' && saved[0].reply === 'E2E 답변입니다', saved);

    // 파일 변경 -> 캔버스 새로고침
    const file = path.join(DIR, 'index.html');
    const src = fs.readFileSync(file, 'utf8');
    const title = (await fr().locator('[data-active] h1, [data-active] h2').first().textContent()).trim();
    fs.writeFileSync(file, src.replace(new RegExp(`(<h[12][^>]*>)${title}<`), '$1E2E 외부 수정<')); // <title>이 아니라 제목 요소를 고친다
    await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && /E2E 외부 수정/.test(f.contentDocument.body.textContent); }, null, { timeout: 25000 })
      .then(() => check('deck-changed로 캔버스가 새로고침', true), async () => check('deck-changed로 캔버스가 새로고침', false, { fileHas: fs.readFileSync(file, 'utf8').includes('E2E 외부 수정'), canvas: await page.evaluate(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument ? f.contentDocument.body.textContent.replace(/\s+/g, ' ').slice(0, 120) : null; }), title, unsaved: await page.getByText('Unsaved').count(), body: (await page.locator('body').innerText()).slice(0, 300) }));
    check('페이지 오류 없음', errors.length === 0, errors);
  } catch (e) {
    fail++; console.log('FAIL 예외 ' + e);
  } finally {
    abort.abort();
    if (browser) await browser.close();
    fs.rmSync(DIR, { recursive: true, force: true });
  }
  console.log(fail ? `${fail} failed` : 'all passed');
  process.exit(fail ? 1 : 0);
})();
