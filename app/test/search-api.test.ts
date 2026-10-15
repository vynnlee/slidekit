// 덱 검색 색인: 제목, 본문, 노트 추출과 스크립트와 주석 제거, 숨김 폴더와 깨진 메타 처리, mtime 캐시. 임시 덱 폴더만 쓴다.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-search-"));
process.env.SLIDEKIT_DECKS = dir;
const deck = (name: string, html: string) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, "index.html"), html); };
deck("alpha", `<!doctype html><html><head><title>태그 제목</title><script type="application/json" id="deck-meta">{"title":"알파 덱","id":"alpha-id"}</script><style>h1{color:red}</style></head><body>
<section data-slide="cover"><h1>첫 &amp; 제목</h1><p>본문 &lt;b&gt; 글자</p><script>var secret = "스크립트 글자";</script><!-- 주석 글자 --><aside data-notes>노트 글자 &nbsp;하나</aside></section>
<section data-slide="chapter" data-title="이름표 &amp; 장"><h1>장 표지</h1></section></body></html>`);
deck("broken", `<html><head><title>깨진 메타 덱</title><script type="application/json" id="deck-meta">{ not json </script></head><body><section data-slide="content"><h2>글</h2></section></body></html>`);
deck(".hidden", `<html><body><section data-slide="cover"><h1>숨김</h1></section></body></html>`);
mkdirSync(join(dir, "empty")); // index.html이 없는 폴더
const { searchIndex } = await import("../search-api");
const get = async () => (await (await searchIndex()).json()) as { folder: string; id: string; title: string; slides: { n: number; title: string; text: string; notes: string }[] }[];

test("제목, 본문, 노트를 뽑고 스크립트, 스타일, 주석 글자는 넣지 않으며 엔티티를 푼다", async () => {
  const a = (await get()).find((d) => d.folder === "alpha")!;
  expect(a).toMatchObject({ id: "alpha-id", title: "알파 덱" });
  expect(a.slides.length).toBe(2);
  expect(a.slides[0].title).toBe("첫 & 제목");
  expect(a.slides[0].text).toContain("본문 <b> 글자");
  expect(a.slides[0].text).not.toMatch(/스크립트 글자|주석 글자|노트 글자/);
  expect(a.slides[0].notes).toBe("노트 글자 하나");
  expect(a.slides[1].title).toBe("이름표 & 장"); // data-title이 우선
});
test("숨김 폴더와 index.html 없는 폴더는 빠지고, 깨진 deck-meta는 <title>로 물러난다", async () => {
  const all = await get();
  expect(all.map((d) => d.folder).sort()).toEqual(["alpha", "broken"]);
  expect(all.find((d) => d.folder === "broken")).toMatchObject({ id: "broken", title: "깨진 메타 덱" });
});
test("파일이 바뀌면(mtime) 다시 읽고 같으면 캐시를 쓴다", async () => {
  const first = await get();
  deck("alpha", (await Bun.file(join(dir, "alpha", "index.html")).text()).replace("알파 덱", "알파 덱 수정"));
  utimesSync(join(dir, "alpha", "index.html"), new Date(), new Date(Date.now() + 5000));
  const second = await get();
  expect(first.find((d) => d.folder === "alpha")!.title).toBe("알파 덱");
  expect(second.find((d) => d.folder === "alpha")!.title).toBe("알파 덱 수정");
});
