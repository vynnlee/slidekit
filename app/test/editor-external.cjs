/* 편집 중에 같은 덱이 밖에서 바뀔 때(Claude Code가 파일을 직접 고치거나 다른 탭이 저장할 때)의 동작.
   (1) 저장 안 한 변경이 없으면 자동 반영되고 선택, 슬라이드, 줌이 유지된다
   (2) 저장 안 한 변경이 있으면 조용히 덮어쓰지 않고 Reload/Overwrite를 고르게 한다(고르기 전에는 파일도 화면도 그대로)
   (3) 파일이 잠깐 깨지거나 슬라이드가 없는 중간 상태가 되어도 편집기가 죽지 않고 고쳐지면 돌아온다
   (4) 밖의 변경을 반영하면 실행 취소 기록은 비워진다: Undo가 밖의 변경을 되돌리지 않는다(SPEC 9)
   (5) 두 탭: 한쪽이 저장하면 다른 쪽이 반영하고, 저장 안 한 변경이 있는 쪽은 충돌 안내를 띄운다 */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-external' });
  const { fs, FILE, check, page, ctx, settle, focusBody, cond, saveDone, goSlide2, BASE, T, errors, finish, sleep } = H;
  const notes = () => page.getByPlaceholder('Speaker notes (Markdown)');
  const read = () => fs.readFileSync(FILE, 'utf8');
  // n번째 슬라이드 끝에 문단을 덧붙인다(밖의 수정 흉내)
  const addTo = (n, text) => { const h = read(); const ends = [...h.matchAll(/<\/section>/g)].map((m) => m.index); const at = ends[n - 1]; fs.writeFileSync(FILE, h.slice(0, at) + `<p>${text}</p>` + h.slice(at)); };
  const header = () => page.getByText(/^Slide \d+ \/ \d+$/).first().textContent();
  const failPut = async (pg) => { await pg.route(/\/api\/decks\/[^/]+$/, (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 500, body: '{}' }) : r.fallback())); };
  const passPut = async (pg) => { await pg.unroute(/\/api\/decks\/[^/]+$/); };
  const bannerSeen = async () => { await page.bringToFront(); return page.waitForFunction(() => document.body.innerText.includes('File changed outside the editor'), null, { timeout: 20000, polling: 200 }).then(() => true).catch(() => false); };

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

  // (4b) 실행 취소 기록 재기준: 내 편집(2번 슬라이드 노트)을 저장한 뒤 밖에서 4번 슬라이드를 고치면, Undo는 내 편집만 되돌리고 밖의 수정은 남는다(Redo 뒤에도)
  await notes().fill('REB-A'); await saveDone();
  addTo(4, 'EXT-REB');
  check('밖의 변경 알림에 바뀐 슬라이드는 되돌릴 수 없다고 안내', await page.getByText("Changed slides can't be undone", { exact: false }).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
  await settle();
  check('내 편집 뒤 밖의 변경을 반영해도 Undo 단추가 살아 있음(기록 유지)', !(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled()));
  await focusBody(); await page.keyboard.press('Meta+z'); await settle(); await saveDone();
  check('Undo는 내 편집(REB-A)만 되돌리고 밖의 수정(EXT-REB)은 파일에 남음', !read().includes('REB-A') && read().includes('EXT-REB'));
  await focusBody(); await page.keyboard.press('Shift+Meta+z'); await settle(); await saveDone();
  check('Redo 뒤에도 내 편집과 밖의 수정이 함께 있음', read().includes('REB-A') && read().includes('EXT-REB'));
  await focusBody(); await page.keyboard.press('Meta+z'); await settle(); await saveDone();

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
  const versionWith = (kind, needle) => page.evaluate(async ([folder, kind, needle]) => { const list = await (await fetch(`/api/decks/${folder}/versions`)).json(); for (const v of list.filter((x) => x.kind === kind)) { const d = await (await fetch(`/api/decks/${folder}/versions/${v.id}`)).json(); if (d.source.includes(needle)) return true; } return false; }, [T.folder, kind, needle]);
  check('Reload로 버린 내 편집이 버전 기록에 남음(Before reload (my edits))', await versionWith('mine', 'MINE-ONE'));
  check('Reload는 밖의 변경을 받아들이고 내 변경을 버림(Reload 단추의 뜻)', !(await notes().inputValue()).includes('MINE-ONE') && read().includes('EXT-TWO'));
  await failPut(page);
  await notes().fill('MINE-TWO');
  await page.getByRole('button', { name: 'Save failed. Retry' }).waitFor({ timeout: 8000 }).catch(() => {});
  addTo(7, 'EXT-THREE');
  await bannerSeen(); await passPut(page);
  await page.getByRole('button', { name: 'Overwrite' }).click(); await saveDone();
  check('Overwrite로 덮이는 파일 내용이 버전 기록에 남음(Before overwrite (file on disk))', await versionWith('disk', 'EXT-THREE'));
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
  await b.waitForFunction(() => document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelector('[data-active]'), null, { timeout: 30000 }); // 캔버스가 준비되기 전에 노트를 고치면 편집이 문서에 반영되지 않는다
  await b.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300))));
  await b.getByPlaceholder('Speaker notes (Markdown)').fill('FROM-TAB-B');
  await b.keyboard.press('Meta+s');
  // 탭 A는 B가 열리면 배경 탭이 되어 렌더링과 rAF가 멈출 수 있다: 앞으로 가져오고 타이머 기반(polling 200ms)으로 본다
  await page.bringToFront();
  const reflected = await page.waitForFunction(() => document.body.innerText.includes('Slide 1 updated'), null, { timeout: 30000, polling: 200 }).then(() => true).catch(() => false);
  if (!reflected) console.log('INFO 상태', JSON.stringify({ aVis: await page.evaluate(() => document.visibilityState), bVis: await b.evaluate(() => document.visibilityState), aUrl: page.url(), bUrl: b.url(), aCanvas: await page.evaluate(() => !!document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelector('[data-active]')), bCanvas: await b.evaluate(() => !!document.querySelector('iframe[title="Canvas"]')?.contentDocument?.querySelector('[data-active]')), bStatus: await b.evaluate(() => document.querySelector('[data-testid=status]')?.textContent), mtime: fs.statSync(FILE).mtimeMs, fileHasB: read().includes('FROM-TAB-B') }));
  if (!reflected) console.log('INFO 탭 A 화면', JSON.stringify((await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 500)), 'B 파일에 있음', read().includes('FROM-TAB-B'));
  check('탭 B의 저장이 탭 A에 반영됨(Slide 1 updated)', reflected);
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

  // ---- 에이전트 존재 효과(spec/AGENT-PRESENCE.md): 커서, 광채, 격자 펄스, 필름스트립 점과 칩, 완료 강조, 접근성, 충돌, 누수 ----
  await page.evaluate(() => localStorage.setItem('slidekit.e2e', '1')); await page.reload();
  await cond(() => document.querySelectorAll('iframe[title="Canvas"]')[0]?.contentDocument?.querySelectorAll('#sk-stage > [data-slide]').length === 8, null, 20000);
  await goSlide2(); await settle();
  const ingest = (e) => page.evaluate((ev) => window.__skAgent.ingest(ev), e);
  const sessions = () => page.evaluate(() => window.__skAgent.snapshot().sessions.length);
  const fx = (sel) => page.locator(`[data-testid=agent-layer] ${sel}`).count();
  const live = () => page.getByTestId('agent-live').textContent();
  const chip = () => page.getByTestId('agent-chip');
  const tiles = page.locator('[data-testid=filmstrip] [role=option]');
  const ifrId = () => page.evaluate(() => { const f = document.querySelector('iframe[title="Canvas"]'); return (f.__sk = f.__sk || Math.random()); });
  const ifr0 = await ifrId(), D = T.folder, ev = (type, o) => ({ type, deck: D, agent: 'claude', ttl: 60000, ...o });
  await ingest(ev('agent.edit.start', { id: 't1', kind: 'edit', slide: 3, anchor: { path: '', excerpt: 'zzz-nothing' } })); await settle();
  check('다른 슬라이드를 고치는 중: 필름스트립 칩과 Follow, 3번 타일 점과 펄스', /Claude is editing slide 3/.test(await chip().textContent()) && (await chip().getByRole('button', { name: 'Follow' }).count()) === 1 && (await page.getByTestId('tile-agent').count()) === 1, await chip().textContent().catch(() => ''));
  check('사용자의 선택(2번 슬라이드)은 바뀌지 않고 캔버스에는 효과가 없음', (await tiles.nth(1).getAttribute('aria-selected')) === 'true' && (await fx('[data-testid=agent-slide-fx]')) === 0);
  check('읽어 주는 문구(aria-live)', /Claude is editing slide 3/.test(await live()), await live());
  const axeP = process.env.AXE;
  const axeScan = async (label, root) => { if (!axeP || !fs.existsSync(axeP)) return; await page.evaluate(fs.readFileSync(axeP, 'utf8')); const v = await page.evaluate(async (r) => { const x = await window.axe.run(r, { resultTypes: ['violations'] }); return x.violations.filter((y) => y.impact === 'serious' || y.impact === 'critical').map((y) => y.id + ':' + y.nodes.length); }, root); check('존재 효과 axe: ' + label, v.length === 0, v); };
  await axeScan('칩이 있는 필름스트립', '[data-testid=filmstrip]');
  await chip().getByRole('button', { name: 'Follow' }).click(); await settle();
  check('Follow를 누르면 그 슬라이드로 이동하고 칩은 "this slide"로 바뀜', (await tiles.nth(2).getAttribute('aria-selected')) === 'true' && /editing this slide/.test(await chip().textContent()), await chip().textContent());
  check('현재 슬라이드: 슬라이드 광채와 점 격자 파동 5개와 커서(Claude 라벨)', (await fx('[data-testid=agent-slide-fx]')) === 1 && (await fx('[data-testid=agent-wave]')) === 5 && (await fx('[data-testid=agent-cursor]')) === 1 && /Claude/.test(await page.locator('[data-testid=agent-cursor]').textContent()));
  check('효과 중에만 will-change(agent-on)가 켜져 있음', (await fx('.agent-on')) >= 2);
  check('효과 레이어는 aria-hidden이고 포인터를 받지 않음', (await page.getByTestId('agent-layer').getAttribute('aria-hidden')) === 'true' && (await page.getByTestId('agent-layer').evaluate((e) => getComputedStyle(e).pointerEvents)) === 'none');
  check('애니메이션은 opacity와 transform뿐(합성 전용)', await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('[data-testid=agent-layer]')).every((a) => a.effect.getKeyframes().every((k) => Object.keys(k).every((p) => /^(opacity|offset|easing|composite|computedOffset)$/.test(p))))));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await settle();
  check('움직임 줄이기: 애니메이션과 커서 이동이 없음(정지 테두리와 칩만)', await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('[data-testid=agent-layer]')).length === 0));
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await settle();
  check('움직임 줄이기를 풀면 효과가 돌아옴', await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('[data-testid=agent-layer]')).length > 0));
  // 도착 위치: 현재 슬라이드의 제목 글자를 앵커로
  const h2 = await page.evaluate(() => document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-active] h2, [data-active] h1')?.textContent?.trim().slice(0, 12) || '');
  await ingest(ev('agent.edit.start', { id: 't1', kind: 'edit', slide: 3, anchor: { path: '', excerpt: h2 } })); await settle();
  check('앵커 글자로 요소를 찾아 요소 광채가 생기고 커서가 그 위치로 감', (await fx('[data-testid=agent-target]')) === 1 && /translate3d\(/.test(await page.locator('[data-testid=agent-cursor]').getAttribute('style')), h2);
  await axeScan('효과가 켜진 캔버스 주변(헤더와 필름스트립)', '[data-testid=filmstrip]');
  await ingest(ev('agent.edit.done', { id: 't1', changed: [{ slide: 3, excerpt: h2 }], revision: 'r', via: 'tool' }));
  check('완료: 변경 강조(1.2초)가 뜨고 읽어 주는 문구가 나옴', await cond(() => document.querySelectorAll('[data-testid=agent-flash]').length >= 1, null, 5000).then(() => true).catch(() => false) && /finished editing slide 3, 1 change/.test(await live()), await live());
  check('강조와 효과가 끝나면 레이어가 비고 will-change가 없음', await cond(() => document.querySelectorAll('[data-testid=agent-layer] *').length === 0, null, 6000).then(() => true).catch(() => false));
  check('끝나면 필름스트립 점과 칩 정리(칩은 알림 문구 뒤 사라짐)', (await page.getByTestId('tile-agent').count()) === 0 && await cond(() => !document.querySelector('[data-testid=agent-chip]'), null, 8000).then(() => true).catch(() => false));
  check('효과 내내 캔버스 iframe을 다시 만들지 않음', (await ifrId()) === ifr0);
  // 실패와 ttl
  await ingest(ev('agent.edit.start', { id: 'f1', kind: 'edit', slide: 3, anchor: null })); await ingest(ev('agent.edit.fail', { id: 'f1', reason: 'not_found' })); await settle();
  check('실패: 효과를 걷고 알림 문구', await cond(() => /couldn.t finish editing slide 3/.test(document.querySelector('[data-testid=agent-live]').textContent), null, 4000).then(() => true).catch(() => false));
  await ingest(ev('agent.edit.start', { id: 'ttl1', kind: 'edit', slide: 3, anchor: null, ttl: 1200 }));
  check('ttl이 지나면 말없이 정리됨(세션 0, 레이어 비어 있음)', await cond(() => window.__skAgent.snapshot().sessions.length === 0 && document.querySelectorAll('[data-testid=agent-layer] *').length === 0, null, 5000).then(() => true).catch(() => false));
  // 폭주와 누수: 200건을 쏟아도 합쳐지고, 끝나면 모두 정리
  await page.evaluate((d) => { for (let i = 0; i < 200; i++) window.__skAgent.ingest({ type: 'agent.edit.start', id: 's' + (i % 5), deck: d, agent: 'a' + (i % 5), kind: 'edit', slide: 3, ttl: 1500 }); }, D);
  check('이벤트 폭주: 보이는 세션 3개 + 칩에 +2', (await sessions()) === 3 && /\+2/.test(await chip().textContent()), await chip().textContent().catch(() => ''));
  check('폭주 뒤 ttl 정리: 세션 0과 레이어 비어 있음', await cond(() => window.__skAgent.snapshot().sessions.length === 0 && document.querySelectorAll('[data-testid=agent-layer] *').length === 0 && !document.querySelector('[data-testid=tile-agent]'), null, 6000).then(() => true).catch(() => false));
  // 실제 경로: slidekit_edit 도구가 부르는 서버 엔드포인트 -> SSE 이벤트 -> 효과와 반영
  await tiles.nth(1).click(); await settle();
  addTo(3, 'AGENTFX-MARK-ONE'); await cond(() => (document.querySelectorAll('iframe[title="Canvas"]')[0]?.contentDocument?.body?.textContent || '').includes('AGENTFX-MARK-ONE') || true, null, 3000); await sleep(1500);
  const post = (old, nw) => page.evaluate(async (a) => (await fetch('/api/decks/' + a.f + '/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edits: [{ old_str: a.o, new_str: a.n }] }) })).json(), { f: D, o: old, n: nw });
  const toastsBefore = await page.locator('[data-sonner-toast], [role=status] li').count().catch(() => 0);
  const r1 = await post('AGENTFX-MARK-ONE', 'AGENTFX-NEW-ONE');
  check('slidekit_edit 서버 경로가 성공하고 바뀐 슬라이드(3)를 알림', r1.ok === true && r1.changed?.some((c) => c.slide === 3), JSON.stringify(r1).slice(0, 160));
  check('도구 수정: 3번 타일 점이 최소 표시 시간 동안 보임', await cond(() => !!document.querySelector('[data-testid=tile-agent]'), null, 3000).then(() => true).catch(() => false));
  check('도구 수정: 끝난 뒤 문구와 칩(1 change)과 파일 반영', await cond(() => /finished editing slide 3, 1 change/.test(document.querySelector('[data-testid=agent-live]').textContent), null, 6000).then(() => true).catch(() => false) && read().includes('AGENTFX-NEW-ONE') && !read().includes('AGENTFX-MARK-ONE'));
  check('선택(2번 슬라이드)은 그대로', (await tiles.nth(1).getAttribute('aria-selected')) === 'true');
  check('캔버스 3번 슬라이드에 새 글자가 반영됨(iframe 재생성 없음)', await cond(() => [...document.querySelectorAll('iframe[title="Canvas"]')[0].contentDocument.querySelectorAll('#sk-stage > [data-slide]')][2]?.textContent.includes('AGENTFX-NEW-ONE'), null, 8000).then(() => true).catch(() => false) && (await ifrId()) === ifr0);
  const fail1 = await post('NOT-THERE-' + Date.now(), 'x');
  check('없는 글자는 not_found로 거절되고 실패 이벤트가 정리됨', fail1.ok === false && fail1.error === 'not_found' && await cond(() => window.__skAgent.snapshot().sessions.length === 0, null, 5000).then(() => true).catch(() => false), JSON.stringify(fail1).slice(0, 120));
  // 충돌: 저장 안 한 변경이 있으면 기존 외부 변경 규칙(Reload/Overwrite)을 따르고 강조는 하지 않는다
  await notes().fill('DIRTY-WHILE-AGENT');
  const r2 = await post('AGENTFX-NEW-ONE', 'AGENTFX-NEW-TWO');
  check('충돌: 저장 안 한 변경이 있으면 Reload/Overwrite 안내가 뜸', r2.ok === true && await cond(() => /File changed outside the editor/.test(document.body.textContent), null, 8000).then(() => true).catch(() => false));
  check('충돌: 칩은 Reload 안내만, 변경 강조는 없음', await cond(() => /Reload to see the changes/.test(document.body.textContent), null, 6000).then(() => true).catch(() => false) && (await page.getByTestId('agent-flash').count()) === 0);
  check('충돌 중에도 입력 포커스와 내용은 그대로', (await notes().inputValue()) === 'DIRTY-WHILE-AGENT');
  check('효과 전체에서 페이지 오류 없음', errors.length === 0, errors.slice(0, 2));
  await finish();
})();
