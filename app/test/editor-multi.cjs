/* 편집기 브라우저 검증: 다중 선택(Shift+클릭, 마퀴), 묶음 편집과 정렬, 그룹과 그룹 해제, 이동과 리사이즈(Offset, 핸들, 회전한 조상), 레이어 잠금과 순서.
   하네스(lib/editor-harness.cjs)가 작은 덱 사본을 만들고 편집기를 한 번 열어 준다. Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node editor-multi.cjs */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-multi' });
  const { fs, path, T, FILE, N0, sleep, check, page, settle, focusBody, fr, frameEl, cond, saveDone, unsaved, n, stageCount, layers, inDoc, nKids, rowsL, goSlide2 } = H;
  const tr = () => inDoc((s) => s.querySelector('h2').style.translate || ''); // 2번 슬라이드 h2의 인라인 translate
  // 다중 선택: Shift+클릭으로 같은 부모의 요소를 묶고 이동, 넛지, 복제, 삭제가 한 번에 적용된다(실행 취소 1건)
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const tr2 = () => inDoc((s) => [s.children[0].style.translate || '', s.children[1].style.translate || '']);
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  check('Shift+클릭으로 두 요소가 선택됨(Layers 행 2개)', (await page.locator('[role=treeitem] > [aria-selected], [role=treeitem][aria-selected=true]').count()) >= 2);
  await focusBody(); await page.keyboard.press('ArrowRight'); await settle();
  const m1 = await tr2();
  check('방향키 넛지가 둘 다 옮김', m1[0] === '1px' && m1[1] === '1px', m1);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('넛지 실행 취소 한 번에 둘 다 되돌아감', (await tr2()).join('') === '', await tr2());
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  const k0n = await nKids();
  await focusBody(); await page.keyboard.press('Meta+d'); await settle();
  check('Cmd+D가 선택한 둘을 모두 복제', (await nKids()) === k0n + 2, [k0n, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  await focusBody(); await page.keyboard.press('Delete'); await settle();
  check('Delete가 선택한 둘을 모두 지움', (await nKids()) === k0n - 2, [k0n, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('삭제 실행 취소 한 번에 둘 다 돌아옴', (await nKids()) === k0n, await nKids());
  await page.keyboard.press('Escape');

  // 묶음 Inspector: 값이 다르면 Mixed, Align은 묶음 상자 기준이고 한 번에 실행 취소
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  check('묶음 헤더가 2 layers', (await page.getByRole('button', { name: 'Show in layers' }).textContent()).includes('2 layers'));
  check('값이 다른 필드는 Mixed', (await page.locator('input[placeholder="Mixed"]').count()) >= 1);
  const lefts = () => inDoc((s) => [s.children[0].getBoundingClientRect().left, s.children[1].getBoundingClientRect().left]);
  await page.getByRole('button', { name: 'Align right', exact: true }).click(); await settle();
  const rights = await inDoc((s) => [s.children[0].getBoundingClientRect().right, s.children[1].getBoundingClientRect().right]);
  check('묶음 Align right가 오른쪽 가장자리를 맞춤', Math.abs(rights[0] - rights[1]) < 1.5, rights);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  const back = await tr2();
  check('Align 실행 취소 한 번에 둘 다 되돌아감', back.join('') === '', back);
  void lefts; await focusBody(); await page.keyboard.press('Escape');

  // 그룹과 그룹 해제(Cmd+G, Shift+Cmd+G): 같은 부모의 선택을 div 하나로 감싸고 되돌린다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const kidsBefore = await nKids();
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  await fr().locator('[data-active] > :nth-child(2)').first().click({ modifiers: ['Shift'] }); await settle();
  await focusBody(); await page.keyboard.press('Meta+g'); await settle();
  check('Cmd+G가 선택을 Group div 하나로 감쌈', (await nKids()) === kidsBefore - 1 && (await inDoc((s) => s.querySelectorAll(':scope > [data-name=Group] > *').length)) === 2, [kidsBefore, await nKids()]);
  check('그룹이 한 요소로 선택됨', (await page.getByRole('button', { name: 'Show in layers' }).textContent()).includes('Group'));
  await focusBody(); await page.keyboard.press('Meta+Shift+g'); await settle();
  check('Shift+Cmd+G가 그룹을 풀어 원래 개수로', (await nKids()) === kidsBefore && (await inDoc((s) => !s.querySelector('[data-name=Group]'))), [kidsBefore, await nKids()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle(); await page.keyboard.press('Meta+z'); await settle();
  check('그룹과 해제 실행 취소 뒤 원래 상태', (await nKids()) === kidsBefore && (await inDoc((s) => !s.querySelector('[data-name=Group]'))));
  await page.keyboard.press('Escape');

  // 마퀴: 빈 곳을 끌면 겹친 최상위 요소가 모두 선택된다
  await focusBody(); await page.keyboard.press('Escape'); await settle();
  const sbox = await fr().locator('[data-active]').first().boundingBox();
  await page.mouse.move(sbox.x + sbox.width - 6, sbox.y + sbox.height - 6); await page.mouse.down();
  await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, { steps: 6 }); await settle();
  const marqVisible = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.className.includes('bg-focus-ring/10') && d.style.display === 'block'));
  await page.mouse.move(sbox.x + 6, sbox.y + 6, { steps: 6 }); await page.mouse.up(); await settle();
  check('마퀴 상자가 끄는 동안 보이고 놓으면 사라짐', marqVisible && !(await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.className.includes('bg-focus-ring/10') && d.style.display === 'block'))), marqVisible);
  check('마퀴로 최상위 요소가 여럿 선택됨', (await page.locator('[role=treeitem][aria-selected=true]').count()) >= 2, await page.locator('[role=treeitem][aria-selected=true]').count());
  await focusBody(); await page.keyboard.press('Escape');

  // Inspector Offset 필드와 리사이즈 핸들
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await settle();
  await focusBody(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await settle();
  check('Offset X 필드가 넛지 값을 보임', (await page.getByLabel('Offset X', { exact: true }).inputValue()) === '2', await page.getByLabel('Offset X', { exact: true }).inputValue());
  const offX = page.getByLabel('Offset X', { exact: true }); await offX.fill('12'); await offX.press('Enter'); await settle();
  check('Offset 입력이 translate에 반영', /^12px( 0px)?$/.test(await tr()), await tr());
  await offX.focus(); await page.keyboard.press('Meta+z'); await settle(); await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await settle();
  const wBefore = await inDoc((s) => s.querySelector('h2').getBoundingClientRect().width);
  const hdl = page.locator('[data-handle=e]'); const hbx = await hdl.boundingBox();
  const HC = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
  const hcs = {}; for (const id of Object.keys(HC)) hcs[id] = await page.locator('[data-handle=' + id + ']').evaluate((e) => getComputedStyle(e).cursor);
  check('리사이즈 핸들 8개 커서', Object.keys(HC).every((k) => hcs[k] === HC[k]), hcs);
  await page.mouse.move(hbx.x + hbx.width / 2, hbx.y + hbx.height / 2); await page.mouse.down(); await page.mouse.move(hbx.x - 60, hbx.y + hbx.height / 2, { steps: 6 }); await settle();
  check('리사이즈 끌기 중 방패가 시작한 핸들 커서를 유지', (await page.getByTestId('cursor-shield').count()) === 1 && (await page.getByTestId('cursor-shield').evaluate((e) => getComputedStyle(e).cursor)) === 'ew-resize');
  const chipTxt = await page.getByText(/^\d+ × \d+$/).textContent();
  await page.mouse.up(); await settle();
  check('리사이즈가 끝나면 방패가 사라짐', (await page.getByTestId('cursor-shield').count()) === 0);
  const wStyle = await inDoc((s) => s.querySelector('h2').style.width || '');
  check('핸들로 줄이면 인라인 width가 생기고 크기 칩이 따라옴', /px$/.test(wStyle) && !!chipTxt, [wStyle, chipTxt]);
  check('리사이즈 뒤 Inspector 크기 모드가 Fixed', (await page.getByRole('radiogroup', { name: 'Width mode' }).locator('[aria-checked=true]').getAttribute('aria-label')) !== null);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('리사이즈는 실행 취소 한 번에 되돌아감', (await inDoc((s) => s.querySelector('h2').style.width || '')) === '', await inDoc((s) => s.querySelector('h2').style.cssText));
  void wBefore; await page.keyboard.press('Escape');

  // 회전한 조상 아래에서도 끌면 화면에서 포인터를 따라간다(로컬 축이 아니라)
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const rkpos = () => inDoc((s) => { const r = s.children[1].children[0].getBoundingClientRect(); return [r.x, r.y]; });
  await inDoc((s) => { s.children[1].style.transform = 'rotate(30deg)'; });
  await settle();
  const rkl = fr().locator('[data-active] > :nth-child(2) > :first-child').first(); const rb = await rkl.boundingBox();
  const rk0 = await rkpos();
  const sx = rb.x + rb.width / 2, sy = rb.y + rb.height / 2;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 50, sy, { steps: 8 }); await page.mouse.up(); await settle();
  const rk1 = await rkpos();
  check('회전한 부모 아래 요소가 가로로 끌림(세로로 새지 않음)', rk1[0] - rk0[0] > 10 && Math.abs(rk1[1] - rk0[1]) < Math.abs(rk1[0] - rk0[0]) * 0.2, [rk0, rk1]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  await inDoc((s) => { s.children[1].style.transform = ''; }); await page.keyboard.press('Escape');

  // 레이어: 잠금은 캔버스 선택에서 제외, Cmd+[ ]로 순서 이동, F2 이름 변경
  await layers.nth(1).click(); await settle();
  // (rowsL는 위에서 선언됨)
  await rowsL.nth(1).click(); await settle();
  await rowsL.nth(1).getByRole('button', { name: 'Lock layer' }).click({ force: true }); await settle();
  check('잠금이 data-locked로 저장됨', await inDoc((s) => !!s.querySelector('[data-locked]')));
  await rowsL.nth(1).locator('svg').first().click(); await settle();
  check('잠긴 부모 아래 행에 잠금 표시', (await page.getByTestId('parent-lock').count()) >= 1);
  await focusBody(); await page.keyboard.press('Escape');
  const lockedBox = await fr().locator('[data-active] [data-locked]').first().boundingBox();
  await page.mouse.click(lockedBox.x + lockedBox.width / 2, lockedBox.y + lockedBox.height / 2); await settle();
  check('잠긴 요소는 캔버스 클릭으로 선택되지 않음', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 0);
  // 잠긴 요소를 Layers에서 고른 뒤 Delete를 눌러도 지워지지 않는다
  const nLocked = await inDoc((s) => s.children.length);
  await rowsL.nth(1).click(); await focusBody(); await page.keyboard.press('Delete'); await settle();
  check('잠긴 요소는 Delete로 지워지지 않음', (await inDoc((s) => s.children.length)) === nLocked);
  await page.getByRole('button', { name: 'Unlock layer' }).first().click({ force: true }); await settle();
  check('잠금 해제', !(await inDoc((s) => !!s.querySelector('[data-locked]'))));
  await rowsL.nth(1).click(); await settle();
  const orderOf = () => inDoc((s) => [...s.children].map((e) => e.tagName + ((e.textContent || '').trim().slice(0, 4))).join('|'));
  const o0 = await orderOf();
  await focusBody(); await page.keyboard.press('Meta+['); await settle();
  const o1 = await orderOf();
  check('Cmd+[로 한 칸 앞으로(문서 순서)', o1 !== o0, [o0, o1]);
  await page.keyboard.press('Meta+]'); await settle();
  check('Cmd+]로 되돌림', (await orderOf()) === o0);
  await rowsL.nth(1).click(); await page.keyboard.press('Enter'); await settle();
  check('Layers 행에서 Enter로 이름 입력창', (await page.getByLabel('Layer name').count()) === 1);
  await page.getByLabel('Layer name').press('Escape'); await settle();
  await focusBody(); await page.keyboard.press('F2'); await settle();
  check('F2로 레이어 이름 입력창', (await page.getByLabel('Layer name').count()) === 1);
  await page.getByLabel('Layer name').press('Escape'); await settle();
  await focusBody(); await page.keyboard.press('Escape');

  await H.finish();
})();
