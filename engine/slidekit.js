/* slidekit engine, spec v1. No dependencies. */
(function () {
  'use strict';

  var W = 1920, H = 1080;
  var KINDS = ['cover', 'chapter', 'content', 'end'];
  var METHODS = ['enter', 'next', 'prev', 'get', 'goto'];
  var SK = window.SlideKit = window.SlideKit || {};
  var steppers = new WeakMap();

  SK.scale = 1;

  /* Can be called before or after the engine starts. */
  SK.stepper = function (el, impl) {
    var missing = !el || !impl ? ['(element or implementation)'] :
      METHODS.filter(function (m) { return typeof impl[m] !== 'function'; });
    if (missing.length) {
      console.warn('[slidekit] stepper rejected, missing: ' + missing.join(', '), el);
      return;
    }
    steppers.set(el, impl);
  };

  function make(tag, id, cls) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (cls) e.className = cls;
    return e;
  }

  /* stepper for data-step elements. Jumps (enter, goto) are instant; next and prev animate through CSS. */
  function autoStepper(s, els) {
    var cur = 1;
    function apply(k, instant) {
      cur = k;
      if (instant) s.el.setAttribute('data-step-instant', '');
      els.forEach(function (x) { x.toggleAttribute('data-shown', Number(x.getAttribute('data-step')) <= k); });
      if (instant) { void s.el.offsetWidth; s.el.removeAttribute('data-step-instant'); }
    }
    return {
      enter: function (forward) { apply(forward ? 1 : s.steps, true); },
      next: function () { if (cur >= s.steps) return false; apply(cur + 1); return true; },
      prev: function () { if (cur <= 1) return false; apply(cur - 1); return true; },
      get: function () { return cur; },
      goto: function (n) { apply(Math.max(1, Math.min(s.steps, n)), true); }
    };
  }

  function start() {
    var root = document.documentElement;
    if (root.getAttribute('data-slidekit') !== '1') {
      console.warn('[slidekit] data-slidekit is "' + root.getAttribute('data-slidekit') + '", engine implements "1"');
    }
    var qs = new URLSearchParams(location.search);
    var embed = qs.get('embed') === '1' || root.hasAttribute('data-sk-embed'), sync = qs.get('sync') === '1';

    /* meta */
    var parsed = {}, metaEl = document.getElementById('deck-meta');
    try { parsed = JSON.parse(metaEl.textContent) || {}; }
    catch (err) { console.warn('[slidekit] #deck-meta missing or invalid, using defaults'); }
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts.length && parts[parts.length - 1].indexOf('.') > -1) parts.pop();
    var meta = Object.assign({
      title: document.title, lang: 'ko', visibility: 'public', pageNumber: false, progress: false,
      id: parts[parts.length - 1] || 'deck'
    }, parsed);

    /* slides */
    var els = [].filter.call(document.body.children, function (c) { return c.matches('section[data-slide]'); });
    if (!els.length) { console.warn('[slidekit] no <section data-slide> found'); return; }
    var stage = make('div', 'sk-stage');
    stage.setAttribute('role', 'main');
    document.body.insertBefore(stage, els[0]);
    els.forEach(function (e) { stage.appendChild(e); });

    var chapterNo = 0;
    var slides = els.map(function (e, i) {
      var kind = e.getAttribute('data-slide');
      if (KINDS.indexOf(kind) < 0) { console.warn('[slidekit] unknown data-slide "' + kind + '", treated as content', e); kind = 'content'; }
      var title = e.getAttribute('data-title');
      if (kind === 'chapter') { chapterNo++; if (!title) console.warn('[slidekit] chapter without data-title', e); }
      var steps = 1, raw = e.getAttribute('data-steps');
      if (raw !== null) {
        steps = Number(raw);
        if (!(steps >= 2 && Math.floor(steps) === steps)) { console.warn('[slidekit] invalid data-steps "' + raw + '"', e); steps = 1; }
      }
      var note = e.querySelector(':scope > aside[data-notes]');
      /* declarative steps: data-step="N" (integer >= 2) reveals the element from step N on */
      var stepEls = [].filter.call(e.querySelectorAll('[data-step]'), function (x) {
        var n = Number(x.getAttribute('data-step'));
        if (n >= 2 && Math.floor(n) === n) return true;
        if (n !== 1) console.warn('[slidekit] invalid data-step "' + x.getAttribute('data-step') + '"', x);
        return false;
      });
      stepEls.forEach(function (x) { steps = Math.max(steps, Number(x.getAttribute('data-step'))); });
      var s = { el: e, n: i + 1, kind: kind, title: title || null, chapter: chapterNo, steps: steps,
                notes: note ? note.textContent.trim() : '', auto: null };
      if (stepEls.length) s.auto = autoStepper(s, stepEls);
      return s;
    });
    slides.forEach(function (s) { if (s.auto) s.auto.enter(true); }); /* every slide starts at step 1 (overview copies show this) */
    var chapters = slides.filter(function (s) { return s.kind === 'chapter'; });
    /* a stepper registered with SlideKit.stepper wins over the declarative one */
    var stepperOf = function (i) { return slides[i].steps > 1 ? steppers.get(slides[i].el) || slides[i].auto : null; };

    /* page number, progress, number entry */
    var pageEl, progEl, numEl = make('div', 'sk-num');
    numEl.hidden = true;
    stage.appendChild(numEl);
    if (!embed && meta.pageNumber === true) { pageEl = make('div', 'sk-page'); stage.appendChild(pageEl); }
    if (!embed && meta.progress === true) {
      progEl = make('div', 'sk-progress'); progEl.appendChild(document.createElement('i')); stage.appendChild(progEl);
    }

    /* position */
    var cur = -1, step = 1, started = false;
    var me = Math.random().toString(36).slice(2, 8);
    var bc = null;

    function fire(el, type, n) {
      el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: { slide: n } }));
    }

    /* mode: 'fwd' | 'back' | 'jump'. 'jump' runs enter(true) then goto(toStep). */
    function show(i, mode, toStep, quiet) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      var st = stepperOf(i);
      if (i !== cur) {
        if (cur >= 0) {
          var old = slides[cur].el;
          old.removeAttribute('data-active'); fire(old, 'sk:leave', cur + 1);
          /* arrows crossfade: the old slide stays on screen while it fades out (CSS, motion allowed only) */
          if (mode !== 'jump' && !embed) { old.setAttribute('data-leaving', ''); clearTimeout(old._skLeave); old._skLeave = setTimeout(function () { old.removeAttribute('data-leaving'); }, 360); }
        }
        cur = i;
        clearTimeout(slides[i].el._skLeave); slides[i].el.removeAttribute('data-leaving');
        slides[i].el.setAttribute('data-active', '');
        if (st) st.enter(mode !== 'back');
        fire(slides[i].el, 'sk:enter', i + 1);
      }
      if (st && mode === 'jump') st.goto(Math.max(1, Math.min(slides[i].steps, toStep || 1)));
      step = st ? st.get() : 1;
      changed(quiet);
    }

    function move(d) {
      var st = stepperOf(cur);
      if (st && (d > 0 ? st.next() : st.prev())) { step = st.get(); changed(); return; }
      var i = cur + d;
      if (i >= 0 && i < slides.length) show(i, d > 0 ? 'fwd' : 'back');
    }

    function changed(quiet) {
      var s = slides[cur], edge = s.kind === 'cover' || s.kind === 'end';
      if (pageEl) { pageEl.textContent = s.n + ' / ' + slides.length; pageEl.hidden = edge; }
      if (progEl) { progEl.firstChild.style.width = (s.n / slides.length * 100) + '%'; progEl.hidden = edge; }
      if (!embed) { try { history.replaceState(null, '', '#' + s.n); } catch (err) { /* ignore */ } }
      if (!quiet && bc) bc.postMessage({ v: 1, type: 'state', from: me, slide: s.n, step: step });
      if (embed && started) toParent('state', { slide: s.n, step: step });
    }

    /* scale */
    function fit() {
      var s = Math.min(window.innerWidth / W, window.innerHeight / H);
      SK.scale = s;
      stage.style.transform = 'translate(' + Math.round((window.innerWidth - W * s) / 2) + 'px,' + Math.round((window.innerHeight - H * s) / 2) + 'px) scale(' + s + ')';
    }
    window.addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', fit);
    document.addEventListener('webkitfullscreenchange', fit);
    fit();

    /* info and parent messages */
    function info() {
      return {
        meta: meta, slide: cur + 1, step: step,
        slides: slides.map(function (s) { return { n: s.n, kind: s.kind, title: s.title, chapter: s.chapter, steps: s.steps, notes: s.notes }; }),
        chapters: chapters.map(function (c) { return { n: c.n, title: c.title }; })
      };
    }
    function toParent(type, extra) {
      if (window.parent === window) return;
      try { window.parent.postMessage(Object.assign({ source: 'slidekit', v: 1, type: type }, extra), location.origin); }
      catch (err) { /* opaque origin, e.g. file: */ }
    }

    /* print shows every slide; the active stepper slide prints in its first step */
    window.addEventListener('beforeprint', function () { var st = stepperOf(cur); if (st) st.goto(1); });
    window.addEventListener('afterprint', function () { var st = stepperOf(cur); if (st) st.goto(step); });

    /* initial position from the hash */
    var h = parseInt((location.hash || '').slice(1), 10);
    show(isNaN(h) ? 0 : h - 1, 'jump', 1, true);

    if (embed) {
      window.addEventListener('message', function (e) {
        var m = e.data;
        if (window.parent === window || e.source !== window.parent || e.origin !== location.origin) return;
        if (!m || m.source !== 'slidekit' || m.v !== 1) return;
        if (m.type === 'goto') show((Number(m.slide) || 1) - 1, 'jump', Number(m.step) || 1);
        else if (m.type === 'next') move(1);
        else if (m.type === 'prev') move(-1);
        else if (m.type === 'get-info') toParent('info', { info: info() });
      });
      started = true;
      toParent('ready', { info: info() });
      return;
    }
    started = true;

    window.addEventListener('hashchange', function () {
      var n = parseInt((location.hash || '').slice(1), 10);
      if (!isNaN(n) && n - 1 !== cur) show(n - 1, 'jump', 1);
    });

    if (sync && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('slidekit:' + meta.id);
      bc.onmessage = function (e) {
        var m = e.data;
        if (!m || m.v !== 1 || m.from === me) return;
        if (m.type === 'state') show((Number(m.slide) || 1) - 1, 'jump', Number(m.step) || 1, true);
        else if (m.type === 'hello') bc.postMessage({ v: 1, type: 'state', from: me, slide: cur + 1, step: step });
      };
      bc.postMessage({ v: 1, type: 'hello', from: me });
    }

    /* overview: inert clones of every slide, grouped by chapter, placed after the stage */
    /* thumbnails fill the grid cell; each copy is scaled to its box width */
    var fitThumbs = window.ResizeObserver ? new ResizeObserver(function (es) {
      es.forEach(function (e) { var w = e.contentRect.width; if (w) e.target.firstChild.style.transform = 'scale(' + (w / W) + ')'; });
    }) : null;
    var ov = make('div', 'sk-overview'), thumbs = [], sel = 0, group, grid;
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Slide overview'); ov.tabIndex = 0;
    slides.forEach(function (s, i) {
      if (!group || s.kind === 'chapter') {
        group = make('div', '', 'sk-ov-group');
        if (s.kind === 'chapter') { var t = make('div', '', 'sk-ov-title'); t.textContent = s.title || ''; group.appendChild(t); }
        grid = make('div', '', 'sk-ov-grid');
        group.appendChild(grid);
        ov.appendChild(group);
      }
      var cell = make('div', '', 'sk-thumb'), box = make('div', '', 'sk-thumb-box'),
          inner = make('div', '', 'sk-thumb-in'), copy = s.el.cloneNode(true), lab = make('div', '', 'sk-thumb-n');
      copy.removeAttribute('data-active');
      copy.setAttribute('inert', '');
      inner.appendChild(copy); box.appendChild(inner);
      if (window.ResizeObserver) fitThumbs.observe(box);
      lab.textContent = s.n + (s.title ? '  ' + s.title : '');
      cell.appendChild(box); cell.appendChild(lab);
      cell.addEventListener('click', function () { closeOv(); show(i, 'jump', 1); });
      grid.appendChild(cell);
      thumbs.push(cell);
    });
    document.body.insertBefore(ov, stage.nextSibling);

    function isOpen() { return ov.hasAttribute('data-open'); }
    function mark() {
      thumbs.forEach(function (t, i) { t.toggleAttribute('data-sel', i === sel); });
      thumbs[sel].scrollIntoView({ block: 'nearest' });
    }
    function openOv() { sel = cur; thumbs.forEach(function (t, i) { t.toggleAttribute('data-cur', i === cur); }); ov.setAttribute('data-open', ''); mark(); }
    function closeOv() { ov.removeAttribute('data-open'); }
    function ovMove(key) {
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        sel = Math.max(0, Math.min(thumbs.length - 1, sel + (key === 'ArrowRight' ? 1 : -1)));
      } else {
        var dy = key === 'ArrowDown' ? 1 : -1, c = thumbs[sel].getBoundingClientRect(), best = -1, bs = Infinity;
        thumbs.forEach(function (t, i) {
          var r = t.getBoundingClientRect(), d = (r.top - c.top) * dy;
          if (d < 1) return;
          var score = d * 1000 + Math.abs(r.left - c.left);
          if (score < bs) { bs = score; best = i; }
        });
        if (best >= 0) sel = best;
      }
      mark();
    }

    /* number entry */
    var num = '', numTimer;
    function setNum(v) {
      num = v;
      var ch = v && chapters[parseInt(v, 10) - 1];
      numEl.textContent = v + (ch ? '  ' + (ch.title || '') : '');
      numEl.toggleAttribute('data-bad', !!v && !ch);
      numEl.hidden = !v;
      clearTimeout(numTimer);
      if (v) numTimer = setTimeout(function () { setNum(''); }, 3000);
    }

    function toggleFull() {
      var d = document, el = d.documentElement, on = d.fullscreenElement || d.webkitFullscreenElement;
      try {
        if (on) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
        else { var r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el); if (r && r.catch) r.catch(function () {}); }
      } catch (err) { /* ignore */ }
    }

    /* blank screen: B black, W white. Local to this window; position, steps and sync are untouched. */
    var blank = make('div', 'sk-blank');
    blank.setAttribute('aria-hidden', 'true');
    document.body.appendChild(blank);
    function setBlank(m) {
      if (m) { blank.setAttribute('data-blank', m); stage.setAttribute('aria-hidden', 'true'); }
      else { blank.removeAttribute('data-blank'); stage.removeAttribute('aria-hidden'); }
    }

    /* the pointer hides after 2s without moving (never while the overview is open) */
    var idleT;
    function wake() { root.removeAttribute('data-idle'); clearTimeout(idleT); idleT = setTimeout(function () { if (!isOpen()) root.setAttribute('data-idle', ''); }, 2000); }
    document.addEventListener('mousemove', wake);
    document.addEventListener('mousedown', wake);
    wake();

    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target, k = e.key, open = isOpen();
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) {
        if (k === 'Escape') t.blur();
        return;
      }
      var bm = blank.getAttribute('data-blank');
      if (e.code === 'KeyB' || e.code === 'KeyW') {
        e.preventDefault();
        if (!e.repeat) { var want = e.code === 'KeyB' ? 'black' : 'white'; setBlank(bm === want ? null : want); }
        return;
      }
      if (bm) { /* while blank, an arrow or Esc only brings the slide back, nothing else moves */
        if (k === 'Escape' || /^Arrow/.test(k)) { e.preventDefault(); setBlank(null); }
        return;
      }
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowUp') {
        e.preventDefault();
        if (open) ovMove(k); else move(k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1);
      } else if (k === 'Escape') {
        if (open) closeOv();
        setNum('');
      } else if (k === 'Enter') {
        if (e.repeat) return;
        if (open) { e.preventDefault(); closeOv(); show(sel, 'jump', 1); }
        else if (num) {
          e.preventDefault();
          var c = chapters[parseInt(num, 10) - 1];
          setNum('');
          if (c) show(c.n - 1, 'jump', 1);
        }
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        if (!e.repeat) toggleFull();
      } else if (e.code === 'KeyO') {
        e.preventDefault();
        if (!e.repeat) { if (open) closeOv(); else openOv(); }
      } else if (!open && /^[0-9]$/.test(k)) {
        setNum((num + k).slice(-3));
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
