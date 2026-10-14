// 덱 -> Markdown 개요. 작은 입력은 기대 문자열로, 템플릿 3종은 스냅샷으로, 가이드 덱은 구조 불변식으로 본다.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outline } from "../outline";
import { TEMPLATE_IDS, buildDeck } from "../templates";

const deck = (slides: string, meta = `{"title":"테스트 덱","author":"작성자","date":"2026-10-15","visibility":"password"}`) =>
  `<!doctype html><html><head><title>t</title><script type="application/json" id="deck-meta">${meta}</script><style>h1{color:red}</style></head><body>${slides}</body></html>`;

test("머리말: 제목, 작성자, 날짜만(공개 범위 같은 메타는 넣지 않는다)", () => {
  expect(outline(deck(""))).toBe("# 테스트 덱\n\n- Author: 작성자\n- Date: 2026-10-15\n");
  expect(outline(deck("", "깨진 json")).startsWith("# t\n")).toBe(true);
});

test("슬라이드 제목, 본문 글, 목록, 링크, 이미지, 코드, 인용", () => {
  const md = outline(deck(`
    <section data-slide="content"><h2>할 일</h2><p>첫 <b>문단</b>과 <a href="https://x.dev/a b">링크</a>.</p>
      <ul><li>하나<ul><li>안쪽</li></ul></li><li data-step>둘 <code>a_b</code></li></ul>
      <ol start="3"><li>셋</li><li>넷</li></ol>
      <img src="assets/cat one.png" alt="고양이">
      <pre><code class="language-ts">const a = 1 &lt; 2;\nlog(a)</code></pre>
      <blockquote><p>인용문</p></blockquote></section>`));
  expect(md).toBe(`# 테스트 덱

- Author: 작성자
- Date: 2026-10-15

## 1. 할 일

첫 **문단**과 [링크](https://x.dev/a%20b).

- 하나
  - 안쪽
- 둘 \`a_b\`

3. 셋
4. 넷

![고양이](assets/cat%20one.png)

\`\`\`ts
const a = 1 < 2;
log(a)
\`\`\`

> 인용문
`);
});

test("제목 위계: 첫 제목은 슬라이드 제목, 나머지는 ###부터, data-title이 있으면 그것이 제목", () => {
  const md = outline(deck(`<section data-slide="content" data-title="이름표"><h1>큰 제목</h1><h3>작은 제목</h3><p>글</p></section>`));
  expect(md).toContain("## 1. 이름표\n\n### 큰 제목\n\n#### 작은 제목\n\n글\n");
  const same = outline(deck(`<section data-slide="chapter" data-title="장"><h1>장</h1></section><section data-slide="content"><p>제목 없음</p></section>`));
  expect(same).toContain("## 1. 장\n\n## 2. Slide 2\n\n제목 없음\n");
});

test("노트는 옵션일 때만 > Notes: 인용으로, 단계와 카드는 읽기 순서로, 숨김과 장식은 빼고", () => {
  const html = deck(`<section data-slide="content"><h2>카드</h2>
    <div class="card"><span class="k">Cmd+K</span><span class="d">팔레트</span></div>
    <div data-step="2"><p>둘째 단계</p></div><div data-step="1"><p>첫째 단계</p></div>
    <p hidden>숨김</p><svg><text>그림</text></svg><div aria-hidden="true">장식</div><footer>3 / 9</footer>
    <aside data-notes>첫 줄

- 항목</aside></section>`);
  const off = outline(html);
  expect(off).not.toContain("Notes");
  expect(off).toContain("Cmd+K 팔레트\n\n둘째 단계\n\n첫째 단계\n"); // DOM 순서 그대로
  for (const gone of ["숨김", "그림", "장식", "3 / 9", "항목"]) expect(off).not.toContain(gone);
  expect(outline(html, { notes: true }).endsWith("> Notes: 첫 줄\n>\n> - 항목\n")).toBe(true);
});

test("표는 Markdown 표로, 셀의 | 는 이스케이프한다", () => {
  const md = outline(deck(`<section data-slide="content"><h2>표</h2><table><tr><th>이름</th><th>값</th></tr><tr><td>a|b</td><td>1</td></tr><tr><td>c</td></tr></table></section>`));
  expect(md).toContain("| 이름 | 값 |\n| --- | --- |\n| a\\|b | 1 |\n| c |  |\n");
});

test("줄 맨 앞의 Markdown 기호와 엔티티", () => {
  const md = outline(deck(`<section data-slide="content"><h2>t</h2><p>- 빼기 &amp; &lt;b&gt; &#39;x&#39;</p><p>1. 번호처럼</p></section>`));
  expect(md).toContain("\\- 빼기 & <b> 'x'");
  expect(md).toContain("\\1. 번호처럼");
});

test("닫히지 않은 li와 p, 알 수 없는 태그, 빈 덱에도 던지지 않는다", () => {
  expect(() => outline(deck(`<section data-slide="content"><ul><li>a<li>b</ul><p>x<p>y<custom-tag>z</custom-tag></section><section data-slide>`))).not.toThrow();
  expect(outline("")).toBe("# Untitled deck\n");
  const md = outline(deck(`<section data-slide="content"><ul><li>a<li>b</ul><p>x<p>y</section>`));
  expect(md).toContain("- a\n- b\n\nx\n\ny\n");
});

for (const id of TEMPLATE_IDS) {
  test(`템플릿 ${id}: 스냅샷(노트 포함)`, () => {
    const html = buildDeck(id, { title: "샘플", date: "2026-10-15", author: "작성자", id: "sample" });
    expect(outline(html, { notes: true })).toMatchSnapshot();
  });
}

test("가이드 덱: 장마다 ## 하나, 태그와 스타일이 새지 않고, --notes 없이는 노트가 없다", () => {
  const html = readFileSync(join(import.meta.dir, "..", "..", "decks", "slidekit-guide", "index.html"), "utf8");
  const slides = (html.match(/<section\b[^>]*\bdata-slide\b/g) ?? []).length;
  const md = outline(html);
  expect((md.match(/^## \d+\. /gm) ?? []).length).toBe(slides);
  expect(md).not.toMatch(/<\/?(div|span|section|aside|script|style)\b/);
  expect(md).not.toContain("Notes:");
  expect(outline(html, { notes: true })).toContain("> Notes:");
  expect(md).not.toContain("letter-spacing"); // style 안의 CSS가 글로 새지 않는다
  expect(md).not.toContain("data:image"); // data: 이미지는 자리표시자로 바뀐다
  expect(md).toContain("](inline-image)");
});
