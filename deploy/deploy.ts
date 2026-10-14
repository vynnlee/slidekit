#!/usr/bin/env bun
// 사용: bun run deploy <덱> | bun run deploy --worker
// dist/<덱>.html을 Cloudflare KV에 올리고 공개 범위를 등록한다. 비밀번호는 해시만 올린다.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "./worker/src/index";

const root = join(import.meta.dir, "..");
const workerDir = join(import.meta.dir, "worker");
const arg = process.argv[2];
if (!arg) { console.error("사용: bun run deploy <덱> 또는 bun run deploy --worker"); process.exit(1); }

// 배포 뒤 점검: bun run deploy --smoke [공개덱 [비밀번호덱]]. GET만 보낸다(토큰 불필요, 잘못된 비밀번호 POST는 시도 횟수를 쓰므로 보내지 않는다). SLIDEKIT_BASE로 주소를 바꾼다.
if (arg === "--smoke") {
  const base = process.env.SLIDEKIT_BASE ?? "https://static.vynnlee.com";
  const [pub = "vibe-coding-workshop", pwd] = process.argv.slice(3);
  let bad = 0;
  const ok = (name: string, good: boolean, extra = "") => { if (!good) bad++; console.log(`${good ? "PASS" : "FAIL"} ${name}${good || !extra ? "" : "  " + extra}`); };
  const get = (p: string) => fetch(`${base}/${p}`, { redirect: "manual" }).catch((e) => { console.error(`접속 실패: ${e.message}. mac-cloud의 DNS 캐시 문제면 HANDOFF의 dig 안내를 본다`); process.exit(1); });
  const common = (r: Response, name: string) => {
    ok(`${name}: nosniff`, r.headers.get("x-content-type-options") === "nosniff");
    ok(`${name}: COOP same-origin`, r.headers.get("cross-origin-opener-policy") === "same-origin");
    ok(`${name}: HSTS`, (r.headers.get("strict-transport-security") ?? "").includes("max-age="));
    ok(`${name}: frame-ancestors none`, (r.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"));
    ok(`${name}: noindex`, r.headers.get("x-robots-tag") === "noindex");
  };
  const a = await get(pub); common(a, `공개 덱 ${pub}`);
  ok("공개 덱 200", a.status === 200, String(a.status));
  ok("공개 덱 캐시 must-revalidate", (a.headers.get("cache-control") ?? "").includes("must-revalidate"), a.headers.get("cache-control") ?? "");
  ok("공개 덱이 슬라이드 HTML", (await a.text()).includes("data-slide"));
  const n = await get("no-such-deck-smoke"); common(n, "없는 덱");
  ok("없는 덱 404", n.status === 404, String(n.status));
  if (pwd) {
    const f = await get(pwd); common(f, `비밀번호 덱 ${pwd}`);
    const t = await f.text();
    ok("비밀번호 덱은 폼을 보임(슬라이드 없음)", f.status === 200 && t.includes("type=\"password\"") && !t.includes("data-slide"), String(f.status));
    ok("폼 CSP에 nonce", /script-src 'nonce-/.test(f.headers.get("content-security-policy") ?? ""));
    ok("비밀번호 덱 no-store", (f.headers.get("cache-control") ?? "").includes("no-store"));
    const x = await fetch(`${base}/${pwd}`, { headers: { "Sec-Fetch-Dest": "empty" } });
    ok("비밀번호 덱은 fetch(문서 아님) 요청을 거부", x.status === 403, String(x.status));
  }
  console.log(bad ? `\n실패 ${bad}건` : "\n전체 통과");
  process.exit(bad ? 1 : 0);
}

const dryRun = process.argv.includes("--dry-run") || !!process.env.SLIDEKIT_DEPLOY_DRY_RUN; // 업로드 직전까지만 하는 테스트용
// 토큰은 환경 변수나 키체인(slidekit-cloudflare-token)에서만 읽고 출력하지 않는다.
const token = process.env.CLOUDFLARE_API_TOKEN
  ?? Bun.spawnSync(["security", "find-generic-password", "-s", "slidekit-cloudflare-token", "-w"]).stdout.toString().trim();
if (!token && !dryRun) { console.error("Cloudflare 토큰이 없습니다. 키체인 slidekit-cloudflare-token에 토큰을 저장하세요(deploy/README.md 1절)."); process.exit(1); }
// wrangler 자식 프로세스에는 비밀번호를 넘기지 않는다(같은 사용자의 ps로 보이지 않게).
const { SLIDEKIT_DEPLOY_PASSWORD: _pw, ...baseEnv } = process.env;
const env = { ...baseEnv, CLOUDFLARE_API_TOKEN: token };
const MIN_PW = 8;

function wrangler(...args: string[]) {
  // 버전을 고정한다. 최신 패키지를 토큰이 있는 환경에서 실행하지 않는다(올릴 때는 이 숫자를 의도적으로 바꾼다).
  const r = Bun.spawnSync(["bunx", "wrangler@4.150.0", ...args], { cwd: workerDir, env, stdout: "inherit", stderr: "inherit" });
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
if (!existsSync(join(root, "dist", `${arg}.html`))) { console.error(`dist/${arg}.html이 없습니다. 먼저 slidekit bundle ${arg} 로 묶으세요.`); process.exit(1); }
const html = readFileSync(join(root, "dist", `${arg}.html`), "utf8");
const metaJson = html.match(/<script[^>]*id="deck-meta"[^>]*>([\s\S]*?)<\/script>/)?.[1];
// deck-meta를 읽지 못하면 공개 범위를 알 수 없으므로 올리지 않는다(비밀번호를 걸려던 덱이 공개로 올라가는 일을 막는다).
let dm: { visibility?: string; lang?: string; title?: string; lockTitle?: boolean } = {};
try { dm = JSON.parse(metaJson ?? ""); } catch { console.error("deck-meta를 읽지 못했습니다. 공개 범위를 알 수 없어 올리지 않습니다. slidekit lint로 점검하세요."); process.exit(1); }
const visibility = dm.visibility ?? "public";
if (visibility !== "public" && visibility !== "password") { console.error(`알 수 없는 visibility: ${visibility}`); process.exit(1); }

const lang = dm.lang;
// 공개 덱은 제목을 올린다. 비밀번호 덱은 인증 전에 제목이 보이므로 deck-meta에 "lockTitle": true를 적은 경우에만 올린다.
const title = visibility === "public" || dm.lockTitle === true ? dm.title : undefined;
const meta: Record<string, string> = { visibility, ...(lang === "en" || lang === "ko" ? { lang } : {}), ...(typeof title === "string" && title ? { title: title.slice(0, 120) } : {}) };
console.log(`덱 ${arg}: ${(statSync(join(root, "dist", `${arg}.html`)).size / 1024).toFixed(0)} KB, 공개 범위 ${visibility === "password" ? "비밀번호" : "공개"}`);
if (visibility === "password") {
  // 앱의 Export 메뉴는 비밀번호를 환경 변수로 넘긴다(명령줄과 로그에 남기지 않는다). 터미널에서는 숨김 입력으로 묻는다.
  const pw = process.env.SLIDEKIT_DEPLOY_PASSWORD ?? askHidden("덱 비밀번호: ");
  if (pw.length < MIN_PW || (process.env.SLIDEKIT_DEPLOY_PASSWORD === undefined && pw !== askHidden("다시 입력: "))) { console.error(`비밀번호는 ${MIN_PW}자 이상이어야 하고 두 번 입력이 같아야 합니다`); process.exit(1); }
  Object.assign(meta, await hashPassword(pw));
}

// --dry-run(또는 SLIDEKIT_DEPLOY_DRY_RUN=1): 여기까지만 하고 업로드는 하지 않는다. 테스트용.
if (dryRun) {
  console.log(`DRY RUN: https://static.vynnlee.com/${arg} (${visibility}) 업로드는 하지 않았습니다`); // export-api가 이 줄에서 주소를 읽는다
  process.exit(0);
}

// 임시 파일은 0700 폴더에 두고 끝나면 지운다.
const tmp = mkdtempSync(join(tmpdir(), "slidekit-"));
try {
  writeFileSync(join(tmp, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
  // meta를 먼저 올린다. 공개에서 비밀번호로 바꿀 때 html만 새것이고 meta는 옛 public인 상태를 막는다.
  console.log("공개 범위를 올리는 중 (1/2)");
  wrangler("kv", "key", "put", `meta:${arg}`, "--binding", "DECKS", "--remote", "--path", join(tmp, "meta.json"));
  console.log("덱을 올리는 중 (2/2)");
  wrangler("kv", "key", "put", `html:${arg}`, "--binding", "DECKS", "--remote", "--path", join(root, "dist", `${arg}.html`));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n올렸습니다: https://static.vynnlee.com/${arg} (${visibility})`);
if (visibility === "password") console.log("비밀번호 덱입니다. 주소와 비밀번호를 따로 전달하세요. 비밀번호는 저장되지 않고 해시만 올라갑니다.");
else console.log("공개 덱입니다. 주소를 아는 누구나 볼 수 있습니다(검색 엔진에는 노출되지 않습니다).");
console.log("내용을 고쳤다면 slidekit bundle, slidekit deploy를 다시 실행하세요.");
