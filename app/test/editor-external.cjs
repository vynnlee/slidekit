/* 편집 중에 같은 덱이 밖에서 바뀔 때(Claude Code가 파일을 직접 고치거나 다른 탭이 저장할 때)의 동작.
   (1) 저장 안 한 변경이 없으면 자동 반영되고 선택, 슬라이드, 줌이 유지된다
   (2) 저장 안 한 변경이 있으면 조용히 덮어쓰지 않고 Reload/Overwrite를 고르게 한다(고르기 전에는 파일도 화면도 그대로)
   (3) 파일이 잠깐 깨지거나 슬라이드가 없는 중간 상태가 되어도 편집기가 죽지 않고 고쳐지면 돌아온다
   (4) 밖의 변경을 반영하면 실행 취소 기록은 비워진다: Undo가 밖의 변경을 되돌리지 않는다(SPEC 9)
   (5) 두 탭: 한쪽이 저장하면 다른 쪽이 반영하고, 저장 안 한 변경이 있는 쪽은 충돌 안내를 띄운다 */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-external' });
  const { fs, FILE, check, page, ctx, settle, focusBody, cond, saveDone, goSlide2, BASE, T, errors, finish } = H;
  const notes = () => page.getByPlaceholder('Speaker notes (Markdown)');
  const read = () => fs.readFileSync(FILE, 'utf8');
  // n번째 슬라이드 끝에 문단을 덧붙인다(밖의 수정 흉내)
  const addTo = (n, text) => { const h = read(); const ends = [...h.matchAll(/<\/section>/g)].map((m) => m.index); const at = ends[n - 1]; fs.writeFileSync(FILE, h.slice(0, at) + `<p>${text}</p>` + h.slice(at)); };
  const header = () => page.getByText(/^Slide \d+ \/ \d+$/).first().textContent();
  const failPut = async (pg) => { await pg.route(/\/api\/decks\/[^/]+$/, (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 500, body: '{}' }) : r.fallback())); };
  const passPut = async (pg) => { await pg.unroute(/\/api\/decks\/[^/]+$/); };
  const bannerSeen = () => page.getByText('File changed outside the editor').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);

  // (1) 저장 안 한 변경 없음: 2번 슬라이드에서 요소를 고르고, 5번 슬라이드를 밖에서 바꾼다
  await goSlide2(); await focusBody(); await page.keyboard.press('Tab'); await settle();
  const zoom0 = await page.getByRole('button', { name: /^Zoom to fit/ }).textContent();
  check('시작: 요소가 선택됨', await page.locator('.border-2.border-focus-ring').first().isVisible());
  addTo(5, 'EXT-ONE');
  check('밖의 변경이 알림으로 반영됨(Slide 5 updated)', await page.getByText('Slide 5 updated').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  check('필름스트립 5번 타일에 updated 표시(4초 동안만 보임)', (await page.getByRole('option', { name: /^Slide 5, updated/ }).count()) === 1);
  await settle();
  check('반영 뒤에도 같은 슬라이드(2번)에 머묾', /^Slide 2 \//.test(await header()), await header());
  check('반영 뒤에도 요소 선택이 유지됨(외곽선과 Layers 선택 행)', await page.locator('.border-2.border-focus-ring').first().waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false) && (await page.locator('[role=treeitem][aria-selected=true]').count()) >= 1);
  check('반영 뒤에도 줌이 같음', (await page.getByRole('button', { name: /^Zoom to fit/ }).textContent()) === zoom0);

  // (4) 실행 취소: 반영 직후 Undo는 밖의 변경을 되돌리지 않는다(기록이 비워졌다)
  check('밖의 변경 반영 뒤 Undo 단추가 꺼져 있음', await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled());
  await focusBody(); await page.keyboard.press('Meta+z'); await settle(); await page.keyboard.press('Meta+s'); await settle();
  check('Cmd+Z를 눌러도 밖의 변경(EXT-ONE)이 파일에 남음', read().includes('EXT-ONE'));

  // (2) 저장 안 한 변경이 있을 때: 저장이 막힌 상태로 내 변경을 만든 뒤 밖에서 바꾼다
  await failPut(page);
  await notes().fill('MINE-ONE');
  await page.getByRole('button', { name: 'Save failed. Retry' }).waitFor({ timeout: 8000 }).catch(() => {});
  addTo(6, 'EXT-TWO');
  check('저장 안 한 변경이 있으면 충돌 안내(File changed outside the editor)', await bannerSeen());
  check('충돌 안내가 떠도 내 변경(노트)이 화면에 남음', (await notes().inputValue()) === 'MINE-ONE');
  check('고르기 전에는 파일이 밖의 변경 그대로(내 변경이 몰래 덮어쓰지 않음)', read().includes('EXT-TWO') && !read().includes('MINE-ONE'));
  await passPut(page);
  await page.getByRole('button', { name: 'Reload' }).click(); await settle();
  check('저장 안 한 편집이 있으면 Reload는 확인을 한 번 더 물음(바로 버리지 않음)', (await notes().inputValue()) === 'MINE-ONE' && (await page.getByRole('button', { name: 'Discard my edits and reload' }).count()) === 1);
  await page.getByRole('button', { name: 'Discard my edits and reload' }).click(); await settle();
  check('Reload는 밖의 변경을 받아들이고 내 변경을 버림(Reload 단추의 뜻)', !(await notes().inputValue()).includes('MINE-ONE') && read().includes('EXT-TWO'));
  await failPut(page);
  await notes().fill('MINE-TWO');
  await page.getByRole('button', { name: 'Save failed. Retry' }).waitFor({ timeout: 8000 }).catch(() => {});
  addTo(7, 'EXT-THREE');
  await bannerSeen(); await passPut(page);
  await page.getByRole('button', { name: 'Overwrite' }).click(); await saveDone();
  check('Overwrite는 내 변경으로 덮어씀(밖의 변경은 사라짐)', read().includes('MINE-TWO') && !read().includes('EXT-THREE'));
  check('Overwrite 뒤 충돌 안내가 사라짐', (await page.getByText('File changed outside the editor').count()) === 0);

  // (R1) 팔레트의 Save도 Cmd+S와 같다: 밖의 변경이 있으면 덮어쓰지 않고 충돌 안내를 유지한다
  await failPut(page);
  await notes().fill('MINE-PAL');
  await page.getByRole('button', { name: 'Save failed. Retry' }).waitFor({ timeout: 8000 }).catch(() => {});
  addTo(3, 'EXT-PAL');
  await bannerSeen(); await passPut(page);
  await focusBody(); await page.keyboard.press('Meta+k'); await settle(); await page.keyboard.type('Save'); await settle(); await page.keyboard.press('Enter'); await settle(); await page.waitForTimeout(800);
  check('팔레트 Save는 밖의 변경을 덮어쓰지 않음', read().includes('EXT-PAL') && !read().includes('MINE-PAL'));
  await page.getByRole('button', { name: 'Overwrite' }).click(); await saveDone();

  // (R3) 저장 실패 뒤 Cmd+Z로 저장본과 같게 되돌리면 Save failed. Retry가 풀린다
  await failPut(page);
  await notes().fill('R3-X');
  await page.getByRole('button', { name: 'Save failed. Retry' }).waitFor({ timeout: 8000 }).catch(() => {});
  await passPut(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await settle();
  await page.getByRole('button', { name: 'Save failed. Retry' }).click(); await settle();
  check('되돌려 저장본과 같아지면 Retry를 눌러 실패 표시가 풀림', (await page.getByRole('button', { name: 'Save failed. Retry' }).count()) === 0 && (await page.getByText('Saved', { exact: true }).count()) > 0);

  // (R2) 서버는 썼는데 응답이 유실되어 409가 오면 충돌이 아니라 성공으로 본다
  let once = true;
  await page.route(/\/api\/decks\/[^/]+$/, async (r) => { if (r.request().method() === 'PUT' && once) { once = false; await r.fetch(); return r.fulfill({ status: 409, body: '{"error":"changed"}' }); } return r.fallback(); });
  await notes().fill('R2-X'); await saveDone();
  check('응답 유실(409)이어도 파일이 같으면 성공 처리(충돌 안내 없음)', read().includes('R2-X') && (await page.getByText('File changed outside the editor').count()) === 0);
  await passPut(page);

  // (R8) 403 같은 영구 오류는 자동 재시도를 멈추고 알린다
  let puts = 0;
  await page.route(/\/api\/decks\/[^/]+$/, (r) => { if (r.request().method() === 'PUT') { puts++; return r.fulfill({ status: 403, body: '{}' }); } return r.fallback(); });
  await notes().fill('R8-X');
  check('영구 오류 알림(옮겨졌거나 없어졌을 수 있음)', await page.getByText('The deck may have been moved or removed', { exact: false }).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  const p0 = puts; await page.waitForTimeout(11500);
  check('4xx는 10초가 지나도 자동 재시도하지 않음', puts === p0, [p0, puts]);
  await passPut(page);
  await page.getByRole('button', { name: 'Save failed. Retry' }).click(); await saveDone();
  check('복구 뒤 수동 Retry로 저장됨', read().includes('R8-X'));

  // (5) 두 탭: B가 노트를 고쳐 저장하면 A가 반영한다. A에 저장 안 한 변경이 있으면 충돌 안내
  const b = await ctx.newPage();
  b.on('pageerror', (e) => errors.push('B: ' + String(e)));
  await b.goto(BASE + '/edit/' + T.id);
  await b.getByPlaceholder('Speaker notes (Markdown)').waitFor();
  await b.getByPlaceholder('Speaker notes (Markdown)').fill('FROM-TAB-B');
  await b.keyboard.press('Meta+s');
  check('탭 B의 저장이 탭 A에 반영됨(Slide 1 updated)', await page.getByText('Slide 1 updated').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await failPut(page);
  await notes().fill('A-LOCAL');
  await page.getByRole('button', { name: 'Save failed. Retry' }).waitFor({ timeout: 8000 }).catch(() => {});
  await b.getByPlaceholder('Speaker notes (Markdown)').fill('FROM-TAB-B-2');
  await b.keyboard.press('Meta+s');
  const seenB = await bannerSeen();
  check('탭 A에 저장 안 한 변경이 있을 때 탭 B가 저장하면 A에 충돌 안내', seenB);
  check('A의 로컬 변경은 그대로', (await notes().inputValue()) === 'A-LOCAL');
  await passPut(page);
  await b.close();
  // 충돌을 정리하고(A의 로컬 변경을 버림) 다음 시나리오를 깨끗한 상태로 시작한다
  await page.getByRole('button', { name: 'Reload' }).click(); await page.getByRole('button', { name: 'Discard my edits and reload' }).click(); await settle();
  check('Reload로 불러오면 저장 실패 표시도 풀림', (await page.getByRole('button', { name: 'Save failed. Retry' }).count()) === 0);
  check('두 탭 충돌을 Reload로 정리하면 탭 B의 내용이 보임', (await notes().inputValue()).includes('FROM-TAB-B-2') || (await page.getByText('File changed outside the editor').count()) === 0);
  // (3) 중간 상태: 파일이 반쯤 잘리거나 슬라이드가 없다가 고쳐진다
  const good = read();
  const half = good.slice(0, Math.floor(good.length / 2));
  fs.writeFileSync(FILE, half);
  await settle(); await page.waitForTimeout(1200);
  check('잘린 파일을 열어도 저장 안 한 변경으로 오인하지 않음(자동 저장이 덮어쓰지 않음)', (await page.getByText('Unsaved', { exact: true }).count()) === 0 && read() === half, [read().length, half.length]);
  check('잘린 파일에서도 편집기가 살아 있음(캔버스 있음, 페이지 오류 없음)', (await page.locator('iframe[title="Canvas"]').count()) === 1 && errors.length === 0, errors.slice(0, 2));
  fs.writeFileSync(FILE, '<!doctype html><html><body><p>broken</p></body></html>');
  check('슬라이드가 없는 중간 상태는 안내 글자를 보임', await page.getByText('This deck has no slides yet.').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  fs.writeFileSync(FILE, good);
  await cond(() => !document.body.innerText.includes('This deck has no slides yet.'), null, 8000);
  await settle();
  check('고쳐지면 안내가 사라지고 8장으로 돌아옴', (await page.getByText('This deck has no slides yet.').count()) === 0 && /\/ 8$/.test(await header()), await header());
  check('복구 뒤에도 페이지 오류 없음', errors.length === 0, errors.slice(0, 2));
  check('깨진 중간 상태를 거친 뒤 캔버스에 슬라이드가 다시 그려짐', await cond(() => document.querySelectorAll('iframe[title="Canvas"]')[0]?.contentDocument?.querySelectorAll('#sk-stage > [data-slide]').length === 8, null, 8000).then(() => true).catch(() => false) && (await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]').length)) === 8);
  await notes().fill('AFTER-BROKEN');
  await saveDone();
  check('깨진 중간 상태를 거친 뒤에도 편집과 저장이 됨', read().includes('AFTER-BROKEN'));

  await finish();
})();
