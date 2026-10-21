import { expect, test } from "bun:test";
import { scan } from "./scan-secrets";

const d = (line: string, file = "a.ts") => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,1 @@\n+${line}\n`;
// 가짜 값은 조각을 이어 만든다(이 파일 자체가 검사에 걸리지 않게).
const j = (...p: string[]) => p.join("");
const POS: [string, string][] = [
  ["GitHub", j("const t = 'gh", "p_", "a".repeat(36), "'")],
  ["GitHub PAT", j("github", "_pat_", "A1".repeat(30))],
  ["Anthropic", j("key = sk", "-ant-", "api03-", "Ab1".repeat(10))],
  ["Slack", j("SLACK=xo", "xb-", "1234567890-abcdefghij")],
  ["AWS", j("id: AK", "IA", "ABCDEFGHIJKLMNOP")],
  ["PEM", j("-----BEGIN ", "PRIVATE KEY-----")],
  ["CF env", j("CLOUDFLARE_API_", "TOKEN=", "Zx9_", "a".repeat(30))],
  ["generic", j("const api", "Key = \"", "q".repeat(8), "Wx9".repeat(4), "\"")],
  ["healthchecks", j("curl https://hc-ping", ".com/", "3f2b8c1e-9d4a-4f6b-8a1c-0b7d5e9f2a34")],
  ["telegram", j("BOT=", "123456789:", "AAH".repeat(11), "ab")],
];
const NEG: string[] = [
  "const token = process.env.CLOUDFLARE_API_TOKEN;",
  'export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s x -w)',
  "id = \"b96f1dc5a1e21b82ca630ab77ac5b21c\" # kv namespace",
  "const password = askHidden(\"덱 비밀번호: \");",
  "const secret = c.env.COOKIE_SECRET;",
  "token: string; password?: string;",
  "const color = \"#a78bfa\"; // accent",
  "uuid: 3f2b8c1e-9d4a-4f6b-8a1c-0b7d5e9f2a34",
  "apiKey = \"REPLACE_WITH_YOUR_KEY_HERE_1234\"",
  "const sk = 'sk-short'; const a = 1;",
];

test("양성 10종은 모두 잡는다", () => {
  for (const [name, line] of POS) expect(scan(d(line), []).length, name).toBe(1);
});
test("음성 10종은 잡지 않는다", () => {
  for (const line of NEG) expect(scan(d(line), []), line).toEqual([]);
});
test("허용 목록, 줄 번호, 값 가림", () => {
  const diff = `+++ b/x.ts\n@@ -1,0 +5,2 @@\n+ok\n+${POS[0][1]}\n`;
  const f = scan(diff, []);
  expect(f).toEqual([{ file: "x.ts", line: 6, rule: "GitHub token", value: f[0].value }]);
  expect(scan(diff, [["x.ts", "*"]])).toEqual([]);
  expect(scan(diff, [["other.ts", "*"]]).length).toBe(1);
  expect(scan(diff.replace("+ok", "-ghp_removedremovedremovedremovedremoved0"), []).length).toBe(1); // 삭제 줄은 무시, 추가 줄은 그대로
});
