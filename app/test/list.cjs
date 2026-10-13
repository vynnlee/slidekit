/* 덱 목록 브라우저 검증: Cmd/Ctrl+K, 새 덱 오류 표시, 목록 요청 실패와 재시도, 보기 전환 기억.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node list.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
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
  check('페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
