/* 편집기 브라우저 검증: 넘침 표시와 안전 영역, 덱 전체 찾기와 바꾸기, 덱 설정, 이미지 붙여넣기와 끌어 놓기.
   하네스(lib/editor-harness.cjs)가 작은 덱 사본을 만들고 편집기를 한 번 열어 준다. Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3200 node editor-assets.cjs */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-assets' });
  const { fs, path, T, FILE, N0, sleep, check, page, settle, focusBody, fr, frameEl, cond, saveDone, unsaved, n, stageCount, layers, inDoc, nKids, rowsL, goSlide2 } = H;
  // 넘침 표시: 슬라이드 밖으로 나가면 캔버스 점선 외곽선, Layers 경고, 필름스트립 표시가 뜨고 안전 영역을 켤 수 있다
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  await fr().locator('[data-active] h2').first().click({ modifiers: ['Meta'] }); await settle();
  const offXo = page.getByLabel('Offset X', { exact: true }); await offXo.fill('3000'); await offXo.press('Enter');
  await cond(() => document.querySelectorAll('[data-testid=overflow-badge]').length > 0, null, 8000); // 검사는 0.6초 주기라 Layers 경고가 뜰 때까지 기다린다
  check('넘친 요소에 점선 외곽선이 그려짐', (await page.getByTestId('overflow-box').evaluateAll((els) => els.filter((e) => e.style.display === 'block').length)) >= 1);
  check('Layers 행에 경고 아이콘', (await page.getByTestId('overflow-badge').count()) >= 1);
  check('필름스트립 타일에 넘침 표시', (await page.getByRole('img', { name: 'Content overflows' }).count()) >= 1);
  await page.getByRole('button', { name: 'Show overflow' }).click(); await settle();
  check('Show overflow를 끄면 외곽선이 사라짐', (await page.getByTestId('overflow-box').evaluateAll((els) => els.filter((e) => e.style.display === 'block').length)) === 0);
  await page.getByRole('button', { name: 'Show overflow' }).click();
  await page.getByRole('button', { name: 'Safe area' }).click(); await settle();
  check('안전 영역 가이드가 보임', await page.getByTestId('safe-area').evaluate((e) => e.style.display === 'block'));
  await page.getByRole('button', { name: 'Safe area' }).click();
  await offXo.fill('0'); await offXo.press('Enter'); await settle(); // 오프셋을 되돌린다
  await cond(() => document.querySelectorAll('[data-testid=overflow-badge]').length === 0, null, 8000);
  check('되돌리면 경고가 사라짐', (await page.getByTestId('overflow-badge').count()) === 0);
  await page.keyboard.press('Escape');

  // 찾기와 바꾸기(Cmd+F): 슬라이드별 일치 수, 다음으로 이동, 바꾸기와 모두 바꾸기(실행 취소 한 건), 노트 옵션
  await focusBody(); await page.keyboard.press('Meta+f');
  const findIn = page.getByLabel('Find', { exact: true });
  await findIn.waitFor({ timeout: 5000 }).catch(() => {});
  check('Cmd+F가 찾기 줄을 열고 포커스', await findIn.evaluate((e) => document.activeElement === e));
  const fieldMetrics = await page.evaluate(() => ['Find', 'Replace with'].map((l) => { const e = document.querySelector('[aria-label="' + l + '"]'); return [Math.round(e.getBoundingClientRect().height), getComputedStyle(e).fontSize]; }));
  check('Find와 Replace 입력의 높이와 글자 크기가 같음', JSON.stringify(fieldMetrics[0]) === JSON.stringify(fieldMetrics[1]), fieldMetrics);
  await findIn.fill('바이브'); await settle();
  const total1 = (await page.getByTestId('find-count').textContent()) || '';
  check('찾으면 일치 수와 슬라이드 수를 보임', /\d+ of \d+ in \d+ slide/.test(total1), total1);
  const nMatches = Number((total1.match(/of (\d+)/) || [])[1] || 0);
  check('필름스트립 타일에 슬라이드별 일치 수', (await page.getByLabel(/^\d+ matches$/).count()) >= 1);
  const idx0 = await page.getByText(/^Slide \d+ \/ \d+$/).first().textContent().catch(() => '');
  await page.getByRole('button', { name: 'Next match' }).click(); await settle();
  check('다음 단추가 현재 위치를 옮김', /^2 of /.test((await page.getByTestId('find-count').textContent()) || '') || nMatches === 1);
  await page.getByLabel('Replace with', { exact: true }).fill('Vibe');
  await page.getByRole('button', { name: 'Replace all' }).click(); await settle();
  const afterAll = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')].map((s) => s.textContent).join('|'));
  check('모두 바꾸기가 덱 전체의 글자를 바꿈', !afterAll.includes('바이브') && afterAll.includes('Vibe'));
  await focusBody(); await page.keyboard.press('Meta+z'); await settle();
  const undone = await page.evaluate(() => [...document.querySelector('iframe[title="Canvas"]').contentDocument.querySelectorAll('#sk-stage > [data-slide]')].map((s) => s.textContent).join('|'));
  check('모두 바꾸기는 실행 취소 한 번에 되돌아감', undone.includes('바이브'));
  void idx0;
  await page.getByLabel('Find', { exact: true }).fill('zzzz-없는-글'); await settle();
  check('없는 글은 No results', ((await page.getByTestId('find-count').textContent()) || '').includes('No results'));
  await page.getByLabel('Find', { exact: true }).press('Escape'); await settle();
  check('Esc가 찾기 줄을 닫음', (await page.getByTestId('find-bar').count()) === 0);

  // 덱 설정: 헤더 버튼으로 열고 Author를 바꾸면 deck-meta에 저장되고 실행 취소 한 번에 되돌아간다
  await page.getByRole('button', { name: 'Deck settings' }).click();
  const focusedInDialog = await page.evaluate(() => { const a = document.activeElement; return !!a && !!a.closest('[role=dialog]') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); });
  check('설정 대화상자가 열리면 첫 입력에 포커스', focusedInDialog);
  const authorIn = page.getByLabel('Author', { exact: true });
  await authorIn.waitFor({ timeout: 8000 }).catch(() => {});
  await authorIn.fill('테스트 저자'); await page.keyboard.press('Tab');
  await sleep(600); // 폼의 글자 입력 디바운스(400ms)가 지나야 반영된다
  await page.keyboard.press('Escape'); await settle();
  check('설정 대화상자를 닫으면 포커스가 톱니 단추로 돌아옴', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Deck settings'));
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Meta+s'); await saveDone();
  check('덱 설정 Author가 deck-meta에 저장됨', /"author"\s*:\s*"테스트 저자"/.test(fs.readFileSync(FILE, 'utf8')));
  await focusBody(); await page.keyboard.press('Meta+z'); await settle(); await saveDone();
  check('덱 설정 변경 실행 취소', !/"author"\s*:\s*"테스트 저자"/.test(fs.readFileSync(FILE, 'utf8')));

  // 이미지: 붙여넣기와 끌어 놓기는 덱 assets/에 저장해 img를 넣거나 바꾼다. 서버는 이미지 형식만 받는다.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', GIF = 'R0lGODlhAQABAIAAAP8AAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const apiImg = (bytes, name, type) => page.evaluate(async ([f, arr, n, t]) => (await fetch('/api/decks/' + f + '/assets?name=' + encodeURIComponent(n), { method: 'POST', headers: { 'Content-Type': t }, body: new Uint8Array(arr) })).status, [T.folder, [...bytes], name, type]);
  check('이미지 API: 텍스트와 스크립트 든 SVG는 400', (await apiImg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg', 'image/svg+xml')) === 400 && (await apiImg(Buffer.from('hello'), 'x.png', 'image/png')) === 400);
  check('이미지 API: PNG는 201', (await apiImg(Buffer.from(PNG, 'base64'), 'shot.png', 'image/png')) === 201);
  await layers.nth(1).click(); await settle(); await focusBody(); await page.keyboard.press('Escape');
  const imgBefore = await inDoc((s) => s.querySelectorAll('img').length);
  await fr().evaluate(([b64]) => { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([a], 'pasted shot.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, [PNG]);
  await cond(() => !!document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-active] img[src^="assets/"]'));
  check('이미지 붙여넣기가 img를 넣음', (await inDoc((s) => s.querySelectorAll('img').length)) === imgBefore + 1);
  check('이미지 파일이 덱 assets/에 저장됨', fs.existsSync(path.join(T.dir, 'assets')) && fs.readdirSync(path.join(T.dir, 'assets')).some((f) => /\.png$/.test(f)));
  const newSrc = await inDoc((s) => s.querySelector('img[src^="assets/"]').getAttribute('src'));
  await fr().evaluate(([b64]) => { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); const dt = new DataTransfer(); dt.items.add(new File([a], 'drop.gif', { type: 'image/gif' })); const img = document.querySelector('[data-active] img[src^="assets/"]'); img.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, [GIF]);
  await cond(([old]) => !document.querySelector('iframe[title="Canvas"]').contentDocument.querySelector('[data-active] img[src="' + old + '"]'), [newSrc]);
  check('이미지 위에 놓으면 src가 바뀜(교체)', (await inDoc((s) => s.querySelectorAll('img').length)) === imgBefore + 1 && (await inDoc((s) => !!s.querySelector('img[src$=".gif"]'))));
  await focusBody(); for (let i = 0; i < 2; i++) { await page.keyboard.press('Meta+z'); await settle(); }
  check('이미지 추가와 교체 실행 취소', (await inDoc((s) => s.querySelectorAll('img').length)) === imgBefore);

  await H.finish();
})();
