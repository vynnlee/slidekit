/* 버전 기록과 Claude 수정 되돌리기 브라우저 검증.
   Version history 대화상자(목록, Compare, Restore, Undo)와, 코멘트 답에 붙는 "Revert Claude's edit"(되돌리기, 취소, 덱이 더 바뀌었을 때 거절 안내).
   덱은 decks/_e2e-versions 사본만 쓴다. 실행 전에 앱 서버가 떠 있어야 한다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3241 node versions-e2e.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:3241';
const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra).slice(0, 240))); };
const J = { 'Content-Type': 'application/json' };

(async () => {
  const t = makeTestDeck('versions');
  await sleep(900); // 사본을 만들며 id를 고친 쓰기가 감시기에 잡혀 첫 스냅샷이 생기는 시간(디바운스 250ms)을 기다린다
  let browser, page;
  try {
    browser = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/edit/${t.id}`);
    await page.getByTestId('filmstrip').waitFor();
    await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });

    const api = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: J, body: JSON.stringify({ deck: t.folder, ...(body || {}) }) });
    const versions = async () => (await (await fetch(`${BASE}/api/decks/${t.folder}/versions`)).json());
    const claudeEdit = async (from, to) => { // 편집기 밖(Claude)에서 파일을 고친다
      const before = (await versions()).length;
      fs.writeFileSync(t.file, fs.readFileSync(t.file, 'utf8').replace(from, to));
      for (let i = 0; i < 60 && (await versions()).length === before; i++) await sleep(100);
    };
    const reload = async () => {
      await page.waitForFunction((txt) => { const f = document.querySelector('iframe[title="Canvas"]'); return !!(f && f.contentDocument && f.contentDocument.body.textContent.includes(txt)); }, 'Claude 수정 1', { timeout: 20000 }).catch(() => {});
    };
    const openHistory = async () => {
      await page.getByRole('button', { name: 'Export' }).click();
      await page.getByRole('menuitem', { name: /Version history/ }).click();
      await page.getByRole('dialog').waitFor();
    };
    const original = fs.readFileSync(t.file, 'utf8');
    const title = (original.match(/<h[12][^>]*>([^<]+)</) ?? [])[1];

    // 1) 대화상자가 열리고 처음 상태(사본 만들 때의 스냅샷이 있을 수 있다)를 보여 준다
    const baseline = (await versions()).length;
    await openHistory();
    check('Version history가 열리고 목록 또는 없음 안내를 보인다', await page.getByTestId(baseline ? 'version-list' : 'no-versions').isVisible());
    await page.keyboard.press('Escape');

    // 2) Claude가 파일을 고치면 직전 내용이 external 버전으로 남는다
    await claudeEdit(`>${title}<`, '>Claude 수정 1<');
    check('편집기 밖 수정이 external 버전을 만든다', (await versions())[0]?.kind === 'external');
    await reload();
    await openHistory();
    const row = page.getByTestId('version-list').locator('li').first();
    check('목록에 "Before a change outside the editor" 항목', /outside the editor/.test(await row.textContent()));
    await row.getByRole('button', { name: /^Compare/ }).click();
    check('Compare가 현재와의 차이를 말한다', await page.waitForFunction(() => /would come back|Same as|slide/i.test(document.querySelector('[data-testid=version-list]')?.textContent ?? ''), null, { timeout: 5000 }).then(() => true, () => false));
    check('Preview 링크는 새 탭용 미리보기 주소다', /\/api\/decks\/_e2e-versions\/versions\/.+\/preview$/.test((await row.getByRole('link', { name: /^Preview/ }).getAttribute('href')) ?? ''));

    // 3) Restore와 Undo
    await row.getByRole('button', { name: /^Restore/ }).click();
    await page.getByText(/Restored the version from/).first().waitFor({ timeout: 5000 });
    check('Restore가 파일을 옛 내용으로 되돌린다', fs.readFileSync(t.file, 'utf8') === original);
    check('복원 직전 내용이 restore 버전으로 남는다', (await versions()).some((v) => v.kind === 'restore'));
    await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
    check('Undo 토스트가 복원을 취소한다', await (async () => { for (let i = 0; i < 50; i++) { if (fs.readFileSync(t.file, 'utf8').includes('Claude 수정 1')) return true; await sleep(100); } return false; })());

    // 4) 코멘트의 Revert Claude's edit
    fs.writeFileSync(t.file, original); await sleep(900); // 기준으로 돌아간다(편집기는 조용히 다시 불러온다)
    const { id } = await (await api('/api/comments', { slide: 1, path: 'h1', excerpt: 'x', text: 'REVERT-TEST 제목을 바꿔 주세요' })).json();
    await api(`/api/comments/${id}/ack`);
    await claudeEdit(`>${title}<`, '>Claude 수정 2<');
    await api(`/api/comments/${id}/reply`, { reply: '제목을 바꿨습니다' });
    await page.getByRole('tab', { name: /^Comments/ }).click();
    const btn = page.getByRole('button', { name: /Revert Claude's edit for comment/ });
    await btn.waitFor({ timeout: 8000 }).then(() => check('답이 달리면 Revert Claude\'s edit 버튼이 나온다', true), () => check('답이 달리면 Revert Claude\'s edit 버튼이 나온다', false));
    await btn.click();
    check('Revert가 Claude 수정 전 내용으로 되돌린다', await (async () => { for (let i = 0; i < 50; i++) { if (fs.readFileSync(t.file, 'utf8') === original) return true; await sleep(100); } return false; })());
    await page.getByText("Reverted Claude's edit").first().waitFor({ timeout: 5000 }).then(() => check('되돌렸다는 토스트', true), () => check('되돌렸다는 토스트', false));
    await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
    check('토스트의 Undo가 되돌리기를 취소한다', await (async () => { for (let i = 0; i < 50; i++) { if (fs.readFileSync(t.file, 'utf8').includes('Claude 수정 2')) return true; await sleep(100); } return false; })());

    // 5) 그 사이 덱이 더 바뀌면 되돌리기를 거절하고 버전 기록을 안내한다
    await claudeEdit('Claude 수정 2', 'Claude 수정 2 그리고 사용자 수정');
    await page.getByRole('button', { name: /Revert Claude's edit for comment/ }).click();
    await page.getByText(/changed after Claude's edit/).first().waitFor({ timeout: 5000 }).then(() => check('덱이 더 바뀌었으면 거절 안내', true), () => check('덱이 더 바뀌었으면 거절 안내', false));
    check('거절하면 파일을 건드리지 않는다', fs.readFileSync(t.file, 'utf8').includes('Claude 수정 2 그리고 사용자 수정'));
    await page.getByRole('button', { name: 'Version history' }).last().click();
    check('안내의 Version history 버튼이 대화상자를 연다', await page.getByRole('dialog').getByText('Version history').first().isVisible());
    check('페이지 오류 없음', errors.length === 0, errors);
  } catch (e) {
    fail++; console.log('FAIL 예외 ' + e);
    await (typeof page !== 'undefined' ? page : null)?.screenshot({ path: '/tmp/slidekit-test-logs/versions-e2e-fail.png' }).catch(() => {}); // 실패 화면을 남긴다
  } finally {
    if (browser) await browser.close();
    t.cleanup();
  }
  console.log(fail ? `${fail} failed` : 'all passed');
  process.exit(fail ? 1 : 0);
})();
