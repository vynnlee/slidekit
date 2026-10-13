#!/usr/bin/env bun
// 사용: bun run deploy <덱> | bun run deploy --worker
// dist/<덱>.html을 Cloudflare KV에 올리고 공개 범위를 등록한다. 비밀번호는 해시만 올린다.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "./worker/src/index";

const root = join(import.meta.dir, "..");
const workerDir = join(import.meta.dir, "worker");
const arg = process.argv[2];
if (!arg) { console.error("사용: bun run deploy <덱> 또는 bun run deploy --worker"); process.exit(1); }

const dryRun = process.argv.includes("--dry-run") || !!process.env.SLIDEKIT_DEPLOY_DRY_RUN; // 업로드 직전까지만 하는 테스트용
// 토큰은 환경 변수나 키체인(slidekit-cloudflare-token)에서만 읽고 출력하지 않는다.
const token = process.env.CLOUDFLARE_API_TOKEN
  ?? Bun.spawnSync(["security", "find-generic-password", "-s", "slidekit-cloudflare-token", "-w"]).stdout.toString().trim();
if (!token && !dryRun) { console.error("Cloudflare 토큰이 없습니다. deploy/README.md를 보세요."); process.exit(1); }
const env = { ...process.env, CLOUDFLARE_API_TOKEN: token };

function wrangler(...args: string[]) {
  const r = Bun.spawnSync(["bunx", "wrangler", ...args], { cwd: workerDir, env, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`wrangler 실패 (종료 코드 ${r.exitCode})`); // finally가 임시 폴더를 지우도록 throw
}

function askHidden(label: string) {
  process.stdout.write(label);
  Bun.spawnSync(["stty", "-echo"], { stdin: "inherit" });
  const v = prompt("") ?? "";
  Bun.spawnSync(["stty", "echo"], { stdin: "inherit" });
  process.stdout.write("\n");
  return v;
}

if (arg === "--worker") {
  wrangler("deploy");
  process.exit(0);
}

if (!/^[\w-]+$/.test(arg)) { console.error("덱 이름이 올바르지 않습니다"); process.exit(1); }
const html = readFileSync(join(root, "dist", `${arg}.html`), "utf8"); // 없으면 먼저 번들한다
const metaJson = html.match(/<script[^>]*id="deck-meta"[^>]*>([\s\S]*?)<\/script>/)?.[1];
const visibility = metaJson ? (JSON.parse(metaJson).visibility ?? "public") : "public";
if (visibility !== "public" && visibility !== "password") { console.error(`알 수 없는 visibility: ${visibility}`); process.exit(1); }

const meta: Record<string, string> = { visibility };
if (visibility === "password") {
  // 앱의 Export 메뉴는 비밀번호를 환경 변수로 넘긴다(명령줄과 로그에 남기지 않는다). 터미널에서는 숨김 입력으로 묻는다.
  const pw = process.env.SLIDEKIT_DEPLOY_PASSWORD ?? askHidden("덱 비밀번호: ");
  if (!pw || (process.env.SLIDEKIT_DEPLOY_PASSWORD === undefined && pw !== askHidden("다시 입력: "))) { console.error("비밀번호가 비었거나 서로 다릅니다"); process.exit(1); }
  Object.assign(meta, await hashPassword(pw));
}

// --dry-run(또는 SLIDEKIT_DEPLOY_DRY_RUN=1): 여기까지만 하고 업로드는 하지 않는다. 테스트용.
if (dryRun) {
  console.log(`DRY RUN: https://static.vynnlee.com/${arg} (${visibility}) 업로드는 하지 않았습니다`);
  process.exit(0);
}

// 임시 파일은 0700 폴더에 두고 끝나면 지운다.
const tmp = mkdtempSync(join(tmpdir(), "slidekit-"));
try {
  writeFileSync(join(tmp, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
  // meta를 먼저 올린다. 공개에서 비밀번호로 바꿀 때 html만 새것이고 meta는 옛 public인 상태를 막는다.
  wrangler("kv", "key", "put", `meta:${arg}`, "--binding", "DECKS", "--remote", "--path", join(tmp, "meta.json"));
  wrangler("kv", "key", "put", `html:${arg}`, "--binding", "DECKS", "--remote", "--path", join(root, "dist", `${arg}.html`));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`https://static.vynnlee.com/${arg} (${visibility})`);
