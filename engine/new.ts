/* slidekit new <name>: decks/<name>/index.html from engine/template/index.html */
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const root = join(import.meta.dir, "..");
const name = process.argv[2];
if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  console.error("usage: slidekit new <name>   (lowercase letters, digits and - only)");
  process.exit(1);
}
const dir = join(root, "decks", name);
const file = join(dir, "index.html");
if (await Bun.file(file).exists()) { console.error(`already exists: decks/${name}`); process.exit(1); }

const date = new Date().toLocaleDateString("sv"); // YYYY-MM-DD
const html = (await Bun.file(join(root, "engine", "template", "index.html")).text())
  .replaceAll("__TITLE__", name).replaceAll("__DATE__", date).replaceAll("__ID__", name);
await mkdir(dir, { recursive: true });
await Bun.write(file, html);
console.log(`created decks/${name}/index.html`);
