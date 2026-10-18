// 사용자 덱 지문과 읽기 전용 가드. 실행: bun test scripts/lib/user-decks.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diff, snapshot, userDecks } from "./user-decks";

test("userDecks: 커밋된 실제 덱만(시험 사본 _로 시작하는 것은 빠진다)", () => {
  const names = userDecks();
  expect(names).toContain("vibe-coding-workshop");
  expect(names.every((n) => !n.startsWith("_") && !n.startsWith("."))).toBe(true);
});
test("snapshot과 diff: index.html, comments.json, 점 폴더, 파일 목록이 바뀌면 잡는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-guard-"));
  try {
    mkdirSync(join(dir, "u"));
    writeFileSync(join(dir, "u", "index.html"), "<html>");
    const a = snapshot(["u"], dir);
    expect(diff(a, snapshot(["u"], dir))).toEqual([]);
    writeFileSync(join(dir, "u", "comments.json"), "[]");
    expect(diff(a, snapshot(["u"], dir))).toEqual(["u/(files)", "u/comments.json"]);
    const b = snapshot(["u"], dir);
    mkdirSync(join(dir, "u", ".versions")); writeFileSync(join(dir, "u", ".versions", "x"), "1");
    expect(diff(b, snapshot(["u"], dir))).toEqual(["u/(files)", "u/.versions"]);
    const c = snapshot(["u"], dir);
    writeFileSync(join(dir, "u", "index.html"), "<html>changed");
    expect(diff(c, snapshot(["u"], dir))).toEqual(["u/index.html"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
