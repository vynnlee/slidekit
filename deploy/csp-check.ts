#!/usr/bin/env bun
// 배포 Worker에 덱 CSP를 올리기 전 확인표(spec/WORKER-CSP.md 8절). 원격 호출도 토큰도 쓰지 않는다. 실행: bun deploy/csp-check.ts [덱...] [--build] [--json]
//   덱 이름을 안 주면 decks/ 의 모든 덱(점과 _로 시작하는 폴더 제외). 번들은 dist/<덱>.html을 읽는다. --build면 없는 번들을 slidekit bundle로 만든다.
//   표의 열: 덱, 게시 기록, 번들 크기, CSP가 허용할 외부 호스트, 허용하지 못한 외부 자원, CSP가 막을 사용, 판정.
//   판정: OK(그대로 동작), CHECK(막힐 사용이나 허용하지 못한 자원이 있어 사람이 눈으로 확인), NO BUNDLE(번들 없음).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readPublish } from "../engine/publish-record";
import { scanHosts } from "./hosts";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2), flags = new Set(args.filter((a) => a.startsWith("--"))), named = args.filter((a) => !a.startsWith("--"));
const decks = named.length ? named : readdirSync(join(root, "decks")).filter((d) => !d.startsWith(".") && !d.startsWith("_") && existsSync(join(root, "decks", d, "index.html"))).sort();

const rows = decks.map((deck) => {
  const bundle = join(root, "dist", `${deck}.html`);
  if (!existsSync(bundle) && flags.has("--build")) Bun.spawnSync(["bun", join(root, "app/server.ts"), "bundle", deck], { cwd: root, stdout: "ignore", stderr: "ignore" });
  let rec = "";
  try { const c = readPublish(join(root, "decks", deck)).current; rec = c ? `${c.visibility} ${c.at.slice(0, 10)}` : "없음"; } catch { rec = "없음"; }
  if (!existsSync(bundle)) return { deck, published: rec, kb: 0, hosts: [] as string[], skipped: [] as string[], blocked: [] as string[], verdict: "NO BUNDLE" };
  const html = readFileSync(bundle, "utf8"), s = scanHosts(html);
  return { deck, published: rec, kb: Math.round(statSync(bundle).size / 1024), hosts: s.hosts, skipped: s.skipped, blocked: s.blocked, verdict: s.skipped.length || s.blocked.length ? "CHECK" : "OK" };
});

if (flags.has("--json")) console.log(JSON.stringify(rows, null, 1));
else {
  console.log("| 덱 | 게시 기록 | 번들 KB | 허용 호스트 | 허용 못한 외부 자원 | 막힐 사용 | 판정 |\n|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.deck} | ${r.published} | ${r.kb || "-"} | ${r.hosts.join(", ") || "-"} | ${r.skipped.join(", ") || "-"} | ${r.blocked.join(", ") || "-"} | ${r.verdict} |`);
  console.log(`\n${rows.filter((r) => r.verdict === "OK").length}/${rows.length} OK. CHECK인 덱은 게시본을 열어 해당 기능이 CSP에서 막혀도 되는지 확인한다(막힌 요청은 콘솔에 CSP 위반으로 보인다).`);
}
