import { expect, test } from "bun:test";
import { safeJson, withMeta } from "../decks-api";

const doc = (meta: string) => `<!doctype html><title>t</title><script type="application/json" id="deck-meta">${meta}</script><body></body>`;
const read = (html: string) => JSON.parse(html.match(/<script[^>]*id="deck-meta"[^>]*>([\s\S]*?)<\/script>/)![1]);

test("제목에 </script>가 있어도 deck-meta를 탈출하지 않고 같은 제목으로 읽힌다", () => {
  const evil = `</script><script>alert(1)</script><b>`;
  const out = withMeta(doc(`{"title":"x"}`), (m) => { m.title = evil; });
  expect(out).not.toContain("</script><script>alert");
  expect(out.match(/<\/script>/g)!.length).toBe(1); // 닫는 태그는 원래 하나뿐
  expect(read(out).title).toBe(evil);
});

test("U+2028과 U+2029는 이스케이프되고 복원된다", () => {
  const t = "a" + String.fromCharCode(0x2028) + "b" + String.fromCharCode(0x2029) + "c";
  expect(safeJson({ t }).includes(String.fromCharCode(0x2028)) || safeJson({ t }).includes(String.fromCharCode(0x2029))).toBe(false);
  expect(JSON.parse(safeJson({ t })).t).toBe(t);
});

test("깨진 메타는 건드리지 않는다", () => {
  const html = doc(`{not json`);
  expect(withMeta(html, (m) => { m.title = "x"; })).toBe(html);
});

test("메타가 없으면 그대로 둔다", () => {
  const html = "<html><body>x</body></html>";
  expect(withMeta(html, () => {})).toBe(html);
});
