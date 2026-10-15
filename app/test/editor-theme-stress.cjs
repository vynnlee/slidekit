/* 테마 변경을 반복하면서(느린 CPU, 선택한 요소가 있는 상태, 직전에 밖에서 파일을 쓰는 변형 포함) 오류 경계("Something went wrong")와
   콘솔 오류가 나는지 센다. 도그푸딩에서 한 번 보인 일회성 충돌을 잡으려는 시험이다. 실패하면 window.__skLastError의 스택을 찍는다.
   환경: ROUNDS(기본 30), CPU_SLOW(하네스가 CPU를 늦춘다). 실행: CPU_SLOW=4 bun scripts/test.ts --only editor-theme-stress */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-theme-stress' });
  const { fs, FILE, check, page, settle, focusBody, errors, finish } = H;
  const ROUNDS = Number(process.env.ROUNDS || 30);
  const cons = [];
  page.on('console', async (m) => { if (m.type() !== 'error' || /fonts\.g|ERR_FAILED|Failed to load resource|Blocked script execution/.test(m.text() + m.location().url)) return; cons.push(m.text().slice(0, 300)); });
  const themes = ['Dark', 'Light', 'Paper', 'Midnight blue', 'Mono', 'High contrast'];
  const crashed = () => page.getByText('Something went wrong.').count();
  const ext = (n) => { const h = fs.readFileSync(FILE, 'utf8'); const ends = [...h.matchAll(/<\/section>/g)].map((m) => m.index); const at = ends[(n % (ends.length - 1))]; fs.writeFileSync(FILE, h.slice(0, at) + `<p>EXT-${n}</p>` + h.slice(at)); };
  let bad = 0, firstErr = '';
  for (let i = 0; i < ROUNDS && !bad; i++) {
    const t = themes[i % themes.length];
    if (i % 3 === 0) { await focusBody(); await page.keyboard.press('Tab'); }         // 요소를 고른 상태
    if (i % 3 === 1) ext(i);                                                          // 밖의 변경 직후
    if (i % 5 === 4) { ext(i); await page.keyboard.press('Meta+z'); }                // 밖의 변경과 실행 취소가 겹침
    await focusBody(); await page.keyboard.press('Meta+k'); await page.keyboard.type('Theme: ' + t); await page.keyboard.press('Enter');
    if (i % 2) await page.waitForTimeout(150); else await settle();
    if (await crashed()) { bad++; firstErr = await page.evaluate(() => window.__skLastError || '(스택 없음)'); }
  }
  await settle();
  console.log(`INFO 테마 변경 ${ROUNDS}회, 콘솔 오류 ${cons.length}건, 페이지 오류 ${errors.length}건, 오류 경계 ${bad}회`);
  if (cons.length) console.log('INFO 첫 콘솔 오류', cons[0]);
  check('테마 변경을 반복해도 오류 경계가 뜨지 않음', bad === 0, firstErr.slice(0, 800));
  check('콘솔 오류 없음', cons.length === 0, cons.slice(0, 2));
  await finish();
})();
