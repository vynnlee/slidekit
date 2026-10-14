/* 휴대폰 리모컨 e2e: 발표자 화면(데스크톱)과 휴대폰(터치) 두 컨텍스트로 페어링, 이동, 타이머, 거절, 종료를 본다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node remote.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const DECK = '_e2e-remote', ID = 'e2e-remote', TOTAL = 5;
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'decks', DECK);
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><html lang="en" data-slidekit="1"><head><meta charset="utf-8"><title>${ID}</title>
<script type="application/json" id="deck-meta">{ "title": "${ID}", "id": "${ID}" }</script>
<link rel="stylesheet" href="../../engine/slidekit.css"></head><body>
<section data-slide="cover"><h1>Cover</h1><aside data-notes>Notes for cover</aside></section>
${Array.from({ length: TOTAL - 1 }, (_, i) => `<section data-slide="content"><h2>Slide ${i + 2}</h2><aside data-notes>Notes for slide ${i + 2}</aside></section>`).join('\n')}
<script src="../../engine/slidekit.js"></script></body></html>`);
process.on('exit', () => fs.rmSync(DIR, { recursive: true, force: true }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(extra)}`); };
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };

(async () => {
  const browser = await launch();
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await hostCtx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const host = await hostCtx.newPage();
  const errors = []; host.on('pageerror', (e) => errors.push(String(e)));
  await host.goto(`${BASE}/present/${ID}`, { waitUntil: 'domcontentloaded' });
  const counter = (pg) => pg.getByText(/^\d+ \/ \d+$/).first().innerText();
  check('발표자 화면이 열린다', await until(async () => (await counter(host)) === `1 / ${TOTAL}`));

  // 페어링
  await host.getByRole('button', { name: 'Remote' }).click();
  const dlg = host.getByRole('dialog', { name: 'Phone remote' });
  await dlg.getByRole('button', { name: 'Start remote' }).click();
  const addr = await dlg.getByLabel('Remote address').inputValue();
  const code = await dlg.getByLabel('Pairing code').innerText();
  check('주소에 코드는 해시로만 들어간다', /\/remote\/_e2e-remote#code=[A-Z2-7]{8}$/.test(addr) && /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(code), [addr, code]);
  await dlg.getByRole('button', { name: 'Close' }).click().catch(() => host.keyboard.press('Escape'));

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', (e) => errors.push(String(e)));
  await phone.goto(addr.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'domcontentloaded' });
  check('휴대폰에 슬라이드 번호와 노트가 보인다', await until(async () => (await counter(phone)) === `1 / ${TOTAL}` && (await phone.getByText('Notes for cover').count()) === 1));
  check('교환 뒤 주소에서 코드가 지워진다', !phone.url().includes('code='), phone.url());
  check('발표자 화면이 접속 중으로 보인다(Prev, Next 활성)', await until(async () => await phone.getByRole('button', { name: 'Next slide' }).isEnabled()));

  // 이동과 동기화
  const popP = hostCtx.waitForEvent('page', { timeout: 8000 });
  await host.getByRole('button', { name: 'Present', exact: true }).click();
  const aud = await popP.catch(() => null);
  check('청중 창이 열린다', !!aud);
  await phone.getByRole('button', { name: 'Next slide' }).tap();
  check('Next가 발표자 화면을 넘긴다', await until(async () => (await counter(host)) === `2 / ${TOTAL}`), await counter(host));
  check('휴대폰 번호와 노트가 따라온다', await until(async () => (await counter(phone)) === `2 / ${TOTAL}` && (await phone.getByText('Notes for slide 2').count()) === 1));
  check('청중 창도 같이 넘어간다', aud && (await until(async () => new URL(aud.url()).hash === '#2')), aud && aud.url());
  await phone.getByRole('button', { name: 'Previous slide' }).tap();
  check('Prev가 되돌린다', await until(async () => (await counter(host)) === `1 / ${TOTAL}`), await counter(host));

  // 타이머 상태 공유
  await phone.getByRole('button', { name: 'Start timer' }).tap();
  check('휴대폰에서 시작한 타이머가 휴대폰에도 Pause로 보인다', await until(async () => (await phone.getByRole('button', { name: 'Pause timer' }).count()) === 1));
  check('발표자 화면의 타이머가 돈다', await until(async () => (await host.locator('[role=timer]').first().innerText()) !== '00:00:00', 8000));
  await phone.getByRole('button', { name: 'Pause timer' }).tap();

  // 터치 목표와 청중 창 비노출
  const sizes = await Promise.all(['Previous slide', 'Next slide', 'Start timer'].map(async (n) => (await phone.getByRole('button', { name: n }).boundingBox())));
  check('주요 버튼이 44px 이상', sizes.every((b) => b && b.height >= 44 && b.width >= 44), sizes);
  check('청중 창에는 리모컨 대화상자와 코드가 없다', aud && (await aud.getByText(/Phone remote|Start remote/).count()) === 0 && !(await aud.content()).includes(code.replace('-', '')));

  // 거절: 코드 재사용, 틀린 코드, 허용 밖 명령
  const p2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p2.goto(addr.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'domcontentloaded' });
  check('이미 쓴 코드는 거절한다', await until(async () => (await p2.getByRole('alert').filter({ hasText: 'not valid or was already used' }).count()) === 1));
  await p2.getByLabel('Pairing code').fill('AAAA-AAAA');
  await p2.getByRole('button', { name: 'Join' }).click();
  check('틀린 코드는 거절한다', await until(async () => (await p2.getByRole('alert').filter({ hasText: 'not valid' }).count()) === 1));
  const status = await phone.evaluate(async (id) => {
    const t = sessionStorage.getItem(`slidekit:remote:${id}`);
    const post = (b) => fetch(`/api/remote/${id}/cmd`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(b) }).then((r) => r.status);
    return [await post({ type: 'save' }), await post({ type: 'goto', n: 0 })];
  }, DECK);
  check('허용 밖 명령은 400', status.join() === '400,400', status);

  // 종료
  await host.getByRole('button', { name: 'Remote' }).click();
  await host.getByRole('dialog', { name: 'Phone remote' }).getByRole('button', { name: 'Stop remote' }).click();
  check('발표자가 끝내면 휴대폰에 Remote ended', await until(async () => (await phone.getByText('Remote ended').count()) === 1));
  check('끝난 뒤 명령은 거절', (await phone.evaluate(async (id) => fetch(`/api/remote/${id}/cmd`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, body: '{"type":"next"}' }).then((r) => r.status), DECK)) === 403);

  check('페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
