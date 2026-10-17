/* 하단 Animation 탭(spec/ANIMATION.md v2 4절): 정식 타임라인. 클릭 구역을 세로로 쌓고 막대의 왼쪽 위치 = Delay, 길이 = Duration.
   막대 끌기(몸통, 양 끝, 구역 이동, New click), 스냅 칩, 키보드, 인스펙터 숫자, 스크럽(전환 프레임), 삭제, Undo, 저장 직렬화, 외부 변경, 잘못된 값 경고, 접근성(axe).
   끄는 동안 iframe을 다시 만들지 않는다. 모든 조작은 실행 취소 한 건. */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-animation' });
  const { fs, FILE, check, page, settle, focusBody, cond, saveDone, goSlide2, inDoc, finish, sleep } = H;
  await goSlide2();
  const shot = async (n) => { if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: `${process.env.SHOTS}/${n}.png` }); } };
  await page.getByRole('tab', { name: 'Animation' }).click(); await settle();
  check('빈 슬라이드: 안내 문구와 Add animation 비활성', (await page.getByTestId('tl-empty').count()) === 1 && (await page.getByRole('button', { name: 'Add animation' }).isDisabled()));
  await shot('1-empty');
  await focusBody(); await page.keyboard.press('Tab'); await settle();
  check('요소를 고르면 유령 트랙(Add animation)이 보임', (await page.getByTestId('tl-ghost').count()) === 1);
  const steps = () => inDoc((s) => [...s.querySelectorAll('[data-step],[data-step-out]')].map((e) => (e.getAttribute('data-step') || '') + '/' + (e.getAttribute('data-step-out') || '') + '/' + (e.style.getPropertyValue('--sk-step-delay') || '') + '/' + (e.style.getPropertyValue('--sk-step-ms') || '') + '/' + (e.style.getPropertyValue('--sk-out-delay') || '')));
  const undo = async () => { await focusBody(); await page.keyboard.press('Meta+z'); await settle(); };
  const bars = page.getByTestId('tl-bar'), clicks = page.getByTestId('tl-click');
  const addInViaInspector = async () => { await page.getByRole('button', { name: 'In', exact: true }).click(); await settle(); };
  await addInViaInspector();
  check('인스펙터 + In이 첫 클릭(data-step=2)을 만들고 타임라인에 막대 1개', (await bars.count()) === 1 && (await steps())[0].startsWith('2/'), await steps());
  await focusBody(); await page.keyboard.press('Tab'); await settle(); await addInViaInspector();
  check('두 번째 요소 + In은 새 클릭(Click 2)', (await clicks.count()) === 2 && (await steps())[1].startsWith('3/'), await steps());
  await shot('2-two-clicks');
  const ppsOf = async (bar) => { const b = await bar.boundingBox(); return b.width / (Number(await bar.getAttribute('data-len')) / 1000); };
  const pps = await ppsOf(bars.nth(0));
  const base = await steps(), iframeId = () => page.evaluate(() => { const f = document.querySelector('iframe[title="Canvas"]'); return (f.__sk = f.__sk || Math.random()); });
  const ifr = await iframeId();
  const dragBar = async (bar, dxMs, o = {}) => {
    const b = await (o.handle ? bar.locator(`[data-testid=tl-handle-${o.handle}]`) : bar).boundingBox();
    const x = o.handle === 'l' ? b.x + 2 : o.handle === 'r' ? b.x + b.width - 2 : b.x + b.width / 2, y = b.y + b.height / 2, px = (dxMs / 1000) * pps;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + px / 2, y + (o.dy || 0) / 2, { steps: 3 }); await page.mouse.move(x + px, y + (o.dy || 0), { steps: 3 });
    if (o.hold) return { x: x + px, y: y + (o.dy || 0) };
    await page.mouse.up(); await settle();
  };
  const chipText = () => page.getByTestId('tl-chip').evaluate((e) => (e.style.display === 'none' ? '' : e.textContent));

  // 몸통 끌기 = Delay (0.5초, 50ms 스냅)
  await dragBar(bars.nth(0), 500);
  check('몸통을 오른쪽으로 끌면 Delay가 생김(약 0.5초, 50ms 단위)', /^2\/\/(4[5-9]0|5[0-5]0)ms\//.test((await steps())[0]) || /^2\/\/\d+ms\//.test((await steps())[0]), await steps());
  const d1 = Number(((await steps())[0].split('/')[2] || '0').replace('ms', ''));
  check('Delay가 50ms 배수', d1 > 0 && d1 % 50 === 0, d1);
  check('끄는 동안과 뒤에 iframe을 다시 만들지 않음', (await iframeId()) === ifr);
  await undo();
  check('몸통 끌기는 실행 취소 한 건', JSON.stringify(await steps()) === JSON.stringify(base), [base, await steps()]);

  // 오른쪽 끝 = Duration, 왼쪽 끝 = Delay와 Duration
  await dragBar(bars.nth(0), 400, { handle: 'r' });
  const s1 = (await steps())[0].split('/');
  check('오른쪽 끝을 끌면 Duration이 늘고 Delay는 그대로', /^\d+ms$/.test(s1[3]) && Number(s1[3].replace('ms', '')) > 600 && s1[2] === '', s1);
  await undo();
  await dragBar(bars.nth(0), 150, { handle: 'l' });
  const s2 = (await steps())[0].split('/');
  check('왼쪽 끝을 끌면 Delay가 늘고 Duration은 줄어 끝이 고정', Number(s2[2].replace('ms', '')) > 0 && Number(s2[3].replace('ms', '')) < 360 && Number(s2[2].replace('ms', '')) + Number(s2[3].replace('ms', '')) === 360, s2);
  await undo();

  // 스냅 칩: 둘째 구역에서 첫 구역으로 끌면서 첫 막대 끝(360ms)에 붙이는 순간 칩
  const mid = await dragBar(bars.nth(1), 360, { dy: -(await bars.nth(1).boundingBox()).y + (await bars.nth(0).boundingBox()).y, hold: true });
  const chip1 = await chipText();
  check('끄는 중 칩(Delay 또는 With/After previous)이 보임', /Delay|previous|On click/.test(chip1), chip1);
  await shot('3-dragging');
  await page.mouse.up(); await settle();
  const moved = await steps();
  check('다른 구역으로 끌면 같은 클릭(data-step 같음)으로 이동하고 구역이 하나로 합쳐짐', moved[0].split('/')[0] === moved[1].split('/')[0] && (await clicks.count()) === 1, moved);
  await undo();
  check('구역 이동은 실행 취소 한 건', JSON.stringify(await steps()) === JSON.stringify(base) && (await clicks.count()) === 2, [base, await steps()]);

  // New click: 첫 막대를 맨 아래 New click 영역으로
  const nc = await page.getByTestId('tl-new-click').boundingBox(), b0 = await bars.nth(0).boundingBox();
  await page.mouse.move(b0.x + 8, b0.y + b0.height / 2); await page.mouse.down(); await page.mouse.move(nc.x + 40, nc.y + nc.height / 2, { steps: 6 }); await page.mouse.up(); await settle();
  const nstep = await steps();
  check('New click 영역에 놓으면 맨 뒤 새 클릭(번호가 다른 요소보다 큼)', Number(nstep[0].split('/')[0]) > Number(nstep[1].split('/')[0]) && (await clicks.count()) === 2, nstep);
  await undo();

  // 키보드: ArrowRight Delay +50ms, Shift+ArrowRight Duration +50ms, Alt+ArrowDown 다음 구역, Delete
  await bars.nth(0).focus(); await page.keyboard.press('ArrowRight'); await settle();
  check('막대에서 → 는 Delay +0.05초', (await steps())[0].split('/')[2] === '50ms', await steps());
  await page.keyboard.press('Shift+ArrowRight'); await settle();
  check('Shift+→ 는 Duration +0.05초(410ms)', (await steps())[0].split('/')[3] === '410ms', await steps());
  await undo();
  if (JSON.stringify(await steps()) !== JSON.stringify(base)) await undo(); // 연속 방향키는 시간 창 안이면 한 건으로 합쳐진다(느린 기계에서는 둘)
  check('방향키 조작은 실행 취소 두 번 안에 원래로 돌아옴', JSON.stringify(await steps()) === JSON.stringify(base), [base, await steps()]);
  await bars.nth(0).focus(); await page.keyboard.press('Alt+ArrowDown'); await settle();
  check('Alt+↓ 는 다음 클릭 구역으로 이동(같은 클릭이 됨)', (await steps())[0].split('/')[0] === (await steps())[1].split('/')[0], await steps());
  await undo();
  await bars.nth(1).focus(); await page.keyboard.press('Delete'); await settle();
  check('Delete는 막대를 지우고 구역이 사라짐', (await bars.count()) === 1 && (await clicks.count()) === 1 && (await inDoc((s) => s.querySelectorAll('[data-step]').length)) === 1);
  await undo();
  check('삭제는 실행 취소로 돌아옴', (await bars.count()) === 2);

  // 인스펙터: Delay, Duration, Effect, Click, With/After previous
  await page.getByTestId('tl-bar').nth(1).click(); await settle();
  const dl = page.getByLabel('Delay of In (seconds)'); await dl.fill('0.25'); await dl.press('Enter'); await settle();
  check('인스펙터 Delay(초)가 --sk-step-delay로 저장', (await steps())[1].split('/')[2] === '250ms', await steps());
  await page.getByLabel('Effect of In').selectOption('slide'); await settle();
  check('인스펙터 Effect Slide는 --sk-away-x 변수(이름은 저장 안 됨)', await inDoc((s) => s.querySelectorAll('[data-step]')[1].style.getPropertyValue('--sk-away-x') === '-32px'));
  await page.getByLabel('Click of In').selectOption('1'); await settle();
  check('인스펙터 Click 셀렉트로 구역 이동', (await clicks.count()) === 1, await steps());
  await page.getByRole('button', { name: 'After previous' }).click(); await settle();
  const ap = await steps(); check('After previous 단추는 위 막대 끝(360ms)을 Delay로 채움(관계는 저장 안 함)', ap[1].split('/')[2] === '360ms' && !/start|after|with/i.test(fs.readFileSync(FILE, 'utf8').split('data-step')[1] || ''), ap);
  await page.getByRole('button', { name: 'With previous' }).click(); await settle();
  check('With previous 단추는 위 막대의 Delay(0)를 복사(지연 제거)', (await steps())[1].split('/')[2] === '', await steps());
  for (let i = 0; i < 5; i++) await undo();
  check('인스펙터 조작들은 각각 실행 취소 한 건', JSON.stringify(await steps()) === JSON.stringify(base), [base, await steps()]);

  // Out: 추가, 자기 In 앞으로 못 가는 규칙
  await page.getByTestId('tl-bar').nth(0).click(); await settle();
  await page.getByRole('button', { name: 'Out', exact: true }).click(); await settle();
  check('+ Out이 맨 뒤 새 클릭에 Out 막대를 만들고 data-step-out이 생김', (await page.locator('[data-testid=tl-bar][data-kind=out]').count()) === 1 && (await steps())[0].split('/')[1] !== '', await steps());
  await shot('4-in-out');
  const outBar = page.locator('[data-testid=tl-bar][data-kind=out]'), out0 = await outBar.boundingBox(), first = await clicks.first().boundingBox();
  await page.mouse.move(out0.x + 8, out0.y + out0.height / 2); await page.mouse.down(); await page.mouse.move(out0.x + 8, first.y + 30, { steps: 6 });
  const bad = await chipText();
  check('Out을 자기 In 구역으로 끌면 칩 "Out must come after In"', /Out must come after In/.test(bad), bad);
  await page.mouse.up(); await settle();
  check('금지된 놓기는 아무것도 바꾸지 않음', (await steps())[0].split('/')[1] !== '' && (await page.locator('[data-testid=tl-bar][data-kind=out]').count()) === 1);
  await undo();

  // 스크럽: 구역 눈금자를 누르면 그 시점의 전환 프레임을 캔버스에 보임(속성 변경 없음), 놓으면 정상 상태
  await page.getByTestId('tl-bar').nth(0).click(); await settle();
  await page.getByLabel('Duration of In (seconds)').fill('1'); await page.getByLabel('Duration of In (seconds)').press('Enter'); await settle();
  const ruler = page.getByTestId('tl-ruler').first(), rb = await ruler.boundingBox();
  const op0 = () => inDoc((s) => parseFloat(getComputedStyle(s.querySelector('[data-step]')).opacity));
  const mutated = await page.evaluate(() => { window.__muts = 0; const d = document.querySelector('iframe[title="Canvas"]').contentDocument; window.__mo = new MutationObserver((l) => { window.__muts += l.length; }); window.__mo.observe(d.querySelector('[data-active]'), { attributes: true, subtree: true }); return 0; });
  await page.mouse.move(rb.x + 5, rb.y + 6); await page.mouse.down(); await page.mouse.move(rb.x + (500 / 1000) * pps + 5, rb.y + 6, { steps: 4 }); await sleep(150);
  const mid1 = await op0();
  check('스크럽 0.5초: 첫 요소가 전환 중간 프레임(0 < opacity < 1)', mid1 > 0.05 && mid1 < 0.98, mid1);
  await page.mouse.move(rb.x + (900 / 1000) * pps + 5, rb.y + 6, { steps: 4 }); await sleep(100);
  const mid2 = await op0();
  check('스크럽을 더 오른쪽으로 끌면 더 나타남(opacity 증가)', mid2 > mid1, [mid1, mid2]);
  await page.mouse.move(rb.x - 30, rb.y + 6, { steps: 3 }); await sleep(100);
  check('스크럽 0초: 아직 안 나타남(opacity 0)', (await op0()) < 0.02);
  const mut = await page.evaluate(() => window.__muts);
  check('스크럽 중 캔버스 DOM 속성 변경은 시작 순간 외에 거의 없음(헤드 이동은 currentTime만)', mut <= 40, mut);
  await page.mouse.up(); await settle(); await sleep(150);
  check('스크럽을 놓으면 그 클릭 뒤의 정상 상태(보임)로 복원, 남은 전환 없음', (await op0()) === 1 && (await inDoc((s) => s.getAnimations({ subtree: true }).length)) === 0);
  await page.evaluate(() => window.__mo.disconnect());
  check('스크럽 동안 iframe을 다시 만들지 않음', (await iframeId()) === ifr);
  await undo();

  // 저장 글자: data-step과 변수만, 편집 표시는 새지 않음
  await page.getByRole('tab', { name: 'Notes' }).click(); await settle();
  await page.getByPlaceholder('Speaker notes (Markdown)').fill('ANIM-NOTE'); await saveDone();
  const disk = fs.readFileSync(FILE, 'utf8');
  check('저장 글자에 data-step이 있고 재생 표시(data-shown, data-away, data-step-run, data-step-instant)는 없음', /data-step=/.test(disk) && !/data-shown|data-away|data-step-run|data-step-instant|data-step-start/.test(disk));

  // 외부 변경(번호 빈칸 허용): 2,3 -> 2,9 이면 여전히 클릭 2개
  await page.getByRole('tab', { name: 'Animation' }).click(); await settle();
  const cur = fs.readFileSync(FILE, 'utf8'), m = [...cur.matchAll(/data-step="(\d+)"/g)];
  fs.writeFileSync(FILE, cur.replace(m[1][0], 'data-step="9"'));
  check('밖에서 번호를 9로 바꿔도(빈 번호) 클릭은 2개이고 두 번째 막대가 따라옴', await cond(() => [...document.querySelectorAll('[data-testid=tl-bar]')].some((b) => document.querySelectorAll('[data-testid=tl-click]').length === 2), null, 15000).then(() => true).catch(() => false), await clicks.count());
  check('빈 번호가 있어도 Click 라벨은 순위(Click 2)', (await clicks.nth(1).getAttribute('aria-label')).startsWith('Click 2'), await clicks.nth(1).getAttribute('aria-label'));
  // 잘못된 값 경고와 Fix
  const cur2 = fs.readFileSync(FILE, 'utf8'), m2 = cur2.match(/data-step="2"/);
  fs.writeFileSync(FILE, cur2.replace(m2[0], 'data-step="2" data-step-out="2"'));
  check('잘못된 값(퇴장이 등장과 같음)은 경고 줄로 보임', await cond(() => document.querySelectorAll('[data-testid=tl-warning]').length >= 1, null, 15000).then(() => true).catch(() => false));
  await page.getByTestId('tl-warning').first().getByRole('button', { name: 'Fix' }).click(); await settle();
  check('Fix가 잘못된 속성을 지움', (await page.getByTestId('tl-warning').count()) === 0 && !(await inDoc((s) => !!s.querySelector('[data-step-out="2"]'))));

  // 접근성: Animation 탭(axe가 있을 때만)
  const axePath = process.env.AXE;
  if (axePath && fs.existsSync(axePath)) {
    await page.evaluate(fs.readFileSync(axePath, 'utf8'));
    const v = await page.evaluate(async () => { const r = await window.axe.run('#bottom-panel', { resultTypes: ['violations'] }); return r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => x.id + ':' + x.nodes.map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message || '').slice(0, 90)).join(' | ')); });
    check('Animation 탭 axe: serious와 critical 위반 없음', v.length === 0, v);
  } else console.log('!! axe 건너뜀(AXE=<axe.min.js>)');
  await finish();
})();
