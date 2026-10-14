/* 코멘트 흐름과 Export UX의 UI 상태별 스크린샷(UX 리뷰, 전후 비교용). 테스트 덱 사본에서만 동작하고 저장 단축키는 누르지 않는다.
   Usage: PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3245 OUT=<폴더> node scripts/ux-shots-comments.cjs
   BASE 서버는 SLIDEKIT_DEPLOY_DRY_RUN=1로 띄운다. OUT 기본값은 /tmp/slidekit-shots/<타임스탬프>. 못 찾는 상태는 건너뛰고 WARN만 낸다. */
const { chromium } = require(process.env.PW || 'playwright-core');
const fs = require('fs'), path = require('path');
const { makeTestDeck } = require('./lib/test-deck.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3245';
const OUT = process.env.OUT || path.join('/tmp/slidekit-shots', new Date().toISOString().replace(/[:.]/g, '-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JSON_H = { 'Content-Type': 'application/json' };

(async () => {
  const t = makeTestDeck('ux-comments'); // 실제 덱은 건드리지 않는다
  fs.mkdirSync(OUT, { recursive: true });
  const saved = [];
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const fr = () => page.frames().find((f) => f.url().startsWith('blob:'));
    const open = async () => {
      await page.goto(`${BASE}/edit/${t.id}`);
      await page.waitForFunction(() => { const f = document.querySelector('iframe[title="Canvas"]'); return f && f.contentDocument && f.contentDocument.querySelector('[data-active]'); });
      await sleep(800);
    };
    const panel = page.locator('aside[aria-label="Properties"]');
    const tab = (name) => page.getByRole('tab', { name });

    let n = 0;
    // area가 있으면 그 영역 스크린샷(<번호>-<이름>.png)과 전체 화면(-full.png)을, 없으면 전체 화면만 저장.
    const shot = async (name, area) => {
      await sleep(400);
      const base = path.join(OUT, `${String(++n).padStart(2, '0')}-${name}`);
      const full = area ? `${base}-full.png` : `${base}.png`;
      if (area) { await area.screenshot({ path: `${base}.png` }).then(() => saved.push(`${base}.png`), (e) => console.warn(`WARN ${name}: 영역 캡처 실패 ${e.message.split('\n')[0]}`)); }
      await page.screenshot({ path: full });
      saved.push(full);
    };
    const warn = (name, why) => console.warn(`WARN ${name}: ${why}, 건너뜀`);
    const gotoSlide = async (i) => { // 필름스트립 i번째(0부터) 슬라이드로
      await page.locator('[data-testid="filmstrip"] [role="option"]').nth(i).click();
      await sleep(500);
    };

    await open();
    // (1) 코멘트 0개인 Comments 탭
    await tab(/^Comments/).click();
    await shot('comments-empty', panel);

    // (2) 제목 선택 후 Comment 버튼으로 작성창 열고 글 입력(전송 전)
    await tab('Design').click();
    const head = fr().locator('[data-active] h1, [data-active] h2').first();
    if (await head.count()) {
      await head.click({ modifiers: ['Meta'] });
      await sleep(300);
      await page.getByRole('button', { name: 'Comment', exact: true }).first().click();
      const box = page.getByRole('textbox', { name: 'Comment' });
      await box.fill('이 제목을 두 줄로 줄이면 어떨까요? 발표 때 읽기 어렵습니다.');
      await shot('composer', box.locator('xpath=ancestor::div[1]'));
      await page.keyboard.press('Escape');
    } else warn('composer', '제목 요소가 없음');

    // (3) API로 코멘트 5개(슬라이드와 상태가 다름, 2개는 답변 처리, 1개는 아주 긴 본문)
    const paths = await fr().evaluate(() => {
      const secs = [...document.querySelectorAll('section[data-slide]')];
      const pathOf = (slide, el) => { // app/src/lib/deck-source.ts의 pathOf와 같은 규칙
        const parts = [];
        for (let e = el; e && e !== slide; e = e.parentElement) {
          const tag = e.tagName.toLowerCase();
          const same = [...(e.parentElement?.children ?? [])].filter((x) => x.tagName === e.tagName);
          parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
        }
        return parts.join(' > ');
      };
      return secs.map((s, i) => { const h = s.querySelector('h1, h2'); return h ? { slide: i + 1, path: pathOf(s, h), excerpt: h.textContent.trim().slice(0, 80) } : null; }).filter(Boolean);
    });
    const long = '긴 본문 테스트입니다. ' + '이 슬라이드는 한 화면에 전달할 메시지가 너무 많아 보입니다. 핵심 한 문장만 남기고 나머지는 발표자 노트로 옮기면 좋겠습니다. '.repeat(8);
    const plan = [ // [paths 인덱스, 본문, 답변]
      [1, '제목이 너무 깁니다. 한 줄로 줄여 주세요.', null],
      [1, '부제 색 대비를 확인해 주세요.', '대비를 4.5:1 이상으로 올렸습니다.'],
      [2, long, null],
      [3, '이 슬라이드는 순서를 뒤로 옮기는 게 좋겠습니다.', '순서를 바꿨습니다.'],
      [4, '오탈자 확인 부탁드립니다.', null],
    ];
    if (paths.length < 5) warn('comments-mixed', `제목이 있는 슬라이드가 ${paths.length}장뿐`);
    else {
      for (const [k, text, reply] of plan) {
        const p = paths[k];
        const r = await fetch(`${BASE}/api/comments`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ deck: t.folder, ...p, text }) });
        if (!r.ok) { warn('comments-mixed', `POST /api/comments ${r.status}`); continue; }
        if (reply) {
          const { id } = await r.json();
          await fetch(`${BASE}/api/comments/${id}/reply`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ deck: t.folder, reply }) });
        }
      }
      await open(); // 코멘트는 열 때 불러온다
      await tab(/^Comments/).click();
      await shot('comments-mixed', panel);

      // (4) 열린 코멘트가 있는 슬라이드(paths[1].slide)에서 핀, (5) 핀 호버
      await gotoSlide(paths[1].slide - 1);
      const pin = page.locator('[data-comment-pin]').first();
      if (await pin.isVisible().catch(() => false)) {
        await shot('pin');
        await pin.hover();
        await shot('pin-hover');
      } else warn('pin, pin-hover', '코멘트 핀이 보이지 않음');
    }

    // Export는 `_` 폴더(테스트 사본)를 내보낼 수 없어서(덱 id 규칙) 실제 덱을 읽기만 하는 dev 화면에서 찍는다. dry-run 서버라 업로드는 없다.
    await page.goto(`${BASE}/dev/export?deck=vibe-coding-workshop`);
    await page.getByRole('button', { name: 'Export' }).waitFor({ timeout: 15000 });

    // (6) Export 메뉴
    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Export' }).click();
    await shot('export-menu', page.getByRole('menu'));

    // (7) Publish 다이얼로그(전송 전)
    const dialog = page.getByRole('dialog');
    const item = page.getByRole('menuitem', { name: /^Publish to static/ });
    if (await item.count()) {
      await item.click();
      await dialog.getByRole('button', { name: 'Publish', exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
      await shot('publish-dialog', dialog);

      // (8) 진행 중 로그가 보이는 순간, (9) 완료 후 URL과 Copy
      await dialog.getByRole('button', { name: 'Publish', exact: true }).click().catch(() => warn('publish-running', 'Publish 버튼을 못 누름'));
      const prog = dialog.locator('[aria-label="Progress"]');
      if (await prog.waitFor({ timeout: 8000 }).then(() => true, () => false)) await shot('publish-running', dialog);
      else warn('publish-running', '진행 로그가 8초 안에 안 보임');
      if (await dialog.getByRole('button', { name: 'Copy link' }).waitFor({ timeout: 60000 }).then(() => true, () => false)) await shot('publish-done', dialog);
      else warn('publish-done', 'Copy 버튼이 60초 안에 안 나옴');
      await dialog.getByRole('button', { name: /^(Close|Cancel)$/ }).click().catch(() => {});
    } else warn('publish-dialog, publish-running, publish-done', 'Publish 메뉴 항목이 없음');

    // (10) 서버 연결 끊김 안내(ping은 5초마다, 최대 20초 대기)
    await page.route('**/api/ping', (r) => r.abort());
    if (await page.getByRole('status').filter({ hasText: /unreachable|Disconnected/i }).waitFor({ timeout: 20000 }).then(() => true, () => false)) await shot('disconnected');
    else warn('disconnected', '끊김 안내가 20초 안에 안 보임');
  } finally {
    if (browser) await browser.close();
    t.cleanup();
  }
  console.log('저장된 파일:\n' + saved.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
