// 모든 덱에서 compose(splitDeck(원문)) === 원문 인지 확인한다. 실행: bun app/test/roundtrip.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compose, previewHtml, splitDeck } from "../src/lib/deck-source";

(globalThis as any).location ??= { origin: "http://localhost" }; // previewHtml이 base 주소에 쓴다
const dir = join(import.meta.dir, "..", "..", "decks");
// 점으로 시작하는 폴더(.trash 등)와 index.html이 없는 폴더는 덱이 아니다(목록 API와 같은 기준).
for (const d of readdirSync(dir).filter((n) => !n.startsWith(".") && existsSync(join(dir, n, "index.html")))) {
  const src = readFileSync(join(dir, d, "index.html"), "utf8");
  const doc = splitDeck(src);
  const ok = compose(doc) === src;
  const reordered = compose(doc, [...doc.units].reverse()).length;
  const leak = !src.includes("data-sk-show-steps") && (compose(doc).includes("data-sk-show-steps") || !previewHtml(doc, doc.units, d, { embed: true, showSteps: true }).includes("data-sk-show-steps") || previewHtml(doc, doc.units, d, { embed: true }).includes("data-sk-show-steps"));
  if (leak) { console.log(`FAIL ${d} data-sk-show-steps`); process.exit(1); }
  console.log(`${ok ? "PASS" : "FAIL"} ${d} slides=${doc.units.length} reversedLen=${reordered}/${src.length}`);
  if (!ok) process.exit(1);
}
