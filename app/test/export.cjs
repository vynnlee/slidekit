/* Export 메뉴 검증. 서버를 SLIDEKIT_DEPLOY_DRY_RUN=1로 띄워야 한다(실제 배포 금지).
   사용: SLIDEKIT_DEPLOY_DRY_RUN=1 PORT=3250 bun app/server.ts  /  PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3250 node app/test/export.cjs */
const { launch } = require('../../scripts/lib/pw.cjs'); // 러너의 공용 브라우저 서버에 연결한다(없으면 직접 띄운다)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const BASE = process.env.BASE || 'http://127.0.0.1:3250', ROOT = path.join(__dirname, '..', '..');
// 공용 브라우저 서버에 원격으로 연결하면 dl.path()를 쓸 수 없어 saveAs로 로컬 복사본을 받는다.
const saveDl = async (dl) => { const f = path.join(require('os').tmpdir(), `sk-exp-${process.pid}-${dl.suggestedFilename()}`); await dl.saveAs(f); return f; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const sh = (c) => cp.spawnSync('sh', ['-c', c], { cwd: ROOT, encoding: 'utf8' });
const mk = (name, vis) => { sh(`bun app/server.ts new ${name}`); const f = path.join(ROOT, 'decks', name, 'index.html'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"visibility": "public"', `"visibility": "${vis}"`)); };
const rm = (n) => { fs.rmSync(path.join(ROOT, 'decks', n), { recursive: true, force: true }); fs.rmSync(path.join(ROOT, 'dist', n + '.html'), { force: true }); fs.rmSync(path.join(ROOT, 'dist', n + '.pdf'), { force: true }); };
const PW = 'S3cret-pass-ZZ';
(async () => {
  mk('qa-exp-pub', 'public'); mk('qa-exp-pw', 'password');
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1000, height: 700 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  const api = (m, u, body) => p.evaluate(([m, u, body]) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ s: r.status, t: (await r.text()).slice(0, 600) })), [m, u, body]);
  await p.goto(BASE + '/dev/export?deck=qa-exp-pub'); await p.getByRole('button', { name: 'Export' }).waitFor();
  const menu = async (name) => { await p.getByRole('button', { name: 'Export' }).click(); await p.getByRole('menuitem', { name }).click(); };
  // 다운로드
  let [dl] = await Promise.all([p.waitForEvent('download'), menu('Download HTML')]);
  let f = await saveDl(dl); let txt = fs.readFileSync(f, 'utf8');
  check('Download HTML: 파일명과 단독 HTML', dl.suggestedFilename() === 'qa-exp-pub.html' && /^<!doctype html>/i.test(txt) && !/\.\.\/\.\.\/engine/.test(txt), dl.suggestedFilename());
  [dl] = await Promise.all([p.waitForEvent('download'), menu('Download PDF')]);
  f = await saveDl(dl); const pdf = fs.readFileSync(f);
  check('Download PDF: 실제 PDF, 5쪽', dl.suggestedFilename() === 'qa-exp-pub.pdf' && pdf.slice(0, 5).toString() === '%PDF-' && (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length === 5, pdf.length);
  // API 검증
  check('confirm 없이 deploy는 400', (await api('POST', '/api/decks/qa-exp-pub/deploy', {})).s === 400);
  check('나쁜 id는 404', (await api('POST', '/api/decks/..%2Fx/bundle', {})).s === 404);
  check('Origin이 다르면 403', cp.spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Origin: http://evil.example', '-d', '{"confirm":true}', BASE + '/api/decks/qa-exp-pub/deploy'], { encoding: 'utf8' }).stdout === '403');
  // 공개 덱 Publish (dry run)
  await menu('Publish to static.vynnlee.com...');
  const dlg = p.getByRole('dialog');
  check('Publish 다이얼로그: 주소, Public, 경고', (await dlg.textContent()).includes('https://static.vynnlee.com/qa-exp-pub') && (await dlg.textContent()).includes('Public') && /Anyone with the link/.test(await dlg.textContent()));
  await dlg.getByRole('button', { name: 'Publish', exact: true }).click();
  await p.getByRole('link').first().waitFor({ timeout: 60000 });
  check('성공: URL 링크와 Copy 버튼, dry run 로그', (await p.getByRole('link').first().getAttribute('href')) === 'https://static.vynnlee.com/qa-exp-pub' && (await p.getByRole('button', { name: 'Copy link' }).count()) === 1 && /DRY RUN/.test(await dlg.textContent()), await dlg.textContent());
  await dlg.getByRole('button', { name: 'Close', exact: true }).first().click();
  // 비밀번호 덱
  await p.goto(BASE + '/dev/export?deck=qa-exp-pw'); await p.getByRole('button', { name: 'Export' }).waitFor();
  await menu('Publish to static.vynnlee.com...');
  const d2 = p.getByRole('dialog'); await p.getByLabel('Deck password').waitFor();
  const pub = d2.getByRole('button', { name: 'Publish', exact: true });
  check('Password 덱: 입력 전 Publish 비활성', await pub.isDisabled());
  await p.getByLabel('Deck password').fill(PW); await p.getByLabel('Confirm password').fill(PW + 'x');
  check('비밀번호 불일치면 비활성과 안내', (await pub.isDisabled()) && /do not match/.test(await d2.textContent()));
  check('입력은 숨김(type=password)', (await p.getByLabel('Deck password').getAttribute('type')) === 'password');
  await p.getByLabel('Confirm password').fill(PW); await pub.click();
  await p.getByRole('link').first().waitFor({ timeout: 60000 });
  const all = await d2.textContent();
  check('비밀번호가 로그와 화면에 남지 않음', !all.includes(PW), all.slice(0, 200));
  const hits = sh('ps -axo command').stdout.split('\n').filter((l) => l.includes(PW) && !/ps -axo|grep|sh -c|node .*export\.cjs/.test(l));
  check('프로세스 명령줄에 비밀번호 없음', hits.length === 0, hits);
  check('서버 로그에 비밀번호 없음', !fs.readFileSync('/tmp/sk-eng-srv.log', 'utf8').includes(PW));
  // 같은 덱에 비밀번호 없이 API 호출
  check('password 덱에 password 없으면 400', (await api('POST', '/api/decks/qa-exp-pw/deploy', { confirm: true })).s === 400);
  check('페이지 오류 없음', errs.length === 0, errs);
  await b.close(); rm('qa-exp-pub'); rm('qa-exp-pw'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); rm('qa-exp-pub'); rm('qa-exp-pw'); process.exit(2); });
