// 사용자 덱 보호: 시험이 커밋된 실제 덱(decks/demo 등)의 index.html, comments.json, 점 폴더(.versions, .comments), 파일 목록을
// 바꾸지 않았는지 단계 앞뒤로 비교한다. 러너가 단계마다 snapshot()을 찍고 diff()가 있으면 알린다(scripts/test.ts 연결은 lead).
// 사용자가 시험 도중 직접 편집할 수도 있으므로 기본은 경고이고, SLIDEKIT_GUARD_STRICT=1이면 실패로 다룬다.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const sha = (b: Buffer | string) => createHash("sha1").update(b).digest("hex").slice(0, 12);

/** 커밋된(git이 추적하는) 최상위 덱 폴더 이름. 시험이 만드는 _로 시작하는 사본은 빠진다. git이 없으면 _와 .로 시작하지 않는 폴더. */
export function userDecks(decksDir = join(root, "decks")): string[] {
  const g = Bun.spawnSync(["git", "ls-files", "-z", "decks"], { cwd: root, stdout: "pipe", stderr: "ignore" });
  const names = g.exitCode === 0 ? new Set(g.stdout.toString().split("\0").map((f) => f.split("/")[1]).filter(Boolean)) : new Set<string>();
  if (!names.size && existsSync(decksDir)) for (const d of readdirSync(decksDir, { withFileTypes: true })) if (d.isDirectory()) names.add(d.name);
  return [...names].filter((n) => !n.startsWith("_") && !n.startsWith(".")).sort();
}

const listing = (dir: string): string => { try { return readdirSync(dir).sort().join("|"); } catch { return ""; } };
const fileHash = (f: string): string => { try { return statSync(f).isFile() ? sha(readFileSync(f)) : "-"; } catch { return "-"; } };

/** 사용자 덱 파일의 지문: "<덱>/<파일>" → 해시 또는 목록 해시. 파일이 없으면 "-". */
export function snapshot(names = userDecks(), decksDir = join(root, "decks")): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const d = join(decksDir, n);
    out[`${n}/index.html`] = fileHash(join(d, "index.html"));
    out[`${n}/comments.json`] = fileHash(join(d, "comments.json"));
    out[`${n}/(files)`] = sha(listing(d));
    for (const dot of [".versions", ".comments"]) out[`${n}/${dot}`] = sha(listing(join(d, dot)));
  }
  return out;
}

/** 두 지문의 차이(바뀐 항목 이름). 비어 있으면 그대로다. */
export const diff = (a: Record<string, string>, b: Record<string, string>): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();

if (import.meta.main) { // bun scripts/lib/user-decks.ts [list|snapshot]
  const cmd = process.argv[2] ?? "list";
  console.log(cmd === "snapshot" ? JSON.stringify(snapshot(), null, 2) : userDecks().join(","));
}
