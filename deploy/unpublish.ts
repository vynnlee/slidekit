#!/usr/bin/env bun
// 사용: slidekit unpublish <덱> [--yes]. 배포한 덱을 KV에서 지운다(html, meta, 시도 제한 카운터). --yes가 없으면 목록만 보이고 종료 코드 2.
// SLIDEKIT_DEPLOY_DRY_RUN=1 또는 --dry-run이면 지울 키만 출력하고 Cloudflare에 접속하지 않는다.
import { join } from "node:path";
import { runUnpublish, type KvOps } from "./unpublish-core";
import { WRANGLER } from "./kv";

const args = process.argv.slice(2);
const deck = args.find((a) => !a.startsWith("--"));
const yes = args.includes("--yes");
const dry = args.includes("--dry-run") || !!process.env.SLIDEKIT_DEPLOY_DRY_RUN;
if (!deck) { console.error("사용: slidekit unpublish <덱> [--yes]  (예: slidekit unpublish my-talk). --yes가 없으면 지울 목록만 보인다"); process.exit(1); }
if (!/^[\w-]+$/.test(deck)) { console.error(`덱 이름이 올바르지 않습니다: ${deck}`); process.exit(1); }

if (dry) process.exit(runUnpublish(deck, { yes, dry: true }, null));

// 토큰은 환경 변수나 키체인(slidekit-cloudflare-token)에서만 읽고 출력하지 않는다.
const token = process.env.CLOUDFLARE_API_TOKEN
  ?? Bun.spawnSync(["security", "find-generic-password", "-s", "slidekit-cloudflare-token", "-w"]).stdout.toString().trim();
if (!token) { console.error("Cloudflare 토큰이 없습니다. 키체인 slidekit-cloudflare-token에 토큰을 저장하세요(deploy/README.md 1절)."); process.exit(1); }
const { SLIDEKIT_DEPLOY_PASSWORD: _pw, ...baseEnv } = process.env;
const env = { ...baseEnv, CLOUDFLARE_API_TOKEN: token };
const wr = (...a: string[]) => Bun.spawnSync(["bunx", WRANGLER, ...a], { cwd: join(import.meta.dir, "worker"), env, stdout: "pipe", stderr: "pipe" });

const ops: KvOps = {
  get(key) {
    const r = wr("kv", "key", "get", key, "--binding", "DECKS", "--remote");
    return r.exitCode === 0 && r.stdout.toString().length ? r.stdout.toString() : null;
  },
  list(prefix) {
    const r = wr("kv", "key", "list", "--binding", "DECKS", "--remote", "--prefix", prefix);
    if (r.exitCode !== 0) throw new Error(`wrangler 목록 조회 실패 (종료 코드 ${r.exitCode})`);
    try { return (JSON.parse(r.stdout.toString()) as { name: string }[]).map((k) => k.name); } catch { return []; }
  },
  del(key) {
    const r = wr("kv", "key", "delete", key, "--binding", "DECKS", "--remote");
    if (r.exitCode !== 0) throw new Error(`wrangler 삭제 실패: ${key} (종료 코드 ${r.exitCode}). ${r.stderr.toString().split(token).join("***").trim().split("\n").slice(-2).join(" ").slice(0, 300)}`); // 토큰과 네트워크 단서만 남긴다
  },
};
try { process.exit(runUnpublish(deck, { yes, dry: false }, ops)); }
catch (e) { console.error(String((e as Error).message)); process.exit(1); }
