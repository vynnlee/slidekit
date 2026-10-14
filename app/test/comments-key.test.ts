// 코멘트 서명 키 파일: 없으면 0600으로 만들고, 넓은 권한은 0600으로 줄이며, 읽을 수 없거나 손상됐으면 덮어쓰지 않고 안내한다.
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sk-key-"));
process.env.SLIDEKIT_DECKS = dir; // 임시 폴더를 쓰는 테스트라 러너가 파일마다 따로 돌린다
mkdirSync(join(dir, "d1"));
writeFileSync(join(dir, "d1", "index.html"), "<html></html>");
const fresh = async (file: string) => { process.env.SLIDEKIT_KEY_FILE = file; return await import(`../comments?k=${Date.now()}${Math.random()}`); };
const c = { id: "a", slide: 1, path: "", excerpt: "", text: "t", status: "open" as const, createdAt: "2026-10-15T00:00:00Z" };

test("키 파일이 없으면 상위 폴더까지 만들고 0600으로 쓴다", async () => {
  const file = join(dir, "nested", "k", "comments.key");
  const C = await fresh(file);
  const sig = C.sign("d", c);
  expect(sig).toMatch(/^[0-9a-f]{64}$/);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(file, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
  expect(C.verify("d", { ...c, sig })).toBe(true);
});

test("있는 키는 다시 만들지 않고, 권한이 넓으면 0600으로 줄인다", async () => {
  const file = join(dir, "wide.key");
  writeFileSync(file, "ab".repeat(32) + "\n", { mode: 0o644 });
  chmodSync(file, 0o644);
  const C = await fresh(file);
  C.sign("d", c);
  expect(readFileSync(file, "utf8").trim()).toBe("ab".repeat(32));
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("손상된 키는 덮어쓰지 않고 안내하며, 목록 검증은 Unverified로 계속된다", async () => {
  const file = join(dir, "bad.key");
  writeFileSync(file, "not hex\n");
  const C = await fresh(file);
  expect(() => C.sign("d", c)).toThrow(/damaged. Delete it to create a new key/);
  expect(readFileSync(file, "utf8")).toBe("not hex\n");
  expect(C.verify("d", { ...c, sig: "0".repeat(64) })).toBe(false);
});

test("읽을 수 없는 키(권한 없음)도 덮어쓰지 않고 경로와 해결 방법을 알린다", async () => {
  if (process.getuid?.() === 0) return; // root는 권한을 무시한다
  const file = join(dir, "locked.key");
  writeFileSync(file, "cd".repeat(32) + "\n", { mode: 0o600 });
  chmodSync(file, 0o000);
  try {
    const C = await fresh(file);
    expect(() => C.sign("d", c)).toThrow(/Cannot read the comment signing key .*locked\.key \(EACCES\)\. Fix its permissions/);
    expect(C.verify("d", { ...c, sig: "0".repeat(64) })).toBe(false);
  } finally { chmodSync(file, 0o600); }
  expect(readFileSync(file, "utf8").trim()).toBe("cd".repeat(32));
});

test("API: 키를 쓸 수 없으면 코멘트 작성이 500과 안내 문구로 거절된다", async () => {
  const file = join(dir, "bad2.key");
  writeFileSync(file, "x\n");
  const C = await fresh(file);
  const res = await C.routes["/api/comments"].POST(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3200" }, body: JSON.stringify({ deck: "d1", slide: 1, path: "", excerpt: "", text: "hello" }) }) as any);
  expect(res.status).toBe(500);
  expect(((await res.json()) as { error: string }).error).toContain("damaged");
});
