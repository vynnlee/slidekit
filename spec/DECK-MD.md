# deck.md: 번들과 배포에서 재사용하는 Markdown (M3a)

2026-10-18 설계. 구현 전 문서다. 목적은 배포한 덱 옆에 `deck.md`를 두어 사람이나 에이전트가 **덱 내용을 HTML을 해석하지 않고** 읽고 이어서 작업(remix)하게 하는 것이다(Claude Artifacts가 `.md` 콘텐츠를 함께 내는 것을 본뜸). 본체는 기존 `engine/outline.ts`를 재사용하고, 덱과 엔진은 바닐라 그대로이며 새 의존성은 없다. 이 문서는 M3a(생성)만 다룬다. 배포가 파일을 올리고 `<head>`에 alternate 링크를 넣고 "Copy agent prompt" 단추를 만드는 것은 M3b(app-dev)다.

## 1. 원칙: 노트는 새지 않는다

`deck.md`는 공개 URL에 놓이므로 **발표자 노트를 기본으로 뺀다**. `notes: true`(CLI는 `--notes`)를 줄 때만 넣는다. 번들, 배포, 앱의 어떤 경로도 이 기본을 바꾸지 않는다(앱의 Copy as Markdown은 사용자가 자기 클립보드로 복사하는 것이라 지금처럼 노트를 넣는다. 배포용 `deck.md`는 별도 함수를 쓴다). 노트로 취급하는 것은 `aside[data-notes]` 전부이고, 비밀번호, 코멘트, 게시 기록, `.versions`는 HTML 밖의 정보라 원래 들어가지 않는다.

한계(문서에 적는다): 덱 CSS의 클래스로 숨긴 글(`.private { display: none }` 같은 규칙)은 CSS를 평가하지 않는 이 변환기가 알 수 없어 `deck.md`에 들어간다. 숨길 글은 `aside[data-notes]`나 `hidden` 속성, 인라인 `display:none`만 쓴다. `lint`는 `<style>`에 `display:none` 규칙이 있으면 `hidden-css` 경고를 낸다(구현됨).

## 2. 인터페이스

```ts
// engine/deck-md.ts (순수 함수, node:fs 없음)
deckMarkdown(html: string, opts?: { notes?: boolean }): string
```

- `outline(html, { notes, deck: true })`의 얇은 래퍼다. `outline`에 **옵트인 모드 `deck`** 하나를 더하고 기본 출력은 바꾸지 않는다(기존 스냅샷 불변). deck 모드가 켜는 것:
  - 이미지: 로컬 이미지(상대 경로, `data:`)는 `![alt](inline-image)`로 쓴다. 배포하면 이미지가 `deck.html` 안에 인라인되어 상대 경로가 옆 파일로 존재하지 않기 때문이다. `http(s):` 이미지는 주소를 그대로 둔다. deck 모드가 아니면 지금처럼 상대 경로를 쓴다.
  - 그림: 지금은 통째로 건너뛰는 `svg`, `video`, `audio`, `canvas`를 자리표시자 한 줄로 남긴다: `[figure: <title 또는 aria-label 또는 안의 글자>]`, `[video: <파일 이름>]`, `[audio: <파일 이름>]`. 글자가 없으면 `[figure]`. (무손실 = 글은 모두, 그림은 있다는 사실과 설명.)
- 표: 셀 안의 `|`는 이미 `\|`로 이스케이프된다(기존 동작). deck 모드는 `colspan`을 빈 칸으로 채워 열 수를 맞춘다.
  - 단어 띄우기: `span`, `small`, `label` 같은 인라인 요소가 앞뒤 글과 붙어 있으면 한 칸 띄운다(`모델<small>설명</small>` → `모델 설명`. 덱 CSS가 이들을 블록으로 만들기 때문). `br`은 제목 안에서도 공백이 된다.
- 머리말: `# 제목`, 부제(`deck-meta.subtitle`)가 있으면 `> 부제`, `- Author:`, `- Date:`, `- Language:`(`lang`). 슬라이드는 `## n. 제목`.
- CLI: `slidekit outline <덱> [--notes]`(그대로), `slidekit outline <덱> --deck-md`는 위 래퍼를 쓴다(미리보기와 시험용). 파일 생성은 번들러가 한다.
- 번들러: `slidekit bundle <덱>`이 `dist/<덱>.html` 옆에 `dist/<덱>.md`를 **항상** 만든다(노트 없음). `--notes`는 번들에 없다(번들은 공개용이므로 deck.md에 노트를 넣는 길을 열지 않는다). M3b가 이 파일을 올린다. `<link rel="alternate" type="text/markdown">` 삽입은 M3b가 정하는 파일 이름(`deck.md`)에 맞춰 `bundle.ts --alternate <href>` 한 옵션으로 연다(없으면 삽입하지 않아 오프라인 번들은 그대로).

## 3. 무손실의 뜻과 처리 표

| 요소 | deck.md |
|---|---|
| 제목 `h1`~`h6` | 슬라이드 제목 아래 `###`부터(기존 규칙), 슬라이드 제목과 같은 첫 제목은 중복하지 않음 |
| 문단, 줄바꿈 | 문단, `br`은 줄 끝 두 칸 |
| 목록 `ul`, `ol`, 중첩 | `-`와 `1.` 중첩 들여쓰기 |
| 표 | Markdown 표(첫 행 머리), 셀의 `\|` 이스케이프, `colspan`은 빈 칸으로 채움 |
| 코드 `pre` | 펜스 코드(언어 클래스 유지) |
| 인용 | `>` |
| 강조, 링크, 코드 | `**`, `*`, `[글](주소)`, `` ` `` |
| 이미지 | `![alt](inline-image 또는 http 주소)`. alt는 항상 남긴다(없으면 빈 alt) |
| svg, video, audio | `[figure: ...]` 같은 자리표시자 |
| 단계 등장 요소(`data-step`) | 문서 순서 그대로 포함(단계와 무관하게 모두) |
| 숨김(`hidden`, `aria-hidden`, 인라인 `display:none`), `script`, `style`, `footer` | 제외 |
| `aside[data-notes]` | 기본 제외, `notes: true`일 때 `> Notes:` |

## 4. 합격 기준

1. **노트 비누출**: 노트에 고유 문자열을 넣은 덱에서 기본 출력, 번들이 만든 `.md`, `deckMarkdown(html)` 어디에도 그 문자열이 없다. `{ notes: true }`일 때만 있다. 노트가 메타나 주석 안에 있어도 새지 않는다.
2. **글 무손실**: 별도 방법으로 뽑은 "보이는 글 단어"(HTML에서 script, style, svg, 숨김, 노트를 뺀 글을 단어로 나눈 다중 집합)와 `deck.md`에서 Markdown 기호를 뺀 단어 집합이 같다(자리표시자와 머리말 `Author:` 같은 라벨만 허용). 커밋된 안내 덱과 워크숍 덱, 템플릿 3종에서 통과.
3. **구조 보존**: 덱의 제목 수, 목록 항목 수, 표의 셀 수, 이미지 수와 alt, 링크 주소 수가 `deck.md`와 같다.
4. **이미지**: 로컬과 `data:` 이미지는 `inline-image`, `http(s)`는 주소 유지, alt는 모두 남는다.
5. **표**: `|`가 든 셀과 `colspan`이 있어도 열 수가 맞다.
6. **결정성과 성능**: 같은 입력은 같은 출력(바이트 동일). 53장 워크숍 덱 변환이 100ms 안에 끝난다.
7. **기존 `outline` 불변**: 템플릿 스냅샷 3개와 기존 단위 시험이 바뀌지 않는다(옵션 기본값 보존).
8. **번들러**: `slidekit bundle`이 `dist/<덱>.md`를 만들고(노트 없음), `--alternate` 옵션이 있을 때만 번들에 alternate 링크가 들어가며 링크가 없는 번들은 기존과 바이트 같다(외부 글꼴이 없는 고정 덱으로 비교).

## 5. 시험 계획 (브라우저 없음)

- `engine/test/deck-md.test.ts`(단위): 1~7번, 처리 표의 행마다 최소 샘플, 노트가 든 여러 위치(aside, 중첩 aside, 메타, 주석), `|` 표, svg와 video 자리표시자, 이미지 3종, 결정성, 성능.
- `bundler/test/bundle.test.ts` 확장: 번들이 `.md`를 만들고 노트가 없음, `--alternate` 유무에 따른 HTML 차이.
- `engine/test/cli.test.ts` 확장: `outline --deck-md`와 `--notes` 조합.
- 러너: 새 브라우저 단계 없음. 변경 매핑은 `engine/(deck-md|outline).ts`와 `bundler/`를 `unit-other`, `bundler-bundle`로.

## 6. 열린 질문

1. 비밀번호 덱의 `deck.md`는 `deck.html`과 같은 비밀번호 관문 뒤에 놓여야 한다(M3b와 Worker가 처리). 이 문서는 내용만 만든다.
2. 슬라이드마다 `<!-- slide n -->` 같은 주석 앵커나 `data-step` 정보를 `deck.md`에 넣을지: 에이전트가 이어서 작업할 때 필요하면 후속. 지금은 넣지 않는다(순수 읽기용).
3. 이미지 자체를 `deck.md` 옆에 같이 올릴지(`assets/`): 지금 설계는 번들이 이미지를 인라인하므로 올리지 않는다. 에이전트가 이미지를 보아야 하면 M3b에서 `deck.html`을 읽게 한다.
