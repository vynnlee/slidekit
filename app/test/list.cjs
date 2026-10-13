/* 덱 목록 브라우저 검증: Cmd/Ctrl+K, 새 덱 오류 표시, 목록 요청 실패와 재시도, 보기 전환 기억.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node list.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const fs = require('fs'), path = require('path');
const DECKS = path.join(__dirname, '..', '..', 'decks');
const cleanup = () => { for (const d of fs.readdirSync(DECKS)) if (d.startsWith('zz-e2e')) fs.rmSync(path.join(DECKS, d), { recursive: true, force: true }); const tr = path.join(DECKS, '.trash'); if (fs.existsSync(tr)) for (const d of fs.readdirSync(tr)) if (d.startsWith('zz-e2e')) fs.rmSync(path.join(tr, d), { recursive: true, force: true }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: 'New deck' }).waitFor();
  for (const combo of ['Control+k', 'Meta+k']) {
    await page.keyboard.press(combo);
    check(`${combo}로 검색이 열린다`, await until(async () => (await page.getByRole('dialog').count()) === 1));
    await page.keyboard.press('Escape');
    check(`Esc로 닫힌다 (${combo})`, await until(async () => (await page.getByRole('dialog').count()) === 0));
  }
  await page.getByRole('button', { name: 'New deck' }).click();
  await page.getByLabel('Deck name').fill('vibe-coding-workshop');
  await page.getByRole('button', { name: 'Create' }).click();
  check('중복 이름 오류 표시', await until(async () => (await page.getByText('Name already exists').count()) === 1));
  await page.getByLabel('Deck name').fill('Bad Name');
  await page.getByRole('button', { name: 'Create' }).click();
  check('잘못된 이름 오류 표시', await until(async () => (await page.getByText(/Use lowercase letters/).count()) >= 1));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle view' }).click();
  await page.reload();
  check('보기 전환을 기억한다', await until(async () => (await page.locator('iframe').count()) >= 0 && (await page.evaluate(() => localStorage.getItem('slidekit:list-view'))) === 'list'));
  await page.evaluate(() => localStorage.setItem('slidekit:list-view', 'grid'));

  // 목록 요청 실패 -> 오류와 재시도
  const ctx2 = await browser.newContext();
  let fails = true;
  await ctx2.route('**/api/decks', (r) => (fails ? r.abort() : r.continue()));
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/');
  check('목록 요청 실패 표시', await until(async () => (await p2.getByRole('alert').innerText()).includes('Could not load decks')));
  fails = false;
  await p2.getByRole('button', { name: 'Retry' }).click();
  check('재시도하면 오류가 사라진다', await until(async () => (await p2.getByRole('alert').count()) === 0));
  // 덱 관리: 복제, 이름 변경, 우클릭 메뉴, 휴지통. 테스트가 만든 덱(zz-e2e*)은 끝에 지운다.
  cleanup();
  const post = (u, data) => ctx.request.post(BASE + u, { data });
  check('API로 덱 생성', (await post('/api/decks', { name: 'zz-e2e-a' })).status() === 201);
  await page.goto(BASE + '/');
  const actions = (title) => page.getByRole('button', { name: `Actions for ${title}`, exact: true });
  const item = (name) => page.getByRole('menuitem', { name });
  const ids = async () => (await (await ctx.request.get(BASE + '/api/decks')).json()).map((d) => d.id);
  await actions('zz-e2e-a').first().click({ force: true });
  await item('Duplicate').click();
  check('복제', await until(async () => (await ids()).includes('zz-e2e-a-copy')), await ids());
  const copyHtml = () => fs.readFileSync(path.join(DECKS, 'zz-e2e-a-copy', 'index.html'), 'utf8');
  check('복제본 메타 id가 새 이름', copyHtml().includes('"id":"zz-e2e-a-copy"'));
  await post('/api/decks/zz-e2e-a/duplicate', {}); // 두 번째 복제는 -copy-2
  check('복제 이름 충돌은 -copy-2', (await ids()).includes('zz-e2e-a-copy-2'));
  check('복제는 history 제외', !fs.existsSync(path.join(DECKS, 'zz-e2e-a-copy', 'history')));
  await page.reload();
  await actions('zz-e2e-a').first().click({ force: true });
  await item('Rename').click();
  await page.getByLabel('New name').fill('zz-e2e-a-copy');
  await page.getByRole('button', { name: 'Rename' }).click();
  check('중복 이름 변경 거부', await until(async () => (await page.getByText('Name already exists').count()) === 1));
  await page.getByLabel('New name').fill('Bad Name');
  await page.getByRole('button', { name: 'Rename' }).click();
  check('잘못된 이름 변경 거부', await until(async () => (await page.getByText(/Use lowercase letters/).count()) >= 1));
  await page.getByLabel('New name').fill('zz-e2e-b');
  await page.getByRole('button', { name: 'Rename' }).click();
  check('이름 변경', await until(async () => { const l = await ids(); return l.includes('zz-e2e-b') && !l.includes('zz-e2e-a'); }), await ids());
  check('이름 변경 시 메타 id 갱신', fs.readFileSync(path.join(DECKS, 'zz-e2e-b', 'index.html'), 'utf8').includes('"id":"zz-e2e-b"'));
  await page.getByRole('button', { name: 'zz-e2e-a', exact: true }).click({ button: 'right' });
  check('우클릭으로 메뉴가 열린다', await until(async () => (await item('Move to trash').count()) === 1));
  await item('Move to trash').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  check('취소하면 덱이 남는다', (await ids()).includes('zz-e2e-b'));
  await page.getByRole('button', { name: 'zz-e2e-a', exact: true }).click({ button: 'right' });
  await item('Move to trash').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move to trash' }).click();
  check('휴지통으로 이동', await until(async () => !(await ids()).includes('zz-e2e-b')));
  check('폴더는 decks/.trash에 보존', fs.readdirSync(path.join(DECKS, '.trash')).some((d) => d.startsWith('zz-e2e-b-')));
  check('.trash는 목록에 없다', !(await ids()).some((i) => String(i).includes('trash')));
  check('.trash 폴더는 정적 서빙 안 함', (await ctx.request.get(BASE + '/decks/.trash/x/index.html')).status() === 404);
  check('없는 덱 삭제는 404', (await ctx.request.post(BASE + '/api/decks/nope-nope/trash', { data: {} })).status() === 404);
  check('경로 이탈 이름 거부', (await ctx.request.post(BASE + '/api/decks/..%2Fapp/rename', { data: { name: 'zz-e2e-x' } })).status() === 404);
  cleanup();

  // 연결 상태 표시와 렌더 오류 경계
  const ctx3 = await browser.newContext();
  let down = false;
  await ctx3.route('**/api/ping', (r) => (down ? r.abort() : r.continue()));
  const p3 = await ctx3.newPage();
  await p3.goto(BASE + '/');
  down = true;
  check('서버가 끊기면 표시', await until(async () => (await p3.getByRole('status').filter({ hasText: 'Disconnected' }).count()) === 1, 12000));
  down = false;
  check('다시 연결되면 사라진다', await until(async () => (await p3.getByRole('status').filter({ hasText: 'Disconnected' }).count()) === 0, 15000));
  const ctx4 = await browser.newContext();
  await ctx4.route('**/api/decks', (r) => r.request().method() === 'GET' ? r.fulfill({ json: {} }) : r.continue());
  const p4 = await ctx4.newPage();
  await p4.goto(BASE + '/');
  check('렌더 오류는 Reload 화면', await until(async () => (await p4.getByText('Something went wrong.').count()) === 1 && (await p4.getByRole('button', { name: 'Reload' }).count()) === 1));
  check('페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
