/* 앱 화면(목록, 발표자 화면, 편집기, 리모컨)이 외부 호스트로 요청을 보내지 않는지 본다. 발표장 와이파이가 불안정해도 화면이 떠야 한다.
   127.0.0.1 밖으로 나가는 요청을 모두 막고 기록해 0건이어야 하고, 막은 상태에서도 화면이 뜨고 페이지 오류가 없어야 한다.
   외부 글꼴을 쓰는 덱(예: 글꼴 CDN을 쓰는 덱)은 그 덱의 요청이므로 여기서 보지 않고, 외부 참조가 없는 guide 시험용 덱으로 본다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node app/test/offline-app.cjs */
const { launch } = require('../../scripts/lib/pw.cjs');
const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
const T = makeTestDeck('offline-app', 'guide'); // 커밋된 안내 덱의 사본(작업트리의 덱이 바뀌거나 없어도 같다)
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
let fail = 0;
const check = (name, ok, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const foreign = [], deckOwn = [], errors = [];
  const own = new URL(BASE).host;
  await ctx.route((u) => !/^(data|blob|about):/.test(u.href) && new URL(u.href).host !== own, (r) => {
    // 덱 안의 요청(목록 썸네일 iframe 등)은 그 덱이 정한 것이다. 앱 화면 자신과 이 사본 덱의 요청만 실패로 센다.
    const f = r.request().frame(), fu = f ? f.url() : '', m = fu.match(/\/decks\/([^/?#]+)/);
    const line = r.request().url().slice(0, 100);
    if (m && m[1] !== T.folder) deckOwn.push(m[1] + ': ' + line); else foreign.push(line);
    r.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const routes = [
    ['덱 목록', '/', () => page.getByRole('button', { name: 'New deck' }).waitFor()],
    ['발표자 화면', `/present/${T.id}`, () => page.getByRole('button', { name: 'Present' }).waitFor()],
    ['편집기', `/edit/${T.id}`, () => page.locator('iframe').first().waitFor()],
    ['리모컨', `/remote/${T.id}`, () => page.locator('body').waitFor()],
  ];
  for (const [name, url, ready] of routes) {
    const before = foreign.length;
    await page.goto(BASE + url, { waitUntil: 'load' });
    await ready();
    await page.waitForLoadState('networkidle').catch(() => {});
    check(`${name}: 외부 호스트 요청 0건`, foreign.length === before, foreign.slice(before));
  }
  if (deckOwn.length) console.log('INFO 다른 덱의 외부 요청(그 덱이 정한 것, 번들하면 내장됨): ' + [...new Set(deckOwn.map((x) => x.split(':')[0]))].join(', '));
  check('페이지 오류 0', errors.length === 0, errors);
  await ctx.close(); await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
