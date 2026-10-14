/* 덱 목록 브라우저 검증: Cmd/Ctrl+K, 새 덱 오류 표시, 목록 요청 실패와 재시도, 보기 전환 기억.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node list.cjs */
const { launch, clock, tick } = require('../../scripts/lib/pw.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3200';
const fs = require('fs'), path = require('path');
const DECKS = path.join(__dirname, '..', '..', 'decks');
const cleanup = () => { for (const d of fs.readdirSync(DECKS)) if (d.startsWith('zz-e2e')) fs.rmSync(path.join(DECKS, d), { recursive: true, force: true }); const tr = path.join(DECKS, '.trash'); if (fs.existsSync(tr)) { for (const d of fs.readdirSync(tr)) if (d.startsWith('zz-e2e')) fs.rmSync(path.join(tr, d), { recursive: true, force: true }); try { fs.rmdirSync(tr); } catch {} } }; // 비면 .trash도 지운다
process.on('exit', cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
let __last = Date.now(); // TIMING=1이면 직전 검사 이후 1.5초 넘게 걸린 구간을 보여 준다(느린 단계 찾기)
const check = (name, ok, extra) => { if (process.env.TIMING) { const n = Date.now(); if (n - __last > 1500) console.log('SLOW +' + (n - __last) + 'ms before: ' + name); __last = n; } if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(100); } return false; };

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  if (process.env.TIMING) page.on('load', () => console.log('LOAD ' + page.url().slice(-30) + ' @' + Date.now() % 100000));
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New deck' }).waitFor();
  for (const combo of ['Control+k', 'Meta+k']) {
    await sleep(400); // 앞 팔레트의 닫힘 애니메이션이 끝난 뒤 다음 단축키를 누른다
    await page.keyboard.press(combo);
    check(`${combo}로 검색이 열린다`, await until(async () => (await page.getByRole('dialog').count()) === 1));
    await page.keyboard.press('Escape');
    check(`Esc로 닫힌다 (${combo})`, await until(async () => (await page.getByRole('dialog').count()) === 0));
  }
  await page.getByRole('button', { name: 'New deck' }).click();
  const nd = page.getByRole('dialog');
  await nd.getByLabel('Title').fill('vibe-coding-workshop');
  check('제목에서 폴더 이름을 제안한다', (await nd.getByLabel('Folder').inputValue()) === 'vibe-coding-workshop');
  check('중복 폴더 이름은 입력하는 동안 오류', await until(async () => (await page.getByText(/A deck named vibe-coding-workshop already exists/).count()) === 1));
  check('오류가 있으면 Create 비활성', await nd.getByRole('button', { name: 'Create' }).isDisabled());
  await nd.getByLabel('Folder').fill('Bad Name');
  check('잘못된 이름 오류 표시', await until(async () => (await page.getByText(/Use lowercase letters/).count()) >= 1));
  await nd.getByLabel('Title').fill('한글만 제목');
  check('직접 고친 폴더 이름은 제목을 따라가지 않는다', (await nd.getByLabel('Folder').inputValue()) === 'Bad Name');
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
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  check('목록 요청 실패 표시', await until(async () => (await p2.getByRole('alert').innerText()).includes('Could not load decks')));
  fails = false;
  await p2.getByRole('button', { name: 'Retry' }).click();
  check('재시도하면 오류가 사라진다', await until(async () => (await p2.getByRole('alert').count()) === 0));
  // 덱 관리: 복제, 이름 변경, 우클릭 메뉴, 휴지통. 테스트가 만든 덱(zz-e2e*)은 끝에 지운다.
  cleanup();
  const post = (u, data) => ctx.request.post(BASE + u, { data });
  check('API로 덱 생성', (await post('/api/decks', { name: 'zz-e2e-a', title: 'zz-e2e-a' })).status() === 201);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
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
  await page.route('**/api/decks/zz-e2e-a/published', (r) => r.fulfill({ json: { published: true, url: 'https://example.pages.dev/zz-e2e-a', name: 'zz-e2e-a' } }));
  await item('Rename').click();
  const rd = page.getByRole('dialog');
  check('게시된 덱은 이름 바꾸기에 주소 안내가 뜬다', await until(async () => (await rd.getByText(/published at https:\/\/example\.pages\.dev\/zz-e2e-a\. Renaming does not change that address/).count()) === 1));
  await page.unroute('**/api/decks/zz-e2e-a/published');
  check('Rename은 제목 필드가 먼저', (await rd.getByLabel('Title').inputValue()) === 'zz-e2e-a');
  await rd.getByRole('button', { name: 'Edit folder name' }).click();
  await rd.getByLabel('Folder').fill('zz-e2e-a-copy');
  check('중복 폴더 이름은 입력 중 오류와 버튼 비활성', await until(async () => (await rd.getByText(/already exists/).count()) >= 1) && (await rd.getByRole('button', { name: 'Rename' }).isDisabled()));
  await rd.getByLabel('Folder').fill('Bad Name');
  check('잘못된 폴더 이름 오류', await until(async () => (await rd.getByText(/Use lowercase letters/).count()) >= 1));
  await rd.getByLabel('Folder').fill('zz-e2e-b');
  await rd.getByLabel('Title').fill('Renamed Title');
  await rd.getByRole('button', { name: 'Rename' }).click();
  check('폴더 이름 변경', await until(async () => { const l = await ids(); return l.includes('zz-e2e-b') && !l.includes('zz-e2e-a'); }), await ids());
  check('제목 변경이 목록에 보인다', await until(async () => (await page.getByRole('button', { name: 'Renamed Title', exact: true }).count()) === 1));
  check('제목이 파일의 title과 메타에 들어간다', fs.readFileSync(path.join(DECKS, 'zz-e2e-b', 'index.html'), 'utf8').includes('<title>Renamed Title</title>') && fs.readFileSync(path.join(DECKS, 'zz-e2e-b', 'index.html'), 'utf8').includes('"title":"Renamed Title"'));
  check('이름 변경 시 메타 id 갱신', fs.readFileSync(path.join(DECKS, 'zz-e2e-b', 'index.html'), 'utf8').includes('"id":"zz-e2e-b"'));
  await page.getByRole('button', { name: 'Renamed Title', exact: true }).click({ button: 'right' });
  check('우클릭으로 메뉴가 열린다', await until(async () => (await item('Move to trash').count()) === 1));
  await item('Move to trash').click();
  check('확인 없이 바로 휴지통으로 이동', await until(async () => !(await ids()).includes('zz-e2e-b')));
  check('Undo 토스트가 뜬다', await until(async () => (await page.getByText('Moved Renamed Title to Trash').count()) === 1));
  await page.getByRole('button', { name: 'Undo' }).click();
  check('Undo로 되돌린다', await until(async () => (await ids()).includes('zz-e2e-b')), await ids());
  await page.getByRole('button', { name: 'Renamed Title', exact: true }).click({ button: 'right' });
  await item('Move to trash').click();
  check('다시 휴지통으로 이동', await until(async () => !(await ids()).includes('zz-e2e-b')));
  check('폴더는 decks/.trash에 보존', fs.readdirSync(path.join(DECKS, '.trash')).some((d) => d.startsWith('zz-e2e-b-')));
  check('.trash는 목록에 없다', !(await ids()).some((i) => String(i).includes('trash')));
  check('.trash 폴더는 정적 서빙 안 함', (await ctx.request.get(BASE + '/decks/.trash/x/index.html')).status() === 404);
  check('없는 덱 삭제는 404', (await ctx.request.post(BASE + '/api/decks/nope-nope/trash', { data: {} })).status() === 404);
  check('경로 이탈 이름 거부', (await ctx.request.post(BASE + '/api/decks/..%2Fapp/rename', { data: { name: 'zz-e2e-x' } })).status() === 404);
  // 휴지통 보기: 복구(이름 충돌은 -restored), 영구 삭제는 이름 입력 필요
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Renamed Title' }).waitFor();
  check('휴지통 목록에 삭제한 덱', (await page.getByRole('button', { name: 'Restore Renamed Title' }).count()) === 1);
  await post('/api/decks', { name: 'zz-e2e-b', title: 'zz-e2e-b' }); // 원래 이름을 비워 두지 않으면 -restored가 된다
  await page.getByRole('button', { name: 'Restore Renamed Title' }).click();
  check('이름 충돌 복구는 -restored', await until(async () => (await ids()).includes('zz-e2e-b-restored')), await ids());
  check('복구본 메타 id 갱신', fs.readFileSync(path.join(DECKS, 'zz-e2e-b-restored', 'index.html'), 'utf8').includes('"id":"zz-e2e-b-restored"'));
  await ctx.request.post(BASE + '/api/decks/zz-e2e-b/trash', { data: {} });
  await page.reload();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Delete zz-e2e-b forever' }).click();
  const forever = page.getByRole('dialog').getByRole('button', { name: 'Delete forever' });
  check('이름을 입력하기 전에는 영구 삭제 비활성', await forever.isDisabled());
  await page.getByRole('dialog').getByLabel('Deck name').fill('zz-e2e-b');
  check('이름을 입력하면 활성', await until(async () => !(await forever.isDisabled())));
  await forever.click();
  const trashed = () => fs.existsSync(path.join(DECKS, '.trash')) ? fs.readdirSync(path.join(DECKS, '.trash')).filter((d) => d.startsWith('zz-e2e-b-2')) : [];
  check('영구 삭제', await until(async () => trashed().length === 0), trashed());
  check('휴지통 API 목록', Array.isArray(await (await ctx.request.get(BASE + '/api/trash')).json()));
  await post('/api/decks', { name: 'zz-e2e-p2', title: 'zz-e2e-p2' });
  await ctx.request.post(BASE + '/api/decks/zz-e2e-p2/trash', { data: {} });
  const e2 = (await (await ctx.request.get(BASE + '/api/trash')).json()).find((i) => i.folder === 'zz-e2e-p2');
  check('이름 없이 purge 거부', (await post(`/api/trash/${e2.entry}/purge`, {})).status() === 400);
  check('다른 이름으로 purge 거부', (await post(`/api/trash/${e2.entry}/purge`, { confirm: 'x' })).status() === 400);
  check('경로 이탈 entry 거부', (await post('/api/trash/..%2F..%2Fapp/purge', { confirm: 'app' })).status() === 404);
  check('없는 entry 복구는 404', (await post('/api/trash/nope-2026-01-01T00-00-00-000Z/restore', {})).status() === 404);
  check('이름과 일치하면 purge', (await post(`/api/trash/${e2.entry}/purge`, { confirm: 'zz-e2e-p2' })).status() === 200);
  cleanup();

  // 새 덱: 제목에서 폴더 이름 제안, 만들면 바로 편집기로
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New deck' }).click();
  await page.getByRole('dialog').getByLabel('Title').fill('zz e2e T');
  check('제목에서 zz-e2e-t 제안', (await page.getByRole('dialog').getByLabel('Folder').inputValue()) === 'zz-e2e-t');
  check('템플릿 기본은 Talk', (await page.getByRole('dialog').getByRole('button', { name: 'Talk' }).getAttribute('aria-pressed')) === 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Blank' }).click();
  check('Blank를 고르면 힌트가 바뀐다', (await page.getByRole('dialog').getByText('A cover and one slide').count()) === 1);
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  check('만든 뒤 바로 편집기로', await until(async () => new URL(page.url()).pathname === '/edit/zz-e2e-t'), page.url());
  check('Blank 템플릿은 슬라이드 2장', (fs.readFileSync(path.join(DECKS, 'zz-e2e-t', 'index.html'), 'utf8').match(/<section[^>]*data-slide=/g) || []).length === 2);
  check('알 수 없는 템플릿은 400', (await page.evaluate(() => fetch('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'zz-e2e-tpl', template: 'nope' }) }).then((r) => r.status))) === 400);
  check('제목이 덱에 들어간다', fs.readFileSync(path.join(DECKS, 'zz-e2e-t', 'index.html'), 'utf8').includes('<title>zz e2e T</title>') && fs.readFileSync(path.join(DECKS, 'zz-e2e-t', 'index.html'), 'utf8').includes('"title":"zz e2e T"'));
  // 전체 검색: 슬라이드 본문에서 찾아 그 슬라이드의 편집기로 간다
  check('색인 API', Array.isArray(await (await ctx.request.get(BASE + '/api/search-index')).json()));
  await post('/api/decks', { name: 'zz-e2e-s', title: 'Zebra Quartz' });
  check('색인에 HTML 주석 글자가 섞이지 않는다', !(await (await ctx.request.get(BASE + '/api/search-index')).json()).some((d) => d.slides.some((sl) => /<!--|-->/.test(sl.text + sl.notes + sl.title))));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Search/ }).click();
  await page.getByRole('dialog').getByRole('combobox').fill('zebra quartz');
  check('일치한 글자를 굵게 보인다', await until(async () => (await page.getByRole('dialog').locator('mark').count()) >= 1 && (await page.getByRole('dialog').locator('mark').first().innerText()).toLowerCase() === 'zebra'));
  check('슬라이드 그룹이 나온다', await until(async () => (await page.getByRole('dialog').getByText('Slides', { exact: true }).count()) >= 1));
  const hit = page.getByRole('dialog').getByRole('option').filter({ hasText: 'slide 1' }).first();
  check('결과에 덱 제목과 슬라이드 번호', (await hit.count()) === 1 && (await hit.innerText()).includes('Zebra Quartz'));
  await hit.click();
  check('결과를 고르면 그 슬라이드로', await until(async () => { const u = new URL(page.url()); return u.pathname === '/edit/zz-e2e-s' && u.search === '?slide=1'; }), page.url());
  // 키보드 이동, 빠른 발표 버튼, 메타 위계, Public 칩 숨김, 없는 덱 화면
  await post('/api/decks', { name: 'zz-e2e-k1', title: 'zz-e2e-k1' });
  await post('/api/decks', { name: 'zz-e2e-k2', title: 'zz-e2e-k2' });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  // 앞 단계가 목록 보기로 남겼을 수 있으니 화면의 토글로 그리드를 확실히 맞춘다(저장소 값을 직접 쓰면 마운트 효과와 경합한다)
  await page.getByRole('button', { name: 'Toggle view' }).waitFor();
  await sleep(500);
  if ((await page.evaluate(() => localStorage.getItem('slidekit:list-view'))) !== 'grid') await page.getByRole('button', { name: 'Toggle view' }).click();
  await page.getByRole('button', { name: 'zz-e2e-k1', exact: true }).waitFor();
  await sleep(1000); // 썸네일 iframe이 붙는 동안 포커스가 흔들리지 않게 잠깐 둔다
  const activeLabel = () => page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'));
  await page.getByRole('button', { name: 'zz-e2e-k1', exact: true }).focus();
  const first = await activeLabel();
  await page.keyboard.press('ArrowRight'); await until(async () => (await activeLabel()) !== first);
  const second = await activeLabel();
  check('화살표로 다음 카드에 포커스가 간다', !!second && second !== first && !/^(Actions|Present) /.test(second), [first, second, await page.evaluate(() => [localStorage.getItem('slidekit:list-view'), document.querySelectorAll('[data-deck]').length, [...document.querySelectorAll('[data-deck]')].map((r) => r.getBoundingClientRect().x | 0).join(',')])]);
  await page.keyboard.press('ArrowLeft'); await until(async () => (await activeLabel()) === first);
  check('왼쪽 화살표로 되돌아간다', (await activeLabel()) === first, await activeLabel());
  check('Public 칩은 보이지 않는다', (await page.getByText('Public', { exact: true }).count()) === 0);
  check('메타는 슬라이드 수와 수정 시각으로 나뉜다', (await page.getByText(/^\d+ slides$/).count()) >= 1 && (await page.getByText(/^Edited /).count()) >= 1);
  await page.getByRole('button', { name: 'zz-e2e-k1', exact: true }).focus();
  await page.keyboard.press('Control+Enter');
  check('Ctrl+Enter로 발표자 화면', await until(async () => new URL(page.url()).pathname === '/present/zz-e2e-k1'), page.url());
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Present zz-e2e-k2' }).waitFor();
  await page.getByRole('button', { name: 'Present zz-e2e-k2' }).click({ force: true });
  check('카드의 Present 버튼', await until(async () => new URL(page.url()).pathname === '/present/zz-e2e-k2'), page.url());
  // 보안: 제목의 </script>는 deck-meta를 빠져나가지 않고, 덱 안의 링크로 저장소 밖 파일을 읽을 수 없다
  const evil = '</script><script>window.__pwned=1</script>';
  check('위험한 제목으로 덱 생성', (await post('/api/decks', { name: 'zz-e2e-xss', title: evil })).status() === 201);
  const xssHtml = fs.readFileSync(path.join(DECKS, 'zz-e2e-xss', 'index.html'), 'utf8');
  check('파일에 스크립트 탈출이 없다', !xssHtml.includes('</script><script>window.__pwned'), xssHtml.slice(0, 400));
  check('목록 API는 같은 제목을 돌려준다', (await (await ctx.request.get(BASE + '/api/decks')).json()).some((d) => d.folder === 'zz-e2e-xss' && d.title === evil));
  const linkDir = path.join(DECKS, 'zz-e2e-ln'); fs.mkdirSync(linkDir, { recursive: true });
  fs.writeFileSync(path.join(linkDir, 'ok.txt'), 'ok'); try { fs.symlinkSync('/etc/hosts', path.join(linkDir, 'leak.txt')); } catch {}
  check('저장소 안 파일은 서빙한다', (await ctx.request.get(BASE + '/decks/zz-e2e-ln/ok.txt')).status() === 200);
  check('저장소 밖을 가리키는 링크는 404', (await ctx.request.get(BASE + '/decks/zz-e2e-ln/leak.txt')).status() === 404);
  check('링크는 덱으로 취급하지 않는다(복제 404)', (await post('/api/decks/zz-e2e-ln/duplicate', {})).status() === 404);
  // 컨텍스트 메뉴: 포인터 위치 앵커, 항목과 키캡과 빨강, Esc와 포커스 복귀, 키보드로 열기, 교체, 닫힘 조건, 가장자리 뒤집기
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'zz-e2e-k1', exact: true }).waitFor();
  await sleep(600);
  const cardBtn = (t) => page.getByRole('button', { name: t, exact: true });
  const menuBox = () => page.getByRole('menu').first().boundingBox();
  const kb = await cardBtn('zz-e2e-k1').boundingBox();
  const px = kb.x + 40, py = kb.y + 40;
  await cardBtn('zz-e2e-k1').click({ button: 'right', position: { x: 40, y: 40 } });
  await page.getByRole('menu').waitFor();
  const mb = await menuBox();
  check('메뉴가 포인터 오른쪽 아래에서 시작한다', mb && mb.x >= px - 1 && mb.x <= px + 12 && mb.y >= py - 1 && mb.y <= py + 12, [mb, px, py]);
  check('항목 순서', JSON.stringify(await page.getByRole('menuitem').allInnerTexts().then((a) => a.map((t) => t.split('\n')[0].trim()))) === JSON.stringify(['Open', 'Present', 'Pin to top', 'Rename', 'Duplicate', 'Settings', 'Move to trash']), await page.getByRole('menuitem').allInnerTexts());
  check('단축키 키캡(Open과 Present)', (await page.getByRole('menuitem', { name: 'Open' }).getAttribute('data-shortcut')) === '↵' && /↵$/.test((await page.getByRole('menuitem', { name: 'Present' }).getAttribute('data-shortcut')) || ''));
  const col = await page.getByRole('menuitem', { name: 'Move to trash' }).evaluate((e) => [...e.querySelectorAll('span')].map((x) => getComputedStyle(x).color));
  check('파괴적 항목은 빨강(--destructive)', col.length > 0 && col.every((c) => c === 'rgb(248, 113, 113)'), col);
  check('구분선이 있다', (await page.getByRole('separator').count()) >= 2);
  await page.keyboard.press('Escape');
  check('Esc로 닫힌다', await until(async () => (await page.getByRole('menu').count()) === 0));
  check('닫힌 뒤 포커스가 카드로 돌아간다', await until(async () => (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) === 'zz-e2e-k1'), await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 100)));
  // 핀과 필터 칩: 메뉴의 Pin to top으로 맨 앞에 고정되고(정렬과 무관), 칩으로 줄이며, 새로고침해도 남는다
  await cardBtn('zz-e2e-k2').click({ button: 'right', position: { x: 40, y: 40 } });
  await page.getByRole('menuitem', { name: 'Pin to top' }).click();
  const firstDeck = () => page.evaluate(() => document.querySelector('[data-deck] button')?.getAttribute('aria-label'));
  check('Pin to top으로 맨 앞에 고정된다', await until(async () => (await firstDeck()) === 'zz-e2e-k2'), await firstDeck());
  check('고정된 덱에 Pinned 표시', (await page.getByRole('img', { name: 'Pinned' }).count()) === 1);
  await page.getByRole('button', { name: 'Pinned', exact: true }).click();
  check('Pinned 칩은 고정한 덱만 보인다', await until(async () => (await page.locator('[data-deck]').count()) === 1));
  await page.getByRole('button', { name: 'Password', exact: true }).click();
  check('결과가 없으면 안내', await until(async () => (await page.getByText('No password decks.').count()) === 1));
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  check('새로고침해도 고정이 남는다', await until(async () => (await firstDeck()) === 'zz-e2e-k2'), await firstDeck());
  await cardBtn('zz-e2e-k2').click({ button: 'right', position: { x: 40, y: 40 } });
  await page.getByRole('menuitem', { name: 'Unpin from top' }).click();
  check('Unpin으로 해제된다', await until(async () => (await page.getByRole('img', { name: 'Pinned' }).count()) === 0));
  // 덱 설정: 메뉴의 Settings에서 바꾸는 즉시 파일의 deck-meta에 저장된다(비밀번호는 저장하지 않는다)
  const metaOf = () => { const h = fs.readFileSync(path.join(DECKS, 'zz-e2e-k1', 'index.html'), 'utf8'); return JSON.parse(h.match(/<script[^>]*id="deck-meta"[^>]*>([\s\S]*?)<\/script>/)[1]); };
  await cardBtn('zz-e2e-k1').click({ button: 'right', position: { x: 40, y: 40 } });
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const sd = page.getByRole('dialog', { name: 'Deck settings' });
  await sd.getByLabel('Author').waitFor();
  await sd.getByLabel('Author').fill('Settings E2E');
  check('Author가 파일에 저장된다', await until(async () => metaOf().author === 'Settings E2E'), metaOf());
  await sd.getByLabel('Date').fill('2026-10-14');
  check('Date가 저장된다', await until(async () => metaOf().date === '2026-10-14'), metaOf());
  await sd.getByLabel('Title (browser tab and deck list)').fill('Settings Title');
  check('Title은 meta와 <title>에 저장되고 표지 h1은 그대로', await until(async () => { const h = fs.readFileSync(path.join(DECKS, 'zz-e2e-k1', 'index.html'), 'utf8'); return metaOf().title === 'Settings Title' && h.includes('<title>Settings Title</title>') && !h.includes('<h1>Settings Title</h1>'); }));
  await sd.getByRole('switch', { name: 'Page numbers' }).click();
  check('Page numbers가 저장된다', await until(async () => metaOf().pageNumber === true), metaOf());
  await sd.getByRole('combobox', { name: 'Visibility' }).click();
  await page.getByRole('option', { name: 'Password' }).click();
  check('Visibility를 Password로 바꾸면 저장되고 안내가 보인다', await until(async () => metaOf().visibility === 'password' && (await sd.getByText(/never saved in the deck/).count()) === 1), metaOf());
  check('비밀번호 키는 파일에 없다', !Object.keys(metaOf()).some((k) => /pass|secret|token/i.test(k)) || Object.keys(metaOf()).every((k) => !/pass|secret|token/i.test(k)));
  // 달력에 없는 날짜는 네이티브 날짜 입력이 받지 않으므로 검증은 단위 테스트(deck-meta.test.ts)가 맡는다
  await sd.getByLabel('Date').fill('2026-10-15');
  check('고친 날짜는 저장된다', await until(async () => metaOf().date === '2026-10-15'));
  const stale = await page.evaluate(() => fetch('/api/decks/zz-e2e-k1/meta', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patch: { author: 'x' }, base: 1 }) }).then((r) => r.status));
  check('오래된 base의 PATCH는 409', stale === 409, stale);
  await sd.getByLabel('Title (browser tab and deck list)').fill('zz-e2e-k1'); // 뒤 검사가 이 이름으로 카드를 찾는다
  await page.keyboard.press('Escape'); // 마지막 입력이 디바운스 중이어도 닫을 때 보낸다
  check('닫을 때 보류 입력도 저장되고 목록이 따라온다', await until(async () => metaOf().title === 'zz-e2e-k1' && (await cardBtn('zz-e2e-k1').count()) === 1));
  // 이미지 업로드 API: 바이너리 본문이 guard를 지나 assets/에 저장되고 정적으로 서빙된다
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const upR = await ctx.request.post(BASE + '/api/decks/zz-e2e-k1/assets', { data: png, headers: { 'Content-Type': 'image/png', 'x-filename': 'e2e.png' } });
  const upJ = await upR.json().catch(() => ({}));
  check('이미지 업로드는 201과 assets 경로', upR.status() === 201 && /^assets\/e2e/.test(upJ.path || ''), [upR.status(), upJ]);
  const got = upJ.path ? await ctx.request.get(BASE + '/decks/zz-e2e-k1/' + upJ.path) : null;
  check('올린 이미지는 정적으로 열린다', !!got && got.status() === 200 && (got.headers()['content-type'] || '').startsWith('image/'), got && got.status());
  check('JSON이 아닌 다른 변경 경로는 여전히 거절', (await ctx.request.post(BASE + '/api/decks/zz-e2e-k1/rename', { data: png, headers: { 'Content-Type': 'image/png' } })).status() === 415);
  // 닫는 조건: 휠(줌 포함), 줌 키. 드래그 중(왼쪽 버튼을 누른 채)에는 열리지 않는다
  await cardBtn('zz-e2e-k1').click({ button: 'right', position: { x: 40, y: 40 } });
  await page.getByRole('menu').waitFor();
  await page.mouse.wheel(0, 120);
  check('휠을 돌리면 닫힌다', await until(async () => (await page.getByRole('menu').count()) === 0));
  await cardBtn('zz-e2e-k1').click({ button: 'right', position: { x: 40, y: 40 } });
  await page.getByRole('menu').waitFor();
  await page.keyboard.press('Control+='); // 줌 키
  check('줌 키(Ctrl +)를 누르면 닫힌다', await until(async () => (await page.getByRole('menu').count()) === 0));
  await page.evaluate(() => { const el = document.querySelector('[data-deck]'); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50, buttons: 1 })); });
  await sleep(300);
  check('왼쪽 버튼을 누른 채(드래그 중)에는 열리지 않는다', (await page.getByRole('menu').count()) === 0);
  // 키보드: ContextMenu 키와 Shift+F10, 화살표와 Enter
  await cardBtn('zz-e2e-k1').focus();
  await page.keyboard.press('Shift+F10');
  check('Shift+F10으로 메뉴가 열린다', await until(async () => (await page.getByRole('menu').count()) === 1));
  await page.keyboard.press('Escape'); await sleep(300);
  await cardBtn('zz-e2e-k1').focus();
  await page.keyboard.press('ContextMenu');
  check('ContextMenu 키로 메뉴가 열린다', await until(async () => (await page.getByRole('menu').count()) === 1));
  await page.getByRole('menuitem', { name: 'Open' }).waitFor(); await until(async () => (await activeLabel()) === 'Open'); // 메뉴가 첫 항목에 포커스를 줄 때까지
  await page.keyboard.press('ArrowDown'); await until(async () => (await activeLabel()) === 'Present');
  check('ArrowDown으로 다음 항목(Present)에 포커스가 간다', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) === 'Present', await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 90)));
  await page.keyboard.press('Enter');
  check('화살표와 Enter로 항목을 실행한다(Present)', await until(async () => new URL(page.url()).pathname === '/present/zz-e2e-k1'), page.url());
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await cardBtn('zz-e2e-k1').waitFor(); await sleep(600);
  // 다른 곳을 우클릭하면 교체, 창 크기가 바뀌면 닫힘
  await cardBtn('zz-e2e-k1').click({ button: 'right', position: { x: 30, y: 30 } });
  await page.getByRole('menu').waitFor();
  await cardBtn('zz-e2e-k2').click({ button: 'right', position: { x: 30, y: 30 }, force: true });
  await sleep(400);
  const k2 = await cardBtn('zz-e2e-k2').boundingBox();
  const swapped = await menuBox();
  check('다른 카드를 우클릭하면 메뉴가 하나로 교체된다', (await page.getByRole('menu').count()) === 1 && swapped.y >= k2.y + 29 && swapped.y <= k2.y + 45, [swapped, k2]); // 오른쪽 가장자리라 가로는 뒤집힐 수 있어 세로 위치로 본다
  await page.setViewportSize({ width: 1200, height: 800 });
  check('창 크기가 바뀌면 닫힌다', await until(async () => (await page.getByRole('menu').count()) === 0));
  await page.setViewportSize({ width: 1280, height: 800 });
  // 입력 칸은 네이티브 메뉴를 쓴다(우리 메뉴가 열리지 않는다)
  await page.getByRole('button', { name: 'New deck' }).click();
  await page.getByRole('dialog').getByLabel('Title').click({ button: 'right' });
  check('입력 칸 우클릭은 네이티브 메뉴(우리 메뉴 없음)', (await page.getByRole('menu').count()) === 0);
  await page.keyboard.press('Escape'); await sleep(300);
  // 가장자리: 카드가 화면 오른쪽 아래에 있어도 메뉴가 화면 안에서 뒤집힌다
  await page.setViewportSize({ width: 420, height: 380 });
  await sleep(500);
  const small = await cardBtn('zz-e2e-k1').boundingBox();
  await cardBtn('zz-e2e-k1').click({ button: 'right', position: { x: Math.min(small.width - 4, 300), y: Math.min(small.height - 4, 100) }, force: true });
  await page.getByRole('menu').waitFor();
  const edge = await menuBox();
  check('화면 가장자리에서는 메뉴가 화면 안으로 뒤집힌다', edge && edge.x >= 0 && edge.y >= 0 && edge.x + edge.width <= 420 + 1 && edge.y + edge.height <= 380 + 1, edge);
  check('우클릭을 뗄 때 포인터 아래 항목이 실행되지 않는다(덱이 그대로)', (await cardBtn('zz-e2e-k1').count()) === 1 && (await page.getByText('Moved zz-e2e-k1 to Trash').count()) === 0);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 });
  // 휴지통 행 메뉴
  await ctx.request.post(BASE + '/api/decks/zz-e2e-k2/trash', { data: {} });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('button', { name: 'Restore zz-e2e-k2' }).waitFor();
  await page.getByRole('button', { name: 'Restore zz-e2e-k2' }).click({ button: 'right' });
  check('휴지통 행 메뉴(Restore, Delete forever)', await until(async () => (await page.getByRole('menuitem', { name: 'Restore' }).count()) === 1 && (await page.getByRole('menuitem', { name: 'Delete forever' }).count()) === 1));
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  check('메뉴에서 복구한다', await until(async () => (await ids()).includes('zz-e2e-k2')), await ids());
  // 최근 연 덱: 가장 최근 하나에 Opened 표시, Recent 정렬은 최근 순
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'zz-e2e-k2', exact: true }).waitFor();
  check('가장 최근에 연 덱에 Opened 표시', (await page.getByText(/^Opened /).count()) === 1);
  const sortBtn = page.locator('button:not([aria-pressed])').filter({ hasText: /^(Date|Name|Recent)$/ }); // 칩(aria-pressed)과 구분
  for (let i = 0; i < 2; i++) await sortBtn.click();
  check('Recent 정렬 이름', (await sortBtn.innerText()) === 'Recent');
  const order = await page.evaluate(() => [...document.querySelectorAll('[data-deck]')].map((r) => r.querySelector('button')?.getAttribute('aria-label')));
  const recent0 = await page.evaluate(() => JSON.parse(localStorage.getItem('slidekit:recent') || '[]')[0]?.id);
  check('최근 연 덱이 맨 앞', order[0] === recent0, [order[0], recent0]);
  await page.evaluate(() => localStorage.setItem('slidekit:list-sort', 'date'));
  await page.goto(BASE + '/present/nope-nope', { waitUntil: 'domcontentloaded' });
  check('없는 덱은 안내와 돌아가기', await until(async () => (await page.getByText('Deck not found').count()) === 1));
  await page.getByRole('button', { name: 'Back to decks' }).click();
  check('Back to decks로 목록 복귀', await until(async () => new URL(page.url()).pathname === '/'));
  cleanup();

  // 연결 상태 표시와 렌더 오류 경계
  const ctx3 = await browser.newContext();
  let down = false;
  await ctx3.route('**/api/ping', (r) => (down ? r.abort() : r.continue()));
  const p3 = await ctx3.newPage();
  await clock(p3); // 연결 확인은 5초 간격이라 가짜 시계로 건너뛴다
  await p3.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p3.getByRole('button', { name: 'New deck' }).waitFor();
  down = true; await tick(p3, 5200);
  check('서버가 끊기면 표시', await until(async () => (await p3.getByRole('status').filter({ hasText: 'Server unreachable' }).count()) === 1, 12000));
  down = false; await tick(p3, 5200);
  check('다시 연결되면 Reconnected 표시', await until(async () => (await p3.getByText('Reconnected').count()) === 1, 15000));
  check('다시 연결되면 사라진다', await until(async () => (await p3.getByRole('status').filter({ hasText: 'Server unreachable' }).count()) === 0, 15000));
  const ctx4 = await browser.newContext();
  await ctx4.route('**/api/decks', (r) => r.request().method() === 'GET' ? r.fulfill({ json: {} }) : r.continue());
  const p4 = await ctx4.newPage();
  await p4.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  check('렌더 오류는 Reload 화면', await until(async () => (await p4.getByText('Something went wrong.').count()) === 1 && (await p4.getByRole('button', { name: 'Reload' }).count()) === 1));
  check('페이지 오류 없음', errors.length === 0, errors);
  await browser.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
