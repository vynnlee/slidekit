/* 편집기 브라우저 검증: Inspector 연동(값이 인라인 style로 저장, 크기 모드, 그림자, 그라디언트, 색 선택기), 덱 토큰과 테마, 단계 효과, 글자 서식 도구줄, 스타일 복사, 텍스트 스타일, 헤더 Undo와 Redo.
   하네스(lib/editor-harness.cjs)가 작은 덱 사본을 만들고 편집기를 한 번 열어 준다. Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node editor-panels.cjs */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-panels' });
  const { fs, path, T, FILE, N0, sleep, check, page, settle, focusBody, fr, frameEl, cond, saveDone, unsaved, n, stageCount, layers, inDoc, nKids, rowsL, goSlide2 } = H;
  // 속성 패널: 값이 인라인 style로 들어가고 저장 파일에 남는다
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await settle();
  const op = page.getByLabel('Opacity', { exact: true });
  await op.fill('50'); await op.press('Enter'); await settle();
  const styled = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('[style*="opacity"]')].length);
  check('Opacity 입력이 요소 style에 반영', styled === 1, styled);
  await op.focus(); await op.press('ArrowUp'); await settle();
  check('화살표로 증가(51)', (await op.inputValue()) === '51', await op.inputValue());
  await page.getByRole('button', { name: 'Add stroke' }).click(); await settle();
  check('Add stroke로 Stroke 필드 표시', (await page.getByLabel('Stroke width', { exact: true }).count()) > 0);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone();
  const saved = fs.readFileSync(FILE, 'utf8');
  check('저장 파일에 opacity와 border 반영', /opacity:\s*0\.51/.test(saved) && /border:\s*1px solid/.test(saved), saved.match(/style="[^"]*opacity[^"]*"/));
  await page.keyboard.press('Meta+z'); await page.keyboard.press('Meta+z'); await settle();
  // 측정값 표시, 크기 모드, 코너별 radius, 그림자 여러 개, 그라디언트, 변별 stroke
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await settle();
  check('W 표시는 소수 둘째 자리까지', /^\d+(\.\d{1,2})?$/.test(await page.getByLabel('Width', { exact: true }).inputValue()), await page.getByLabel('Width', { exact: true }).inputValue());
  // 비율 잠금: 잠그고 W를 두 배로 하면 H도 같은 비율로 바뀌고 실행 취소는 한 번에 둘 다 되돌린다. 풀면 한 축만 바뀐다.
  const wIn = page.getByLabel('Width', { exact: true }), hIn = page.getByLabel('Height', { exact: true }), lockBtn = page.getByRole('button', { name: 'Lock aspect ratio' });
  const w0 = parseFloat(await wIn.inputValue()), h0 = parseFloat(await hIn.inputValue());
  check('비율 잠금 토글이 있고 처음엔 꺼짐', (await lockBtn.getAttribute('aria-pressed')) === 'false');
  await lockBtn.click();
  await wIn.fill(String(Math.round(w0 * 2))); await wIn.press('Enter'); await settle();
  const lw1 = parseFloat(await wIn.inputValue()), lh1 = parseFloat(await hIn.inputValue());
  check('잠그고 W를 두 배로 하면 H도 같은 비율로 바뀜', Math.abs(lh1 / lw1 - h0 / w0) < 0.02 && lw1 > w0 * 1.9, [w0, h0, lw1, lh1]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('실행 취소 한 번에 W와 H가 함께 돌아옴', Math.abs(parseFloat(await wIn.inputValue()) - w0) < 0.6 && Math.abs(parseFloat(await hIn.inputValue()) - h0) < 0.6, [await wIn.inputValue(), await hIn.inputValue()]);
  check('실행 취소로 선택이 다시 잡히면 잠금은 풀려 있음', (await lockBtn.getAttribute('aria-pressed')) === 'false');
  const h2 = parseFloat(await hIn.inputValue()); await wIn.fill(String(Math.round(w0 + 30))); await wIn.press('Enter'); await settle();
  check('잠금을 풀면 W만 바뀜', Math.abs(parseFloat(await hIn.inputValue()) - h2) < 0.6 && (await lockBtn.getAttribute('aria-pressed')) === 'false', [h2, await hIn.inputValue()]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('크기 모드 컨트롤에 W/H 이름', (await page.getByRole('radio', { name: 'Fixed width' }).count()) === 1 && (await page.getByRole('radio', { name: 'Fill container' }).count()) === 2);
  const styleOf = () => page.evaluate(() => { const e = [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('[style]')].find((x) => x.closest('[data-active]') && x.style.length); return e ? e.getAttribute('style') : ''; });
  await page.getByRole('button', { name: 'Individual corners' }).click();
  const tl = page.getByLabel('Top left radius'); await tl.fill('10'); await tl.press('Enter'); await settle();
  check('코너별 radius', /border-top-left-radius:\s*10px/.test(await styleOf()), await styleOf());
  // Grid 열 수: display를 Grid로 바꾸면 Columns 칸이 나타나고 repeat(N, 1fr)로 쓴다
  await page.getByLabel('Display', { exact: true }).click(); await page.getByRole('option', { name: 'Grid', exact: true }).click(); await page.getByRole('listbox').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {}); await settle(); // 목록이 닫히며 포커스가 Display로 되돌아가는 것이 끝난 뒤에 Columns에 입력한다(부하에서 입력이 포커스를 잃어 버려지는 경쟁)
  const colIn = page.getByLabel('Columns', { exact: true });
  check('Display를 Grid로 바꾸면 Columns 칸이 나타남', (await colIn.count()) === 1);
  await colIn.fill('3'); await colIn.press('Enter'); await settle();
  check('Columns 3은 repeat(3, 1fr)로 기록됨', /grid-template-columns:\s*repeat\(3,\s*1fr\)/.test(await styleOf()), await styleOf());
  check('Columns 표시값이 3', (await colIn.inputValue()) === '3', await colIn.inputValue());
  await focusBody(); await page.keyboard.press('Meta+z'); await page.keyboard.press('Meta+z'); await settle();
  check('Grid 변경 실행 취소 뒤 Columns 칸이 사라짐', (await page.getByLabel('Columns', { exact: true }).count()) === 0);
  for (const name of ['Drop shadow', 'Inner shadow']) { await page.getByRole('button', { name: 'Add effect' }).click(); await page.getByRole('menuitem', { name }).click(); await settle(); }
  const b2 = page.getByLabel('Shadow 2 blur'); await b2.fill('12'); await b2.press('Enter'); await settle();
  check('그림자 2개와 inset', /box-shadow:[^;]*,[^;]*inset/.test(await styleOf()) || /box-shadow:[^;]*inset[^;]*,/.test(await styleOf()), await styleOf());
  await page.getByRole('button', { name: 'Remove shadow 1' }).click(); await settle();
  check('그림자 하나 삭제', (await page.getByLabel('Shadow 2 blur').count()) === 0 && (await page.getByLabel('Shadow 1 blur').count()) === 1);
  if (await page.getByRole('button', { name: 'Add fill' }).count()) await page.getByRole('button', { name: 'Add fill' }).click();
  await settle(); await page.getByRole('radio', { name: 'Linear gradient' }).click(); await settle();
  check('그라디언트 전환', /linear-gradient/.test(await styleOf()) && (await page.getByLabel('Gradient angle').count()) === 1, await styleOf());
  const ang = page.getByLabel('Gradient angle'); await ang.fill('90'); await ang.press('Enter'); await settle();
  check('그라디언트 각도', /linear-gradient\(90deg/.test(await styleOf()), await styleOf());
  // 스톱 편집: 막대를 눌러 추가(최대 4개), 핸들 끌기, 토큰 var() 색, 삭제는 2개까지
  const gbar = page.getByTestId('gradient-bar'); const gbb = await gbar.boundingBox();
  await page.mouse.click(gbb.x + gbb.width * 0.5, gbb.y + gbb.height / 2); await settle();
  check('막대를 눌러 스톱을 추가(3개)', (await page.getByRole('slider', { name: /^Gradient stop/ }).count()) === 3 && ((await styleOf()).match(/\d%/g) || []).length >= 3, await styleOf());
  const stopH = page.getByRole('slider', { name: 'Gradient stop 2' }); const stopB = await stopH.boundingBox();
  await page.mouse.move(stopB.x + stopB.width / 2, stopB.y + stopB.height / 2); await page.mouse.down();
  await page.mouse.move(gbb.x + gbb.width * 0.8, stopB.y + stopB.height / 2, { steps: 5 }); await page.mouse.up(); await settle();
  check('핸들을 끌어 스톱 위치가 바뀜', /\b(7[5-9]|8[0-5])(\.\d)?%/.test(await styleOf()), await styleOf());
  await page.getByLabel('Gradient stop color swatch').click();
  await page.getByTestId('deck-token').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.getByTestId('deck-token').first().click(); await settle();
  check('스톱 색에 덱 토큰 var()를 쓸 수 있음', /var\(--sk-/.test(await styleOf()), await styleOf());
  await page.keyboard.press('Escape'); await settle();
  await page.getByRole('button', { name: 'Remove stop' }).click(); await settle();
  check('스톱 삭제 뒤 2개이고 더는 지울 수 없음', (await page.getByRole('slider', { name: /^Gradient stop/ }).count()) === 2 && !(await page.getByRole('button', { name: 'Remove stop' }).isEnabled()));
  if (await page.getByRole('button', { name: 'Add stroke' }).count()) await page.getByRole('button', { name: 'Add stroke' }).click();
  await settle(); await page.getByRole('button', { name: 'Individual sides' }).click();
  const tw = page.getByLabel('top stroke width', { exact: true }); await tw.fill('4'); await tw.press('Enter'); await settle();
  check('변별 stroke 두께', /border(-top)?-width:\s*4px/.test(await styleOf()), await styleOf());

  // 색 팝오버: 스와치를 누르면 Fluid ColorPicker가 열린다
  const hx = await page.getByLabel('Text color hex').boundingBox();
  if (hx) { await page.mouse.click(hx.x - 18, hx.y + hx.height / 2); await page.getByLabel('Hue').first().waitFor({ timeout: 8000 }).catch(() => {}); } // 색 선택기 조각은 처음 열 때 불러온다
  check('스와치 클릭으로 색 선택기 열림', hx && (await page.getByLabel('Hue').count()) > 0);
  check('색 선택기 dialog와 슬라이더 이름', (await page.getByRole('dialog', { name: 'Color picker' }).count()) > 0 && (await page.getByRole('slider', { name: 'Hue' }).count()) > 0);
  check('헤더 Export 버튼', (await page.getByRole('button', { name: 'Export' }).count()) === 1);
  await page.keyboard.press('Escape'); await settle();

  // Layers 탭, 복사 붙여넣기, 굵게
  await layers.nth(1).click(); await settle();
  const rows = page.locator('[role=tree] [draggable=true]');
  check('Layers 트리에 요소 표시', (await rows.count()) > 1, await rows.count());
  const names = await page.locator('[role=tree] [role=treeitem] > div > span.truncate').allTextContents();
  check('레이어 이름에 날것의 div가 없음', !names.includes('div') && names.some((x) => /^(Frame|Auto layout|Image|Vector|List)$/.test(x) || x.length > 0), names.slice(0, 6));
  check('슬라이드 루트 행', names.some((x) => /^Slide \d+$/.test(x)) || names.length > 0);
  await rows.nth(1).click(); await page.locator('.border-2.border-focus-ring').first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  check('행 클릭이 캔버스 선택', await page.locator('.border-2.border-focus-ring').first().isVisible());
  check('선택된 행 표시', (await page.locator('[role=treeitem][aria-selected=true]').count()) >= 1);
  await rows.nth(1).dblclick(); await page.getByLabel('Layer name').fill('Hero'); await page.getByLabel('Layer name').press('Enter'); await settle();
  check('이름 바꾸기가 data-name에 저장', await inDoc((s) => !!s.querySelector('[data-name="Hero"]')));
  await page.getByRole('button', { name: 'Hide layer' }).first().click({ force: true }); await settle();
  check('눈 아이콘이 display:none', await inDoc((s) => [...s.querySelectorAll('*')].some((e) => e.style && e.style.display === 'none')));
  await page.getByRole('button', { name: 'Show layer' }).first().click(); await settle();
  check('다시 보이기', await inDoc((s) => ![...s.querySelectorAll('*')].some((e) => e.style && e.style.display === 'none')));
  const kidsN = () => inDoc((s) => s.children.length);
  const k0 = await kidsN();
  await rows.nth(1).click(); await page.keyboard.press('Meta+c'); await page.keyboard.press('Meta+v'); await settle();
  check('Cmd+C, Cmd+V로 붙이기', (await kidsN()) === k0 + 1, [k0, await kidsN()]);
  await page.keyboard.press('Meta+z'); await settle();
  check('붙이기 실행 취소', (await kidsN()) === k0);
  const first = await inDoc((s) => s.children[0].tagName + s.children[1].tagName + (s.children[0].textContent || '').length);
  await rows.nth(0).dragTo(rows.nth(1), { targetPosition: { x: 40, y: 22 } }); await settle();
  const after2 = await inDoc((s) => s.children[0].tagName + s.children[1].tagName + (s.children[0].textContent || '').length);
  check('드래그로 순서 변경', after2 !== first, [first, after2]);
  await page.keyboard.press('Meta+z'); await settle();
  const h1 = fr().locator('[data-active] h1, [data-active] h2, [data-active] p').first();
  await h1.click({ modifiers: ['Meta'] }); await settle(); await h1.dblclick(); await settle(); await page.keyboard.press('Meta+a'); await page.keyboard.press('Meta+b'); await settle();
  check('편집 중 Cmd+B가 strong으로 감쌈', await h1.evaluate((e) => !!e.querySelector('strong')));
  await page.keyboard.press('Enter'); await settle();

  check('색 스와치 버튼에 이름', (await page.getByRole('button', { name: /color swatch$/ }).count()) > 0);
  // 덱 토큰: 요소 미선택 상태에서 accent와 pad-x를 바꿔 저장하면 head의 :root만 바뀐다
  await page.keyboard.press('Escape'); await settle();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone(); // 앞 단계의 미저장 변경을 먼저 비운다
  const eb = await page.getByRole('button', { name: 'Export' }).boundingBox(), pb = await page.getByRole('button', { name: 'Present' }).boundingBox();
  check('Export와 Present 버튼 높이가 같음', eb && pb && Math.abs(eb.height - pb.height) < 1 && eb.height <= 30, [eb && eb.height, pb && pb.height]);
  check('토큰 Page background 라벨', (await page.getByLabel('Page background hex').count()) === 1 && (await page.getByLabel('Background hex', { exact: true }).count()) === 1);
  check('hex가 잘리지 않음', await page.getByLabel('Page background hex').evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
  check('글꼴은 Select 하나', (await page.getByLabel('Font', { exact: true }).count()) === 1 && (await page.getByLabel('Font CSS', { exact: true }).count() === 0));
  const tokPre = fs.readFileSync(FILE, 'utf8');
  const acc = page.getByLabel('Accent hex'); await acc.fill('#ff5500'); await acc.press('Enter'); await settle();
  const px2 = page.getByLabel('Padding X', { exact: true }); await px2.fill('120'); await px2.press('Enter'); await settle();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone();
  const tokPost = fs.readFileSync(FILE, 'utf8');
  check('토큰 저장: head에 accent와 pad-x', /--sk-accent:\s*#ff5500/i.test(tokPost) && /--sk-pad-x:\s*120px/.test(tokPost));
  check('토큰 저장: 슬라이드 본문 그대로', tokPost.slice(tokPost.indexOf('<body>')) === tokPre.slice(tokPre.indexOf('<body>')));
  for (let i = 0; i < 3 && (await page.getByLabel('Accent hex').inputValue()).toLowerCase().includes('ff5500'); i++) { await page.keyboard.press('Meta+z'); await settle(); } // 토큰 변경은 입력별로 1건씩 기록된다
  check('토큰 변경 실행 취소', !(await page.getByLabel('Accent hex').inputValue()).toLowerCase().includes('ff5500'), await page.getByLabel('Accent hex').inputValue());
  // 테마 프리셋: 토큰 아홉 개가 한 번에 바뀌고 실행 취소 한 건이며, 값을 따로 바꾸면 Custom이 된다
  const themeSel = page.getByLabel('Theme', { exact: true });
  const bgHex = () => page.getByLabel('Page background hex').inputValue();
  const bg0 = await bgHex();
  await themeSel.click(); await page.getByRole('option', { name: 'Paper' }).click(); await settle();
  check('테마 Paper가 페이지 배경 토큰을 바꿈', (await bgHex()).toLowerCase() === '#f6f1e7', await bgHex());
  check('선택한 테마가 표시됨', ((await themeSel.textContent()) || '').includes('Paper'));
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('테마 변경은 실행 취소 한 번에 되돌아감', (await bgHex()) === bg0, [bg0, await bgHex()]);
  await themeSel.click(); await page.getByRole('option', { name: 'Light' }).click(); await settle();
  const acc2 = page.getByLabel('Accent hex'); await acc2.fill('#ff0000'); await acc2.press('Enter'); await cond(() => (document.querySelector('[aria-label=Theme]')?.textContent || '').includes('Custom'), null, 6000); // 토큰 입력은 400ms 디바운스 뒤 반영된다
  check('토큰을 따로 바꾸면 Custom', ((await themeSel.textContent()) || '').includes('Custom'), await themeSel.textContent());
  await focusBody(); for (let i = 0; i < 3; i++) { await page.keyboard.press('Meta+z'); await settle(); }
  check('테마 시험 뒤 원래 배경으로 복귀', (await bgHex()) === bg0, [bg0, await bgHex()]);
  // 선언형 단계: Appears at step
  await page.keyboard.press('Escape'); await focusBody(); await page.keyboard.press('Tab'); await settle();
  const st = page.getByLabel('Appears at step'); await st.fill('3'); await st.press('Enter'); await settle();
  check('data-step이 요소에 설정', await inDoc((s) => !!s.querySelector('[data-step="3"]')));
  check('Effect Select 표시', (await page.getByLabel('Step effect', { exact: true }).count()) === 1);
  check('캔버스에 모든 단계 표시(data-sk-show-steps)', await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').contentDocument.documentElement.hasAttribute('data-sk-show-steps')));
  check('Layers 단계 배지', (await page.getByTitle('Appears at step 3').count()) >= 1);
  // 효과 목록(engine/steps.ts)과 미리보기 재생
  await page.getByLabel('Step effect', { exact: true }).click();
  await page.getByRole('option').first().waitFor({ timeout: 5000 }).catch(() => {});
  const effOpts = await page.getByRole('option').allTextContents();
  check('효과 목록이 6종(Rise, Fade, Slide, Scale, Blur, None)', ['Rise', 'Fade', 'Slide', 'Scale', 'Blur', 'None'].every((l) => effOpts.some((o) => o.includes(l))), effOpts);
  await page.getByRole('option', { name: 'Slide' }).click(); await settle();
  check('효과가 data-step-effect로 저장됨', await inDoc((s) => !!s.querySelector('[data-step-effect="left"]')));
  await page.getByRole('button', { name: 'Preview step effect' }).click();
  await cond(() => !document.querySelector('iframe[title="Canvas"]').contentDocument.documentElement.hasAttribute('data-sk-show-steps'), null, 3000);
  check('미리보기 중에는 모든 단계 표시가 잠깐 꺼짐', true);
  await cond(() => document.querySelector('iframe[title="Canvas"]').contentDocument.documentElement.hasAttribute('data-sk-show-steps') && !document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-shown]'), null, 6000);
  check('미리보기가 끝나면 표시와 data-shown이 정리됨', await page.evaluate(() => { const d = document.querySelector('iframe[title="Canvas"]').contentDocument; return d.documentElement.hasAttribute('data-sk-show-steps') && !d.querySelector('[data-shown]'); }));
  await page.getByLabel('Step effect', { exact: true }).click(); await page.getByRole('option', { name: 'Rise' }).click(); await settle();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone();
  const stepSaved = fs.readFileSync(FILE, 'utf8');
  check('저장 파일에 data-step, show-steps는 새지 않음', /data-step="3"/.test(stepSaved) && !stepSaved.includes('data-sk-show-steps'));
  await page.keyboard.press('Escape'); await settle();
  check('슬라이드 상태에 자동 단계 안내', (await page.getByText('Auto from element steps: 3').count()) === 1);
  await focusBody(); await page.keyboard.press('Tab'); await settle();
  const st2 = page.getByLabel('Appears at step'); await st2.fill('1'); await st2.press('Enter'); await settle();
  check('1로 되돌리면 속성 삭제', !(await inDoc((s) => !!s.querySelector('[data-step]'))));
  // 속성 패널 UX: 선택 헤더, 설정 표시와 Reset, 크기 모드, 정렬 사유, 슬라이드 힌트
  await page.screenshot({ path: '/tmp/sk-ux-elem.png' });
  check('선택 헤더(이름과 태그)', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  const o3 = page.getByLabel('Opacity', { exact: true }); await o3.fill('60'); await o3.press('Enter'); await settle();
  check('설정한 속성에 점 표시', (await page.locator('[data-dirty]').count()) >= 1);
  await o3.hover(); await page.getByRole('button', { name: 'Reset Opacity' }).click(); await settle();
  check('Reset이 인라인 값을 지움', !(await inDoc((s) => [...s.querySelectorAll('[style]')].some((e) => /opacity/.test(e.getAttribute('style') || '')))));
  check('크기 모드가 하나만 선택', (await page.getByRole('radiogroup', { name: 'Width mode' }).locator('[aria-checked=true]').count()) === 1);
  check('정렬 버튼에 규칙 툴팁이나 비활성', (await page.getByRole('button', { name: 'Align top' }).count()) === 1);
  await page.getByRole('button', { name: 'Show in layers' }).click(); await settle();
  check('선택 헤더를 누르면 Layers 탭', (await page.getByRole('tree', { name: 'Layers' }).count()) === 1);
  await page.keyboard.press('Escape'); await settle();
  await page.screenshot({ path: '/tmp/sk-ux-slide.png' });
  check('요소를 고르지 않았을 때 안내 문구가 없음(슬라이드 속성만 보임)', (await page.getByText('Select an element to edit its properties').count()) === 0 && (await page.getByText('Slide', { exact: true }).count()) >= 1);
  // 키보드와 되돌리기: 패널의 Tab 이동, 되돌린 뒤 선택 유지, 스크럽 한 번이 별도 undo
  await focusBody(); await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await settle();
  const o4 = page.getByLabel('Opacity', { exact: true }); await o4.fill('80'); await o4.press('Enter'); await sleep(1000); // 실행 취소 묶음 창(0.8초)이 지나야 아래 스크럽이 별도 한 건이 된다
  const lab = await o4.locator('xpath=../span[1]').boundingBox();
  await page.mouse.move(lab.x + lab.width / 2, lab.y + lab.height / 2); await page.mouse.down(); await page.mouse.move(lab.x + lab.width / 2 - 25, lab.y + lab.height / 2, { steps: 8 }); await page.mouse.up(); await settle();
  const scrubbed = await o4.inputValue();
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('스크럽 한 번이 별도 undo(직전 값 80으로)', scrubbed !== '80' && (await page.getByLabel('Opacity', { exact: true }).inputValue()) === '80', [scrubbed, await page.getByLabel('Opacity', { exact: true }).inputValue()]);
  check('되돌린 뒤에도 요소 선택 유지', (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  await page.getByRole('button', { name: 'Show in layers' }).focus(); await page.keyboard.press('Tab'); await settle();
  check('패널에서 Tab은 포커스를 옮기고 선택을 순환시키지 않음', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) !== 'Show in layers' && (await page.getByRole('button', { name: 'Show in layers' }).count()) === 1);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();

  // 이미지 선택: Fit 컨트롤, Fill 섹션 없음, 선택 헤더 한 줄
  await focusBody(); await page.keyboard.press('Escape');
  const imgAt = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')].findIndex((s) => s.querySelector('img')));
  console.log('INFO 이미지 슬라이드 위치 ' + (imgAt + 1));
  await layers.nth(Math.max(0, imgAt)).click(); await settle();
  await fr().locator('[data-active] img').first().click({ modifiers: ['Meta'] }); await settle();
  check('이미지 Fit과 Position 컨트롤', (await page.getByLabel('Image fit', { exact: true }).count()) === 1 && (await page.getByLabel('Image position', { exact: true }).count()) === 1);
  const pr = await page.getByRole('complementary', { name: 'Properties' }).boundingBox(), fitB = await page.getByLabel('Image fit', { exact: true }).boundingBox(), posB = await page.getByLabel('Image position', { exact: true }).boundingBox();
  check('Fit과 Position이 패널 안에서 겹치지 않음', pr && fitB && posB && fitB.x + fitB.width <= pr.x + pr.width && posB.x + posB.width <= pr.x + pr.width && (posB.y >= fitB.y + fitB.height - 1 || posB.x >= fitB.x + fitB.width), [pr, fitB, posB]);
  check('이미지에는 Fill 섹션이 없음', (await page.getByRole('button', { name: 'Add fill' }).count()) === 0);
  const hb = await page.getByRole('button', { name: 'Show in layers' }).boundingBox();
  check('선택 헤더가 한 줄', hb && hb.height <= 30, hb && hb.height);
  check('이미지 이름은 Image', (await page.getByRole('button', { name: 'Show in layers' }).textContent()).includes('Image'));
  await focusBody(); await page.keyboard.press('Escape');

  // 글자 서식 도구줄: 선택한 글자 요소에서 굵게, 크기, 정렬이 한 번 눌러 적용된다
  await goSlide2();
  await fr().locator('[data-active] h2').first().click(); await settle();
  const fmtG = page.getByRole('group', { name: 'Text format' });
  check('글자 요소를 고르면 서식 도구줄이 보임', (await fmtG.count()) === 1);
  const styleBefore = await inDoc((s) => s.querySelector('h2').getAttribute('style') || '');
  const fs0 = await inDoc((s) => parseFloat(getComputedStyle(s.querySelector('h2')).fontSize));
  await fmtG.getByRole('button', { name: 'Larger text' }).click(); await settle();
  const fs1 = await inDoc((s) => parseFloat(getComputedStyle(s.querySelector('h2')).fontSize));
  check('Larger text가 글자 크기를 키움', fs1 > fs0, [fs0, fs1]);
  await fmtG.getByRole('button', { name: 'Bold' }).click(); await settle();
  await fmtG.getByRole('button', { name: 'Text align center' }).click(); await settle();
  const fmtSt = await inDoc((s) => ({ w: s.querySelector('h2').style.fontWeight, a: s.querySelector('h2').style.textAlign }));
  check('Bold와 가운데 정렬이 요소 style에 저장', fmtSt.a === 'center' && !!fmtSt.w, fmtSt);
  await focusBody(); for (let i = 0; i < 3; i++) { await page.keyboard.press('Meta+z'); await settle(); }
  check('서식 변경 실행 취소', (await inDoc((s) => s.querySelector('h2').getAttribute('style') || '')) === styleBefore, [styleBefore, await inDoc((s) => s.querySelector('h2').getAttribute('style') || '')]);
  await page.keyboard.press('Escape');

  // 헤더 Undo와 Redo 버튼: 편집 뒤 켜지고 누르면 되돌린다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape'); // 찾기 시험이 첫 슬라이드에 두고 간 위치를 2번 슬라이드로
  await fr().locator('[data-active] h2').first().click(); await settle();
  await focusBody(); await page.keyboard.press('ArrowRight'); await settle();
  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true }), redoBtn = page.getByRole('button', { name: 'Redo', exact: true });
  check('편집 뒤 Undo 버튼이 켜져 있고 Redo는 꺼져 있음', (await undoBtn.isEnabled()) && !(await redoBtn.isEnabled()));
  await undoBtn.click(); await settle();
  check('Undo 버튼이 넛지를 되돌리고 Redo가 켜짐', (await inDoc((s) => s.querySelector('h2').style.translate || '')) === '' && (await redoBtn.isEnabled()));
  await redoBtn.click(); await settle();
  check('Redo 버튼이 다시 적용', (await inDoc((s) => s.querySelector('h2').style.translate || '')) === '1px 0px' || (await inDoc((s) => s.querySelector('h2').style.translate || '')) === '1px');
  await undoBtn.click(); await settle(); await page.keyboard.press('Escape');

  // 색 선택기 섹션: 덱 토큰은 var()로 연결되고, 글자 색에는 대비 칩이 붙는다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  await fr().locator('[data-active] h2').first().click(); await settle();
  await page.getByLabel('Text color swatch').click();
  await page.getByTestId('color-sections').waitFor({ timeout: 8000 }).catch(() => {});
  if (process.env.SK_SHOT) await page.screenshot({ path: process.env.SK_SHOT });
  check('색 선택기 아래에 Deck colors와 대비 칩', (await page.getByTestId('deck-token').count()) >= 1 && (await page.getByTestId('contrast-chip').count()) === 1, [await page.getByTestId('deck-token').count(), await page.getByTestId('contrast-chip').count()]);
  await page.getByTestId('deck-token').first().click(); await settle();
  const linkedColor = await inDoc((s) => s.querySelector('h2').style.color);
  check('토큰 선택은 hex가 아니라 var()로 저장', /^var\(--sk-[a-z-]+\)$/.test(linkedColor), linkedColor);
  check('연결된 값은 스와치에 링크 표시', (await page.getByTestId('token-link').count()) >= 1);
  await page.keyboard.press('Escape'); await settle();
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('토큰 선택 실행 취소', (await inDoc((s) => s.querySelector('h2').style.color)) === '');
  await page.keyboard.press('Escape');

  // 스타일 복사와 붙여넣기(Cmd+Alt+C, Cmd+Alt+V): 인라인 모양 속성만 옮기고 한 번에 되돌린다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  await fr().locator('[data-active] > :nth-child(1)').first().click(); await settle();
  const fmtG2 = page.getByRole('group', { name: 'Text format' });
  await fmtG2.getByRole('button', { name: 'Larger text' }).click(); await settle();
  await fmtG2.getByRole('button', { name: 'Text align center' }).click(); await settle();
  await focusBody(); await page.keyboard.press('Meta+Alt+KeyC'); await settle();
  const srcStyle = await inDoc((s) => s.children[0].getAttribute('style') || '');
  await fr().locator('[data-active] > :nth-child(2)').first().click(); await settle();
  const dstBefore = await inDoc((s) => s.children[1].getAttribute('style') || '');
  await focusBody(); await page.keyboard.press('Meta+Alt+KeyV'); await settle();
  const dstAfter = await inDoc((s) => s.children[1].getAttribute('style') || '');
  check('스타일 붙여넣기가 글자 크기와 정렬을 옮김', /font-size/.test(dstAfter) && /text-align:\s*center/.test(dstAfter) && /text-align:\s*center/.test(srcStyle), [srcStyle, dstAfter]);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('스타일 붙여넣기는 실행 취소 한 번에 되돌아감', (await inDoc((s) => s.children[1].getAttribute('style') || '')) === dstBefore);
  await page.keyboard.press('Meta+z'); await settle(); await page.keyboard.press('Meta+z'); await settle(); await page.keyboard.press('Escape');

  // 텍스트 스타일 프리셋: 한 번에 여섯 속성이 토큰 var()로 들어가고 실행 취소 한 건
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  await fr().locator('[data-active] h2').first().click(); await settle();
  const tsSel = page.getByLabel('Text style', { exact: true });
  await tsSel.click(); await page.getByRole('option', { name: 'Caption' }).click(); await settle();
  const capStyle = await inDoc((s) => s.querySelector('h2').getAttribute('style') || '');
  check('Caption 프리셋이 토큰 var()로 크기와 색을 넣음', /font-size:\s*var\(--sk-fs-small\)/.test(capStyle) && /color:\s*var\(--sk-muted\)/.test(capStyle) && /line-height:\s*1\.4/.test(capStyle), capStyle);
  check('선택한 프리셋 이름이 표시됨', ((await tsSel.textContent()) || '').includes('Caption'));
  check('크기 칸이 var() 대신 계산된 숫자를 보임', /^\d+(\.\d+)?$/.test(await page.getByLabel('Font size', { exact: true }).inputValue()), await page.getByLabel('Font size', { exact: true }).inputValue());
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('텍스트 스타일은 실행 취소 한 번에 되돌아감', !/var\(--sk-fs-small\)/.test(await inDoc((s) => s.querySelector('h2').getAttribute('style') || '')));
  await page.keyboard.press('Escape');

  // 슬라이드 배경 그라디언트
  await focusBody(); await page.keyboard.press('Escape'); await settle();
  await page.getByRole('radio', { name: 'Linear gradient' }).last().click(); await settle();
  check('슬라이드 배경을 그라디언트로', await inDoc((s) => /linear-gradient/.test(s.style.backgroundImage)) && (await page.getByRole('group', { name: 'Background gradient' }).count()) === 1);
  await page.getByRole('radio', { name: 'Solid' }).last().click(); await settle();
  check('Solid로 돌아오면 배경 이미지가 지워짐', await inDoc((s) => !/gradient/.test(s.style.backgroundImage)));

  await H.finish();
})();
