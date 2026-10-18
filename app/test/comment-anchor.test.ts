// 코멘트 앵커 재계산과 생명주기(spec/COMMENT-UX.md): 슬라이드 대응(LCS), 글자 정규화, 잃음과 복귀, lifecycle 순수 함수. 실행: bun test app/test/comment-anchor.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchSlides, plainText, slideHasText, slideWithText } from "../slide-edit";
import { STALL_SENT_MS, STALL_WORKING_MS, lifecycle, reasonText } from "../src/lib/comment-state";

const sec = (h: string, extra = "") => `<section data-slide="content"><h1>${h}</h1>${extra}</section>`;
const deck = (...hs: string[]) => `<html data-slidekit="1"><body>${hs.map((h) => sec(h)).join("\n")}</body></html>`;

test("plainText: 인라인 태그는 붙이고 블록 태그는 띄우며 엔티티를 풀고 script와 노트는 뺀다", () => {
  expect(plainText("<h1>Hello <b>wor</b>ld</h1><p>A &amp; B&nbsp;C</p>")).toBe("Hello world A & B C");
  expect(plainText("<p>keep</p><script>var x=1</script><style>.a{}</style><aside data-notes>secret</aside>")).toBe("keep");
  expect(plainText("&#65;&#x42;&lt;")).toBe("AB<");
});
test("matchSlides: 이동, 삽입, 삭제를 견디고 고친 슬라이드는 비슷한 글자로 따라간다", () => {
  const before = deck("Alpha one", "Beta two", "Gamma three");
  const moved = deck("Gamma three", "Alpha one", "Beta two");
  expect([...matchSlides(before, moved)]).toEqual([[1, 2], [2, 3], [3, 1]]);
  const inserted = deck("Alpha one", "NEW", "Beta two", "Gamma three");
  expect([...matchSlides(before, inserted)]).toEqual([[1, 1], [2, 3], [3, 4]]);
  const removed = deck("Alpha one", "Gamma three");
  expect([...matchSlides(before, removed)]).toEqual([[1, 1], [2, null], [3, 2]]);
  const edited = deck("Alpha one", "Beta two now longer text", "Gamma three").replace("Beta two now longer text", "Beta two");
  expect(matchSlides(before, edited).get(2)).toBe(2);
  const reword = `<html data-slidekit="1">${sec("Quarterly results overview", "<p>revenue growth margin</p>")}${sec("x")}</html>`;
  const reword2 = `<html data-slidekit="1">${sec("Quarterly results overview 2026", "<p>revenue growth margin</p>")}${sec("x")}</html>`;
  expect(matchSlides(reword, reword2).get(1)).toBe(1); // 내용이 조금 바뀐 슬라이드(해시는 다름)도 같은 슬라이드로 본다
});
test("slideWithText와 slideHasText는 정규화한 글자로 찾는다", () => {
  const d = deck("Hello <b>wor</b>ld", "Other");
  expect(slideHasText(d, 1, "Hello world")).toBe(true);
  expect(slideHasText(d, 2, "Hello world")).toBe(false);
  expect(slideHasText(d, 2, "")).toBe(true);
  expect(slideWithText(d, "Other", 1)).toBe(2);
  expect(slideWithText(d, "", 1)).toBeNull();
});

// 서버 쪽: reanchorDeck
const dir = mkdtempSync(join(tmpdir(), "sk-anchor-"));
mkdirSync(join(dir, "d"));
writeFileSync(join(dir, "d", "index.html"), deck("A"));
process.env.SLIDEKIT_DECKS = dir;
process.env.SLIDEKIT_KEY_FILE = join(dir, "test.key");
const { load, save, reanchorDeck } = await import("../comments");
const mk = (id: string, slide: number, excerpt: string) => ({ id, slide, path: "", excerpt, text: "t", status: "open" as const, createdAt: `2026-10-18T00:00:0${slide}Z` });

test("reanchorDeck: 순서 변경을 따라가고, 삭제는 lost, 되돌리면 lost가 풀린다", () => {
  const v1 = deck("Alpha one", "Beta two", "Gamma three");
  save("d", [mk("a", 1, "Alpha one"), mk("b", 2, "Beta two"), mk("c", 3, ""), mk("e", 3, "Gamma three")]);
  const v2 = deck("Gamma three", "Alpha one", "Beta two"); // 순서 변경(Claude가 직접 수정)
  reanchorDeck("d", v1, v2);
  expect(load("d").map((x) => [x.id, x.slide, x.anchor])).toEqual([["a", 2, "ok"], ["b", 3, "ok"], ["c", 1, "ok"], ["e", 1, "ok"]]);
  const v3 = deck("Alpha one", "Beta two"); // Gamma 삭제
  reanchorDeck("d", v2, v3);
  const l3 = load("d");
  expect(l3.find((x) => x.id === "c")).toMatchObject({ anchor: "lost", slideDeleted: true }); // 글자 없는 코멘트도 잃은 것으로
  expect(l3.find((x) => x.id === "e")).toMatchObject({ anchor: "lost" });
  expect(l3.find((x) => x.id === "a")).toMatchObject({ slide: 1, anchor: "ok" });
  reanchorDeck("d", v3, v2); // 실행 취소로 슬라이드가 돌아옴(글자 없는 코멘트는 lostKey로 찾는다)
  const l4 = load("d");
  expect(l4.map((x) => [x.id, x.slide, x.anchor])).toEqual([["a", 2, "ok"], ["b", 3, "ok"], ["c", 1, "ok"], ["e", 1, "ok"]]);
  expect(l4.every((x) => !x.slideDeleted && !x.lostKey)).toBe(true);
});
test("reanchorDeck: 요소 글자가 사라지면 check, 돌아오면 해제. 편집기가 보낸 slideMap의 삭제는 추측하지 않는다", () => {
  const v1 = deck("Alpha one", "Beta two");
  save("d", [mk("a", 1, "Alpha one"), mk("b", 2, "Beta two")]);
  reanchorDeck("d", v1, deck("Alpha CHANGED", "Beta two"));
  expect(load("d").map((x) => x.anchor)).toEqual(["check", "ok"]);
  reanchorDeck("d", deck("Alpha CHANGED", "Beta two"), v1);
  expect(load("d").map((x) => x.anchor)).toEqual(["ok", "ok"]);
  // 슬라이드 2를 지우고 슬라이드 1과 같은 글자의 슬라이드가 있어도, 정확한 대응에서 지워진 것은 lost로 둔다
  save("d", [mk("a", 1, "Alpha one"), mk("b", 2, "Alpha one")]);
  reanchorDeck("d", deck("Alpha one", "Alpha one"), deck("Alpha one"), { "1": 1 });
  expect(load("d").map((x) => [x.slide, x.anchor])).toEqual([[1, "ok"], [2, "lost"]]);
  reanchorDeck("d", "", "", { "1": "<img onerror=x>" as unknown as number }); // 정수가 아닌 값은 슬라이드 번호로 받지 않는다
  expect(load("d")[0].anchor).toBe("lost");
});

// lifecycle
const c = (o: object) => ({ id: "x", slide: 1, path: "", excerpt: "", text: "t", status: "open" as const, createdAt: "2026-10-18T00:00:00Z", trusted: true, ...o });
const now = Date.parse("2026-10-18T12:00:00Z"), iso = (ms: number) => new Date(now - ms).toISOString();
const ctx = (channel: boolean | null, flow: any = null) => ({ channel, flow, now });
test("lifecycle: 상태와 막힌 이유와 멈춤", () => {
  expect(lifecycle(c({ held: true }), ctx(true))).toEqual({ state: "held", stalled: false, reason: "held" });
  expect(lifecycle(c({}), ctx(false))).toMatchObject({ state: "waiting", reason: "disconnected" });
  expect(lifecycle(c({}), ctx(true))).toMatchObject({ state: "waiting", reason: null }); // 곧 전송된다
  expect(lifecycle(c({}), ctx(true, { reason: "user" }))).toMatchObject({ reason: "paused" });
  expect(lifecycle(c({}), ctx(true, { reason: "limit", resetAt: iso(-1000) }))).toMatchObject({ reason: "limit" });
  expect(lifecycle(c({ deliveredAt: iso(STALL_SENT_MS - 1000) }), ctx(true))).toMatchObject({ state: "sent", stalled: false });
  expect(lifecycle(c({ deliveredAt: iso(STALL_SENT_MS + 1000) }), ctx(true))).toMatchObject({ state: "sent", stalled: true });
  expect(lifecycle(c({ deliveredAt: iso(9e6), ackAt: iso(STALL_WORKING_MS - 1000) }), ctx(true))).toMatchObject({ state: "working", stalled: false });
  expect(lifecycle(c({ deliveredAt: iso(9e6), ackAt: iso(STALL_WORKING_MS + 1000) }), ctx(true))).toMatchObject({ state: "working", stalled: true });
  expect(lifecycle(c({ status: "done", reply: "ok" }), ctx(false))).toEqual({ state: "replied", stalled: false, reason: null });
  expect(lifecycle(c({ resolved: true }), ctx(false)).state).toBe("resolved");
  expect(lifecycle(c({ trusted: false }), ctx(true)).state).toBe("unverified");
  expect(reasonText("disconnected", null)).toBe("Claude is not connected");
  expect(reasonText("paused", null)).toBe("Paused");
  expect(reasonText("limit", { resetAt: "2026-10-18T14:05:00Z" } as any)).toMatch(/^Limit reached, resumes \d\d:\d\d$/);
});
