/* 편집기 조작 퍼즈. 시드 고정 난수로 조작을 섞어 실행하고 매 단계 뒤 불변식을 본다.
   (1) 저장한 HTML에 data-slide와 id 중복이 늘지 않고, 일정 간격과 끝에서 slidekit lint가 오류 없음
   (2) 끝에서 Undo를 더 못 할 때까지 하면 원본과 바이트 동일
   (3) 페이지 오류와 콘솔 error 없음
   실패하면 시드와 조작 열을 찍는다(SEED=<n> OPS=<n> bun scripts/test.ts --only editor-fuzz 로 같은 열을 다시 돌린다). 덱은 사본이다.
   SEED가 없으면 시드 3개(1, 2, 3)를 차례로 자식 프로세스로 돌린다. */
const cp = require('child_process');
if (!process.env.SEED) {
  let bad = 0;
  for (const s of (process.env.SEEDS || '1,2,3,x4,a5').split(',')) { // x로 시작하는 시드는 밖의 파일 쓰기를, a로 시작하는 시드는 애니메이션 연산을 섞는 변형이다
    console.log('== 시드 ' + s);
    const ext = s.startsWith('x'), anim = s.startsWith('a');
    const r = cp.spawnSync(process.execPath, [__filename], { stdio: 'inherit', env: { ...process.env, SEED: ext || anim ? s.slice(1) : s, ...(ext ? { EXT: '1' } : {}), ...(anim ? { ANIM: '1' } : {}) } });
    if (r.status) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const { startEditor } = require('./lib/editor-harness.cjs');
const rng = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

(async () => {
  const seed = Number(process.env.SEED), N = Number(process.env.OPS || 40);
  const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)], int = (a, b) => a + Math.floor(R() * (b - a + 1));
  const H = await startEditor({ name: 'editor-fuzz-' + seed, slides: 6 });
  const { fs, FILE, T, check, page, settle, focusBody, saveDone, cond, errors, finish } = H;
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|Failed to load resource|Blocked script execution/.test(m.text() + m.location().url)) errors.push('console: ' + m.text().slice(0, 160)); });
  const original = fs.readFileSync(FILE, 'utf8');
  // EXT 변형: 내 조작은 첫 슬라이드에만 하고, 가끔 밖에서 6번 슬라이드 끝에 문단을 덧붙인다(Claude의 수정 흉내). Undo를 끝까지 해도 그 수정은 남아 파일이 '원본 + 밖의 수정'과 같아야 한다.
  const EXT = !!process.env.EXT, ANIM = !!process.env.ANIM; // ANIM: 하단 Animation 탭(타임라인)을 열어 두고 막대 끌기, 키보드, 스크럽, 인스펙터 연산을 섞는다
  const insertAt = (h, n, text) => { const ends = [...h.matchAll(/<\/section>/g)].map((m) => m.index); const at = ends[ends.length - 1]; /* 마지막 슬라이드(6번)의 끝: 내 복제가 안쪽 section을 늘려도 흔들리지 않는다 */ return h.slice(0, at) + `<p>${text}</p>` + h.slice(at); };
  let expected = original;
  const dupIds = (html) => { const seen = new Map(); for (const m of html.matchAll(/\sid="([^"]+)"/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1); return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k)); };
  const baseDup = dupIds(original);
  // 단계 속성의 불변식: data-step과 data-step-out은 2 이상의 정수이고 out > in, 재생 표시는 저장 글자에 새지 않는다
  const stepProblems = (html) => {
    const bad = [];
    for (const m of html.matchAll(/<[a-zA-Z][^>]*\sdata-step(?:-out)?=[^>]*>/g)) {
      const t = m[0], st = /\sdata-step="([^"]*)"/.exec(t), so = /\sdata-step-out="([^"]*)"/.exec(t);
      if (st && !/^\d+$/.test(st[1])) bad.push('data-step=' + st[1]); else if (st && Number(st[1]) < 2) bad.push('data-step<2:' + st[1]);
      if (so && !/^\d+$/.test(so[1])) bad.push('data-step-out=' + so[1]); else if (so && Number(so[1]) < 2) bad.push('data-step-out<2:' + so[1]);
      if (st && so && Number(so[1]) <= Number(st[1])) bad.push(`out(${so[1]})<=in(${st[1]})`);
      for (const v of t.matchAll(/--sk-(?:step|out)-(?:ms|delay):\s*([^;"]*)/g)) { const n = /^(\d+)ms$/.exec(v[1].trim()); if (!n || Number(n[1]) > 10000) bad.push('시간 변수 ' + v[0]); } // 시간은 0~10000ms 정수 ms
    }
    if (/data-shown|data-away|data-step-run|data-step-instant/.test(html)) bad.push('재생 표시가 저장 글자에 샘');
    return bad;
  };
  const slideCount = (html) => (html.match(/<section\b[^>]*\bdata-slide\b/g) || []).length;
  const lint = () => { const r = cp.spawnSync('bun', ['app/server.ts', 'lint', T.folder], { encoding: 'utf8' }); const errs = (r.stdout + r.stderr).split('\n').filter((l) => /^\s*error/i.test(l) && !/cover를 첫 슬라이드로/.test(l)); // 슬라이드 이동으로 cover가 첫 자리를 벗어나는 건 사용자의 선택이고 편집기가 알림을 띄운다
    return errs.length ? errs.slice(0, 3).join(' | ') : ''; };
  const key = async (k) => { await focusBody(); await page.keyboard.press(k); };
  const pal = async (text) => { await focusBody(); await page.keyboard.press('Meta+k'); await settle(); await page.keyboard.type(text); await settle(); await page.keyboard.press('Enter'); };
  const box = async (sel) => page.locator(sel).first().boundingBox().catch(() => null);
  const canvas = page.locator('iframe[title="Canvas"]');
  const ops = {
    'select-next': () => key('Tab'), 'select-parent': () => key('Shift+Enter'), 'select-child': async () => { await key('Enter'); await page.keyboard.press('Escape'); }, 'deselect': () => key('Escape'),
    'nudge': () => key(pick(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']).replace(/^/, R() < 0.3 ? 'Shift+' : '')),
    'drag': async () => { const b = await box('.border-2.border-focus-ring'); if (!b) return; const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + int(-60, 60), y + int(-40, 40), { steps: 4 }); await page.mouse.up(); },
    'resize': async () => { const h = await box(`[data-handle=${pick(['se', 'e', 's', 'nw'])}]`); if (!h) return; const x = h.x + h.width / 2, y = h.y + h.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + int(-30, 40), y + int(-30, 30), { steps: 4 }); await page.mouse.up(); },
    'text': async () => { await key('Enter'); await page.keyboard.type(pick(['x', 'ab', ' 가', '<b>'])); await page.keyboard.press('Escape'); },
    'duplicate': () => key('Meta+d'), 'delete': () => key('Delete'), 'group': () => key('Meta+g'), 'ungroup': () => key('Shift+Meta+g'),
    'lock': () => pal('Lock or unlock selection'), 'hide': () => pal('Hide or show selection'),
    'z-back': () => key('Meta+['), 'z-front': () => key('Meta+]'),
    'copy-style': () => key('Meta+Alt+c'), 'paste-style': () => key('Meta+Alt+v'),
    'slide-add': () => pal('Add slide after this one'), 'slide-dup': () => pal('Duplicate slide'), 'slide-move': () => pal(pick(['Move slide to start', 'Move slide to end'])), 'slide-delete': () => pal('Delete slide'),
    'theme': () => pal('Theme: ' + pick(['Paper', 'Midnight', 'Forest', 'Sunset'])),
    'slide-go': () => key(pick(['ArrowUp', 'ArrowDown'])),
    'find-replace': async () => { await focusBody(); await page.keyboard.press('Meta+f'); await page.getByLabel('Find', { exact: true }).fill(pick(['a', 'e', '바', 'the'])); await settle(); await page.getByLabel('Replace with', { exact: true }).fill(pick(['Q', 'zz', ''])); const b = page.getByRole('button', { name: 'Replace all' }); if (await b.isEnabled().catch(() => false)) await b.click(); await page.getByLabel('Find', { exact: true }).press('Escape'); },
    'undo': () => key('Meta+z'), 'redo': () => key('Shift+Meta+z'),
    // 애니메이션 연산(ANIM 변형): 인스펙터 + In/+ Out과 칸, 타임라인 막대 끌기(Delay, Duration, 구역 이동), 키보드, 스크럽, 구역 이동 단추, Add animation
    'anim-in': async () => { const b = page.getByRole('button', { name: 'In', exact: true }); if (await b.count()) await b.click({ timeout: 3000 }); },
    'anim-out': async () => { const b = page.getByRole('button', { name: 'Out', exact: true }); if (await b.count()) await b.click({ timeout: 3000 }); },
    'anim-effect': async () => { const s = page.getByLabel(/^Effect of /).first(); if (await s.count()) await s.selectOption(pick(['fade', 'rise', 'slide', 'scale', 'blur'])); },
    'anim-time': async () => { const f = page.getByLabel(pick(['Delay of In (seconds)', 'Duration of In (seconds)', 'Delay of Out (seconds)', 'Duration of Out (seconds)'])); if (await f.count()) { await f.fill(String(pick(['0', '0.25', '0.4', '1.5', '99', '-1']))); await f.press('Enter'); } },
    'anim-bar-drag': async () => { const bars = page.getByTestId('tl-bar'), n = await bars.count(); if (!n) return; const bar = bars.nth(int(0, n - 1)), part = pick(['l', 'r', null]); const b = await (part ? bar.locator(`[data-testid=tl-handle-${part}]`) : bar).boundingBox(); if (!b) return; const x = part === 'r' ? b.x + b.width - 2 : part === 'l' ? b.x + 2 : b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + int(-150, 150), y + (part ? 0 : int(-60, 60)), { steps: 4 }); await page.mouse.up(); },
    'anim-bar-key': async () => { const bars = page.getByTestId('tl-bar'), n = await bars.count(); if (!n) return; await bars.nth(int(0, n - 1)).focus(); await page.keyboard.press(pick(['ArrowLeft', 'ArrowRight', 'Shift+ArrowLeft', 'Shift+ArrowRight', 'Alt+ArrowUp', 'Alt+ArrowDown', 'Home', 'w', 'a', 'Delete'])); },
    'anim-scrub': async () => { const r = page.getByTestId('tl-ruler'), n = await r.count(); if (!n) return; const b = await r.nth(int(0, n - 1)).boundingBox(); if (!b) return; await page.mouse.move(b.x + 4, b.y + 6); await page.mouse.down(); await page.mouse.move(b.x + int(10, 300), b.y + 6, { steps: 3 }); await page.mouse.up(); },
    'anim-head': async () => { const b = page.getByRole('button', { name: pick(['Previous click', 'Next click']) }); if ((await b.count()) && (await b.isEnabled())) await b.click({ timeout: 3000 }); },
    'anim-add': async () => { const b = page.getByRole('button', { name: 'Add animation' }); if ((await b.count()) && (await b.isEnabled())) await b.click({ timeout: 3000 }); },
  };
  const weights = { 'select-next': 6, 'select-parent': 2, 'select-child': 3, 'deselect': 1, nudge: 4, drag: 4, resize: 3, text: 3, duplicate: 3, delete: 2, group: 2, ungroup: 1, lock: 1, hide: 1, 'z-back': 1, 'z-front': 1, 'copy-style': 1, 'paste-style': 2, 'slide-add': 1, 'slide-dup': 1, 'slide-move': 1, 'slide-delete': 1, theme: 1, 'slide-go': 2, 'find-replace': 1, undo: 3, redo: 1 };
  if (ANIM) { Object.assign(weights, { 'anim-in': 7, 'anim-out': 4, 'anim-effect': 3, 'anim-time': 3, 'anim-bar-drag': 8, 'anim-bar-key': 6, 'anim-scrub': 3, 'anim-head': 2, 'anim-add': 3 }); for (const k of Object.keys(weights)) if (/^slide-|find-replace|^group$|^ungroup$|^delete$/.test(k)) delete weights[k]; } // 요소 선택과 단계 연산 위주
  if (EXT) for (const k of Object.keys(weights)) if (/^slide-|find-replace/.test(k)) delete weights[k]; // 구조 조작과 덱 전체 바꾸기는 6번 슬라이드의 밖의 수정과 섞지 않는다
  if (ANIM) { await page.getByRole('tab', { name: 'Animation' }).click(); await settle(); }
  const bag = Object.entries(weights).flatMap(([k, w]) => Array(w).fill(k));
  const done = [];
  const fail = (what, extra) => { check(`시드 ${seed}: ${what}`, false, { ops: done.join(','), ...extra }); };
  let bad = false;
  for (let i = 0; i < N && !bad; i++) {
    let op = pick(bag);
    const slides = slideCount(fs.readFileSync(FILE, 'utf8'));
    if ((op === 'slide-delete' && slides < 3) || (op === 'slide-add' && slides > 10) || (op === 'slide-dup' && slides > 10)) op = 'select-next';
    done.push(op);
    if (EXT && i % 6 === 5) {
      const mark = `EXT-${i}`; expected = insertAt(expected, 6, mark); const cur = fs.readFileSync(FILE, 'utf8'); const ends = [...cur.matchAll(/<\/section>/g)].map((m) => m.index);
      fs.writeFileSync(FILE, insertAt(cur, 6, mark)); done.push('외부:' + mark);
      await cond((m) => document.querySelector('iframe[title="Canvas"]').contentDocument.body.textContent.includes(m), mark, 20000); // 편집기가 반영할 때까지
    }
    try { await ops[op](); } catch (e) { fail('조작 ' + op + ' 중 예외', { e: String(e).slice(0, 700) }); bad = true; break; }
    await settle(); await page.keyboard.press('Meta+s'); await saveDone();
    const html = fs.readFileSync(FILE, 'utf8');
    const dup = [...dupIds(html)].filter((x) => !baseDup.has(x));
    if (dup.length) { fail('id 중복 늘어남(' + op + ')', { dup: dup.slice(0, 5) }); bad = true; }
    else if (stepProblems(html).length) { fail('단계 속성 불변식 위반(' + op + ')', { problems: stepProblems(html).slice(0, 4) }); bad = true; }
    else if (errors.length) { fail('페이지 오류(' + op + ')', { errors: errors.slice(0, 3) }); bad = true; }
    else if (i % 10 === 9) { const l = lint(); if (l) { fail('lint 오류(' + op + ')', { lint: l }); bad = true; } }
  }
  if (!bad) {
    const l = lint(); if (l) { fail('끝에서 lint 오류', { lint: l }); bad = true; }
    // Undo를 더 못 할 때까지 한다(Undo 단추가 꺼질 때까지). 원본과 바이트 동일해야 한다.
    const undoBtn = page.locator('button[aria-label="Undo"]').first(); // 역할 질의는 열린 대화상자 뒤(aria-hidden)의 단추를 못 찾는다. 도구 모음의 Undo를 속성으로 직접 본다
    for (let k = 0; k < N * 3 + 30 && !bad; k++) { if (await undoBtn.isDisabled().catch(() => true)) break; await key('Meta+z'); await settle(); }
    await page.keyboard.press('Meta+s'); await saveDone();
    const back = fs.readFileSync(FILE, 'utf8');
    const want = EXT ? expected : original;
    if (!bad && back !== want) { const a = want.split('\n'), b = back.split('\n'); let d = 0; while (d < a.length && a[d] === b[d]) d++; fail(EXT ? 'Undo를 모두 해도 원본과 밖의 수정이 합쳐진 모습과 다름' : 'Undo를 모두 해도 원본과 다름', { line: d + 1, prevWant: (a[d - 1] || '').slice(-120), prevGot: (b[d - 1] || '').slice(-120), want: (a[d] || '').slice(0, 120), got: (b[d] || '').slice(0, 120), sizes: [want.length, back.length], slides: [(want.match(/data-slide="[a-z-]+"/g) || []).join(' '), (back.match(/data-slide="[a-z-]+"/g) || []).join(' ')], undoDisabled: await undoBtn.isDisabled({ timeout: 3000 }).catch((e) => String(e).slice(0, 200)), dialogs: await page.locator('[role=dialog],[role=alertdialog]').count() }); }
    else if (!bad) check(`시드 ${seed}: 조작 ${N}개 뒤 Undo로 원본과 바이트 동일, 불변식 유지`, true);
  }
  await finish();
})();
