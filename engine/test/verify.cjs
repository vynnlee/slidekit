/* One-shot browser check for engine + workshop deck.
   Usage: PW=<path to playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3150 node verify.cjs */
const { launch, clock, tick } = require('../../scripts/lib/pw.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:3150';
const DECK = BASE + '/decks/vibe-coding-workshop/index.html';
const results = [];
const check = (name, ok, extra) => { results.push([ok, name, extra]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* settled: wait for two frames and for finite CSS animations and transitions to end. It replaces fixed sleeps after an input (state is applied
   synchronously; only transitions and frames are pending). With several pages a short floor lets BroadcastChannel messages arrive. */
/* finite CSS animations and transitions finished (real time). Used on pages whose timers are faked by clock(), where rAF-based waits would not run. */
const animsDone = (p) => p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
const settledOne = (p) => p.evaluate(() => new Promise((res) => {
  const t = setTimeout(res, 2500);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))).then(() => { clearTimeout(t); res(); });
  }));
}));
/* the engine inside the host page's iframe has started (#sk-stage exists); works across origins */
const frameReady = async (pg) => { for (let i = 0; i < 100; i++) { const f = pg.frames().find((x) => x !== pg.mainFrame()); if (f && (await f.evaluate(() => !!document.getElementById('sk-stage')).catch(() => false))) return f; await sleep(50); } return null; };
const settled = async (...ps) => { await Promise.all(ps.map(settledOne)); if (ps.length > 1) await sleep(60); };

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const errors = [];
  const open = async (url) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#sk-stage');
    return p;
  };
  const hash = (p) => p.evaluate(() => location.hash);
  const active = (p) => p.evaluate(() => [].findIndex.call(document.querySelectorAll('#sk-stage > [data-slide]'), (s) => s.hasAttribute('data-active')) + 1);

  /* structure */
  let p = await open(DECK + '#1');
  const s = await p.evaluate(() => {
    const all = [].slice.call(document.querySelectorAll('#sk-stage > [data-slide]'));
    const k = (x) => all.filter((e) => e.dataset.slide === x).length;
    return {
      n: all.length, cover: k('cover'), chapter: k('chapter'), content: k('content'), end: k('end'),
      first: all[0].dataset.slide, last: all[all.length - 1].dataset.slide,
      activeCount: all.filter((e) => e.hasAttribute('data-active')).length,
      inactiveHidden: all.filter((e) => !e.hasAttribute('data-active')).every((e) => getComputedStyle(e).visibility === 'hidden' && getComputedStyle(e).display !== 'none'),
      scale: SlideKit.scale, transform: document.getElementById('sk-stage').style.transform,
      oldLeft: !!document.getElementById('viewport') || !!document.querySelector('.slide'),
      page: !!document.getElementById('sk-page'), tokIdx: all.findIndex((e) => e.id === 'tok-slide') + 1,
      ftIdx: all.findIndex((e) => e.contains(document.getElementById('ft'))) + 1,
      coverLogo: !!all[0].querySelector('mask'),
    };
  });
  check('53 slides, 1 cover, 7 chapters, 44 content, 1 end', s.n === 53 && s.cover === 1 && s.chapter === 7 && s.content === 44 && s.end === 1, s);
  check('first cover, last end', s.first === 'cover' && s.last === 'end');
  check('one active, others visibility hidden (not display none)', s.activeCount === 1 && s.inactiveHidden);
  check('scale = 1280/1920', Math.abs(s.scale - 1280 / 1920) < 1e-6 && /translate\(.*\) scale\(/.test(s.transform), s.transform);
  check('no leftover viewport/.slide, no page number by default', !s.oldLeft && !s.page);
  const tokIdx = s.tokIdx, ftIdx = s.ftIdx;
  check('hash #1 at start', (await hash(p)) === '#1');

  /* keys */
  const seq = [];
  for (const [key, want] of [['ArrowRight', '#2'], ['ArrowDown', '#3'], ['ArrowLeft', '#2'], ['ArrowUp', '#1']]) { await p.keyboard.press(key); seq.push((await hash(p)) === want); }
  check('four arrow keys move', seq.every(Boolean), seq);
  await p.mouse.click(640, 360); await p.keyboard.press('Space'); await p.keyboard.press('Enter'); await p.keyboard.press('PageDown');
  await p.mouse.wheel(0, 600); await p.mouse.move(900, 360); await settled(p);
  check('click, space, enter, pagedown, wheel do not move', (await hash(p)) === '#1');
  await p.keyboard.press('ArrowLeft');
  check('left at first slide stays', (await hash(p)) === '#1');

  /* hash entry */
  await p.goto(DECK + '#10'); await p.waitForSelector('#sk-stage');
  check('#10 direct entry', (await active(p)) === 10 && (await hash(p)) === '#10');
  await p.goto(DECK + '#999'); await p.waitForSelector('#sk-stage');
  check('#999 clamps to 53', (await active(p)) === 53);
  await p.evaluate(() => { location.hash = '#7'; }); await settled(p);
  check('hashchange moves', (await active(p)) === 7);

  /* tok stepper */
  await p.goto(DECK + '#' + (tokIdx - 1)); await p.waitForSelector('#sk-stage');
  const tokState = () => p.evaluate(() => { const c = document.getElementById('tok').classList; return c.contains('out') ? 4 : c.contains('ids') ? 3 : c.contains('split') ? 2 : 1; });
  await p.keyboard.press('ArrowRight');
  check('arrow into tok slide, step 1', (await active(p)) === tokIdx && (await tokState()) === 1);
  const fw = [];
  for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowRight'); await settled(p); fw.push((await tokState()) + ':' + (await active(p))); }
  check('3 rights stay on tok slide, steps 2,3,4', fw.join() === `2:${tokIdx},3:${tokIdx},4:${tokIdx}`, fw);
  await p.keyboard.press('ArrowRight');
  check('4th right leaves to next slide', (await active(p)) === tokIdx + 1);
  await p.keyboard.press('ArrowLeft');
  check('coming back lands on step 4', (await active(p)) === tokIdx && (await tokState()) === 4);
  const bk = [];
  for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowLeft'); await settled(p); bk.push((await tokState()) + ':' + (await active(p))); }
  check('3 lefts to step 1 on tok slide', bk.join() === `3:${tokIdx},2:${tokIdx},1:${tokIdx}`, bk);
  await p.keyboard.press('ArrowLeft');
  check('left at step 1 goes to previous slide', (await active(p)) === tokIdx - 1);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await settled(p);
  await p.focus('#tok-input');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('f'); await p.keyboard.press('o');
  check('keys in input do not move or open overview', (await active(p)) === tokIdx && (await tokState()) === 2 && !(await p.evaluate(() => document.getElementById('sk-overview').hasAttribute('data-open'))));
  await p.keyboard.press('Escape');
  check('Esc blurs the input', await p.evaluate(() => document.activeElement.tagName !== 'INPUT'));

  /* patrol bot only when active */
  { const bp = await ctx.newPage(); await clock(bp); /* fake clock: the patrol runs every 1.3s of fake time */
    const botT = () => bp.evaluate(() => document.querySelector('#ft .cc-bot').style.transform);
    await bp.goto(DECK + '#' + ftIdx); await bp.waitForSelector('#sk-stage');
    const a1 = await botT(); await tick(bp, 1400); const a2 = await botT();
    await bp.keyboard.press('ArrowRight'); const b1 = await botT(); await tick(bp, 2700); const b2 = await botT(); /* two patrol intervals pass while inactive */
    check('bot moves while active', a1 !== a2, [a1, a2]);
    check('bot frozen while inactive', b1 === b2, [b1, b2]); await bp.close(); }

  /* number + Enter, indicator */
  await p.goto(DECK + '#1'); await p.waitForSelector('#sk-stage');
  const chap = await p.evaluate(() => [].map.call(document.querySelectorAll('#sk-stage > [data-slide="chapter"]'), (e) => [].indexOf.call(e.parentNode.children, e) + 1));
  await p.keyboard.press('3');
  check('digit shows indicator', await p.evaluate(() => { const n = document.getElementById('sk-num'); return !n.hidden && n.textContent.indexOf('3') === 0; }));
  await p.keyboard.press('Enter');
  check('3 Enter goes to chapter 3', (await active(p)) === chap[2] && (await hash(p)) === '#' + chap[2], [chap, await hash(p)]);
  await p.keyboard.press('9'); await p.keyboard.press('Enter');
  check('missing chapter ignored', (await active(p)) === chap[2]);
  await p.keyboard.press('2'); await p.keyboard.press('Escape'); await p.keyboard.press('Enter');
  check('Esc cancels number', (await active(p)) === chap[2]);
  { const nq = await ctx.newPage(); await clock(nq); await nq.goto(DECK + '#1'); await nq.waitForSelector('#sk-stage');
    await nq.keyboard.press('2');
    const shown = await nq.evaluate(() => !document.getElementById('sk-num').hidden);
    await tick(nq, 3100); /* fake clock: no real 3s wait */
    check('indicator clears after 3s', shown && (await nq.evaluate(() => document.getElementById('sk-num').hidden))); await nq.close(); }

  /* overview */
  await p.goto(DECK + '#1'); await p.waitForSelector('#sk-stage');
  await p.keyboard.press('o'); await settled(p);
  const ovs = await p.evaluate(() => ({ open: document.getElementById('sk-overview').hasAttribute('data-open'), thumbs: document.querySelectorAll('.sk-thumb').length, groups: document.querySelectorAll('.sk-ov-group').length, after: document.getElementById('sk-stage').nextSibling === document.getElementById('sk-overview'), inert: [].every.call(document.querySelectorAll('.sk-thumb-in > [data-slide]'), (e) => e.inert), dupFound: document.getElementById('tok-slide').parentNode.id === 'sk-stage' }));
  check('O opens overview: 53 thumbs, 8 groups, inert clones, getElementById finds original', ovs.open && ovs.thumbs === 53 && ovs.groups === 8 && ovs.after && ovs.inert && ovs.dupFound, ovs);
  const box = await p.locator('.sk-thumb-box').first().boundingBox();
  const shot = await p.screenshot({ clip: box });
  const colored = await p.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 80) n++;
    return n;
  }, shot.toString('base64'));
  check('cover thumbnail draws the Gemini logo (mask/filter)', colored > 30, colored);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown');
  const selIdx = await p.evaluate(() => [].findIndex.call(document.querySelectorAll('.sk-thumb'), (t) => t.hasAttribute('data-sel')));
  check('arrows move selection in overview', selIdx > 2, selIdx);
  await p.keyboard.press('Enter'); await settled(p);
  check('Enter in overview jumps and closes', (await active(p)) === selIdx + 1 && !(await p.evaluate(() => document.getElementById('sk-overview').hasAttribute('data-open'))));
  await p.keyboard.press('o'); await p.keyboard.press('Escape');
  check('Esc closes overview', !(await p.evaluate(() => document.getElementById('sk-overview').hasAttribute('data-open'))));
  await p.keyboard.press('o'); await p.locator('.sk-thumb').nth(4).click(); await settled(p);
  check('thumb click jumps', (await active(p)) === 5);
  await p.keyboard.press('Meta+o');
  check('modifier keys ignored', !(await p.evaluate(() => document.getElementById('sk-overview').hasAttribute('data-open'))));

  /* fullscreen (headless may refuse; just must not throw and F must be handled) */
  const fsErr = errors.length;
  await p.keyboard.press('f'); await settled(p);
  const fs = await p.evaluate(() => !!document.fullscreenElement);
  console.log('INFO fullscreen after F: ' + fs);
  check('F handled without errors', errors.length === fsErr);
  if (fs) await p.keyboard.press('f');

  /* embed */
  await ctx.route('**/__host', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" src="/decks/vibe-coding-workshop/index.html?embed=1" style="width:800px;height:450px"></iframe><script>window.log=[];addEventListener("message",e=>{if(e.source===document.getElementById("f").contentWindow)log.push(e.data)})</script>' }));
  const h = await ctx.newPage();
  await h.goto(BASE + '/__host'); await h.waitForFunction(() => log.some((m) => m.type === 'ready'), null, { timeout: 5000 }).catch(() => {});
  const send = (m) => h.evaluate((m) => document.getElementById('f').contentWindow.postMessage(Object.assign({ source: 'slidekit', v: 1 }, m), location.origin), m);
  const logOf = (t) => h.evaluate((t) => log.filter((m) => m.type === t), t);
  /* send, then wait for the next message of that type instead of a fixed sleep */
  const sendWait = async (m, type = 'state') => { const n = (await logOf(type)).length; await send(m); await h.waitForFunction(([t, k]) => log.filter((x) => x.type === t).length > k, [type, n], { timeout: 3000 }).catch(() => {}); };
  const ready = (await logOf('ready'))[0];
  check('embed ready with info', !!ready && ready.info.slides.length === 53 && ready.info.chapters.length === 7 && ready.info.meta.id === 'vibe-coding-workshop' && ready.info.slides[2].chapter === 1 && ready.info.slides[0].title === null && ready.info.slides[tokIdx - 1].steps === 4, ready && ready.info.slides.slice(0, 3));
  await sendWait({ type: 'goto', slide: 12, step: 1 });
  let st = (await logOf('state')).pop();
  check('embed goto -> state 12/1', st && st.slide === 12 && st.step === 1, st);
  await sendWait({ type: 'goto', slide: tokIdx, step: 3 });
  st = (await logOf('state')).pop();
  check('embed goto to stepper slide step 3', st && st.slide === tokIdx && st.step === 3, st);
  await sendWait({ type: 'next' }); st = (await logOf('state')).pop();
  check('embed next steps to 4', st.slide === tokIdx && st.step === 4, st);
  await sendWait({ type: 'next' }); st = (await logOf('state')).pop();
  await sendWait({ type: 'prev' }); st = (await logOf('state')).pop();
  check('embed prev back into step 4', st.slide === tokIdx && st.step === 4, st);
  const fr = h.frames().find((f) => f !== h.mainFrame());
  await fr.focus('body').catch(() => {}); await h.keyboard.press('ArrowRight'); await h.keyboard.press('o'); await settled(h);
  const idle = await fr.evaluate(() => ({ hash: location.hash, ov: !document.getElementById('sk-overview') }));
  check('embed ignores keys, no overview, no hash', idle.hash === '' && idle.ov, idle);
  await sendWait({ type: 'get-info' }, 'info');
  check('get-info answers', (await logOf('info')).length === 1);

  /* sync */
  const A = await open(DECK + '?sync=1#1');
  const B = await open(DECK + '?sync=1#1');
  await A.keyboard.press('ArrowRight'); await A.keyboard.press('ArrowRight'); await settled(A, B);
  check('sync: A moves, B follows', (await active(B)) === 3, await active(B));
  await B.keyboard.press('ArrowLeft'); await settled(A, B);
  check('sync: B moves, A follows', (await active(A)) === 2);
  await A.goto(DECK + '?sync=1#' + tokIdx); await A.waitForSelector('#sk-stage'); await settled(A, B);
  await A.keyboard.press('ArrowRight'); await A.keyboard.press('ArrowRight'); await settled(A, B);
  const bTok = await B.evaluate(() => ({ s: [].findIndex.call(document.querySelectorAll('#sk-stage > [data-slide]'), (e) => e.hasAttribute('data-active')) + 1, split: document.getElementById('tok').classList.contains('split'), ids: document.getElementById('tok').classList.contains('ids') }));
  check('sync carries stepper step (tok step 3 on B)', bTok.s === tokIdx && bTok.split && bTok.ids, bTok);
  const C = await open(DECK + '?sync=1'); await settled(C, A);
  check('sync: hello makes a late joiner adopt current position', (await active(C)) === tokIdx, await active(C));
  const D = await open(DECK + '#1'); await A.keyboard.press('ArrowRight'); await settled(A, B);
  check('no sync param: standalone, unaffected', (await active(D)) === 1);

  const bad = errors.filter((e) => !/Failed to load resource|ERR_FAILED|net::/.test(e));
  check('no console errors or warnings', bad.length === 0, bad);

  /* edge cases: own pages, console noise is expected and not counted above */
  const pages = {};
  const page = (name, body, extra) => { pages[name] = '<!doctype html><html data-slidekit="1"><head><meta charset="utf-8"><link rel="stylesheet" href="/engine/slidekit.css"></head><body>' + body + '<script src="/engine/slidekit.js"></script>' + (extra || '') + '</body></html>'; };
  await ctx.route('**/__t/*', (r) => r.fulfill({ contentType: 'text/html', body: pages[r.request().url().split('/__t/')[1].split('?')[0]] || '' }));
  const sec = (n, attrs) => Array.from({ length: n }, (_, i) => '<section data-slide="content"' + (attrs ? attrs(i) : '') + '><h2>s' + (i + 1) + '</h2></section>').join('');

  for (const [h, want] of [['#999', 53], ['#0', 1], ['#-5', 1], ['#abc', 1]]) {
    const q = await open(DECK + h);
    check('hash ' + h + ' clamps to slide ' + want, (await active(q)) === want && (await hash(q)) === '#' + want, [await active(q), await hash(q)]);
    await q.close();
  }
  const q2 = await open(DECK + '#3'); await q2.evaluate(() => { location.hash = '#9999'; }); await settled(q2);
  check('hashchange out of range clamps', (await active(q2)) === 53, await active(q2));
  await q2.close();

  page('zero', '<h1>no slides</h1>');
  { const z = await ctx.newPage(); const ze = []; z.on('pageerror', (e) => ze.push(String(e))); const zw = []; z.on('console', (m) => { if (m.type() === 'warning') zw.push(m.text()); });
    await z.goto(BASE + '/__t/zero'); await settled(z);
    check('zero slides: no exception, warns, no stage', ze.length === 0 && zw.some((t) => /no <section data-slide>/.test(t)) && !(await z.$('#sk-stage')), [ze, zw]); await z.close(); }

  page('dup', sec(3, () => ' id="x"'));
  { const d = await ctx.newPage(); const de = []; d.on('pageerror', (e) => de.push(String(e)));
    await d.goto(BASE + '/__t/dup#1'); await d.waitForSelector('#sk-stage');
    await d.keyboard.press('ArrowRight'); await d.keyboard.press('ArrowRight'); await d.keyboard.press('ArrowRight');
    check('duplicate ids: no exception, navigation works', de.length === 0 && (await active(d)) === 3 && (await hash(d)) === '#3', [de, await active(d)]);
    await d.keyboard.press('o'); await d.keyboard.press('Enter'); await settled(d);
    check('duplicate ids: overview works', de.length === 0 && (await active(d)) === 3); await d.close(); }

  for (const [mode, want] of [['reduce', 'none'], ['no-preference', 'sk-in']]) {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: mode });
    const r = await c2.newPage(); await r.route('**/__t/*', (x) => x.fulfill({ contentType: 'text/html', body: pages.dup }));
    await r.goto(BASE + '/__t/dup'); await r.waitForSelector('#sk-stage');
    const an = await r.evaluate(() => getComputedStyle(document.querySelector('[data-slide][data-active]')).animationName);
    check('reduced-motion ' + mode + ': animation ' + want, an === want, an); await c2.close();
  }

  page('stp', sec(5, (i) => i === 0 || i === 1 || i === 2 ? ' data-steps="3" id="a' + i + '"' : i === 3 ? ' data-steps="2" id="a3"' : ''),
    `<script>
      window.log = [];
      function mk(name, bad) { var s = 1; var o = { enter: function (f) { log.push(name + ':enter:' + f); s = f ? 1 : 3; }, next: function () { if (s >= 3) return false; s++; log.push(name + ':next'); return true; },
        prev: function () { if (s <= 1) return false; s--; log.push(name + ':prev'); return true; }, get: function () { return s; }, goto: function (n) { s = n; log.push(name + ':goto:' + n); } }; if (bad) delete o.goto; return o; }
      SlideKit.stepper(document.getElementById('a0'), mk('A'));
      SlideKit.stepper(document.getElementById('a3'), mk('D', true));
      window.addEventListener('load', function () { SlideKit.stepper(document.getElementById('a1'), mk('B')); });
    </script>`);
  { const t = await ctx.newPage(); const te = []; t.on('pageerror', (e) => te.push(String(e)));
    const warns = []; t.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
    await t.goto(BASE + '/__t/stp#1'); await t.waitForSelector('#sk-stage'); await settled(t);
    const key = async (k, n) => { for (let i = 0; i < n; i++) await t.keyboard.press(k); };
    await key('ArrowRight', 2);
    check('stepper registered before start works (A step 3, still slide 1)', (await active(t)) === 1 && await t.evaluate(() => log.includes('A:next')), await t.evaluate(() => log));
    await key('ArrowRight', 1); await key('ArrowRight', 2);
    check('stepper registered after start works (B reaches slide 2, step 3)', (await active(t)) === 2 && (await t.evaluate(() => log.filter((x) => x === 'B:next').length)) === 2, [await active(t), await t.evaluate(() => log)]);
    await key('ArrowRight', 1);
    check('unregistered data-steps slide acts as plain slide', (await active(t)) === 3 && true);
    await key('ArrowRight', 1);
    check('rejected stepper (missing goto) warns and is a plain slide', (await active(t)) === 4 && warns.some((w) => /missing: goto/.test(w)), warns);
    await key('ArrowLeft', 2); await key('ArrowLeft', 1);
    check('going back into a stepper slide calls enter(false) (B on step 3)', (await active(t)) === 2 && await t.evaluate(() => log.includes('B:enter:false')), await t.evaluate(() => log));
    await t.evaluate(() => { log.length = 0; location.hash = '#4'; }); await settled(t);
    await t.evaluate(() => { location.hash = '#2'; }); await settled(t);
    check('hash jump into stepper slide runs enter(true) then goto(1)', (await t.evaluate(() => log.join())) === 'B:enter:true,B:goto:1', await t.evaluate(() => log));
    check('stepper tests: no exceptions', te.length === 0, te); await t.close(); }

  /* declarative steps (data-step) */
  const dsBody = '<section data-slide="content"><h2>one</h2></section>' +
    '<section data-slide="content"><h2 id="t">two</h2><p id="a" data-step="2">A</p><p id="b" data-step="3">B</p><p id="b2" data-step="3" data-step-effect="fade">B2</p><p id="n" data-step="2" data-step-effect="none">N</p></section>' +
    '<section data-slide="content"><h2>three</h2></section>';
  page('dstep', dsBody);
  page('dstep-fx', '<section data-slide="content"><h2>fx</h2>' + ['rise', 'fade', 'left', 'scale', 'blur', 'none', 'bogus'].map((e) => '<p id="fx-' + e + '" data-step="2" data-step-effect="' + e + '">' + e + '</p>').join('') + '</section>');
  page('vis-leak', '<section data-slide="content"><h2>one</h2></section><section data-slide="content"><h2>two</h2><p id="leak" style="visibility:visible">leak</p><p id="st" data-step="2">step</p></section><section data-slide="content"><h2>three</h2></section>');
  page('anim', '<section data-slide="content"><h2>one</h2></section><section data-slide="content"><h2>two</h2>' +
    '<p id="a" data-step="2">a</p><p id="b" data-step-out="3">b</p><p id="c" data-step="2" data-step-out="4">c</p><p id="d" data-step="3" style="--sk-step-delay:300ms">d</p>' +
    '<p id="e" data-step="2" data-step-effect="left">e</p><p id="f" data-step="2" style="--sk-away-x:100px;--sk-away-y:0px;--sk-away-scale:.5">f</p><p id="g" data-step="2" data-step-effect="blur">g</p></section><section data-slide="content"><h2>three</h2></section>');
  page('anim50', '<section data-slide="content"><h2>x</h2>' + Array.from({ length: 50 }, (_, i) => '<p data-step="2">item ' + i + '</p>').join('') + '</section><section data-slide="content"><h2>y</h2></section>');
  page('dstep-more', '<section data-slide="content" data-steps="4"><p id="a" data-step="2">A</p></section><section data-slide="content"><h2>x</h2></section>');
  page('dstep-custom', '<section data-slide="content" id="c"><p id="a" data-step="2">A</p><p id="z" data-step="3">Z</p></section><section data-slide="content"><h2>x</h2></section>',
    `<script>window.log = []; var s = 1; SlideKit.stepper(document.getElementById('c'), { enter: function () { s = 1; }, next: function () { log.push('next'); if (s >= 3) return false; s++; return true; }, prev: function () { if (s <= 1) return false; s--; return true; }, get: function () { return s; }, goto: function (n) { s = n; } });</script>`);
  const vis = (p, id) => p.evaluate((id) => getComputedStyle(document.getElementById(id)).visibility, id);
  { const d = await ctx.newPage(); const de = []; d.on('pageerror', (e) => de.push(String(e)));
    await d.goto(BASE + '/__t/dstep#1'); await d.waitForSelector('#sk-stage'); await settled(d);
    const key = async (k, n) => { for (let i = 0; i < (n || 1); i++) await d.keyboard.press(k); await settled(d); };
    await key('ArrowRight');
    check('data-step: step 1 hides later elements, layout kept', (await vis(d, 'a')) === 'hidden' && (await d.evaluate(() => document.getElementById('a').getBoundingClientRect().height)) > 0 && (await hash(d)) === '#2');
    await key('ArrowRight');
    check('data-step: next reveals step 2 only (stays on slide)', (await vis(d, 'a')) === 'visible' && (await vis(d, 'n')) === 'visible' && (await vis(d, 'b')) === 'hidden' && (await hash(d)) === '#2');
    await key('ArrowRight');
    check('data-step: step 3 reveals the rest', (await vis(d, 'b')) === 'visible' && (await vis(d, 'b2')) === 'visible' && (await hash(d)) === '#2');
    await key('ArrowRight');
    check('data-step: after the last step the next slide opens', (await hash(d)) === '#3');
    await key('ArrowLeft');
    check('data-step: coming back enters at the last step', (await hash(d)) === '#2' && (await vis(d, 'b')) === 'visible' && (await vis(d, 'a')) === 'visible');
    await key('ArrowLeft');
    check('data-step: prev hides the last step', (await vis(d, 'b')) === 'hidden' && (await vis(d, 'a')) === 'visible' && (await hash(d)) === '#2');
    await key('ArrowLeft'); await key('ArrowLeft');
    check('data-step: prev from step 1 goes to the previous slide', (await hash(d)) === '#1');
    await d.evaluate(() => { location.hash = '#2'; }); await settled(d);
    check('data-step: hash entry shows step 1', (await vis(d, 'a')) === 'hidden' && (await hash(d)) === '#2');
    check('data-step: duplicate-free, no errors', de.length === 0, de);
    await d.keyboard.press('o'); await settled(d);
    const thumb = await d.evaluate(() => [...document.querySelectorAll('#sk-overview [data-step]')].map((e) => getComputedStyle(e).visibility));
    check('data-step: overview copies show step 1', thumb.length === 4 && thumb.every((v) => v === 'hidden'), thumb);
    await d.keyboard.press('Escape');
    await d.emulateMedia({ media: 'print' }); await settled(d);
    const pv = await d.evaluate(() => [...document.querySelectorAll('#sk-stage [data-step]')].map((e) => getComputedStyle(e).visibility + getComputedStyle(e).opacity));
    check('data-step: print shows every step', pv.length === 4 && pv.every((v) => v === 'visible1'), pv);
    await d.emulateMedia({ media: 'screen' });
    await d.close(); }
  { const v = await ctx.newPage(); const ve = []; v.on('pageerror', (e) => ve.push(String(e)));
    await v.goto(BASE + '/__t/vis-leak#2'); await v.waitForSelector('#sk-stage'); await settled(v);
    const leaks = () => v.evaluate(() => [...document.querySelectorAll('#sk-stage > [data-slide]')].filter((s) => !s.hasAttribute('data-active') && !s.hasAttribute('data-leaving'))
      .flatMap((s) => [s, ...s.querySelectorAll('*')]).filter((e) => getComputedStyle(e).visibility !== 'hidden').map((e) => e.id || e.tagName));
    const lv = (id) => v.evaluate((id) => getComputedStyle(document.getElementById(id)).visibility, id);
    check('inactive slides: the active slide still shows its own visibility:visible child', (await lv('leak')) === 'visible');
    await v.keyboard.press('ArrowRight'); await v.keyboard.press('ArrowRight'); await settled(v); // step 2, then slide 3
    check('inactive slides: no descendant stays visible after leaving (author visibility:visible and running step transitions)', (await leaks()).length === 0, await leaks());
    const seq = ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowLeft'];
    let bad = [];
    for (const k of seq) { await v.keyboard.press(k); await sleep(120); /* inside the fade and the step transition */ await settled(v); bad = bad.concat(await leaks()); }
    await v.evaluate(() => { location.hash = '#2'; }); await settled(v); bad = bad.concat(await leaks());
    check('inactive slides: random moves, hash jumps and step back/forward leave no visible descendant', bad.length === 0, bad);
    // un-show transition in flight (visibility transition with a delay) when the slide is left by a jump: a running transition beats !important, so it must be cancelled
    await v.evaluate(() => { location.hash = '#2'; }); await settled(v);
    await v.keyboard.press('ArrowRight'); await settled(v); // step 2 shown
    await v.keyboard.press('ArrowLeft'); await sleep(40); // un-show starts (visibility goes hidden only after --sk-step-ms)
    const samples = await v.evaluate(() => new Promise((res) => {
      location.hash = '#1';
      const out = {}, at = (ms) => setTimeout(() => { const e = document.getElementById('st'); out[ms] = getComputedStyle(e).visibility + '/' + getComputedStyle(document.getElementById('leak')).visibility; if (ms === 300) res(out); }, ms);
      [10, 100, 300].forEach(at);
    }));
    check('inactive slides: a step element mid un-show transition does not stay on top after a jump (10ms, 100ms, 300ms)', Object.values(samples).every((x) => x === 'hidden/hidden'), samples);
    await v.keyboard.press('ArrowLeft'); // 1 -> leaving slide 2 is still visible while it fades (the crossfade is kept)
    check('inactive slides: the leaving slide keeps its subtree while fading, then hides it', ve.length === 0, ve);
    await v.close(); }
  { const m = await ctx.newPage(); const me = []; m.on('pageerror', (e) => me.push(String(e)));
    await m.goto(BASE + '/__t/anim#2'); await m.waitForSelector('#sk-stage'); await settled(m);
    const vv = (ids) => m.evaluate((ids) => ids.map((i) => getComputedStyle(document.getElementById(i)).visibility[0]).join(''), ids);
    const quiet = () => m.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 8000 }).then(() => sleep(200)); // wait for the transitions to end (360ms + the 300ms delay), not a fixed time
    const step = async () => { await m.keyboard.press('ArrowRight'); await quiet(); };
    check('anim step 1: entrance-only hidden, exit-only visible, mixed hidden', (await vv(['a', 'b', 'c', 'd'])) === 'hvhh', await vv(['a', 'b', 'c', 'd']));
    const away = await m.evaluate(() => { const cs = (i) => getComputedStyle(document.getElementById(i)); return { a: cs('a').transform + '|' + cs('a').opacity + '|' + cs('a').filter, e: cs('e').transform, f: cs('f').transform, g: cs('g').filter }; });
    check('anim away state: default = 20px down, transparent, no filter; alias left; variables; blur only when asked',
      away.a === 'matrix(1, 0, 0, 1, 0, 20)|0|none' && away.e === 'matrix(1, 0, 0, 1, -32, 0)' && away.f === 'matrix(0.5, 0, 0, 0.5, 100, 0)' && away.g === 'blur(12px)', away);
    await m.keyboard.press('ArrowRight'); await sleep(60);
    const hint = await m.evaluate(() => ({ wc: getComputedStyle(document.getElementById('a')).willChange, run: document.querySelector('#sk-stage > [data-active]').hasAttribute('data-step-run') }));
    await quiet();
    const hint2 = await m.evaluate(() => ({ wc: getComputedStyle(document.getElementById('a')).willChange, run: document.querySelector('#sk-stage > [data-active]').hasAttribute('data-step-run') }));
    check('anim will-change: set only while the transition runs, gone after it (no resident layers)', hint.wc === 'opacity, transform' && hint.run && hint2.wc === 'auto' && !hint2.run, [hint, hint2]);
    check('anim step 2: entrances shown, exit-only still visible', (await vv(['a', 'b', 'c', 'd'])) === 'vvvh', await vv(['a', 'b', 'c', 'd']));
    await m.keyboard.press('ArrowRight'); await sleep(100);
    const dl = await m.evaluate(() => getComputedStyle(document.getElementById('d')).opacity);
    await quiet();
    check('anim step 3: exit-only gone, mixed still visible, delayed entrance waits for its delay then shows', (await vv(['a', 'b', 'c', 'd'])) === 'vhvv' && Number(dl) < 0.2 && (await m.evaluate(() => getComputedStyle(document.getElementById('d')).opacity)) === '1', dl);
    await step();
    check('anim step 4: the exit of the mixed element happened; the step count is the largest of every N and M', (await vv(['a', 'b', 'c', 'd'])) === 'vhhv' && (await hash(m)) === '#2', await hash(m));
    await m.keyboard.press('ArrowRight'); await sleep(300);
    check('anim: one more arrow after the last step leaves the slide', (await hash(m)) === '#3');
    await m.keyboard.press('ArrowLeft'); await quiet();
    check('anim: coming back lands on the last step state (entrances shown, exits gone)', (await hash(m)) === '#2' && (await vv(['a', 'b', 'c', 'd'])) === 'vhhv', await vv(['a', 'b', 'c', 'd']));
    for (let i = 0; i < 3; i++) await m.keyboard.press('ArrowLeft');
    await quiet();
    check('anim: back to step 1 restores the exit-only element and hides entrances', (await vv(['a', 'b', 'c', 'd'])) === 'hvhh', await vv(['a', 'b', 'c', 'd']));
    await m.emulateMedia({ media: 'print' }); await sleep(100);
    check('anim print: last step state (later steps shown, anything with an exit is gone)', (await vv(['a', 'b', 'c', 'd'])) === 'vhhv', await vv(['a', 'b', 'c', 'd']));
    await m.emulateMedia({ media: 'screen' });
    await m.keyboard.press('o'); await sleep(200);
    const th = await m.evaluate(() => [...document.querySelectorAll('#sk-overview [data-slide]')][1] && ['a', 'b', 'c', 'd'].map((i) => { const e = [...document.querySelectorAll('#sk-overview [data-slide]')][1].querySelector('#' + i); return getComputedStyle(e).visibility[0]; }).join(''));
    check('anim overview thumbnail shows step 1', th === 'hvhh', th);
    await m.keyboard.press('Escape');
    check('anim: no page errors', me.length === 0, me);
    await m.close(); }
  { const m = await ctx.newPage(); await m.goto(BASE + '/__t/anim#2'); await m.waitForSelector('#sk-stage'); await settled(m);
    const quiet = () => m.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 8000 }).then(() => sleep(200));
    for (let i = 0; i < 2; i++) { await m.keyboard.press('ArrowRight'); await quiet(); } // step 3: d (delay 300ms) is shown
    const dv = () => m.evaluate(() => { const c = getComputedStyle(document.getElementById('d')); return c.visibility[0] + (+c.opacity).toFixed(2); });
    await m.keyboard.press('ArrowLeft'); await sleep(100);
    const runBack = await m.evaluate(() => document.querySelector('#sk-stage > [data-active]').getAttribute('data-step-run')); // the temporary state while the rewind transition runs
    await sleep(420); // rewinding: no delay, so the 360ms fade has ended and visibility is already hidden (with the delay it would only flip at 660ms)
    const back = await dv();
    await quiet();
    const settledAttr = await m.evaluate(() => document.querySelector('#sk-stage > [data-active]').hasAttribute('data-step-run'));
    check('anim rewind: --sk-step-delay applies only going forward; rewinding starts at once and the temporary state is gone after it', back === 'h0.00' && runBack === 'back' && !settledAttr, [back, runBack, settledAttr]);
    await m.keyboard.press('ArrowRight'); await sleep(100);
    const fwd = await dv(); // forward: the delay is kept (300ms), so at 100ms the entrance has not started
    check('anim forward: the delay still staggers the entrance', fwd[0] === 'v' && Number(fwd.slice(1)) < 0.05, fwd);
    await m.close(); }
  { const m = await ctx.newPage(); await m.emulateMedia({ reducedMotion: 'reduce' }); await m.goto(BASE + '/__t/anim#2'); await m.waitForSelector('#sk-stage'); await settled(m);
    await m.keyboard.press('ArrowRight'); await sleep(40);
    const r = await m.evaluate(() => ({ v: getComputedStyle(document.getElementById('a')).visibility, o: getComputedStyle(document.getElementById('a')).opacity, d: getComputedStyle(document.getElementById('a')).transitionDuration, run: document.querySelector('#sk-stage > [data-active]').hasAttribute('data-step-run') }));
    check('anim reduced motion: the state is exact right away, no transition, no layer hint', r.v === 'visible' && r.o === '1' && r.d === '0s' && !r.run, r);
    await m.close(); }
  { const m = await ctx.newPage(); await m.goto(BASE + '/__t/anim50#1'); await m.waitForSelector('#sk-stage'); await settled(m);
    const ms = await m.evaluate(() => { const out = []; for (let i = 0; i < 6; i++) { const t0 = performance.now(); document.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft', bubbles: true })); out.push(performance.now() - t0); } return out; });
    const med = ms.slice().sort((x, y) => x - y)[3];
    check('anim performance: one step change toggling 50 elements costs under 5ms of script (median of 6)', med < 5, ms.map((x) => +x.toFixed(2)));
    await m.close(); }
  { const f = await ctx.newPage(); await f.goto(BASE + '/__t/dstep-fx#1'); await f.waitForSelector('#sk-stage'); await settled(f);
    const st = await f.evaluate(() => Object.fromEntries([...document.querySelectorAll('#sk-stage [data-step]')].map((e) => { const c = getComputedStyle(e); return [e.id.slice(3), c.transform + '|' + c.filter + '|' + c.opacity]; })));
    check('data-step effects: hidden poses (rise, left, scale, blur; fade and none only opacity; unknown falls back to rise)',
      st.rise === 'matrix(1, 0, 0, 1, 0, 20)|none|0' && st.bogus === st.rise && st.left === 'matrix(1, 0, 0, 1, -32, 0)|none|0' && st.scale === 'matrix(0.92, 0, 0, 0.92, 0, 0)|none|0' &&
      st.blur === 'matrix(1, 0, 0, 1, 0, 0)|blur(12px)|0' && st.fade === 'matrix(1, 0, 0, 1, 0, 0)|none|0' && st.none === 'matrix(1, 0, 0, 1, 0, 0)|none|0', st); // no motion = identity transform (the away state is translate() scale() variables)
    await f.keyboard.press('ArrowRight'); await settled(f);
    const sh = await f.evaluate(() => [...document.querySelectorAll('#sk-stage [data-step]')].map((e) => { const c = getComputedStyle(e); return c.opacity + c.visibility + c.transform + c.filter; }));
    check('data-step effects: every effect ends fully shown', sh.every((v) => v === '1visiblenonenone'), sh);
    const say = await f.evaluate(() => document.querySelector('.sk-live, #sk-live, [role=status]').textContent);
    check('a11y: stepping forward announces the text that appeared', /단계 2 \/ 2: rise\. fade\. left\. scale\. blur\. none\. bogus$/.test(say) || /step 2 \/ 2: rise\./.test(say), say);
    await f.emulateMedia({ media: 'print' }); await f.keyboard.press('ArrowLeft'); await settled(f);
    const pr = await f.evaluate(() => [...document.querySelectorAll('#sk-stage [data-step]')].map((e) => { const c = getComputedStyle(e); return c.opacity + c.visibility + c.transform + c.filter; }));
    check('data-step effects: print shows all with no blur or transform', pr.every((v) => v === '1visiblenonenone'), pr);
    await f.close(); }
  { const A = await ctx.newPage(), B = await ctx.newPage();
    await A.goto(BASE + '/__t/dstep?sync=1#2'); await B.goto(BASE + '/__t/dstep?sync=1#2'); await A.waitForSelector('#sk-stage'); await B.waitForSelector('#sk-stage'); await settled(A, B);
    await A.keyboard.press('ArrowRight'); await A.keyboard.press('ArrowRight'); await settled(A, B);
    check('data-step: sync carries the step', (await vis(B, 'b')) === 'visible' && (await vis(B, 'a')) === 'visible' && (await hash(B)) === '#2');
    await A.close(); await B.close(); }
  /* blank is reported over the channel (6.5) but never blanks other windows */
  { const L = await ctx.newPage(), A = await ctx.newPage();
    await L.addInitScript(() => { window.__bm = []; const BC = window.BroadcastChannel; window.BroadcastChannel = function (n) { const c = new BC(n); c.addEventListener('message', (e) => { if (e.data && e.data.type === 'blank') window.__bm.push(e.data.mode); }); return c; }; });
    await L.goto(BASE + '/__t/dstep?sync=1#1'); await A.goto(BASE + '/__t/dstep?sync=1#1'); await L.waitForSelector('#sk-stage'); await A.waitForSelector('#sk-stage'); await settled(A, L);
    await A.keyboard.press('b'); await settled(A, L);
    check('blank: B reports black over the channel', JSON.stringify(await L.evaluate(() => window.__bm)) === '["black"]', await L.evaluate(() => window.__bm));
    check('blank: other windows are not blanked', !(await L.evaluate(() => document.getElementById('sk-blank').hasAttribute('data-blank'))));
    await A.keyboard.press('w'); await settled(A, L); await A.keyboard.press('w'); await settled(A, L);
    check('blank: switching and clearing are reported (white, null)', JSON.stringify(await L.evaluate(() => window.__bm)) === '["black","white",null]', await L.evaluate(() => window.__bm));
    await A.keyboard.press('b'); await settled(A, L);
    await L.evaluate(() => { window.__bm.length = 0; });
    const N = await ctx.newPage(); await N.addInitScript(() => { window.__bm = []; const BC = window.BroadcastChannel; window.BroadcastChannel = function (n) { const c = new BC(n); c.addEventListener('message', (e) => { if (e.data && e.data.type === 'blank') window.__bm.push(e.data.mode); }); return c; }; });
    await N.goto(BASE + '/__t/dstep?sync=1#1'); await N.waitForSelector('#sk-stage'); await settled(N, A);
    check('blank: hello restores the state for a reconnecting window', JSON.stringify(await N.evaluate(() => window.__bm)) === '["black"]', await N.evaluate(() => window.__bm));
    await L.close(); await A.close(); await N.close(); }
  /* the audience screen has no browser context menu while presenting (sync window); plain pages and embeds keep it */
  { const cm = (url) => ctx.newPage().then(async (q) => { await q.goto(url); await q.waitForSelector('#sk-stage'); const r = await q.evaluate(() => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; }); await q.close(); return r; });
    check('contextmenu: blocked in a sync (audience) window', (await cm(BASE + '/__t/dup?sync=1#1')) === true);
    check('contextmenu: kept on a plain page', (await cm(BASE + '/__t/dup#1')) === false);
    const e = await ctx.newPage(); await e.goto(BASE + '/__t/dup?embed=1#1'); await e.waitForSelector('#sk-stage');
    check('contextmenu: kept in embed mode (editor and presenter previews)', (await e.evaluate(() => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; })) === false); await e.close();
    const o = await ctx.newPage(); await o.goto(BASE + '/__t/dup#1'); await o.waitForSelector('#sk-stage'); await o.keyboard.press('o'); await settled(o);
    check('overview thumbnails use the pointer cursor', (await o.evaluate(() => getComputedStyle(document.querySelector('.sk-thumb')).cursor)) === 'pointer'); await o.close(); }
  /* remote blank: a presenter-role setblank message sets this window's blank; other roles and values are ignored */
  { const A = await ctx.newPage(), S = await ctx.newPage();
    await S.addInitScript(() => { const BC = window.BroadcastChannel; window.BroadcastChannel = function (n) { const c = new BC(n); window.__bc = c; return c; }; });
    await A.goto(BASE + '/__t/dstep?sync=1#1'); await S.goto(BASE + '/__t/dstep?sync=1#1'); await A.waitForSelector('#sk-stage'); await S.waitForSelector('#sk-stage');
    const send = (m) => S.evaluate((m) => window.__bc.postMessage(Object.assign({ v: 1, from: 'remote' }, m)), m);
    const mode = () => A.evaluate(() => document.getElementById('sk-blank').getAttribute('data-blank'));
    await send({ type: 'setblank', role: 'presenter', mode: 'black' }); await settled(A, S);
    check('setblank: presenter role blanks the window (black)', (await mode()) === 'black', await mode());
    await send({ type: 'setblank', role: 'presenter', mode: 'white' }); await settled(A, S);
    check('setblank: presenter role switches to white', (await mode()) === 'white', await mode());
    await send({ type: 'setblank', role: 'other', mode: 'off' }); await send({ type: 'setblank', mode: 'off' }); await send({ type: 'setblank', role: 'presenter', mode: 'red' }); await sleep(150); /* kept: ignored messages change nothing */
    check('setblank: other roles and unknown modes are ignored', (await mode()) === 'white', await mode());
    await send({ type: 'setblank', role: 'presenter', mode: 'off' }); await settled(A, S);
    check('setblank: off clears the blank', (await mode()) === null, await mode());
    await send({ type: 'setblank', role: 'presenter', mode: 'black' }); await send({ type: 'setblank', role: 'presenter', mode: null }); await settled(A, S);
    check('setblank: null clears the blank too', (await mode()) === null, await mode());
    await A.close(); await S.close(); }
  /* ?debug=1 diagnostic overlay: off by default, never in embed or print, follows slide and step */
  { const q = await ctx.newPage(); await q.goto(BASE + '/__t/dup?debug=1#1'); await q.waitForSelector('#sk-stage'); await settled(q);
    const txt = () => q.evaluate(() => { const e = document.getElementById('sk-debug'); return e ? e.textContent : null; });
    check('debug: overlay shows slide, step, fps and node count', /^slide 1\/3  step 1\/1  \d+ fps  \d+ nodes$/.test(await txt()), await txt());
    await q.keyboard.press('ArrowRight'); await settled(q);
    check('debug: overlay follows the slide', /^slide 2\/3 /.test(await txt()), await txt());
    check('debug: overlay is not exposed to assistive tech and ignores the pointer', await q.evaluate(() => { const e = document.getElementById('sk-debug'); return e.getAttribute('aria-hidden') === 'true' && getComputedStyle(e).pointerEvents === 'none'; }));
    await q.emulateMedia({ media: 'print' });
    check('debug: hidden in print', await q.evaluate(() => getComputedStyle(document.getElementById('sk-debug')).display === 'none'));
    await q.close();
    const n = await ctx.newPage(); await n.goto(BASE + '/__t/dup#1'); await n.waitForSelector('#sk-stage'); await settled(n);
    check('debug: absent without the query', (await n.evaluate(() => !document.getElementById('sk-debug'))));
    const e = await ctx.newPage(); await e.goto(BASE + '/__t/dup?embed=1&debug=1#1'); await e.waitForSelector('#sk-stage'); await settled(e);
    check('debug: absent in embed mode', (await e.evaluate(() => !document.getElementById('sk-debug')))); await n.close(); await e.close(); }
  /* data-layout is no longer supported: the engine ignores it and the slide stays a plain stacked slide (lint warns) */
  page('lay', '<section data-slide="content" data-layout="two-column"><h2 id="t2">T</h2><div data-col><p id="c1">a</p></div><div data-col><p id="c2">b</p></div></section>' +
    '<section data-slide="content" data-layout="big-number"><p data-big id="big">42%</p></section>');
  { const l = await ctx.newPage(); await l.goto(BASE + '/__t/lay#1'); await l.waitForSelector('#sk-stage'); await settled(l);
    const g = await l.evaluate(() => { const cs = (id) => getComputedStyle(document.getElementById(id)); const r = (id) => document.getElementById(id).getBoundingClientRect();
      return { disp: getComputedStyle(document.querySelector('[data-slide]')).display, same: Math.abs(r('c1').left - r('c2').left) < 2, bigFs: cs('big').fontSize }; });
    check('data-layout is ignored: no grid, columns stack, no preset font size', g.disp === 'flex' && g.same && g.bigFs !== '260px', g);
    await l.close(); }
  /* data-step="1" and invalid values are ignored with the element visible from the start (6.3) */
  page('ds1', '<section data-slide="content"><p id="one" data-step="1">x</p><p id="bad" data-step="abc">y</p><p id="two" data-step="2">z</p></section>');
  { const q = await ctx.newPage(); await q.goto(BASE + '/__t/ds1#1'); await q.waitForSelector('#sk-stage'); await settled(q);
    const v = await q.evaluate(() => ['one', 'bad', 'two'].map((i) => getComputedStyle(document.getElementById(i)).visibility));
    check('data-step: 1 and invalid values are visible from the start, 2 waits', JSON.stringify(v) === '["visible","visible","hidden"]', v);
    await q.close(); }
  { const m = await ctx.newPage(); await m.goto(BASE + '/__t/dstep-more#1'); await m.waitForSelector('#sk-stage');
    let n = 0; while ((await hash(m)) === '#1' && n < 10) { await m.keyboard.press('ArrowRight'); await settled(m); n++; }
    check('data-step: data-steps larger than the max N wins (4 steps)', n === 4, n); await m.close(); }
  { const c = await ctx.newPage(); await c.goto(BASE + '/__t/dstep-custom#1'); await c.waitForSelector('#sk-stage'); await settled(c);
    await c.keyboard.press('ArrowRight'); await settled(c);
    check('data-step: a registered custom stepper wins', (await c.evaluate(() => log.includes('next'))) && (await hash(c)) === '#1', await c.evaluate(() => log)); await c.close(); }
  { const rc = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    await rc.route('**/__t/*', (x) => x.fulfill({ contentType: 'text/html', body: pages.dstep }));
    const r = await rc.newPage(); await r.goto(BASE + '/__t/dstep#2'); await r.waitForSelector('#sk-stage');
    check('data-step: reduced motion has no transition', (await r.evaluate(() => getComputedStyle(document.getElementById('a')).transitionDuration)) === '0s'); await rc.close(); }
  await ctx.route(BASE + '/__e', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" src="/__t/dstep?embed=1" style="width:800px;height:450px"></iframe><script>window.log=[];addEventListener("message",e=>{if(e.source===document.getElementById("f").contentWindow)log.push(e.data)})</script>' }));
  { const h2 = await ctx.newPage(); await h2.goto(BASE + '/__e'); await frameReady(h2); await h2.waitForFunction(() => log.some((m) => m.type === 'ready'), null, { timeout: 3000 }).catch(() => {});
    const rd = await h2.evaluate(() => log.find((m) => m.type === 'ready'));
    check('data-step: info reports steps from data-step (3)', rd && rd.info.slides[1].steps === 3 && rd.info.slides[0].steps === 1, rd && rd.info.slides.map((s) => s.steps));
    await h2.evaluate(() => document.getElementById('f').contentWindow.postMessage({ source: 'slidekit', v: 1, type: 'goto', slide: 2, step: 3 }, location.origin)); await settled(h2);
    const st = await h2.evaluate(() => log.filter((m) => m.type === 'state').pop());
    const fr2 = h2.frames().find((f) => f !== h2.mainFrame());
    check('data-step: embed goto(slide, step) shows that step', st && st.slide === 2 && st.step === 3 && (await fr2.evaluate(() => getComputedStyle(document.getElementById('b')).visibility)) === 'visible', st); await h2.close(); }

  /* UX: crossfade, idle pointer, number pill with the chapter title, responsive overview */
  page('ux', sec(3));
  { const q = await ctx.newPage(); await clock(q); await q.goto(BASE + '/__t/ux#1'); await q.waitForSelector('#sk-stage'); /* fake clock: crossfade timer and idle timer */
    await q.keyboard.press('ArrowRight');
    const lv = await q.evaluate(() => { const o = document.querySelector('[data-slide]:not([data-active])'); const first = document.querySelectorAll('#sk-stage > [data-slide]')[0]; return { leaving: first.hasAttribute('data-leaving'), vis: getComputedStyle(first).visibility }; });
    check('crossfade: the old slide stays visible while leaving (arrow)', lv.leaving && lv.vis === 'visible', lv);
    await tick(q, 400); await animsDone(q); /* leaving is removed by a 360ms timer, then the opacity transition ends */
    check('crossfade: leaving clears after the animation', !(await q.evaluate(() => document.querySelector('[data-leaving]'))) && (await q.evaluate(() => getComputedStyle(document.querySelectorAll('#sk-stage > [data-slide]')[0]).visibility)) === 'hidden');
    await q.evaluate(() => { location.hash = '#3'; });
    check('crossfade: jumps (hash) do not crossfade', !(await q.evaluate(() => document.querySelector('[data-leaving]'))));
    await tick(q, 2100);
    check('idle: the pointer hides after 2s', await q.evaluate(() => document.documentElement.hasAttribute('data-idle')));
    await q.mouse.move(50, 50); await q.mouse.move(80, 80);
    check('idle: moving the mouse brings it back', !(await q.evaluate(() => document.documentElement.hasAttribute('data-idle'))));
    await q.close(); }
  { const rc = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    await rc.route('**/__t/*', (x) => x.fulfill({ contentType: 'text/html', body: pages.ux }));
    const r = await rc.newPage(); await r.goto(BASE + '/__t/ux#1'); await r.waitForSelector('#sk-stage'); await r.keyboard.press('ArrowRight');
    check('crossfade: reduced motion shows no leaving slide', (await r.evaluate(() => getComputedStyle(document.querySelectorAll('#sk-stage > [data-slide]')[0]).visibility)) === 'hidden'); await rc.close(); }
  { const n = await open(DECK + '#1'); await n.keyboard.press('3');
    const t = await n.evaluate(() => { const e = document.getElementById('sk-num'); return { text: e.textContent, bad: e.hasAttribute('data-bad') }; });
    check('number pill shows the chapter title', /^3\s+\S/.test(t.text) && !t.bad, t);
    await n.keyboard.press('Escape'); await n.keyboard.press('9');
    check('number pill dims for a missing chapter', await n.evaluate(() => document.getElementById('sk-num').hasAttribute('data-bad'))); await n.close(); }
  { const o = await open(DECK + '#3'); await o.setViewportSize({ width: 2000, height: 900 }); await o.keyboard.press('o'); await settled(o);
    const w = await o.evaluate(() => { const b = document.querySelectorAll('.sk-thumb-box'); const r = b[0].getBoundingClientRect(); return { w: r.width, h: r.height, t: document.querySelector('.sk-thumb-in').style.transform, cur: document.querySelectorAll('.sk-thumb[data-cur]').length }; });
    check('overview: thumbnails fill the grid and scale to the box, one current marker', w.w > 250 && Math.abs(w.w / w.h - 16 / 9) < 0.05 && /scale\(0\.1[3-9]|scale\(0\.[2-9]/.test(w.t) && w.cur === 1, w); await o.close(); }

  /* accessibility: live region, overview focus */
  page('a11y', '<section data-slide="cover"><h1>첫 장</h1></section><section data-slide="chapter" data-title="둘째 장"><h1>둘째 장</h1></section><section data-slide="content"><h2>셋째 제목</h2></section>');
  { const a = await ctx.newPage(); await a.goto(BASE + '/__t/a11y#1'); await a.waitForSelector('#sk-stage'); await settled(a);
    const live = () => a.evaluate(() => { const l = document.getElementById('sk-live'); return { role: l.getAttribute('role'), atomic: l.getAttribute('aria-live'), text: l.textContent, px: l.getBoundingClientRect().width }; });
    let l1 = await live();
    check('a11y: a polite status region announces slide n / N and the name', l1.role === 'status' && l1.atomic === 'polite' && l1.text === '슬라이드 1 / 3, 첫 장' && l1.px <= 1, l1);
    await a.keyboard.press('ArrowRight'); l1 = await live();
    check('a11y: moving announces the chapter title', l1.text === '슬라이드 2 / 3, 둘째 장', l1);
    await a.keyboard.press('ArrowRight'); l1 = await live();
    check('a11y: moving announces a content slide by its heading', l1.text === '슬라이드 3 / 3, 셋째 제목', l1);
    await a.keyboard.press('o'); await settled(a);
    check('a11y: opening the overview moves focus into it and announces the selection', await a.evaluate(() => document.getElementById('sk-overview').contains(document.activeElement) && /^전체 보기, 3 /.test(document.getElementById('sk-live').textContent)));
    await a.keyboard.press('ArrowLeft'); await settled(a);
    check('a11y: overview selection changes are announced', /^전체 보기, 2 /.test(await a.evaluate(() => document.getElementById('sk-live').textContent)));
    await a.keyboard.press('Escape'); await settled(a);
    check('a11y: closing the overview releases focus', await a.evaluate(() => !document.getElementById('sk-overview').contains(document.activeElement)));
    await a.close(); }
  await ctx.route(BASE + '/__ea', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" src="/__t/a11y?embed=1" style="width:800px;height:450px"></iframe>' }));
  { const e = await ctx.newPage(); await e.goto(BASE + '/__ea'); await frameReady(e);
    const fr = e.frames().find((f) => f !== e.mainFrame());
    check('a11y: embed mode has no live region', await fr.evaluate(() => !document.getElementById('sk-live')), null); await e.close(); }

  /* blank screen (B, W) */
  page('blank', sec(3) + '<input id="inp">');
  { const k = await ctx.newPage(); const ke = []; k.on('pageerror', (e) => ke.push(String(e)));
    await k.goto(BASE + '/__t/blank#2'); await k.waitForSelector('#sk-stage'); await settled(k);
    const ov = () => k.evaluate(() => { const o = document.getElementById('sk-blank'); const c = getComputedStyle(o); return { on: o.hasAttribute('data-blank'), mode: o.getAttribute('data-blank'), display: c.display, bg: c.backgroundColor, z: c.zIndex, stageHidden: document.getElementById('sk-stage').getAttribute('aria-hidden') }; });
    check('blank: overlay exists, off by default', (await ov()).on === false && (await ov()).display === 'none');
    await k.keyboard.press('b');
    let o1 = await ov();
    check('blank: B shows a black full overlay (stage aria-hidden)', o1.mode === 'black' && o1.display === 'block' && o1.bg === 'rgb(0, 0, 0)' && o1.stageHidden === 'true', o1);
    await k.keyboard.press('w'); o1 = await ov();
    check('blank: W switches to white', o1.mode === 'white' && o1.bg === 'rgb(255, 255, 255)', o1);
    await k.keyboard.press('w'); o1 = await ov();
    check('blank: the same key again restores', !o1.on && o1.stageHidden === null, o1);
    await k.keyboard.press('b'); await k.keyboard.press('ArrowRight');
    check('blank: an arrow restores without moving', !(await ov()).on && (await hash(k)) === '#2', await hash(k));
    await k.keyboard.press('ArrowRight'); check('blank: the next arrow moves normally', (await hash(k)) === '#3');
    await k.keyboard.press('w'); await k.keyboard.press('Escape');
    check('blank: Esc restores', !(await ov()).on && (await hash(k)) === '#3');
    await k.keyboard.press('b'); await k.keyboard.press('KeyO').catch(() => {}); await k.keyboard.press('o');
    check('blank: other keys do nothing while blank (overview stays closed)', !(await k.evaluate(() => document.getElementById('sk-overview').hasAttribute('data-open'))));
    await k.keyboard.press('b');
    await k.keyboard.press('Meta+b'); check('blank: Meta+B ignored', !(await ov()).on);
    await k.focus('#inp'); await k.keyboard.press('b'); await k.keyboard.press('w');
    check('blank: ignored while typing in an input', !(await ov()).on && (await k.inputValue('#inp')) === 'bw');
    await k.evaluate(() => document.getElementById('inp').blur()); await k.keyboard.press('b');
    await k.emulateMedia({ media: 'print' }); await settled(k);
    check('blank: hidden in print', (await ov()).display === 'none'); await k.emulateMedia({ media: 'screen' });
    check('blank: no errors', ke.length === 0, ke); await k.close(); }
  { const A = await ctx.newPage(), B = await ctx.newPage();
    await A.goto(BASE + '/__t/blank?sync=1#1'); await B.goto(BASE + '/__t/blank?sync=1#1'); await A.waitForSelector('#sk-stage'); await B.waitForSelector('#sk-stage'); await settled(A, B);
    await A.keyboard.press('b'); await B.keyboard.press('ArrowRight'); await settled(A, B);
    check('blank: each window is independent (A blank, B not, A follows position)', (await A.evaluate(() => document.getElementById('sk-blank').hasAttribute('data-blank'))) && !(await B.evaluate(() => document.getElementById('sk-blank').hasAttribute('data-blank'))) && (await hash(A)) === '#2', await hash(A));
    await A.close(); await B.close(); }
  await ctx.route(BASE + '/__eb', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" src="/__t/blank?embed=1" style="width:800px;height:450px"></iframe>' }));
  { const e = await ctx.newPage(); await e.goto(BASE + '/__eb'); await frameReady(e);
    const fr3 = e.frames().find((f) => f !== e.mainFrame()); await fr3.focus('body').catch(() => {}); await e.keyboard.press('b'); await settled(e);
    check('blank: embed mode ignores B', (await fr3.evaluate(() => !document.getElementById('sk-blank'))), null); await e.close(); }

  { const pr = await open(DECK + '#' + tokIdx); const buf = await pr.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    check('print: one page per slide (53), 16:9', pages === 53 && /MediaBox \[0 0 1440 810\]/.test(buf.toString('latin1')), pages); await pr.close(); }

  /* wrong origin: host on localhost, deck on 127.0.0.1 */
  const LOCAL = BASE.replace('127.0.0.1', 'localhost');
  await ctx.route(LOCAL + '/__x', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" src="' + BASE + '/__t/dup?embed=1" style="width:800px;height:450px"></iframe><script>window.log=[];addEventListener("message",e=>log.push(e.data))</script>' }));
  { const x = await ctx.newPage(); await x.goto(LOCAL + '/__x');
    const fx = await frameReady(x);
    await x.evaluate(() => document.getElementById('f').contentWindow.postMessage({ source: 'slidekit', v: 1, type: 'goto', slide: 3 }, '*')); await settled(x);
    const at = await fx.evaluate(() => [].findIndex.call(document.querySelectorAll('#sk-stage > [data-slide]'), (e) => e.hasAttribute('data-active')) + 1);
    check('embed: cross-origin parent message rejected, nothing sent to it', at === 1 && (await x.evaluate(() => log.length)) === 0, [at, await x.evaluate(() => log)]); await x.close(); }
  { const x = await ctx.newPage(); await ctx.route('**/__y', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" src="/__t/dup?embed=1" style="width:800px;height:450px"></iframe>' }));
    await x.goto(BASE + '/__y');
    const fy = await frameReady(x);
    const post = (m) => x.evaluate((m) => document.getElementById('f').contentWindow.postMessage(m, location.origin), m);
    const at = () => fy.evaluate(() => [].findIndex.call(document.querySelectorAll('#sk-stage > [data-slide]'), (e) => e.hasAttribute('data-active')) + 1);
    await post({ source: 'other', v: 1, type: 'goto', slide: 3 }); await post({ source: 'slidekit', v: 2, type: 'goto', slide: 3 }); await post(null); await post('goto'); await sleep(150); /* kept: a rejected message changes nothing, so there is nothing to wait for; 150ms is several frames */
    const before = await at();
    await post({ source: 'slidekit', v: 1, type: 'goto', slide: 3 }); await fy.waitForFunction(() => document.querySelector('#sk-stage > [data-slide]:nth-child(3)').hasAttribute('data-active'), null, { timeout: 3000 }).catch(() => {});
    check('embed: wrong source, version or shape ignored; valid message accepted', before === 1 && (await at()) === 3, [before, await at()]); await x.close(); }

  await browser.close();
  const failed = results.filter((r) => !r[0]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
