/* 하단 Animation 탭(spec/ANIMATION.md 4절): Keynote식 애니메이션 목록. 단계 숫자 없이 줄 순서와 시작 방식(On click, With previous, After previous)이
   data-step과 지연으로 저장되고, 효과와 시간은 select, 순서는 끌기와 Alt+위아래, 줄을 누르면 캔버스가 그 줄까지 실행된 상태를 보인다.
   모든 조작은 실행 취소 한 건이고 iframe을 다시 만들지 않는다. 인스펙터 Animation 섹션은 + In, + Out과 세 칸뿐. */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-animation' });
  const { fs, FILE, check, page, settle, focusBody, cond, saveDone, goSlide2, inDoc, finish } = H;
  await goSlide2();
  const shot = async (n) => { if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: `${process.env.SHOTS}/${n}.png` }); } }; // SHOTS=<폴더>이면 화면을 저장한다(검토용)
  await page.getByRole('tab', { name: 'Animation' }).click(); await settle(); await shot('1-empty-list'); // 빈 목록
  await focusBody(); await page.keyboard.press('Tab'); await settle();
  const addIn = async () => { await page.getByRole('button', { name: 'In', exact: true }).click(); await settle(); };
  const stepsOf = () => inDoc((s) => [...s.querySelectorAll('[data-step],[data-step-out]')].map((e) => (e.getAttribute('data-step') || '') + '/' + (e.getAttribute('data-step-out') || '') + '/' + (e.style.getPropertyValue('--sk-step-delay') || '')));
  const undo = async () => { await focusBody(); await page.keyboard.press('Meta+z'); await settle(); };

  check('요소를 고르면 인스펙터에 + In과 + Out 단추만 있음(숫자 칸 없음)', (await page.getByRole('button', { name: 'In', exact: true }).count()) === 1 && (await page.getByRole('button', { name: 'Out', exact: true }).count()) === 1 && (await page.getByLabel('Appears at step').count()) === 0);
  await addIn();
  check('인스펙터 + In이 첫 클릭 단계(data-step=2)를 만듦', (await stepsOf())[0].startsWith('2/'), await stepsOf());
  check('인스펙터에 효과, 시작, 시간 세 칸만 보임', (await page.getByRole('combobox').filter({ hasText: /Fade|On click|0\.36s/ }).count()) >= 3);
  await focusBody(); await page.keyboard.press('Tab'); await settle(); await addIn();
  const rows = page.getByTestId('anim-row'), row = (i) => rows.nth(i), sel = (i, name) => row(i).getByRole('combobox', { name });
  check('빈 목록이 아니라 줄 둘(둘 다 On click, Click 1과 Click 2)', (await rows.count()) === 2 && (await row(0).getAttribute('data-start')) === 'click' && (await row(1).getAttribute('data-group')) === '2', await rows.count());
  check('단계 숫자 입력칸과 막대와 격자는 없음', (await page.getByTestId('anim-bar').count()) === 0 && (await page.getByRole('grid').count()) === 0 && (await page.getByRole('spinbutton').count()) === 0);
  check('목록은 이름 있는 list이고 줄 이름에 요소와 In이 읽힘', (await page.getByRole('list', { name: 'Animations' }).count()) === 1 && /, In$/.test((await row(0).getAttribute('aria-label')) || ''), await row(0).getAttribute('aria-label'));
  check('현재 위치 표시(기본은 끝): Click 2 of 2', (await page.getByTestId('anim-step-label').textContent()) === 'Click 2 of 2');
  const base = await stepsOf(), iframeId = () => page.evaluate(() => { const f = document.querySelector('iframe[title="Canvas"]'); return (f.__sk = f.__sk || Math.random()); });
  const ifr = await iframeId();

  // 시작 방식: 둘째 줄을 With previous로 -> 같은 단계
  await sel(1, /^Start/).selectOption('with'); await settle();
  check('With previous: 두 요소가 같은 단계(2)이고 지연 없음', JSON.stringify(await stepsOf()) === JSON.stringify(['2//', '2//']), await stepsOf());
  check('목록이 Click 1 아래에 묶음', (await row(1).getAttribute('data-start')) === 'with' && (await row(1).getAttribute('data-group')) === '1');
  await sel(1, /^Start/).selectOption('after'); await settle();
  check('After previous: 같은 단계에 지연이 앞 줄의 시간(360ms)', JSON.stringify(await stepsOf()) === JSON.stringify(['2//', '2//360ms']), await stepsOf());
  await undo(); await undo();
  check('시작 방식 바꾸기는 각각 실행 취소 한 건', JSON.stringify(await stepsOf()) === JSON.stringify(base), [base, await stepsOf()]);

  // 순서: Alt+위로 -> 둘째 요소가 먼저 실행(번호가 맞바뀜), Undo로 복귀
  await row(1).focus(); await page.keyboard.press('Alt+ArrowUp'); await settle();
  check('Alt+위: 순서가 바뀌고 단계 번호가 자동으로 맞바뀜', JSON.stringify(await stepsOf()) === JSON.stringify(['3//', '2//']), await stepsOf());
  await undo();
  // 끌어서 순서 바꾸기
  await row(1).getByTestId('anim-grip').dragTo(row(0)); await settle();
  check('줄을 끌어 순서를 바꿈', JSON.stringify(await stepsOf()) === JSON.stringify(['3//', '2//']), await stepsOf());
  await undo();
  check('순서 바꾸기는 실행 취소 한 건', JSON.stringify(await stepsOf()) === JSON.stringify(base), [base, await stepsOf()]);
  check('조작 중 캔버스 iframe을 다시 만들지 않음', (await iframeId()) === ifr);

  // 효과와 시간
  await sel(0, /^Effect/).selectOption('fade'); await settle();
  check('Effect Fade는 --sk-away-y 0px를 채움(이름은 저장 안 됨)', await inDoc((s) => s.querySelector('[data-step]').style.getPropertyValue('--sk-away-y') === '0px') && !/data-step-effect|fade/i.test(fs.readFileSync(FILE, 'utf8').split('data-step')[1] || ''));
  await sel(0, /^Duration/).selectOption('500'); await settle();
  check('Duration 0.5s는 --sk-step-ms 500ms', await inDoc((s) => s.querySelector('[data-step]').style.getPropertyValue('--sk-step-ms') === '500ms'));
  await undo(); await undo();

  // Custom(기본 접힘): 지연 직접 입력
  check('Custom은 기본 접힘', (await row(0).getByRole('group').count()) === 0);
  await row(0).getByRole('button', { name: /^Custom values/ }).click();
  await page.getByLabel(/^Delay of/).first().fill('200'); await page.getByLabel(/^Delay of/).first().press('Enter'); await settle();
  check('Custom의 지연 칸이 --sk-step-delay를 씀', (await stepsOf())[0].endsWith('/200ms'), await stepsOf());
  await undo();

  // 줄을 누르면 캔버스가 그 줄까지 실행된 상태
  const vis = (i) => inDoc((s, ix) => getComputedStyle([...s.querySelectorAll('[data-step]')][ix]).visibility, i);
  await row(0).getByRole('button', { name: /./ }).first().click(); await settle();
  check('첫 줄을 누르면 첫 요소만 보임(Click 1 of 2)', (await vis(0)) === 'visible' && (await vis(1)) === 'hidden' && (await page.getByTestId('anim-step-label').textContent()) === 'Click 1 of 2', [await vis(0), await vis(1)]);
  await row(1).getByRole('button', { name: /./ }).first().click(); await settle();
  check('둘째 줄을 누르면 모두 보임', (await vis(0)) === 'visible' && (await vis(1)) === 'visible');
  check('캔버스 단계 배지는 클릭 순서(1, 2)', JSON.stringify(await page.getByTestId('step-badges').evaluate((e) => [...e.children].map((c) => c.textContent.trim()))) === '["1","2"]');

  // 퇴장: Add animation은 In이 있으면 Out을 더한다(선택한 요소의 줄 아래, On click)
  await row(0).getByRole('button', { name: /./ }).first().click(); await settle();
  await page.getByRole('button', { name: 'Add animation' }).click(); await settle();
  check('Add animation: 선택한 요소의 Out이 새 클릭 단계로 생기고 자기 In 뒤에 놓임', (await rows.count()) === 3 && (await row(1).getAttribute('data-kind')) === 'out' && (await stepsOf())[0].startsWith('2/3'), [await rows.count(), await stepsOf()]);
  check('Out 줄의 효과와 시간은 In과 같아 바꿀 수 없음', await sel(1, /^Effect/).isDisabled() && await sel(1, /^Duration/).isDisabled());
  await row(1).focus(); await page.keyboard.press('Delete'); await settle();
  check('Delete로 줄을 지우면 data-step-out이 사라지고 번호가 당겨짐', (await rows.count()) === 2 && !/data-step-out/.test(fs.readFileSync(FILE, 'utf8').split('</section>')[1] || ''), await stepsOf());
  await row(1).getByRole('button', { name: /^Remove In animation/ }).click(); await settle();
  check('휴지통 단추로 줄을 지우면 그 요소의 단계 속성이 모두 사라짐', (await inDoc((s) => s.querySelectorAll('[data-step]').length)) === 1);
  await undo(); await undo(); await undo();
  check('지우기와 추가는 모두 실행 취소로 돌아옴', JSON.stringify(await stepsOf()) === JSON.stringify(base), [base, await stepsOf()]);

  if (process.env.SHOTS) { // 검토용 화면: 줄 넷(Click 묶음)과 인스펙터
    await sel(1, /^Start/).selectOption('with'); await settle();
    await row(0).getByRole('button').first().click(); await settle();
    await page.getByRole('button', { name: 'Out', exact: true }).click(); await settle();
    await row(2).getByRole('button').first().click(); await settle();
    await page.getByRole('button', { name: 'Out', exact: true }).click(); await settle();
    await row(0).getByRole('button', { name: /^Custom values/ }).click(); await settle();
    await shot('2-list-with-click-groups'); await page.getByRole('group', { name: 'In animation' }).scrollIntoViewIfNeeded(); await settle(); await shot('3-inspector');
    for (let i = 0; i < 3; i++) await undo();
  }
  // 노트 탭, 저장 글자 점검
  await page.getByRole('tab', { name: 'Notes' }).click(); await settle();
  await page.getByPlaceholder('Speaker notes (Markdown)').fill('ANIM-NOTE'); await saveDone();
  check('노트 탭은 이전처럼 동작', fs.readFileSync(FILE, 'utf8').includes('ANIM-NOTE'));
  check('재생 헤드와 전환 표시(data-shown, data-away, data-step-run, data-step-instant)는 저장 글자에 새지 않음', !/data-shown|data-away|data-step-run|data-step-instant/.test(fs.readFileSync(FILE, 'utf8')) && /data-step=/.test(fs.readFileSync(FILE, 'utf8')));
  // 밖에서(Claude 등) data-step을 바꾸면 목록이 따라온다
  await page.getByRole('tab', { name: 'Animation' }).click(); await settle();
  const disk = fs.readFileSync(FILE, 'utf8'), m = /data-step="(\d+)"/.exec(disk);
  fs.writeFileSync(FILE, disk.replace(m[0], 'data-step="7"'));
  check('밖에서 data-step을 바꾸면 줄 순서가 따라옴(7단계는 마지막이 되어 Click 2)', await cond(() => [...document.querySelectorAll('[data-testid=anim-row]')].map((e) => e.getAttribute('data-group')).join() === '1,2', null, 15000).then(() => true).catch(() => false), await page.getByTestId('anim-row').evaluateAll((es) => es.map((e) => e.getAttribute('data-group'))));
  // 접근성: Animation 탭(axe가 있을 때만)
  const axePath = process.env.AXE;
  if (axePath && fs.existsSync(axePath)) {
    await page.evaluate(fs.readFileSync(axePath, 'utf8'));
    const v = await page.evaluate(async () => { const r = await window.axe.run('#bottom-panel', { resultTypes: ['violations'] }); return r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => x.id + ':' + x.nodes.length); });
    check('Animation 탭 axe: serious와 critical 위반 없음', v.length === 0, v);
  } else console.log('!! axe 건너뜀(AXE=<axe.min.js>)');
  await finish();
})();
