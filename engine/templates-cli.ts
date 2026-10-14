// slidekit templates [--json]: 새 덱 템플릿 목록(본체는 engine/templates.ts).
import { DEFAULT_TEMPLATE, TEMPLATES } from "./templates";

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(TEMPLATES.map(({ id, label, hint }) => ({ id, label, hint, default: id === DEFAULT_TEMPLATE })), null, 2));
} else {
  console.log("새 덱 템플릿 (slidekit new <이름> --template <id>)\n");
  for (const t of TEMPLATES) console.log(`${t.id}${t.id === DEFAULT_TEMPLATE ? " (기본)" : ""}  ${t.label}\n  ${t.hint}\n`);
}
