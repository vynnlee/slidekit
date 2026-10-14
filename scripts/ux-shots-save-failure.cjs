/* 저장 실패 화면 캡처(1440과 390): PUT을 500으로 막은 편집기, 복구 뒤 화면. 실행: bun scripts/test.ts --only editor-save-shots (OUT에 PNG) */
const { startEditor } = require('../app/test/lib/editor-harness.cjs');
const path = require('path');
const OUT = process.env.OUT || '/tmp/slidekit-ux-shots/save-failure';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const H = await startEditor({ name: 'save-shots' });
  const { page, check, settle, saveDone, cond, BASE, T } = H;
  for (const [tag, w, h] of [['1440', 1440, 900], ['390', 390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + '/edit/' + T.id);
    await page.locator('iframe[title="Canvas"]').waitFor(); await settle();
    let fail = true;
    const re = /\/api\/decks\/[^/]+$/;
    await page.route(re, (r) => (r.request().method() === 'PUT' && fail ? r.fulfill({ status: 500, body: '{}' }) : r.fallback()));
    await H.focusBody(); await page.keyboard.press('Tab'); await page.keyboard.press('ArrowRight'); // 요소를 골라 1px 옮겨 편집으로 만든다(화면 크기와 무관)
    const ok = await page.getByText('Could not save. Your edits are kept here. Retrying automatically.').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    check('저장 실패 알림이 ' + tag + '에서 보임', ok);
    await settle();
    await page.screenshot({ path: path.join(OUT, `save-failed-${tag}.png`) });
    fail = false; await page.evaluate(() => window.dispatchEvent(new Event('online'))); await saveDone();
    await page.screenshot({ path: path.join(OUT, `save-recovered-${tag}.png`) });
    await page.unroute(re);
  }
  await H.finish();
})();
