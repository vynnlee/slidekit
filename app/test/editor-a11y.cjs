/* 편집기 필름스트립의 접근성(axe): 기본, 코멘트 표시가 붙은 타일, 찾기 일치 배지, 넘침 표시가 붙은 상태에서 serious와 critical 위반이 없다.
   axe가 없으면 러너가 이 단계를 건너뛰고 크게 알린다(직접 실행하려면 AXE=<axe.min.js>). 하네스(lib/editor-harness.cjs)가 작은 덱 사본을 만든다. */
const { startEditor } = require('./lib/editor-harness.cjs');

(async () => {
  const H = await startEditor({ name: 'editor-a11y' });
  const { fs, T, check, page, settle, focusBody, fr, cond, layers, inDoc, goSlide2 } = H;
  const axePath = process.env.AXE;
  if (!axePath || !fs.existsSync(axePath)) { console.log('!! 건너뜀: axe-core를 찾지 못함(AXE=<axe.min.js>)'); await H.finish(); return; }
  await page.evaluate(fs.readFileSync(axePath, 'utf8'));
  const scan = async (label) => {
    const v = await page.evaluate(async () => {
      const r = await window.axe.run('[data-testid=filmstrip]', { resultTypes: ['violations'] });
      return r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => ({ id: x.id, n: x.nodes.length, first: (x.nodes[0] && x.nodes[0].html || '').slice(0, 120), msg: (x.nodes[0] && x.nodes[0].any[0] && x.nodes[0].any[0].message || '').slice(0, 140) }));
    });
    check('필름스트립 axe: ' + label, v.length === 0, v);
  };
  await scan('기본(1번 타일 선택)');
  await goSlide2();
  await layers.nth(1).click(); await settle();
  await scan('2번 타일 선택');
  // 코멘트 표시(열린 코멘트가 있는 슬라이드의 점)
  await page.evaluate(([slide, folder]) => fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deck: folder, slide, path: '', excerpt: 'x', text: 'check' }) }), [3, T.folder]);
  await cond(() => document.querySelectorAll('[data-testid=filmstrip] [role=option] span.rounded-full').length > 0, null, 8000);
  await scan('코멘트 표시가 있는 타일');
  // 찾기 일치 배지
  await focusBody(); await page.keyboard.press('Meta+f');
  await page.getByLabel('Find', { exact: true }).fill('바이브');
  await cond(() => !!document.querySelector('[data-testid=filmstrip] [data-testid=tile-found]'), null, 8000);
  await scan('찾기 일치 배지가 있는 타일');
  await page.getByLabel('Find', { exact: true }).press('Escape'); await settle();
  // 넘침 표시: 현재 슬라이드의 요소를 슬라이드 밖으로 밀어 낸다(저장하지 않는 시험용 변형)
  await layers.nth(1).click(); await settle();
  await inDoc((s) => { s.querySelector('h2').style.translate = '3000px 0'; });
  await cond(() => !!document.querySelector('[data-testid=filmstrip] [aria-label="Content overflows"]'), null, 8000);
  await scan('넘침 표시가 있는 타일');
  await H.finish();
})();
