import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deckFingerprint, localImageRefs, readPublish, recordPublish, recordUnpublish, type Entry } from "../publish-record";

const tmp = () => mkdtempSync(join(tmpdir(), "sk-pub-"));
const deck = (html: string, files: Record<string, string> = {}) => {
  const d = tmp();
  writeFileSync(join(d, "index.html"), html);
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), c); }
  return d;
};
const entry = (n: number, extra: Partial<Entry> = {}): Entry => ({ name: "x", url: "https://static.vynnlee.com/x", at: new Date(1_700_000_000_000 + n * 1000).toISOString(), visibility: "public", bytes: 100 + n, sha: "a".repeat(40), ...extra });

test("지문: html과 참조한 로컬 이미지의 경로와 크기가 바뀌면 달라지고, 외부 주소와 덱 밖과 없는 파일은 무시", () => {
  const html = `<img src="img/a.png"><div style="background:url('img/b.jpg')"></div><img src="https://x.com/c.png"><img src="data:image/png;base64,AAAA"><img src="/abs.png"><img src="../outside.png"><img src="img/missing.png"><link href="img/icon.svg?v=2">`;
  const d = deck(html, { "img/a.png": "12345", "img/b.jpg": "12", "img/icon.svg": "<svg/>", "../outside.png": "zz" });
  expect(localImageRefs(html, d)).toEqual([{ rel: "img/a.png", size: 5 }, { rel: "img/b.jpg", size: 2 }, { rel: "img/icon.svg", size: 6 }]);
  const f1 = deckFingerprint(d);
  expect(f1).toMatch(/^[0-9a-f]{40}$/);
  expect(deckFingerprint(d)).toBe(f1);
  writeFileSync(join(d, "img/a.png"), "123456"); // 크기가 달라짐
  const f2 = deckFingerprint(d);
  expect(f2).not.toBe(f1);
  writeFileSync(join(d, "index.html"), html + " ");
  expect(deckFingerprint(d)).not.toBe(f2);
  rmSync(d, { recursive: true, force: true });
});
test("기록: 없거나 깨졌거나 형식이 틀린 항목은 빈 기록과 걸러내기", () => {
  const d = deck("<html></html>");
  expect(readPublish(d)).toEqual({ current: null, history: [] });
  writeFileSync(join(d, ".publish.json"), "{");
  expect(readPublish(d)).toEqual({ current: null, history: [] });
  writeFileSync(join(d, ".publish.json"), JSON.stringify({ current: { name: "../x" }, history: [entry(1), { name: "x" }, entry(2, { sha: "zz" }), "x", entry(3, { url: "javascript:1" })] }));
  const r = readPublish(d);
  expect(r.current).toBeNull();
  expect(r.history.map((e) => e.bytes)).toEqual([101]);
  rmSync(d, { recursive: true, force: true });
});
test("recordPublish와 recordUnpublish: current 교체, 최신순 history 최대 20개, 취소 시각 기록, 임시 파일 없음", () => {
  const d = deck("<html></html>");
  for (let i = 1; i <= 22; i++) recordPublish(d, entry(i));
  let r = readPublish(d);
  expect(r.current?.bytes).toBe(122);
  expect(r.history.length).toBe(20);
  expect(r.history[0].bytes).toBe(122);
  expect(r.history[19].bytes).toBe(103);
  expect(readdirSync(d).some((n) => n.includes(".tmp-"))).toBe(false);
  const un = recordUnpublish(d, new Date("2026-10-15T00:00:00Z"));
  expect(un.current).toBeNull();
  expect(un.history[0].unpublishedAt).toBe("2026-10-15T00:00:00.000Z");
  expect(un.history[1].unpublishedAt).toBeUndefined();
  expect(readPublish(d)).toEqual(un);
  expect(recordUnpublish(d)).toEqual(un); // current가 없으면 그대로
  expect(() => recordPublish(d, { ...entry(1), sha: "bad" })).toThrow();
  expect(existsSync(join(d, ".publish.json"))).toBe(true);
  rmSync(d, { recursive: true, force: true });
});

test("보안 감사: 기록의 url은 PUBLISH_HOST와 name으로 만든 값만, name은 맨 앞에 하이픈이나 옵션 모양을 허용하지 않는다", () => {
  const d = deck("<html></html>");
  writeFileSync(join(d, ".publish.json"), JSON.stringify({ current: entry(1, { url: "https://evil.example/login" }), history: [entry(2), entry(3, { name: "-x", url: "https://static.vynnlee.com/-x" }), entry(4, { name: "--yes", url: "https://static.vynnlee.com/--yes" }), entry(5, { name: "a b", url: "https://static.vynnlee.com/a b" }), entry(6, { url: "http://static.vynnlee.com/x" })] }));
  const r = readPublish(d);
  expect(r.current).toBeNull();
  expect(r.history.map((e) => e.bytes)).toEqual([102]);
  expect(() => recordPublish(d, entry(7, { url: "https://evil.example/x" }))).toThrow();
  rmSync(d, { recursive: true, force: true });
});
