#!/usr/bin/env bun
// Worker 배포 리허설(승인 전에 돌려도 된다): 원격 호출도, 토큰도, 로그인도 쓰지 않는다. 실행: bun deploy/rehearse.ts
//   1) bun test deploy        단위 테스트(Worker 동시 요청, unpublish)
//   2) wrangler deploy --dry-run   번들과 바인딩(LIMITER, DECKS) 확인
//   3) wrangler dev --local(포트 3295, 임시 저장소)에 가짜 덱을 넣고 Worker를 실제로 띄워
//      공개 덱, 없는 덱 404, 보안 헤더, 비밀번호 폼, 문서 요청만 서빙, Durable Object 로그인 제한(5회 뒤 잠금과 Retry-After)을 본다.
// 환경의 Cloudflare 토큰은 자식 프로세스에 넘기지 않는다. 끝나면 서버와 임시 폴더를 지운다. `wrangler login`이나 원격 쓰기는 하지 않는다.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WRANGLER } from "./kv";
import { hashPassword } from "./worker/src/index";

const root = join(import.meta.dir, "..");
const workerDir = join(import.meta.dir, "worker");
const PORT = 3295;
const base = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), "sk-rehearse-"));
const state = join(tmp, "state");
const devLog = join(tmp, "wrangler-dev.log");
const { CLOUDFLARE_API_TOKEN: _t, CLOUDFLARE_API_KEY: _k, CLOUDFLARE_ACCOUNT_ID: _a, ...clean } = process.env;
const env = { ...clean, WRANGLER_SEND_METRICS: "false", WRANGLER_HIDE_BANNER: "true", CI: "true" } as Record<string, string>;

let bad = 0;
const ok = (name: string, good: boolean, extra = "") => { if (!good) bad++; console.log(`${good ? "PASS" : "FAIL"} ${name}${good || !extra ? "" : "  " + extra}`); };
const run = (args: string[], cwd = workerDir) => Bun.spawnSync(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
let server: ReturnType<typeof Bun.spawn> | null = null;
const stop = () => { if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch { try { server.kill(); } catch { /* 이미 끝났다 */ } } server = null; } rmSync(tmp, { recursive: true, force: true }); rmSync(join(workerDir, ".wrangler"), { recursive: true, force: true }); /* wrangler가 만든 임시 폴더 */ };
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(130); });

try {
  // 1) 단위 테스트
  const unit = Bun.spawnSync(["bun", "test", "deploy"], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const unitText = unit.stdout.toString() + unit.stderr.toString();
  ok("bun test deploy", unit.exitCode === 0, unitText.split("\n").slice(-6).join(" | "));

  // 2) 드라이런
  const dry = run(["bunx", WRANGLER, "deploy", "--dry-run", "--outdir", join(tmp, "out")]);
  const dryText = dry.stdout.toString() + dry.stderr.toString();
  ok("wrangler deploy --dry-run", dry.exitCode === 0 && /LIMITER/.test(dryText) && /DECKS/.test(dryText), dryText.split("\n").slice(-8).join(" | "));

  // 3) 로컬 Worker
  const pwA = "rehearsal-password-A", pwB = "rehearsal-password-B";
  const slides = (t: string) => `<!doctype html><html lang="en"><body><section data-slide="cover"><h1>${t}</h1></section></body></html>`;
  const put = (key: string, value: string) => { const f = join(tmp, key.replace(/\W/g, "_")); writeFileSync(f, value); const r = run(["bunx", WRANGLER, "kv", "key", "put", key, "--binding", "DECKS", "--local", "--persist-to", state, "--path", f]); if (r.exitCode !== 0) throw new Error(`kv put ${key}: ${r.stderr.toString().slice(0, 300)}`); };
  put("meta:r-pub", JSON.stringify({ visibility: "public", lang: "en", title: "Rehearsal public" })); put("html:r-pub", slides("public deck"));
  for (const [name, pw] of [["r-pw", pwA], ["r-pw2", pwB]] as const) { put(`meta:${name}`, JSON.stringify({ visibility: "password", lang: "en", ...(await hashPassword(pw)) })); put(`html:${name}`, slides(`${name} secret`)); }

  server = Bun.spawn(["bunx", WRANGLER, "dev", "--local", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", state, "--var", "COOKIE_SECRET:rehearsal-cookie-secret"], { cwd: workerDir, env, stdout: Bun.file(devLog), stderr: Bun.file(devLog), detached: true });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { up = await fetch(`${base}/r-pub`).then((r) => r.status === 200, () => false); if (!up) await Bun.sleep(500); }
  ok("wrangler dev --local이 떴다", up);
  if (up) {
    // 기존 스모크(GET만)를 로컬 주소로
    const smoke = Bun.spawnSync(["bun", "deploy/deploy.ts", "--smoke", "r-pub", "r-pw"], { cwd: root, env: { ...env, SLIDEKIT_BASE: base }, stdout: "pipe", stderr: "pipe" });
    const st = smoke.stdout.toString();
    ok("deploy --smoke(로컬 주소): 공개 덱, 404, 헤더, 비밀번호 폼, 문서만 서빙", smoke.exitCode === 0, st.split("\n").filter((l) => l.startsWith("FAIL")).join(" | ") || smoke.stderr.toString().slice(0, 200));

    // 로그인: 맞는 비밀번호는 303과 쿠키, 쿠키로 슬라이드, 틀리면 폼
    const post = (deck: string, pw: string) => fetch(`${base}/${deck}`, { method: "POST", redirect: "manual", headers: { Origin: base }, body: new URLSearchParams({ password: pw }) });
    const good = await post("r-pw2", pwB);
    const cookie = (good.headers.get("set-cookie") ?? "").split(";")[0];
    ok("맞는 비밀번호는 303과 쿠키", good.status === 303 && cookie.includes("="), String(good.status));
    const withCookie = await fetch(`${base}/r-pw2`, { headers: { Cookie: cookie } });
    ok("쿠키가 있으면 슬라이드가 나온다", withCookie.status === 200 && (await withCookie.text()).includes("data-slide"));
    const noCookie = await (await fetch(`${base}/r-pw2`)).text();
    ok("쿠키가 없으면 폼만(슬라이드 없음)", noCookie.includes('type="password"') && !noCookie.includes("data-slide"));

    // Durable Object 로그인 제한: 틀린 5번은 폼과 401, 여섯 번째부터 429와 Retry-After, 맞는 비밀번호도 잠금 중이면 거부
    const wrong: number[] = [];
    for (let i = 0; i < 5; i++) wrong.push((await post("r-pw", "wrong-password-" + i)).status);
    ok("틀린 비밀번호 5번은 폼과 함께 401", wrong.every((s) => s === 401), wrong.join(","));
    const sixth = await post("r-pw", "wrong-password-6");
    const retry = Number(sixth.headers.get("retry-after"));
    ok("6번째는 429와 Retry-After(최대 900초)", sixth.status === 429 && retry > 0 && retry <= 900, `${sixth.status} retry-after=${sixth.headers.get("retry-after")}`);
    const lockedGood = await post("r-pw", pwA);
    ok("잠금 중에는 맞는 비밀번호도 429", lockedGood.status === 429, String(lockedGood.status));
    const other = await post("r-pw2", pwB);
    ok("다른 덱은 잠금의 영향이 없다", other.status === 303, String(other.status));
    // 다른 사이트에서 온 POST는 거부
    const cross = await fetch(`${base}/r-pw2`, { method: "POST", headers: { Origin: "https://evil.example" }, body: new URLSearchParams({ password: pwB }) });
    ok("다른 Origin의 POST는 403", cross.status === 403, String(cross.status));
    ok("GET, HEAD, POST 외 메서드는 405", (await fetch(`${base}/r-pub`, { method: "DELETE" })).status === 405);
  }
} catch (e) { bad++; console.log("FAIL 예외 " + String(e).slice(0, 400)); }
finally {
  if (bad) { try { console.log("\n--- wrangler dev 로그(끝 40줄)\n" + (await Bun.file(devLog).text()).split("\n").slice(-40).join("\n")); } catch { /* 로그가 없다 */ } }
  stop();
}
console.log(bad ? `\n실패 ${bad}건` : "\n리허설 전체 통과(원격 호출 없음)");
process.exit(bad ? 1 : 0);
