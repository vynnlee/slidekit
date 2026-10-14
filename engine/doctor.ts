/* slidekit doctor: 환경 점검을 한 화면에 OK/WARN으로. 비밀 값은 출력하지 않는다. */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { lint } from "./lint";

const root = join(import.meta.dir, "..");
let warns = 0;
const row = (ok: boolean, name: string, msg: string) => { if (!ok) warns++; console.log(`${ok ? "OK  " : "WARN"} ${name.padEnd(8)} ${msg}`); };

row(true, "bun", Bun.version);

const envChrome = process.env.SLIDEKIT_CHROME;
const cache = join(homedir(), "Library", "Caches", "ms-playwright");
const shell = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse()
  .flatMap((d) => readdirSync(join(cache, d)).map((s) => join(cache, d, s, "chrome-headless-shell"))).find(existsSync) : undefined;
if (envChrome) row(existsSync(envChrome), "chrome", existsSync(envChrome) ? `SLIDEKIT_CHROME ${envChrome}` : `SLIDEKIT_CHROME 경로가 없다: ${envChrome}`);
else row(!!shell, "chrome", shell ?? "없음. SLIDEKIT_CHROME을 지정하거나 playwright로 chromium_headless_shell을 설치한다(pdf 명령에 필요)");

for (const svc of ["slidekit-cloudflare-token"]) {
  const r = Bun.spawnSync(["security", "find-generic-password", "-s", svc], { stdout: "ignore", stderr: "ignore" });
  row(r.exitCode === 0, "keychain", `${svc} ${r.exitCode === 0 ? "있음" : "없음(deploy에 필요, deploy/README.md 1절)"}`);
}

const probe = async (port: number, host?: string) => {
  try { return (await fetch(`http://127.0.0.1:${port}/api/decks`, { headers: host ? { Host: host } : {}, signal: AbortSignal.timeout(1500) })).status; }
  catch { return 0; }
};
for (const port of [3200, 3220]) {
  const s = await probe(port);
  row(true, `port ${port}`, s ? `사용 중(HTTP ${s})` : "비어 있음");
}
const up = (await probe(3200)) ? 3200 : (await probe(3220)) ? 3220 : 0;
if (up) {
  const s = await probe(up, "evil.example");
  row(s === 403 || s === 400 || s === 421, "guard", `낯선 Host 요청에 HTTP ${s} (${up})${s === 403 || s === 400 || s === 421 ? "" : ". app/guard.ts의 Host 허용 목록과 바인딩 주소(127.0.0.1)를 확인한다"}`);
} else row(true, "guard", "서버가 꺼져 있어 건너뜀 (bun run slidekit 후 다시 실행)");

const decks = existsSync(join(root, "decks")) ? readdirSync(join(root, "decks"), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, "decks", d.name, "index.html"))) : [];
for (const d of decks) {
  const issues = lint(await Bun.file(join(root, "decks", d.name, "index.html")).text());
  const e = issues.filter((i) => i.level === "error").length, w = issues.length - e;
  row(e === 0, "lint", `${d.name}: 오류 ${e}, 경고 ${w}${e ? `. 자세히: bun run slidekit lint ${d.name}` : ""}`);
}
if (!decks.length) row(false, "lint", "decks/에 덱이 없다. bun run slidekit new <이름>으로 만든다");

console.log(warns ? `\n${warns}건 확인 필요` : "\n모두 정상");
process.exit(0);
