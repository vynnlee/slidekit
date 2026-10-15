/* 하단 Animation 탭(spec/ANIMATION.md 4절): 단계 격자와 막대. 막대 끌기가 data-step과 data-step-out을 바꾸고 실행 취소 한 건으로 되돌아가며,
   머리글 클릭이 캔버스를 그 단계 상태로 바꾸고, 키보드로도 조작된다. 끄는 동안 iframe을 다시 만들지 않는다. */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-animation' });
  const { fs, FILE, check, page, settle, focusBody, cond, saveDone, goSlide2, inDoc, finish } = H;
  await goSlide2(); await focusBody(); await page.keyboard.press('Tab'); await settle();
  // 요소 둘에 등장 단계를 준다(Inspector의 칸)
  const setStep = async (n) => { const f = page.getByLabel('Appears at step', { exact: true }); await f.fill(String(n)); await f.press('Enter'); await settle(); };
  await setStep(3);
  await focusBody(); await page.keyboard.press('Tab'); await settle(); await setStep(2);
  await page.getByRole('tab', { name: 'Animation' }).click(); await settle();
  const bars = page.getByTestId('anim-bar');
  check('Animation 탭에 단계 있는 요소마다 막대가 있음', (await bars.count()) === 2, await bars.count());
  check('막대 이름에 등장 단계가 읽힘(접근성)', /appears at step 3/.test((await bars.nth(0).getAttribute('aria-label')) || '') && /appears at step 2/.test((await bars.nth(1).getAttribute('aria-label')) || ''), [await bars.nth(0).getAttribute('aria-label'), await bars.nth(1).getAttribute('aria-label')]);
  check('격자 머리글과 재생 헤드 표시(기본은 마지막 단계)', (await page.getByTestId('anim-step-label').textContent()) === 'Step 3 of 3');
  const stepsOf = () => inDoc((s) => [...s.querySelectorAll('[data-step]')].map((e) => e.getAttribute('data-step') + '/' + (e.getAttribute('data-step-out') || '')));
  const before = await stepsOf();
  const iframeId = () => page.evaluate(() => { const f = document.querySelector('iframe[title="Canvas"]'); return (f.__sk = f.__sk || Math.random()); });
  const ifr = await iframeId();

  // 왼쪽 끝을 한 칸 왼쪽으로 끌면 등장이 한 단계 앞당겨진다(첫 막대: 3 -> 2)
  const drag = async (el, dx, handle) => {
    const b = await (handle ? el.locator(`[data-testid=anim-handle-${handle}]`) : el).boundingBox();
    const x = handle === 'in' ? b.x + 2 : handle === 'out' ? b.x + b.width - 2 : b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 3 }); await page.mouse.move(x + dx, y, { steps: 3 }); await page.mouse.up(); await settle();
  };
  const colW = (await page.getByTestId('anim-scroll').locator('[role=columnheader] button').first().boundingBox()).width;
  await drag(bars.nth(0), -colW, 'in');
  check('왼쪽 끝을 끌면 data-step이 바뀜(3 -> 2)', (await stepsOf())[0].startsWith('2/'), await stepsOf());
  check('끄는 동안 캔버스 iframe을 다시 만들지 않음', (await iframeId()) === ifr);
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  check('막대 끌기는 실행 취소 한 건', JSON.stringify(await stepsOf()) === JSON.stringify(before), [before, await stepsOf()]);

  // 오른쪽 끝을 왼쪽으로 끌면 퇴장이 생긴다(마지막 단계 직전까지)
  await drag(bars.nth(1), -colW, 'out');
  check('오른쪽 끝을 끌면 data-step-out이 생김', (await stepsOf())[1].endsWith('/3'), await stepsOf());
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();

  // 몸통을 끌면 같은 간격으로 이동(둘째 막대 2 -> 3은 마지막 단계 안)
  await drag(bars.nth(1), colW);
  check('몸통을 끌면 등장 단계가 이동함', (await stepsOf())[1].startsWith('3'), await stepsOf());
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();

  // 머리글 클릭: 재생 헤드가 그 단계로 가고 캔버스가 그 단계 상태를 보인다
  const vis = (i) => inDoc((s, ix) => getComputedStyle([...s.querySelectorAll('[data-step]')][ix]).visibility, i);
  await page.getByRole('button', { name: 'Step 1', exact: true }).click(); await settle();
  check('Step 1 머리글을 누르면 단계 요소가 숨음', (await vis(0)) === 'hidden' && (await vis(1)) === 'hidden', [await vis(0), await vis(1)]);
  check('재생 헤드 표시가 Step 1 of 3', (await page.getByTestId('anim-step-label').textContent()) === 'Step 1 of 3');
  await page.getByRole('button', { name: 'Step 2', exact: true }).click(); await settle();
  check('Step 2에서는 2단계 요소만 보임', (await vis(0)) === 'hidden' && (await vis(1)) === 'visible', [await vis(0), await vis(1)]);
  await page.getByRole('button', { name: 'Step 3', exact: true }).click(); await settle();
  check('Step 3에서는 모두 보임', (await vis(0)) === 'visible' && (await vis(1)) === 'visible');

  // 키보드: 막대에 포커스, 오른쪽 방향키는 몸통을 한 칸, Delete는 단계 속성을 지움
  await bars.nth(1).focus(); await page.keyboard.press('ArrowRight'); await settle();
  check('막대에서 오른쪽 방향키는 한 단계 뒤로', (await stepsOf())[1].startsWith('3'), await stepsOf());
  await page.keyboard.press('Delete'); await settle();
  check('Delete는 그 요소의 단계 속성을 지움', (await inDoc((s) => s.querySelectorAll('[data-step]').length)) === 1);
  await focusBody(); await page.keyboard.press('Meta+z'); await page.keyboard.press('Meta+z'); await settle();

  // + Step: 빈 단계를 하나 더 만든다
  await page.getByRole('button', { name: 'Add step' }).click(); await settle();
  check('+ Step이 빈 단계를 더함(Step 3 of 4)', /of 4$/.test(await page.getByTestId('anim-step-label').textContent()) || (await page.getByRole('button', { name: 'Step 4', exact: true }).count()) === 1);

  // 노트 탭으로 돌아가도 노트 입력이 그대로 동작
  await page.getByRole('tab', { name: 'Notes' }).click(); await settle();
  await page.getByPlaceholder('Speaker notes (Markdown)').fill('ANIM-NOTE'); await saveDone();
  check('노트 탭은 이전처럼 동작', fs.readFileSync(FILE, 'utf8').includes('ANIM-NOTE'));
  check('재생 헤드와 전환 표시(data-shown, data-away, data-step-run, data-step-instant)는 저장 글자에 새지 않음', !/data-shown|data-away|data-step-run|data-step-instant/.test(fs.readFileSync(FILE, 'utf8')) && /data-step=/.test(fs.readFileSync(FILE, 'utf8')));
  await finish();
})();
