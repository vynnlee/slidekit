// 덱 원문을 슬라이드 단위로 쪼개고 다시 합친다. SPEC 9절.
// 손대지 않은 슬라이드는 원문 글자 그대로 돌아온다. split 뒤 compose는 항등이어야 한다.
// gap: 앞 슬라이드 끝에서 이 슬라이드 시작까지의 원문. undefined면 기본 간격을 쓴다.
export type Unit = { key: string; gap?: string; html: string };
export type Doc = { prefix: string; suffix: string; units: Unit[] };

let seq = 0;
export const newKey = () => `u${++seq}`;

// 작은 토크나이저로 최상위 section의 범위를 찾는다. 주석, 따옴표 속성 값, script, style, textarea, title 안의
// "<section"과 "</section>"은 경계로 보지 않는다. 최상위 section 중 data-slide 속성이 있는 것만 슬라이드다.
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noembed", "noframes", "plaintext", "iframe"]);
function sections(src: string) {
  const out: { a: number; b: number; slide: boolean }[] = [];
  const n = src.length;
  let i = 0, depth = 0, start = 0, slide = false;
  while ((i = src.indexOf("<", i)) >= 0) {
    if (src.startsWith("<!--", i)) { const e = src.indexOf("-->", i + 4); i = e < 0 ? n : e + 3; continue; }
    const close = src[i + 1] === "/";
    const m = /^[A-Za-z][^\s/>]*/.exec(src.slice(i + (close ? 2 : 1), i + 64 + (close ? 2 : 1)));
    if (!m) { i++; continue; }
    const name = m[0].toLowerCase();
    let j = i + (close ? 2 : 1) + m[0].length, has = false;
    // 태그 끝까지: 따옴표 안의 ">"는 건너뛰고 속성 이름을 모은다
    while (j < n && src[j] !== ">") {
      const c = src[j];
      if (c === '"' || c === "'") { const e = src.indexOf(c, j + 1); j = e < 0 ? n : e + 1; continue; }
      const w = /^[^\s"'<>\/=]+/.exec(src.slice(j, j + 64));
      if (w) { if (w[0].toLowerCase() === "data-slide") has = true; j += w[0].length; } else j++;
    }
    const end = Math.min(n, j + 1);
    if (name === "section") {
      if (!close) { if (depth++ === 0) { start = i; slide = has; } }
      else if (depth > 0 && --depth === 0) out.push({ a: start, b: end, slide });
    } else if (!close && RAW.has(name)) {
      const e = new RegExp(`</${name}(?=[\\s/>])`, "i").exec(src.slice(end));
      i = e ? end + e.index : n;
      continue;
    }
    i = end;
  }
  return out;
}

export function splitDeck(src: string): Doc {
  const slides = sections(src).filter((r) => r.slide).map((r) => [r.a, r.b] as const);
  if (!slides.length) throw new Error("슬라이드가 없습니다");
  const units = slides.map(([a, b], i) => ({
    key: newKey(),
    gap: i ? src.slice(slides[i - 1][1], a) : undefined,
    html: src.slice(a, b),
  }));
  return { prefix: src.slice(0, slides[0][0]), suffix: src.slice(slides.at(-1)![1]), units };
}

// gap이 없는 단위(복제, 추가, 첫 자리에서 옮겨 온 것)에는 덱에서 처음 보이는 공백 간격을 쓴다.
function defaultGap(units: Unit[]) {
  return units.slice(1).find((u) => u.gap && u.gap.trim() === "")?.gap ?? "\n";
}

export function compose(doc: Doc, units = doc.units) {
  const dg = defaultGap(units);
  return doc.prefix + units.map((u, i) => (i ? u.gap ?? dg : "") + u.html).join("") + doc.suffix;
}

// 캔버스와 썸네일용 문서. 상대 경로가 깨지지 않게 base를 넣고, 임베드 표시를 단다.
export function previewHtml(doc: Doc, units: Unit[], folder: string, opts: { embed?: boolean; thumb?: boolean; showSteps?: boolean }) {
  let s = compose(doc, units);
  const base = `<base href="${location.origin}/decks/${folder}/">`;
  s = s.replace(/<html\b/i, opts.embed ? (opts.showSteps ? "<html data-sk-embed data-sk-show-steps" : "<html data-sk-embed") : "<html");
  s = s.replace(/<head[^>]*>/i, (h) => h + base);
  if (opts.thumb) {
    // 외부 글꼴 링크는 렌더를 막으므로 뺀다(썸네일은 대체 글꼴로 그린다).
    s = s.replace(/<link\b[^>]*href=["']https?:[^>]*>/gi, "");
    // 스크립트를 쓰지 않는 정적 썸네일: 엔진 대신 무대를 직접 만든다.
    s = s.replace(/<script\b(?![^>]*application\/json)[^>]*>[\s\S]*?<\/script>/gi, "");
    s = s.replace(/<section\b/i, '<div id="sk-stage" style="transform:none"><section').replace(/<\/section>(?![\s\S]*<\/section>)/i, "</section></div>");
    s = s.replace(/<section\b([^>]*)>/i, "<section data-active $1>");
  }
  return s;
}

// 살아 있는 슬라이드를 저장용 글자로 되돌린다. 엔진과 편집기가 붙인 것을 뺀다.
export function serializeSlide(el: Element) {
  const c = el.cloneNode(true) as Element;
  for (const e of [c, ...c.querySelectorAll("[data-active],[contenteditable],[inert]")]) {
    e.removeAttribute("data-active");
    e.removeAttribute("contenteditable");
    if (e === c) e.removeAttribute("inert");
  }
  // 속성 값을 모두 지운 인라인 style은 빈 style=""로 남으므로(되돌리기 뒤 등) 저장 글자에서 뺀다.
  for (const e of [c, ...c.querySelectorAll('[style=""]')]) if (e.getAttribute("style") === "") e.removeAttribute("style");
  // outerHTML은 boolean 속성을 =""로 쓴다. SPEC 형태(`data-notes`)로 되돌린다.
  return c.outerHTML.replace(/(<aside\b[^>]*\sdata-notes)=""/g, "$1");
}

export const newSlideHtml = () =>
  `<section data-slide="content">\n    <h2>제목</h2>\n    <p>내용</p>\n  </section>`;

export function duplicateHtml(html: string) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  const s = t.content.firstElementChild!;
  s.removeAttribute("id"); // 같은 id가 둘이 되지 않게
  s.removeAttribute("data-steps"); // stepper는 id로 붙으므로 복제본은 일반 슬라이드가 된다
  return s.outerHTML;
}

// 요소 경로: 슬라이드 아래에서 `tag:nth-of-type(n)`을 ` > `로 잇는다.
export function pathOf(slide: Element, el: Element) {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== slide; e = e.parentElement) {
    const tag = e.tagName.toLowerCase();
    const same = [...(e.parentElement?.children ?? [])].filter((x) => x.tagName === e!.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
  }
  return parts.join(" > ");
}
export const byPath = (slide: Element, path: string) => (path ? slide.querySelector(`:scope > ${path}`) : slide);
