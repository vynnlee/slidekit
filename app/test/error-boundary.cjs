/* 오류 경계: 렌더 오류가 나면 흰 화면 대신 안내와 Reload, Copy details를 보인다. 테스트 전용 /dev/boom 라우트가 렌더 중에 던진다.
   단언: 메시지와 스택이 콘솔과 window.__skLastError에 남음, Copy details가 클립보드에 메시지와 스택을 넣음, 편집기 주소에서는 자동 저장 안내,
   Reload가 마지막 저장본(파일 내용)으로 편집기를 다시 엶. */
const fs = require('fs');
const { launch } = require('../../scripts/lib/pw.cjs');
const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
let fail = 0;
const check = (label, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };

(async () => {
  const T = makeTestDeck('error-boundary', 'vibe-coding-workshop', { slides: 3 });
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('slidekit.tip.editor', '1'); } catch {} });
  const page = await ctx.newPage();
  const cons = []; page.on('console', (m) => { if (m.type() === 'error') cons.push(m.text()); });

  await page.goto(BASE + '/dev/boom');
  check('렌더 오류가 나면 안내와 Reload가 보임', await page.getByText('Something went wrong.').waitFor({ timeout: 8000 }).then(() => true).catch(() => false) && (await page.getByRole('button', { name: 'Reload' }).count()) === 1);
  check('/dev/boom에서는 편집기 자동 저장 안내가 없음', (await page.getByText('The editor saves automatically').count()) === 0);
  const last = await page.evaluate(() => window.__skLastError || '');
  check('window.__skLastError에 메시지, 스택, 컴포넌트 스택, 주소', /Boom: test render error/.test(last) && /Component stack:/.test(last) && /URL: \/dev\/boom/.test(last), last.slice(0, 200));
  check('콘솔에 [slidekit] render error 상세가 남음', cons.some((c) => /\[slidekit\] render error/.test(c) && /Boom: test render error/.test(c)), cons.slice(0, 2));
  await page.getByRole('button', { name: 'Copy details' }).click();
  await page.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 3000 }).catch(() => {});
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('Copy details가 클립보드에 메시지와 스택을 넣음', /Boom: test render error/.test(clip) && /Component stack:/.test(clip), clip.slice(0, 200));
  check('복사하면 단추가 Copied로 바뀜', (await page.getByRole('button', { name: 'Copied' }).count()) === 1);

  // 편집기 주소에서 난 오류: 자동 저장 안내, Reload는 마지막 저장본으로 편집기를 다시 연다
  await page.goto(BASE + '/dev/boom?deck=' + T.id);
  await page.getByText('Something went wrong.').waitFor({ timeout: 8000 });
  check('편집기 주소에서는 자동 저장과 마지막 저장본 안내', (await page.getByText('The editor saves automatically. Reloading opens the last saved version.').count()) === 1);
  const html = fs.readFileSync(T.file, 'utf8');
  fs.writeFileSync(T.file, html.replace(/(<section\b[^>]*\bdata-slide\b[^>]*>)/, '$1<p id="saved-marker">SAVED-MARKER</p>'));
  await page.getByRole('button', { name: 'Reload' }).click();
  check('Reload가 편집기를 열고 마지막 저장본(파일)의 내용을 보임', await page.locator('iframe[title="Canvas"]').waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
    && await page.waitForFunction(() => document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelector('#saved-marker'), null, { timeout: 15000 }).then(() => true).catch(() => false));
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL', String(e).slice(0, 300)); process.exit(1); });
