// slidekit outline <덱> [--notes]: 덱을 Markdown 개요로 출력한다(본체는 engine/outline.ts). 발표자 노트는 --notes가 있을 때만 넣는다.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { outline } from "./outline";

const name = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!name || !/^[\w-]+$/.test(name)) { console.error("사용법: slidekit outline <덱> [--notes]  (예: slidekit outline my-talk --notes)"); process.exit(1); }
const dir = join(import.meta.dir, "..", "decks");
const file = join(dir, name, "index.html");
if (!existsSync(file)) {
  const have = existsSync(dir) ? readdirSync(dir).filter((d) => !d.startsWith(".") && !d.startsWith("_")) : [];
  console.error(`없는 덱: decks/${name}. 있는 덱: ${have.join(", ") || "(없음)"}`);
  process.exit(1);
}
process.stdout.write(outline(await Bun.file(file).text(), { notes: process.argv.includes("--notes") }));
