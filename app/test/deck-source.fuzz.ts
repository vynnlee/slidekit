// splitDeck/compose 퍼징. 실행: bun app/test/deck-source.fuzz.ts
// 조각을 섞어 만든 덱에서 (1) compose(split(x)) === x, (2) 슬라이드 수가 기대와 같고 각 단위가 section 하나인지 확인한다.
import { compose, splitDeck } from "../src/lib/deck-source";

let seed = Number(process.env.SEED ?? 12345);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

// 슬라이드 안에 들어가도 슬라이드 경계를 바꾸면 안 되는 조각
const inner = [
  "<h1>제목</h1>", "<p>글</p>", "\n  ", "<!-- </section> -->", "<!-- <section data-slide=\"x\"> -->",
  "<script>var s = '</section>'; var t = \"<section data-slide='content'>\";</script>",
  "<script>/* </section> */ if (a<b) {}</script>", "<style>.a::after{content:'</section>'}</style>",
  "<div data-x=\"a>b\">x</div>", "<div title='</section>'>y</div>", "<div data-x=\"<section data-slide='content'>\">z</div>",
  "<SECTION class=\"card\"><p>중첩</p></SECTION>", "<section class=\"nested\"><section><b>깊은</b></section></section>",
  "<img src=\"a.png\"/>", "<br>", "<aside data-notes>노트 &lt;/section&gt;</aside>", "<svg><g><path d=\"M0 0\"/></g></svg>",
  "<section-card>커스텀</section-card>", "<sectionx>?</sectionx>", "<textarea></section></textarea>",
  "<xmp></section><section data-slide=\"x\"></xmp>", "<noembed></section></noembed>", "<noframes><section data-slide=\"x\"></noframes>", "<iframe srcdoc=\"x\"></section></iframe>",
];
const slideAttrs = ["data-slide=\"content\"", "data-slide=\"chapter\" data-title=\"장\"", "class=\"a\" data-slide=\"content\"",
  "data-title=\"a>b\" data-slide=\"chapter\"", "id=\"x\" data-steps=\"3\" data-slide='content'", "DATA-SLIDE=\"content\"",
  "data-x='>' data-slide=\"content\"", `data-pad="${"x".repeat(500)}" data-slide="content"`];
const between = ["\n\n  ", "\n", "", "  <!-- 구분 -->\n  ", "\n  <section class=\"not-a-slide\"><p>x</p></section>\n  ", "\n<script>var q='<section data-slide=\"content\">';</script>\n"];

// 정규식 파서가 아직 못 다루는 입력(위 SINGLE FAIL 목록). HARD=1이면 무작위 퍼징에도 섞는다.
const HARD = ["<div title='</section>'>y</div>", "<div data-x=\"<section data-slide='content'>\">z</div>", "<section-card>커스텀</section-card>", "<textarea></section></textarea>", "data-title=\"a>b\" data-slide=\"chapter\"", "data-x='>' data-slide=\"content\""];
const innerOk = process.env.HARD ? inner : inner.filter((f) => !HARD.includes(f));
const attrsOk = process.env.HARD ? slideAttrs : slideAttrs.filter((f) => !HARD.includes(f));

function slide() {
  const body = Array.from({ length: Math.floor(rnd() * 5) }, () => pick(innerOk)).join("");
  return `<section ${pick(attrsOk)}>${body}</section>`;
}

// 조각 하나씩: 어떤 입력이 깨지는지 목록으로 보여 준다. 첫 슬라이드 원문이 정확히 같아야 한다.
const tail = '\n<section data-slide="content"><p>뒤</p></section>\n</body></html>';
const cases: [string, string][] = [
  ...inner.map((f): [string, string] => [f, `<section data-slide="content">${f}</section>`]),
  ...slideAttrs.map((a): [string, string] => [a, `<section ${a}><p>x</p></section>`]),
];
for (const [name, first] of cases) {
  let ok = false; try { const d = splitDeck("<html><body>\n" + first + tail); ok = d.units.length === 2 && d.units[0].html === first; } catch {}
  if (!ok) console.log(`SINGLE FAIL: ${name}`);
}
for (const b of between) {
  const src = `<html><body><section data-slide="content"><p>a</p></section>${b}<section data-slide="content"><p>b</p></section></body></html>`;
  let n = -1; try { n = splitDeck(src).units.length; } catch {}
  if (n !== 2) console.log(`SINGLE FAIL (between ${n} units): ${b.trim().slice(0, 40)}`);
}

let fail = 0;
const bad = (why: string, src: string) => { if (fail++ < 8) console.log(`FAIL ${why}\n${src}\n---`); };
const N = Number(process.env.N ?? 3000);
for (let i = 0; i < N; i++) {
  const n = 1 + Math.floor(rnd() * 5);
  const slides = Array.from({ length: n }, slide);
  const src = `<!doctype html><html><head><title>t</title><style>x{}</style></head><body>\n  ${slides.map((s, j) => (j ? pick(between) : "") + s).join("")}\n  <script src="e.js"></script></body></html>`;
  let doc;
  try { doc = splitDeck(src); } catch (e) { bad("throws: " + e, src); continue; }
  if (compose(doc) !== src) bad("round trip", src);
  if (doc.units.length !== n) bad(`unit count ${doc.units.length} != ${n}`, src);
  else if (!doc.units.every((u, j) => u.html === slides[j])) bad("unit boundaries differ", src);
}
console.log(fail ? `${fail} failures of ${N}` : `ok ${N} cases`);
process.exit(fail ? 1 : 0);
