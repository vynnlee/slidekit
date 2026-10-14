/* 새 덱 템플릿의 목록 원천. 공통 head(토큰, 스타일, 엔진 연결)는 engine/template/shell.html 하나이고 템플릿마다 슬라이드만 다르다.
   모양의 변화는 레이아웃 프리셋(engine/layouts.ts)이 맡으므로 템플릿은 슬라이드 묶음일 뿐이다.
   모든 템플릿은 표지가 첫 슬라이드이고 h1이 첫 제목이다(앱의 제목 설정이 deck-meta, <title>, 첫 h1에 같은 값을 넣는다).
   예제 문구는 "여기에 적는다" 꼴이라 lint의 placeholder 경고가 배포 전에 잡는다. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Template = { id: string; label: string; hint: string; slides: string };

const TALK = `<section data-slide="cover">
  <h1>__TITLE__</h1>
  <p>부제를 여기에 적는다</p>
  <aside data-notes>발표자만 보는 노트. 문단은 빈 줄로 나눈다.

두 번째 문단.</aside>
</section>

<section data-slide="chapter" data-title="첫 번째 장">
  <h1>첫 번째 장</h1>
</section>

<section data-slide="content">
  <h2>핵심 문장 하나</h2>
  <p>뒷받침하는 설명을 짧게 쓴다.</p>
  <p data-step="2">방향키를 한 번 더 누르면 나타나는 문장</p>
</section>

<section data-slide="content" data-layout="two-column">
  <h2>둘을 나란히 놓을 때는 두 열을 쓴다</h2>
  <div data-col>
    <h3>왼쪽 소제목을 여기에 적는다</h3>
    <p>왼쪽 설명을 여기에 적는다</p>
  </div>
  <div data-col>
    <h3>오른쪽 소제목을 여기에 적는다</h3>
    <p>오른쪽 설명을 여기에 적는다</p>
  </div>
</section>

<section data-slide="end">
  <h1>감사합니다</h1>
</section>`;

const BLANK = `<section data-slide="cover">
  <h1>__TITLE__</h1>
  <p>부제를 여기에 적는다</p>
</section>

<section data-slide="content">
  <h2>제목을 여기에 적는다</h2>
  <p>내용을 여기에 적는다</p>
</section>`;

const WORKSHOP = `<section data-slide="cover">
  <h1>__TITLE__</h1>
  <p>부제를 여기에 적는다</p>
  <aside data-notes>인사와 오늘의 목표를 말한다.

- 시간: 전체 시간을 여기에 적는다
- 준비물: 참가자가 미리 갖춰야 할 것</aside>
</section>

<section data-slide="chapter" data-title="준비">
  <h1>준비</h1>
  <aside data-notes>이 장은 환경을 갖추는 일이다. 막힌 사람이 없는지 **한 번 확인**하고 넘어간다.</aside>
</section>

<section data-slide="content">
  <h2>따라 하는 순서를 여기에 적는다</h2>
  <p>1단계 할 일을 여기에 적는다</p>
  <p data-step="2">2단계 할 일을 여기에 적는다</p>
  <p data-step="3">3단계 할 일을 여기에 적는다</p>
  <aside data-notes>방향키를 누를 때마다 한 단계씩 나타난다. 단계마다 참가자가 따라 할 시간을 준다.

예상 질문은 여기에 적는다.</aside>
</section>

<section data-slide="content" data-layout="big-number">
  <p data-big>30분</p>
  <p>실습 시간을 여기에 적는다</p>
  <aside data-notes>숫자 하나로 시간이나 목표를 보여 준다.</aside>
</section>

<section data-slide="content" data-layout="two-column">
  <h2>전과 후를 나란히 보여 준다</h2>
  <div data-col>
    <h3>실습 전을 여기에 적는다</h3>
    <p>시작할 때의 상태를 여기에 적는다</p>
  </div>
  <div data-col>
    <h3>실습 후를 여기에 적는다</h3>
    <p>끝났을 때의 상태를 여기에 적는다</p>
  </div>
  <aside data-notes>참가자가 얻어 가는 것을 한 문장으로 말한다.</aside>
</section>

<section data-slide="end">
  <h1>다음 행동 하나를 여기에 적는다</h1>
  <aside data-notes>질문을 받고 자료의 위치를 알려 준다.</aside>
</section>`;

export const TEMPLATES: Template[] = [
  { id: "talk", label: "Talk", hint: "발표 기본형: 표지, 장, 본문(단계 등장), 두 열, 끝", slides: TALK },
  { id: "blank", label: "Blank", hint: "가장 작게: 표지와 본문 한 장", slides: BLANK },
  { id: "workshop", label: "Workshop", hint: "실습용: 장, 단계 공개 절차, 큰 숫자, 전후 비교, 슬라이드마다 노트", slides: WORKSHOP },
];
export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);
export const DEFAULT_TEMPLATE = "talk";

/** 템플릿으로 덱 HTML을 만든다. title은 호출자가 이스케이프해서 준다. */
export function buildDeck(id: string, v: { title: string; date: string; author: string; id: string }) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`알 수 없는 템플릿: ${id}`);
  const shell = readFileSync(join(import.meta.dir, "template", "shell.html"), "utf8");
  return shell.replace("__SLIDES__", () => t.slides)
    .replaceAll("__TITLE__", v.title).replaceAll("__DATE__", v.date).replaceAll("__AUTHOR__", v.author).replaceAll("__ID__", v.id);
}
