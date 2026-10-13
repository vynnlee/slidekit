/* One-shot browser check for engine + workshop deck.
   Usage: PW=<path to playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:3150 node verify.cjs */
const { chromium } = require(process.env.PW || 'playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:3150';
const DECK = BASE + '/decks/vibe-coding-workshop/index.html';
const results = [];
const check = (name, ok, extra) => { results.push([ok, name, extra]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-gpu'] });
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
  await p.mouse.wheel(0, 600); await p.mouse.move(900, 360); await sleep(300);
  check('click, space, enter, pagedown, wheel do not move', (await hash(p)) === '#1');
  await p.keyboard.press('ArrowLeft');
  check('left at first slide stays', (await hash(p)) === '#1');

  /* hash entry */
  await p.goto(DECK + '#10'); await p.waitForSelector('#sk-stage');
  check('#10 direct entry', (await active(p)) === 10 && (await hash(p)) === '#10');
  await p.goto(DECK + '#999'); await p.waitForSelector('#sk-stage');
  check('#999 clamps to 53', (await active(p)) === 53);
  await p.evaluate(() => { location.hash = '#7'; }); await sleep(200);
  check('hashchange moves', (await active(p)) === 7);

  /* tok stepper */
  await p.goto(DECK + '#' + (tokIdx - 1)); await p.waitForSelector('#sk-stage');
  const tokState = () => p.evaluate(() => { const c = document.getElementById('tok').classList; return c.contains('out') ? 4 : c.contains('ids') ? 3 : c.contains('split') ? 2 : 1; });
  await p.keyboard.press('ArrowRight');
  check('arrow into tok slide, step 1', (await active(p)) === tokIdx && (await tokState()) === 1);
  const fw = [];
  for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowRight'); await sleep(150); fw.push((await tokState()) + ':' + (await active(p))); }
  check('3 rights stay on tok slide, steps 2,3,4', fw.join() === `2:${tokIdx},3:${tokIdx},4:${tokIdx}`, fw);
  await p.keyboard.press('ArrowRight');
  check('4th right leaves to next slide', (await active(p)) === tokIdx + 1);
  await p.keyboard.press('ArrowLeft');
  check('coming back lands on step 4', (await active(p)) === tokIdx && (await tokState()) === 4);
  const bk = [];
  for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowLeft'); await sleep(100); bk.push((await tokState()) + ':' + (await active(p))); }
  check('3 lefts to step 1 on tok slide', bk.join() === `3:${tokIdx},2:${tokIdx},1:${tokIdx}`, bk);
  await p.keyboard.press('ArrowLeft');
  check('left at step 1 goes to previous slide', (await active(p)) === tokIdx - 1);
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await sleep(200);
  await p.focus('#tok-input');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('f'); await p.keyboard.press('o');
  check('keys in input do not move or open overview', (await active(p)) === tokIdx && (await tokState()) === 2 && !(await p.evaluate(() => document.getElementById('sk-overview').hasAttribute('data-open'))));
  await p.keyboard.press('Escape');
  check('Esc blurs the input', await p.evaluate(() => document.activeElement.tagName !== 'INPUT'));

  /* patrol bot only when active */
  const botT = () => p.evaluate(() => document.querySelector('#ft .cc-bot').style.transform);
  await p.goto(DECK + '#' + ftIdx); await p.waitForSelector('#sk-stage');
  const a1 = await botT(); await sleep(3000); const a2 = await botT();
  await p.keyboard.press('ArrowRight'); const b1 = await botT(); await sleep(3000); const b2 = await botT();
  check('bot moves while active', a1 !== a2, [a1, a2]);
  check('bot frozen while inactive', b1 === b2, [b1, b2]);

  /* number + Enter, indicator */
  await p.goto(DECK + '#1'); await p.waitForSelector('#sk-stage');
  const chap = await p.evaluate(() => [].map.call(document.querySelectorAll('#sk-stage > [data-slide="chapter"]'), (e) => [].indexOf.call(e.parentNode.children, e) + 1));
  await p.keyboard.press('3');
  check('digit shows indicator', await p.evaluate(() => { const n = document.getElementById('sk-num'); return !n.hidden && n.textContent === '3'; }));
  await p.keyboard.press('Enter');
  check('3 Enter goes to chapter 3', (await active(p)) === chap[2] && (await hash(p)) === '#' + chap[2], [chap, await hash(p)]);
  await p.keyboard.press('9'); await p.keyboard.press('Enter');
  check('missing chapter ignored', (await active(p)) === chap[2]);
  await p.keyboard.press('2'); await p.keyboard.press('Escape'); await p.keyboard.press('Enter');
  check('Esc cancels number', (await active(p)) === chap[2]);
  await p.keyboard.press('2'); await sleep(3300);
  check('indicator clears after 3s', await p.evaluate(() => document.getElementById('sk-num').hidden));

  /* overview */
  await p.goto(DECK + '#1'); await p.waitForSelector('#sk-stage');
  await p.keyboard.press('o'); await sleep(300);
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
  await p.keyboard.press('Enter'); await sleep(100);
  check('Enter in overview jumps and closes', (await active(p)) === selIdx + 1 && !(await p.evaluate(() => document.getElementById('sk-overview').hasAttribute('data-open'))));
  await p.keyboard.press('o'); await p.keyboard.press('Escape');
  check('Esc closes overview', !(await p.evaluate(() => document.getElementById('sk-overview').hasAttribute('data-open'))));
  await p.keyboard.press('o'); await p.locator('.sk-thumb').nth(4).click(); await sleep(100);
  check('thumb click jumps', (await active(p)) === 5);
  await p.keyboard.press('Meta+o');
  check('modifier keys ignored', !(await p.evaluate(() => document.getElementById('sk-overview').hasAttribute('data-open'))));

  /* fullscreen (headless may refuse; just must not throw and F must be handled) */
  const fsErr = errors.length;
  await p.keyboard.press('f'); await sleep(300);
  const fs = await p.evaluate(() => !!document.fullscreenElement);
  console.log('INFO fullscreen after F: ' + fs);
  check('F handled without errors', errors.length === fsErr);
  if (fs) await p.keyboard.press('f');

  /* embed */
  await ctx.route('**/__host', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" src="/decks/vibe-coding-workshop/index.html?embed=1" style="width:800px;height:450px"></iframe><script>window.log=[];addEventListener("message",e=>{if(e.source===document.getElementById("f").contentWindow)log.push(e.data)})</script>' }));
  const h = await ctx.newPage();
  await h.goto(BASE + '/__host'); await sleep(1200);
  const send = (m) => h.evaluate((m) => document.getElementById('f').contentWindow.postMessage(Object.assign({ source: 'slidekit', v: 1 }, m), location.origin), m);
  const logOf = (t) => h.evaluate((t) => log.filter((m) => m.type === t), t);
  const ready = (await logOf('ready'))[0];
  check('embed ready with info', !!ready && ready.info.slides.length === 53 && ready.info.chapters.length === 7 && ready.info.meta.id === 'vibe-coding-workshop' && ready.info.slides[2].chapter === 1 && ready.info.slides[0].title === null && ready.info.slides[tokIdx - 1].steps === 4, ready && ready.info.slides.slice(0, 3));
  await send({ type: 'goto', slide: 12, step: 1 }); await sleep(200);
  let st = (await logOf('state')).pop();
  check('embed goto -> state 12/1', st && st.slide === 12 && st.step === 1, st);
  await send({ type: 'goto', slide: tokIdx, step: 3 }); await sleep(200);
  st = (await logOf('state')).pop();
  check('embed goto to stepper slide step 3', st && st.slide === tokIdx && st.step === 3, st);
  await send({ type: 'next' }); await sleep(200); st = (await logOf('state')).pop();
  check('embed next steps to 4', st.slide === tokIdx && st.step === 4, st);
  await send({ type: 'next' }); await sleep(200); st = (await logOf('state')).pop();
  await send({ type: 'prev' }); await sleep(200); st = (await logOf('state')).pop();
  check('embed prev back into step 4', st.slide === tokIdx && st.step === 4, st);
  const fr = h.frames().find((f) => f !== h.mainFrame());
  await fr.focus('body').catch(() => {}); await h.keyboard.press('ArrowRight'); await h.keyboard.press('o'); await sleep(200);
  const idle = await fr.evaluate(() => ({ hash: location.hash, ov: !document.getElementById('sk-overview') }));
  check('embed ignores keys, no overview, no hash', idle.hash === '' && idle.ov, idle);
  await send({ type: 'get-info' }); await sleep(200);
  check('get-info answers', (await logOf('info')).length === 1);

  /* sync */
  const A = await open(DECK + '?sync=1#1');
  const B = await open(DECK + '?sync=1#1');
  await A.keyboard.press('ArrowRight'); await A.keyboard.press('ArrowRight'); await sleep(300);
  check('sync: A moves, B follows', (await active(B)) === 3, await active(B));
  await B.keyboard.press('ArrowLeft'); await sleep(300);
  check('sync: B moves, A follows', (await active(A)) === 2);
  await A.goto(DECK + '?sync=1#' + tokIdx); await A.waitForSelector('#sk-stage'); await sleep(300);
  await A.keyboard.press('ArrowRight'); await A.keyboard.press('ArrowRight'); await sleep(300);
  const bTok = await B.evaluate(() => ({ s: [].findIndex.call(document.querySelectorAll('#sk-stage > [data-slide]'), (e) => e.hasAttribute('data-active')) + 1, split: document.getElementById('tok').classList.contains('split'), ids: document.getElementById('tok').classList.contains('ids') }));
  check('sync carries stepper step (tok step 3 on B)', bTok.s === tokIdx && bTok.split && bTok.ids, bTok);
  const C = await open(DECK + '?sync=1'); await sleep(400);
  check('sync: hello makes a late joiner adopt current position', (await active(C)) === tokIdx, await active(C));
  const D = await open(DECK + '#1'); await A.keyboard.press('ArrowRight'); await sleep(300);
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
  const q2 = await open(DECK + '#3'); await q2.evaluate(() => { location.hash = '#9999'; }); await sleep(200);
  check('hashchange out of range clamps', (await active(q2)) === 53, await active(q2));
  await q2.close();

  page('zero', '<h1>no slides</h1>');
  { const z = await ctx.newPage(); const ze = []; z.on('pageerror', (e) => ze.push(String(e))); const zw = []; z.on('console', (m) => { if (m.type() === 'warning') zw.push(m.text()); });
    await z.goto(BASE + '/__t/zero'); await sleep(300);
    check('zero slides: no exception, warns, no stage', ze.length === 0 && zw.some((t) => /no <section data-slide>/.test(t)) && !(await z.$('#sk-stage')), [ze, zw]); await z.close(); }

  page('dup', sec(3, () => ' id="x"'));
  { const d = await ctx.newPage(); const de = []; d.on('pageerror', (e) => de.push(String(e)));
    await d.goto(BASE + '/__t/dup#1'); await d.waitForSelector('#sk-stage');
    await d.keyboard.press('ArrowRight'); await d.keyboard.press('ArrowRight'); await d.keyboard.press('ArrowRight');
    check('duplicate ids: no exception, navigation works', de.length === 0 && (await active(d)) === 3 && (await hash(d)) === '#3', [de, await active(d)]);
    await d.keyboard.press('o'); await d.keyboard.press('Enter'); await sleep(100);
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
    await t.goto(BASE + '/__t/stp#1'); await t.waitForSelector('#sk-stage'); await sleep(200);
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
    await t.evaluate(() => { log.length = 0; location.hash = '#4'; }); await sleep(100);
    await t.evaluate(() => { location.hash = '#2'; }); await sleep(200);
    check('hash jump into stepper slide runs enter(true) then goto(1)', (await t.evaluate(() => log.join())) === 'B:enter:true,B:goto:1', await t.evaluate(() => log));
    check('stepper tests: no exceptions', te.length === 0, te); await t.close(); }

  { const pr = await open(DECK + '#' + tokIdx); const buf = await pr.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    check('print: one page per slide (53), 16:9', pages === 53 && /MediaBox \[0 0 1440 810\]/.test(buf.toString('latin1')), pages); await pr.close(); }

  /* wrong origin: host on localhost, deck on 127.0.0.1 */
  const LOCAL = BASE.replace('127.0.0.1', 'localhost');
  await ctx.route(LOCAL + '/__x', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" src="' + BASE + '/__t/dup?embed=1" style="width:800px;height:450px"></iframe><script>window.log=[];addEventListener("message",e=>log.push(e.data))</script>' }));
  { const x = await ctx.newPage(); await x.goto(LOCAL + '/__x'); await sleep(1000);
    const fx = x.frames().find((f) => f !== x.mainFrame());
    await x.evaluate(() => document.getElementById('f').contentWindow.postMessage({ source: 'slidekit', v: 1, type: 'goto', slide: 3 }, '*')); await sleep(300);
    const at = await fx.evaluate(() => [].findIndex.call(document.querySelectorAll('#sk-stage > [data-slide]'), (e) => e.hasAttribute('data-active')) + 1);
    check('embed: cross-origin parent message rejected, nothing sent to it', at === 1 && (await x.evaluate(() => log.length)) === 0, [at, await x.evaluate(() => log)]); await x.close(); }
  { const x = await ctx.newPage(); await ctx.route('**/__y', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe id="f" src="/__t/dup?embed=1" style="width:800px;height:450px"></iframe>' }));
    await x.goto(BASE + '/__y'); await sleep(800);
    const fy = x.frames().find((f) => f !== x.mainFrame());
    const post = (m) => x.evaluate((m) => document.getElementById('f').contentWindow.postMessage(m, location.origin), m);
    const at = () => fy.evaluate(() => [].findIndex.call(document.querySelectorAll('#sk-stage > [data-slide]'), (e) => e.hasAttribute('data-active')) + 1);
    await post({ source: 'other', v: 1, type: 'goto', slide: 3 }); await post({ source: 'slidekit', v: 2, type: 'goto', slide: 3 }); await post(null); await post('goto'); await sleep(200);
    const before = await at();
    await post({ source: 'slidekit', v: 1, type: 'goto', slide: 3 }); await sleep(200);
    check('embed: wrong source, version or shape ignored; valid message accepted', before === 1 && (await at()) === 3, [before, await at()]); await x.close(); }

  await browser.close();
  const failed = results.filter((r) => !r[0]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
