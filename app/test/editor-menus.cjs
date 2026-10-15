/* 편집기 브라우저 검증: 줌과 크기 칩, 명령 팔레트와 단축키 안내(발견 가능성), 팬과 줌, 끌어서 이동과 스마트 가이드와 넛지와 커서 방패, 우클릭 메뉴(요소, 빈 곳, Layers 행, 필름스트립 타일).
   하네스(lib/editor-harness.cjs)가 작은 덱 사본을 만들고 편집기를 한 번 열어 준다. Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node editor-menus.cjs */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-menus' });
  const { fs, path, T, FILE, N0, sleep, check, page, settle, focusBody, fr, frameEl, cond, saveDone, unsaved, n, stageCount, layers, inDoc, nKids, rowsL, goSlide2 } = H;
  // 줌 컨트롤, 크기 칩, 명령 팔레트, 단축키 안내
  const pctBtn = page.getByRole('button', { name: 'Zoom to fit' });
  const pct0 = await pctBtn.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click(); await settle();
  check('줌 버튼이 비율을 바꾸고 맞춤으로 돌아옴', (await pctBtn.textContent()) !== pct0 && (await pctBtn.click(), await settle(), (await pctBtn.textContent()) === pct0), pct0);
  await focusBody(); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await settle();
  check('선택 요소 크기 칩(W × H)', (await page.getByText(/^\d+ × \d+$/).count()) === 1);
  await focusBody(); await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k'); await settle();
  await page.getByPlaceholder('Slides or actions').fill('Slide 3'); await settle();
  await page.keyboard.press('Enter'); await settle();
  check('Cmd+K 팔레트로 슬라이드 이동', (await layers.nth(2).getAttribute('aria-selected')) === 'true');
  await page.keyboard.press('Meta+/'); await settle();
  check('단축키 안내가 그룹으로 보임', (await page.getByText('Select', { exact: true }).count()) >= 1 && (await page.locator('kbd').count()) > 10);
  await page.keyboard.press('Escape'); await settle();

  // 발견 가능성: 최근 기능이 단축키 안내와 Cmd+K 팔레트에 모두 있다
  await page.keyboard.press('Meta+/'); await settle();
  await page.getByRole('dialog').getByText('Shortcuts', { exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
  const helpTxt = (await page.getByRole('dialog').innerText()).replace(/\s+/g, ' ');
  const inHelp = ['Group', 'Ungroup', 'Find and replace', 'Copy style', 'Paste style', 'Paste an image from the clipboard', 'Drop an image', 'Pick a layout', 'Context menu', 'Add to selection'];
  check('단축키 안내에 최근 기능이 모두 있음', inHelp.every((t) => helpTxt.includes(t)), inHelp.filter((t) => !helpTxt.includes(t)));
  await page.keyboard.press('Escape'); await settle();
  const inPalette = ['Group selection', 'Ungroup', 'Find and replace', 'Copy style', 'Paste style', 'Deck settings', 'Insert image', 'Add slide: Quote', 'Theme: Paper', 'Text style: Caption', 'Zoom to 100%', 'Show safe area', 'overflow outlines', 'Undo'];
  const missingP = [];
  await page.keyboard.press('Meta+k'); await settle(); // 팔레트를 한 번 열어 두고 검색어만 바꿔 가며 본다
  const palIn = page.getByPlaceholder('Slides or actions');
  // 처음 연 팔레트(빈 검색어)는 슬라이드 목록이 아니라 핵심 동작 다섯 개(Try)로 시작한다
  const tryRows = await page.getByRole('option').allTextContents();
  check('빈 팔레트는 Try 다섯 개로 시작', tryRows.slice(0, 5).map((t) => t.replace(/\s+/g, ' ')).every((t, i) => [/Present from this slide/, /Add slide after/, /Find and replace/, /Add comment/, /Keyboard shortcuts/][i].test(t)) && (await page.getByText('Try', { exact: true }).count()) >= 1, tryRows.slice(0, 6));
  for (const q of inPalette) {
    await palIn.fill(q);
    await cond(() => true, null, 50); // 목록 갱신 한 프레임
    await page.waitForFunction(() => document.querySelectorAll('[role=option]').length >= 0);
    if (!(await page.getByRole('option').first().waitFor({ timeout: 3000 }).then(() => true).catch(() => false))) missingP.push(q); // 목록이 갱신되어 항목이 나타나기를 기다린다
  }
  await page.keyboard.press('Escape'); await settle();
  check('Cmd+K 팔레트에 최근 기능이 모두 있음', missingP.length === 0, missingP);
  // 글자 편집 중에는 Cmd+G가 요소를 감싸지 않는다
  await fr().locator('[data-active] h1, [data-active] h2, [data-active] p').first().click({ modifiers: ['Meta'] }); await settle(); await fr().locator('[data-active] h1, [data-active] h2, [data-active] p').first().dblclick(); await settle();
  const kidsE = await inDoc((s) => s.querySelectorAll('[data-name=Group]').length);
  await page.keyboard.press('Meta+g'); await settle();
  check('글자 편집 중 Cmd+G는 그룹을 만들지 않음', (await inDoc((s) => s.querySelectorAll('[data-name=Group]').length)) === kidsE);
  await page.keyboard.press('Escape'); await settle(); await page.keyboard.press('Escape'); await settle();

  // Space 드래그 팬과 커서 기준 줌
  await page.getByRole('button', { name: 'Zoom in' }).click(); await page.getByRole('button', { name: 'Zoom in' }).click(); await page.getByRole('button', { name: 'Zoom in' }).click(); await settle();
  const scroller = () => page.evaluate(() => { const b = document.querySelector('iframe[title="Canvas"]').closest('div.overflow-auto'); return [b.scrollLeft, b.scrollTop, b.scrollWidth > b.clientWidth]; });
  const s0 = await scroller();
  const fbx = await page.locator('iframe[title="Canvas"]').boundingBox();
  await focusBody(); await page.keyboard.down('Space'); await settle();
  check('Space를 누르면 팬 덮개가 나타남', (await page.getByTestId('pan-overlay').count()) === 1);
  check('Space 팬 덮개 커서는 grab', (await page.getByTestId('pan-overlay').evaluate((e) => getComputedStyle(e).cursor)) === 'grab');
  await page.mouse.move(fbx.x + 300, fbx.y + 200); await page.mouse.down(); await page.mouse.move(fbx.x + 150, fbx.y + 120, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space'); await settle();
  const s1 = await scroller();
  check('Space+드래그로 스크롤이 이동', s1[2] && (s1[0] > s0[0] || s1[1] > s0[1]), [s0, s1]);
  check('Space를 떼면 덮개가 사라짐', (await page.getByTestId('pan-overlay').count()) === 0);
  await page.getByRole('button', { name: 'Zoom to fit' }).click(); await settle();
  // 끌어서 이동(translate), 스마트 가이드, 방향키 넛지, 실행 취소 1건
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const hb2 = await fr().locator('[data-active] h2').first().boundingBox();
  const cx = hb2.x + hb2.width / 2, cy = hb2.y + hb2.height / 2;
  const tr = () => inDoc((s) => s.querySelector('h2').style.translate || '');
  await page.mouse.click(cx, cy); await settle();
  await page.mouse.move(cx + 1, cy); await settle();
  const cursorOfH2 = () => fr().evaluate(() => getComputedStyle(document.querySelector('[data-active] h2')).cursor);
  check('선택된 요소 위에서는 move 커서', (await cursorOfH2()) === 'move', await cursorOfH2());
  const cardBox = await fr().locator('[data-active] > :nth-child(2)').first().boundingBox();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height - 8); await settle();
  check('선택되지 않은 요소 위에서는 default 커서', (await fr().evaluate(() => getComputedStyle(document.querySelector('[data-active] > :nth-child(2)')).cursor)) === 'default');
  await page.mouse.move(cx, cy); await settle();
  check('끌기 전에는 커서 방패가 없음', (await page.getByTestId('cursor-shield').count()) === 0);
  await page.mouse.down(); await page.mouse.move(cx, cy + 40, { steps: 8 }); await settle();
  check('끄는 동안 방패가 있고 커서는 move', (await page.getByTestId('cursor-shield').count()) === 1 && (await page.getByTestId('cursor-shield').evaluate((e) => getComputedStyle(e).cursor)) === 'move');
  check('끄는 동안 가이드선이 보임(왼쪽 가장자리 정렬 유지)', (await page.getByTestId('guide-line').count()) >= 1);
  await page.mouse.up(); await settle();
  check('끌기가 끝나면 방패가 사라짐', (await page.getByTestId('cursor-shield').count()) === 0);
  const t1 = await tr();
  check('끌면 인라인 translate가 생김', /px\s+-?\d/.test(t1), t1);
  check('끌고 난 뒤 가이드선이 사라짐', (await page.getByTestId('guide-line').count()) === 0);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('끌기는 실행 취소 한 번에 되돌아감', (await tr()) === '', await tr());
  // 방패가 남는 경로 점검: Esc로 끌기를 취소해도, 창 밖에서 놓아도 사라진다
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy + 10, { steps: 4 }); await settle();
  const shieldDuring = await page.getByTestId('cursor-shield').count();
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle();
  check('Esc로 취소한 끌기 뒤에도 방패가 남지 않음', shieldDuring === 1 && (await page.getByTestId('cursor-shield').count()) === 0, [shieldDuring, await page.getByTestId('cursor-shield').count()]);
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy + 10, { steps: 4 }); await page.mouse.move(2, 2, { steps: 3 }); await page.mouse.up(); await settle();
  check('끄는 중 문서 가장자리 밖에서 놓아도 방패가 남지 않음', (await page.getByTestId('cursor-shield').count()) === 0);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await settle();
  await focusBody(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown'); await settle();
  const t2 = await tr();
  check('방향키 1px와 Shift+방향키 10px 넛지', /^1px 10px$/.test(t2), t2);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle(); await page.keyboard.press('Escape');

  // 컨텍스트 메뉴: 우클릭은 먼저 선택하고, 맥락에 맞는 항목을 보인다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const menuLabels = async () => { await page.getByRole('menuitem').first().waitFor({ timeout: 5000 }).catch(() => {}); return page.getByRole('menuitem').allTextContents(); }; // 메뉴가 그려지기를 기다린 뒤 읽는다
  const h2b = await fr().locator('[data-active] h2').first().boundingBox();
  await page.mouse.click(h2b.x + 20, h2b.y + h2b.height / 2, { button: 'right' }); await settle();
  check('요소 우클릭이 먼저 선택함', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  const ml = (await menuLabels()).join('|');
  check('요소 메뉴 항목(글자 요소)', /Edit text/.test(ml) && /Add comment/.test(ml) && /Select/.test(ml) && /Duplicate/.test(ml) && /Delete/.test(ml) && /Style/.test(ml), ml);
  const dupBefore = await nKids();
  await page.getByRole('menuitem', { name: /^Duplicate/ }).click(); await settle();
  check('메뉴의 Duplicate가 동작', (await nKids()) === dupBefore + 1, [dupBefore, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await page.keyboard.press('Escape');
  // 빈 곳 우클릭: 선택이 풀리고 슬라이드 메뉴
  const sb2 = await fr().locator('[data-active]').first().boundingBox();
  await page.mouse.click(sb2.x + sb2.width - 6, sb2.y + sb2.height - 6, { button: 'right' }); await settle();
  const bl = (await menuLabels()).join('|');
  check('빈 곳 메뉴: 슬라이드 항목과 줌', /Add comment/.test(bl) && /Zoom to fit/.test(bl) && /Zoom to 100%/.test(bl) && /Add slide after/.test(bl) && /Delete slide/.test(bl), bl);
  await page.getByRole('menuitem', { name: /^Zoom to 100%/ }).click(); await settle();
  check('Zoom to 100% 메뉴가 100%를 만듦', /^100%$/.test((await page.getByRole('button', { name: 'Zoom to fit' }).textContent()).trim()), await page.getByRole('button', { name: 'Zoom to fit' }).textContent());
  await focusBody(); await page.keyboard.press('Shift+1'); await settle();
  // 키보드: 선택 후 Shift+F10
  await fr().locator('[data-active] h2').first().click(); await settle(); await focusBody();
  await page.keyboard.press('Shift+F10'); await settle();
  check('Shift+F10으로 요소 메뉴가 열림', (await page.getByRole('menuitem', { name: /^Add comment/ }).count()) === 1);
  await page.keyboard.press('Escape'); await settle();
  check('Esc가 메뉴를 닫음', (await page.getByRole('menu').count()) === 0);
  // Layers 행 우클릭(잠긴 요소는 세 항목만)
  await rowsL.nth(1).getByRole('button', { name: 'Lock layer' }).click({ force: true }); await settle();
  await rowsL.nth(1).click({ button: 'right' }); await settle();
  const ll = (await menuLabels()).map((s) => s.replace(/\s+/g, ' ').trim());
  check('잠긴 요소의 Layers 메뉴는 Unlock, Select parent, Add comment', ll.length === 3 && /^Unlock/.test(ll[0]) && /^Select parent/.test(ll[1]) && /^Add comment/.test(ll[2]), ll);
  await page.getByRole('menuitem', { name: /^Unlock/ }).click(); await settle();
  check('메뉴 Unlock으로 잠금 해제', !(await inDoc((s) => !!s.querySelector('[data-locked]'))));
  // 필름스트립 타일 우클릭
  await page.getByRole('option', { name: 'Slide 2', exact: true }).click({ button: 'right' }); await settle();
  const tileL = (await menuLabels()).join('|');
  check('필름스트립 타일 메뉴', /Present from here/.test(tileL) && /Add slide before/.test(tileL) && /Move to start/.test(tileL) && /Move to end/.test(tileL) && /Delete/.test(tileL), tileL);
  await page.keyboard.press('Escape'); await settle();

  // 글 상자와 목록 넣기: 팔레트에서 넣으면 바로 편집이 시작되고, 항목은 Cmd+D로 늘린다
  const palRun = async (q) => { await focusBody(); await page.keyboard.press('Meta+k'); await settle(); await page.keyboard.type(q); await settle(); await page.keyboard.press('Enter'); await settle(); };
  const liBefore = await inDoc((s) => s.querySelectorAll('ul li').length);
  await palRun('Insert bulleted list');
  check('Insert bulleted list는 항목 3개짜리 목록을 넣음', (await inDoc((s) => s.querySelectorAll('ul li').length)) === liBefore + 3);
  check('넣자마자 첫 항목이 편집 중', await cond(() => { const e = document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[contenteditable]'); return !!e && e.tagName === 'LI'; }, null, 3000).then(() => inDoc((s) => !!s.querySelector('li[contenteditable]'))));
  await page.keyboard.type('Alpha'); await page.keyboard.press('Escape'); await settle();
  check('넣은 항목에 바로 쓰면 자리표시 글자가 바뀜(덧붙지 않음)', await inDoc((s) => [...s.querySelectorAll('ul li')].some((l) => l.textContent === 'Alpha')) && !(await inDoc((s) => /AlphaFirst point|First pointAlpha/.test(s.textContent))));
  await page.keyboard.press('Meta+d'); await settle();
  check('Cmd+D로 항목을 늘림', (await inDoc((s) => s.querySelectorAll('ul li').length)) === liBefore + 4);
  const pBefore = await inDoc((s) => s.querySelectorAll(':scope > p').length);
  await page.keyboard.press('Escape'); await palRun('Insert text');
  check('Insert text는 문단을 넣고 편집을 시작함', (await inDoc((s) => s.querySelectorAll(':scope > p').length)) === pBefore + 1 && (await inDoc((s) => !!s.querySelector('p[contenteditable]'))));
  await page.keyboard.press('Escape'); await settle();

  // 글자를 편집하다 Shift+Enter로 줄을 바꾸면 화면에서도 줄이 바뀐다(문서에 개행 글자만 남아 한 줄로 합쳐 보이면 안 된다)
  await page.keyboard.press('Escape'); await palRun('Insert text'); await page.keyboard.type('line one'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('line two'); await page.keyboard.press('Escape'); await settle();
  const lines = await inDoc((s) => { const p = [...s.querySelectorAll(':scope > p')].find((x) => /line one/.test(x.textContent)); return p ? { text: p.textContent, ws: p.style.whiteSpace, rows: (() => { const r = p.ownerDocument.createRange(); r.selectNodeContents(p); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size; })() } : null; });
  check('Shift+Enter로 바꾼 줄이 화면에서도 두 줄(white-space: pre-line)', !!lines && lines.text === 'line one\nline two' && lines.ws === 'pre-line' && lines.rows >= 2, lines);

  // cover가 첫 자리를 벗어나게 옮기면 알림에 Undo가 있어 한 번에 되돌린다
  const coverFirst = () => inDoc((s) => s.ownerDocument.querySelector('#sk-stage > [data-slide]').getAttribute('data-slide') === 'cover');
  await page.keyboard.press('Escape'); await H.layers.nth(1).click(); await settle(); await palRun('Move slide to start');
  check('cover가 밀리면 Undo 단추가 있는 알림', await page.getByText('The cover slide should stay first').first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false) && !(await coverFirst()));
  await page.getByRole('button', { name: 'Undo', exact: true }).last().click(); await settle();
  check('알림의 Undo로 cover가 다시 첫 자리', await coverFirst());

  await H.finish();
})();
