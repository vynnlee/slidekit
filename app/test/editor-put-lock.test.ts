// 같은 base로 동시에 온 PUT 두 개는 차례로 처리되어 하나만 저장되고 나머지는 409다(잠금 없이는 둘 다 통과해 한쪽이 사라진다).
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { routes } = await import("../editor-api");
const dir = join(import.meta.dir, "..", "..", "decks", "_put-lock");
const file = join(dir, "index.html");
const html = (t: string) => `<html data-slidekit="1"><body><section data-slide>${t}</section></body></html>`;
const put = (source: string, base: number) =>
  routes["/api/decks/:folder"].PUT(Object.assign(new Request("http://x/api/decks/_put-lock", { method: "PUT", body: JSON.stringify({ source, base }) }), { params: { folder: "_put-lock" } }));

test("동시 PUT: 하나는 저장, 하나는 409", async () => {
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(file, html("start"));
    const base = statSync(file).mtimeMs;
    const res = await Promise.all([put(html("A"), base), put(html("B"), base)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(["A", "B"].some((t) => readFileSync(file, "utf8").includes(`>${t}<`))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("저장 뒤 코멘트 번호 갱신이 실패해도(comments.json 손상) PUT은 성공으로 답한다", async () => {
  const d = join(import.meta.dir, "..", "..", "decks", "_put-corrupt");
  mkdirSync(d, { recursive: true });
  try {
    writeFileSync(join(d, "index.html"), html("start"));
    writeFileSync(join(d, "comments.json"), "{not json");
    const base = statSync(join(d, "index.html")).mtimeMs;
    const req = Object.assign(new Request("http://x/api/decks/_put-corrupt", { method: "PUT", body: JSON.stringify({ source: html("saved"), base, slideMap: { "1": 1 } }) }), { params: { folder: "_put-corrupt" } });
    const res = await routes["/api/decks/:folder"].PUT(req);
    expect(res.status).toBe(200);
    expect(readFileSync(join(d, "index.html"), "utf8")).toContain("saved");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
