// slidekit image <덱> <파일> [--max 2400]: 이미지를 decks/<덱>/assets/에 저장하고 덱 기준 상대 경로를 출력한다(본체는 engine/assets.ts).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { AssetError, DEFAULT_MAX, saveAsset } from "./assets";

const args = process.argv.slice(2);
const mi = args.indexOf("--max");
let max = DEFAULT_MAX;
if (mi >= 0) { max = Number(args[mi + 1]); args.splice(mi, 2); }
const [deck, file] = args;
const USAGE = "사용법: slidekit image <덱> <파일> [--max 2400]  (예: slidekit image my-talk ~/Pictures/photo.jpg)";
if (!deck || !file) { console.error(USAGE); process.exit(1); }
if (!Number.isFinite(max) || max < 200) { console.error(`--max는 200 이상의 숫자여야 한다. ${USAGE}`); process.exit(1); }
if (!/^[\w-]+$/.test(deck)) { console.error(`덱 이름이 올바르지 않다: ${deck}`); process.exit(1); }
const deckDir = join(import.meta.dir, "..", "decks", deck);
if (!existsSync(join(deckDir, "index.html"))) { console.error(`없는 덱: decks/${deck}. 새 덱은 slidekit new <이름>`); process.exit(1); }
const src = resolve(file);
if (!existsSync(src) || !statSync(src).isFile()) { console.error(`파일이 없다: ${file}`); process.exit(1); }
try {
  const r = saveAsset(deckDir, src, new Uint8Array(readFileSync(src)), { max });
  for (const w of r.warnings) console.error(`경고: ${w}`);
  console.log(`저장했다: decks/${deck}/${r.path} (${(r.bytes / 1024).toFixed(0)} KB${r.width ? `, ${r.width}x${r.height}` : ""}${r.resized ? ", 줄였다" : ""})`);
  console.log(`덱에서는 <img src="${r.path}" alt="이미지 설명을 여기에 적는다"> 로 쓴다. alt는 꼭 적는다.`);
  console.log(r.path);
} catch (e) {
  if (e instanceof AssetError) { console.error(e.message); process.exit(1); }
  throw e;
}
