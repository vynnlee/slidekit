/* PDF 유인물 모드(engine/pdf.ts가 인쇄용 사본에만 넣는다). 슬라이드를 A4 세로 쪽에 줄여 놓고 노트를 붙인다.
   입력: window.__SK_HANDOUT = { mode: "notes" | "handout", per: 2 | 3 | 4 | 6 }, 전역 markdown(src) (app/src/lib/markdown.ts). 엔진은 이 파일을 모른다. */
(function () {
  var C = window.__SK_HANDOUT || { mode: 'notes', per: 3 };
  var W_PAGE = 703, H_PAGE = 1030; /* A4 세로에서 여백 12mm를 뺀 본문 폭과 높이(96dpi px) */
  function run() {
    var stage = document.getElementById('sk-stage');
    var slides = [].filter.call(stage ? stage.children : [], function (e) { return e.hasAttribute && e.hasAttribute('data-slide'); });
    var items = slides.map(function (s, i) {
      var a = s.querySelector(':scope > aside[data-notes]');
      var h = s.querySelector('h1, h2');
      return { el: s, n: i + 1, notes: a ? a.textContent.trim() : '', title: (s.getAttribute('data-title') || (h ? h.textContent : '') || '').trim() };
    });
    document.documentElement.setAttribute('data-sk-handout', C.mode);
    var root = document.createElement('div');
    root.id = 'sk-hd';
    document.body.appendChild(root);
    function box(it, w) {
      var k = w / 1920, sl = document.createElement('div');
      sl.className = 'hd-sl'; sl.style.width = w + 'px'; sl.style.height = (w * 9 / 16) + 'px';
      it.el.style.transform = 'scale(' + k + ')';
      sl.appendChild(it.el);
      return sl;
    }
    if (C.mode === 'notes') {
      items.forEach(function (it) {
        var card = document.createElement('section');
        card.className = 'hd-card';
        var head = document.createElement('div');
        head.className = 'hd-head';
        head.textContent = it.n + ' / ' + items.length + (it.title ? '   ' + it.title : '');
        var notes = document.createElement('div');
        notes.className = 'hd-notes' + (it.notes ? '' : ' hd-empty');
        if (it.notes) notes.innerHTML = window.markdown(it.notes); else notes.textContent = '노트 없음';
        card.appendChild(head); card.appendChild(box(it, W_PAGE)); card.appendChild(notes);
        root.appendChild(card);
      });
    } else {
      var per = C.per || 3, c = per <= 3 ? 1 : 2, r = per / c, gap = 16, label = 18;
      var cw = (W_PAGE - (c - 1) * gap) / c, ch = (H_PAGE - (r - 1) * gap) / r;
      var w = Math.floor(Math.min(cw, (ch - label) * 16 / 9));
      for (var p = 0; p < items.length; p += per) {
        var pg = document.createElement('section');
        pg.className = 'hd-page';
        pg.style.gridTemplateColumns = 'repeat(' + c + ', ' + cw + 'px)';
        items.slice(p, p + per).forEach(function (it) {
          var cell = document.createElement('div');
          cell.className = 'hd-cell';
          var lb = document.createElement('div');
          lb.className = 'hd-label'; lb.textContent = it.n + (it.title ? '   ' + it.title : '');
          cell.appendChild(box(it, w)); cell.appendChild(lb);
          pg.appendChild(cell);
        });
        root.appendChild(pg);
      }
    }
  }
  if (document.readyState === 'complete') run(); else window.addEventListener('load', run);
})();
