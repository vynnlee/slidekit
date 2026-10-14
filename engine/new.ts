/* slidekit new <이름>: engine/template/index.html로 decks/<이름>/index.html을 만든다 */
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const root = join(import.meta.dir, "..");
const name = process.argv[2];
if (!name) { console.error("사용법: slidekit new <이름>  (예: slidekit new my-talk)"); process.exit(1); }
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  console.error(`이름 "${name}"은 쓸 수 없다. 영문 소문자, 숫자, -만 쓴다(예: my-talk). 화면에 보이는 제목은 만든 뒤 덱 안에서 바꾼다.`);
  process.exit(1);
}
const dir = join(root, "decks", name);
const file = join(dir, "index.html");
if (await Bun.file(file).exists()) { console.error(`decks/${name}가 이미 있다. 다른 이름을 쓰거나 그 덱을 편집한다(bun run slidekit 후 덱 목록에서 열기).`); process.exit(1); }

const date = new Date().toLocaleDateString("sv"); // YYYY-MM-DD
// git 사용자 이름이 있으면 author로 채운다. 없으면 빈 문자열(목록과 lint는 빈 author를 정상으로 본다). JSON 문자열 안에 들어가므로 이스케이프한다.
const gitName = Bun.spawnSync(["git", "config", "user.name"]).stdout.toString().trim();
const author = JSON.stringify(gitName).slice(1, -1).replaceAll("<", "\\u003c");
const html = (await Bun.file(join(root, "engine", "template", "index.html")).text())
  .replaceAll("__TITLE__", "제목을 여기에 적는다").replaceAll("__DATE__", date).replaceAll("__AUTHOR__", author).replaceAll("__ID__", name);
await mkdir(dir, { recursive: true });
await Bun.write(file, html);
console.log(`만들었다: decks/${name}/index.html
다음:
  1. bun run slidekit 으로 앱을 열고 "${name}"을 선택해 제목과 문구를 고친다(파일을 직접 고쳐도 된다).
  2. bun run slidekit lint ${name} 으로 규격을 점검한다.
  3. 예제 문구는 모두 바꿔도 되고, data-slide 값(cover, chapter, content, end)은 바꾸지 않는다.`);
