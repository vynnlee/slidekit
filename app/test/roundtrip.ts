// 모든 덱에서 compose(splitDeck(원문)) === 원문 인지 확인한다. 실행: bun app/test/roundtrip.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compose, splitDeck } from "../src/lib/deck-source";

const dir = join(import.meta.dir, "..", "..", "decks");
for (const d of readdirSync(dir)) {
  const src = readFileSync(join(dir, d, "index.html"), "utf8");
  const doc = splitDeck(src);
  const ok = compose(doc) === src;
  const reordered = compose(doc, [...doc.units].reverse()).length;
  console.log(`${ok ? "PASS" : "FAIL"} ${d} slides=${doc.units.length} reversedLen=${reordered}/${src.length}`);
  if (!ok) process.exit(1);
}
