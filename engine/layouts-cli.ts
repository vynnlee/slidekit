// slidekit layouts [--json]: 레이아웃 프리셋 목록. 사람과 에이전트가 읽는다(본체는 engine/layouts.ts).
import { LAYOUTS } from "./layouts";

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(LAYOUTS, null, 2));
} else {
  console.log("슬라이드 레이아웃 (content 슬라이드의 data-layout 값)\n");
  for (const l of LAYOUTS) {
    console.log(`${l.id}  ${l.label}\n  ${l.hint}\n${l.html.split("\n").map((x) => "  " + x).join("\n")}\n`);
  }
  console.log("고르는 법: <section data-slide=\"content\" data-layout=\"<id>\">. data-layout이 없으면 title-body와 같다. 자세한 규칙은 spec/SPEC.md 2.1.");
}
