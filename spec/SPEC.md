# slidekit 규격 v1

덱은 폴더 하나이고 원본은 `index.html`이다. 이 문서는 덱 HTML의 형식과 엔진(`engine/slidekit.js`, `engine/slidekit.css`)의 동작 약속을 정한다. 앱, 편집기, 번들러는 이 문서만 보고 구현한다.

## 1. 덱 파일

```html
<!doctype html>
<html lang="ko" data-slidekit="1">
<head>
  <meta charset="utf-8">
  <title>디자이너를 위한 바이브 코딩 워크숍</title>
  <script type="application/json" id="deck-meta">
    { "title": "디자이너를 위한 바이브 코딩 워크숍", "author": "이성빈", "date": "2026-10-12", "visibility": "public" }
  </script>
  <link rel="stylesheet" href="../../engine/slidekit.css">
  <style> :root { --sk-accent: #a78bfa; } /* 덱 토큰과 덱 전용 스타일 */ </style>
</head>
<body>
  <section data-slide="cover"> ... </section>
  <section data-slide="chapter" data-title="바이브 코딩"> <h1>바이브 코딩</h1> </section>
  <section data-slide="content">
    ...
    <aside data-notes>발표자만 보는 노트</aside>
  </section>
  <section data-slide="end"> ... </section>
  <script src="../../engine/slidekit.js"></script>
  <script> /* 덱 전용 스크립트. 엔진 뒤에 둔다. */ </script>
</body>
</html>
```

- `<html data-slidekit="1">`은 규격 버전 표시다. 값이 다르면 엔진은 콘솔에 경고한다.
- 슬라이드는 `<body>`의 직계 자식 `<section data-slide>`이다. 문서 순서가 슬라이드 순서다. 엔진이 `#sk-stage`를 만들어 슬라이드를 옮겨 담으므로 덱은 `viewport`나 `stage` 래퍼를 쓰지 않는다.
- 엔진 스크립트는 덱 스크립트보다 앞에 둔다. 엔진은 `DOMContentLoaded`에서 시작한다.
- 글꼴은 `<head>`의 `<link>`로 불러도 된다(`slidekit bundle`이 덱이 쓰는 글자만 남긴 woff2로 내장한다).
- 명령: `slidekit new <이름>`은 `engine/template/index.html`로 새 덱을 만들고, `slidekit lint <덱>`은 이 문서의 형식 위반을 규칙별로 출력하며(오류가 있으면 종료 코드 1), `slidekit bundle <덱>`은 단독 파일 하나로 묶고, `slidekit pdf <덱>`은 슬라이드당 한 페이지의 PDF로 내보내고, `slidekit deploy <덱>`은 배포하고, `slidekit doctor`는 환경을 점검한다.

## 2. 슬라이드

| `data-slide` | 의미 | 규칙 |
|---|---|---|
| `cover` | 표지 | 있다면 첫 슬라이드, 최대 1개 |
| `chapter` | 장 표지 | `data-title` 필수. 목차의 단위 |
| `content` | 본문 | 개수 제한 없음 |
| `end` | 마지막 | 있다면 마지막 슬라이드, 최대 1개 |

- 위 네 값 외의 값은 `content`로 처리하고 콘솔에 경고한다.
- `data-title`: 장 제목. `chapter`는 필수이고, 다른 종류에서는 선택이다(있으면 전체 보기에 표시). 화면에 글자를 그리는 일은 하지 않으므로 같은 글자를 `<h1>`에도 적는다.
- `data-steps="N"`: 슬라이드 안에서 N단계로 나뉘는 장(6절). 없으면 1. 슬라이드 안 요소의 `data-step`(6.3절)에서 계산한 단계 수보다 작게 선언해도 큰 쪽이 쓰인다.
- 장 번호: `chapter` 슬라이드를 위에서부터 1, 2, 3으로 센다. 각 슬라이드는 자신이 속한 장 번호를 가진다. 첫 `chapter` 앞의 슬라이드는 0이다.
- 목차는 `chapter`의 `data-title`로 엔진이 만든다(전체 보기, 앱의 장 목록). 목차 슬라이드는 규격에 없다.
- 슬라이드 번호는 1부터 센다. 외부로 나가는 모든 값(URL 해시, 메시지)도 1부터 센다.

### 노트

`<aside data-notes>`를 슬라이드의 자식으로 둔다. 슬라이드당 하나이고 내용은 마크다운 원문(CommonMark 범위)이다. 엔진은 항상 숨기고(`display:none`), 앱에는 `textContent`를 앞뒤 공백 제거 후 문자열로 넘긴다. 마크다운은 렌더하지 않고 원문 그대로 넘기며, 렌더는 앱이 한다(원시 HTML은 렌더하지 않고 이스케이프한다). 글자에 `<`, `&`가 있으면 파일에는 `&lt;`, `&amp;`로 적힌다.

## 3. 화면

- 무대는 1920x1080 고정이다. 덱 내용은 px로 설계하고 `vw`, `vh`, `100vh`를 쓰지 않는다.
- 엔진은 `scale = min(창폭/1920, 창높이/1080)`로 무대를 줄이고 늘려 창 가운데에 둔다(`transform: translate() scale()`). 남는 영역은 `--sk-bg`로 채운다. `resize`와 `fullscreenchange`에서 다시 계산한다. 현재 배율은 `SlideKit.scale`로 읽는다.
- 활성 슬라이드에 `data-active` 속성을 붙인다. 나머지는 `visibility:hidden`이고 `display:none`을 쓰지 않는다. `url(#id)` 참조와 크기 측정이 비활성 슬라이드에서도 동작해야 하기 때문이다.
- 슬라이드가 켜질 때 0.34초 페이드인을 쓴다. 방향키 이동(앞뒤, 단계 끝)에서는 떠나는 슬라이드가 0.2초 동안 남아 서로 겹치며 사라지는 크로스페이드가 된다(`data-leaving`, 약 0.36초 뒤 제거). 해시, 숫자 입력, 전체 보기, 동기화로 건너뛸 때와 임베드 모드에서는 크로스페이드 없이 바로 바뀐다(새 슬라이드의 페이드인만 재생된다). `prefers-reduced-motion: reduce`이면 전부 끈다. 곡선은 토큰 `--sk-ease`다.
- 덱 CSS는 활성 여부를 `[data-slide][data-active]`로 선택한다.
- 슬라이드 기본 배치(엔진 CSS): 무대 전체를 덮고, `flex` 세로 배치, 세로 가운데 정렬, 안쪽 여백과 간격은 토큰을 따른다. 종류별 모양(`cover`, `chapter`)은 덱 CSS가 정한다.
- 무대 밖으로 넘친 내용은 잘린다(`overflow:hidden`).
- 세로나 좁은 창에서는 무대 비율(16:9)을 유지한 채 줄어들고, 남는 위아래나 좌우는 `--sk-bg`로 채워진다. 화면에 안내나 버튼을 띄우지 않는다.
- 접근성: 무대 `#sk-stage`는 `role="main"`, 전체 보기는 `role="dialog"`(`aria-label` "Slide overview", 포커스 가능)이다. 썸네일 번호는 `--sk-muted`로 대비를 맞춘다. axe-core 검사에서 슬라이드와 전체 보기 위반 0건.
- 인쇄(`@media print`): 브라우저 인쇄와 PDF 저장은 슬라이드 한 장을 한 페이지(1920x1080px, 16:9)로 모든 슬라이드를 출력한다. 배경색을 유지하고 노트와 엔진 UI(페이지 번호, 진행률, 전체 보기, 숫자 입력)는 숨긴다. stepper 슬라이드는 1단계 모습이고, 인쇄 직전 `beforeprint`에서 활성 슬라이드의 stepper를 `goto(1)`로 맞췄다가 `afterprint`에서 되돌린다.

## 4. 디자인 토큰

`:root`의 `--sk-` CSS 변수다. 엔진 CSS가 기본값을 주고 덱이 덮어쓴다. 덱 전용 변수는 `--sk-` 접두사를 쓰지 않는다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `--sk-bg` | `#000` | 배경 |
| `--sk-fg` | `#fff` | 본문 글자 |
| `--sk-muted` | `#9a9a9f` | 보조 글자 |
| `--sk-faint` | `#7a7a80` | 약한 글자 |
| `--sk-line` | `#2b2b30` | 구분선 |
| `--sk-panel` | `#0f0f12` | 카드 배경 |
| `--sk-accent` | `#a78bfa` | 강조색 |
| `--sk-font` | `"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif` | 본문 글꼴 |
| `--sk-font-mono` | `"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace` | 고정폭 글꼴 |
| `--sk-pad-y` | `150px` | 슬라이드 위아래 여백 |
| `--sk-pad-x` | `170px` | 슬라이드 좌우 여백 |
| `--sk-gap` | `56px` | 슬라이드 안 요소 간격 |
| `--sk-fs-h1` | `120px` | `h1` |
| `--sk-fs-h2` | `68px` | `h2` |
| `--sk-fs-body` | `36px` | 본문 `p` |
| `--sk-fs-small` | `28px` | 작은 글자 |
| `--sk-step-ms` | `360ms` | 선언형 단계 등장(`data-step`)의 전환 시간 |
| `--sk-ease` | `cubic-bezier(.22,1,.36,1)` | 슬라이드 진입과 단계 등장의 곡선 |

엔진 CSS는 `body` 배경과 글자색, 글꼴, `h1`, `h2`, `p`의 크기를 위 토큰으로 정한다. 색은 `color-scheme: dark`를 전제한다. 표의 기본값은 엔진 CSS의 값이다(워크숍 덱처럼 덱 CSS가 일부를 덮어쓸 수 있다).

엔진이 붙이는 요소(페이지 번호, 진행률, 전체 보기, 숫자 입력 표시)는 `--sk-fg`, `--sk-faint`, `--sk-muted`, `--sk-bg`, `--sk-line`, `--sk-font`를 쓴다. 숫자 입력 알약의 배경(`rgba(255,255,255,.14)`)과 가리기 덮개(`#000`, `#fff`)만 고정 색이다.

## 5. `#deck-meta`

`<script type="application/json" id="deck-meta">`에 JSON 한 개를 둔다. 없거나 깨져 있으면 엔진은 기본값으로 동작하고 경고한다.

| 필드 | 형식 | 기본값 | 설명 |
|---|---|---|---|
| `title` | string | `<title>` | 덱 제목. 필수 |
| `subtitle` | string | 없음 | 부제 |
| `author` | string | 없음 | 발표자 |
| `date` | string `YYYY-MM-DD` | 없음 | 강의일 |
| `lang` | string | `ko` | 언어 코드 |
| `visibility` | `"public"` 또는 `"password"` | `"public"` | 공개 범위. 비밀번호는 덱에 넣지 않는다 |
| `pageNumber` | boolean | `false` | 페이지 번호 표시 |
| `progress` | boolean | `false` | 진행률 막대 표시 |
| `id` | string(영문 소문자, 숫자, `-`) | 폴더 이름 | 동기화 채널 구분용 덱 식별자 |

`pageNumber`, `progress`는 `cover`와 `end`에서는 숨긴다. 번호는 `현재 / 전체` 형식으로 무대 아래쪽, 슬라이드 오른쪽 여백(`--sk-pad-x`)에 맞춰 `--sk-faint` 색으로 그린다. 진행률은 맨 아래 2px 선이다.

## 6. 엔진 동작

### 6.1 키 입력

| 키 | 동작 |
|---|---|
| `ArrowRight`, `ArrowDown` | 앞으로. stepper가 있으면 단계 먼저, 끝나면 다음 슬라이드 |
| `ArrowLeft`, `ArrowUp` | 뒤로. 같은 규칙 |
| `F` | 전체화면 토글. 화면에 버튼을 두지 않는다. `F`와 `O`는 한글 입력 상태에서도 동작하도록 `e.code`(`KeyF`, `KeyO`)로 받는다 |
| `O` | 전체 보기 토글 |
| `B`, `W` | 검은 화면, 흰 화면 가리기(Keynote와 같다). 같은 키를 다시 누르면 돌아오고 다른 키는 바로 바뀐다. `e.code`(`KeyB`, `KeyW`)로 받는다 |
| 숫자 + `Enter` | 해당 번호의 장 슬라이드로 이동 |
| `Esc` | 전체 보기 닫기, 숫자 입력 취소 |

- 이동은 방향키로만 한다. 클릭, 스페이스, `Enter`(숫자 입력이 없을 때), `PageUp`, `PageDown`, 터치 스와이프, 휠로는 이동하지 않는다. 엔진은 이 입력에 핸들러를 달지 않는다.
- 수정 키(`Meta`, `Ctrl`, `Alt`)가 눌려 있으면 모든 키를 무시한다.
- 입력 대상이 `input`, `textarea`, `select`, `contenteditable`이면 키를 무시한다. `Esc`는 그 요소의 포커스를 해제한다.
- 숫자 + `Enter`: 숫자는 장 번호(2절)다. 입력 중인 숫자는 최근 3자리만 남기고(4자리째를 누르면 맨 앞이 밀려난다) 무대 아래 가운데에 알약 모양으로 표시하고 해당 장의 제목을 함께 보여 주며(없는 장이면 흐리게), 3초 동안 입력이 없으면 지운다. 해당 장이 없으면 Enter를 무시한다.
- 접근성: 화면에는 그리지 않는 보이지 않는 안내 영역(`#sk-live`, `role="status"`, `aria-live="polite"`)이 슬라이드가 바뀔 때마다 `슬라이드 n / N, 장 제목 또는 첫 제목`(단계가 있으면 `, 단계 k / N`)을 읽어 준다. `deck-meta.lang`이 `en`이면 영어 문구다. 전체 보기를 열면 포커스가 전체 보기 안으로 옮겨 가고 선택을 옮길 때마다 `전체 보기, n 제목`이 안내되며, 닫으면 포커스가 풀린다. 임베드 모드에는 안내 영역이 없다.
- 이벤트와 입력 세부: `sk:enter`와 `sk:leave`의 `detail`은 `{ slide: n }`이다. 전체 보기가 열려 있으면 숫자 입력을 받지 않고, 전체 보기에서 위아래 방향키는 화면 위치 기준으로 선택을 옮긴다. 안내 영역의 제목은 80자로 자른다.
- 포인터: 마우스가 2초 동안 움직이지 않으면 숨기고(전체 보기가 열려 있을 때는 숨기지 않는다) 움직이거나 누르면 다시 보인다. 전체 보기를 열면 숨김이 풀린다. 임베드 모드에서는 이 동작이 없다.
- 가리기(`B`, `W`): `#sk-stage` 위의 전체 화면 덮개(`#sk-blank`, 전환 없음, 화면에 버튼이나 표시를 두지 않는다)다. 켜져 있는 동안 `#sk-stage`는 `aria-hidden`이고 포커스는 그대로다. 위치, 단계, 동기화는 바뀌지 않으며 가림 상태는 창마다 독립이다(발표 창만 가려도 발표자 화면은 보인다). 켜진 동안 방향키와 `Esc`는 가리기만 풀고 이동하지 않으며, 그 밖의 키는 무시한다. 입력 대상 안에서, 수정 키와 함께, 임베드 모드에서는 동작하지 않고 인쇄에서는 보이지 않는다. `B`, `W`는 반복 입력(`e.repeat`)을 무시하고, 가리기 상태는 동기화 채널로 알려진다(6.5 `blank`).
- 전체 보기: 모든 슬라이드를 장별로 묶은 격자 축소판이다. 방향키로 선택을 옮기고 `Enter` 또는 축소판 클릭으로 이동하며 닫는다. 격자는 창 폭에 맞춰 칸이 늘고 줄며(칸 최소 260px) 축소판은 칸 폭에 맞게 줄여 그린다. 선택은 2px `--sk-fg` 윤곽, 지금 보던 슬라이드는 번호 앞 점으로 표시한다. 축소판은 `inert`로 복제한 사본이고 stepper는 동작하지 않는다(1단계 모습). 사본은 `id`를 유지한다. 사본 컨테이너는 무대 뒤에 붙이므로 `getElementById`는 원본을 찾는다.

### 6.2 위치와 URL 해시

- 위치는 `(slide, step)`이다. 둘 다 1부터 센다. stepper가 없는 슬라이드의 step은 1이다.
- URL 해시 `#N`은 슬라이드 번호다. 이동할 때마다 `history.replaceState`로 갱신한다(기록을 쌓지 않는다). 시작할 때 해시를 읽고 범위를 벗어나면 가장 가까운 슬라이드로 맞춘다. `hashchange`가 오면 현재와 다른 유효한 번호일 때 그 슬라이드로 이동한다. 해시에 step은 넣지 않고, 해시로 들어가면 step은 1이다(슬라이드가 바뀌면 `enter(true)`, 이어서 `goto(1)`). 숫자가 아니면 1번 슬라이드다.
- 슬라이드가 0장이면 엔진은 경고만 하고 아무것도 만들지 않는다. 같은 `id`가 겹쳐도 엔진은 `id`를 쓰지 않으므로 동작하지만, `getElementById`와 SVG `url(#id)`는 첫 요소를 가리킨다.

### 6.3 슬라이드별 stepper

슬라이드 안에서 단계를 넘기는 장은 두 가지를 모두 한다.

1. 슬라이드에 `data-steps="N"`(N은 2 이상 정수)을 선언한다.
2. 덱 스크립트가 구현을 등록한다.

```js
SlideKit.stepper(document.getElementById('tok-slide'), {
  enter(forward) {},   // 슬라이드에 들어올 때. forward면 1단계, 뒤로 돌아오면 N단계로 맞춘다. 애니메이션 없이
  next() {},           // 한 단계 앞으로. 이동했으면 true, 마지막 단계라 못 움직였으면 false
  prev() {},           // 한 단계 뒤로. 같은 규칙
  get() {},            // 현재 단계(1..N)
  goto(n) {},          // n단계로 즉시 이동. 애니메이션 없이. 동기화와 앱 명령에 쓴다
})
```

- 다섯 메서드가 모두 필요하다. 하나라도 없으면 엔진은 등록을 거부하고 경고하며, 그 슬라이드는 일반 슬라이드로 취급한다.
- 엔진은 이동 입력마다 `next()` 또는 `prev()`를 먼저 부른다. `true`면 슬라이드는 그대로 두고 step만 갱신해 알린다. `false`면 다음 또는 이전 슬라이드로 넘어간다.
- 다른 슬라이드에서 들어오면 엔진이 `enter(forward)`를 부른다. 앞으로 오면 `true`, 뒤로 오면 `false`다.
- 동기화나 앱 명령으로 `(slide, step)`에 직접 이동하면 슬라이드가 바뀔 때 `enter(true)`를 부르고, 같은 슬라이드 안에서는 `goto(step)`만 부른다.
- `SlideKit.stepper`는 엔진 시작 전후 어느 때든 부를 수 있다.
#### 선언형 단계 (`data-step`)

JS 없이 슬라이드 안 요소를 단계마다 나타나게 한다(Keynote의 build, reveal.js의 fragment).

```html
<section data-slide="content">
  <h2>세 가지 원칙</h2>
  <p data-step="2">첫째</p>
  <p data-step="3" data-step-effect="fade">둘째</p>
</section>
```

- `data-step="N"`: N은 2 이상 정수. 이 요소는 N단계부터 보인다. 속성이 없거나 1이면 처음부터 보인다. 정수가 아니거나 1 이하이면 엔진이 경고하고 무시한다.
- 슬라이드의 단계 수는 `data-steps`와 요소의 `data-step` 최댓값 중 큰 쪽이다(둘 중 하나만 있어도 된다).
- `data-step="1"`과 정수가 아닌 값은 경고 없이(1) 또는 경고하고(그 밖의 값) 무시하며 요소는 처음부터 보인다. `slidekit lint`는 이를 오류로 막고, `data-steps`를 쓰면 section `id`와 `SlideKit.stepper` 등록이 있어야 한다(`data-step`만 쓰는 슬라이드에는 해당 없다).
- 같은 슬라이드에 `SlideKit.stepper`로 등록한 구현이 있으면 그쪽이 우선이고 `data-step`은 동작하지 않는다(요소는 숨겨진 채로 남는다).
- 이동 규칙은 위 stepper와 같다. 앞으로는 단계가 먼저이고 끝나면 다음 슬라이드, 뒤로도 같으며 뒤에서 들어오면 마지막 단계다. 동기화, `info`의 `steps`, `state`의 `step`, embed의 `goto(slide, step)`도 같은 숫자를 쓴다. 해시 진입은 1단계다.
- 숨김 상태는 `visibility:hidden`과 `opacity:0`이고 자리는 그대로 차지한다(레이아웃이 움직이지 않는다). 효과는 `data-step-effect`: `rise`(기본, 투명도와 20px 위로 올라오기), `fade`(투명도만), `none`(즉시). 시간은 `--sk-step-ms`(기본 360ms)이고 `prefers-reduced-motion: reduce`이면 전환이 없다. 이동(`enter`, `goto`, 해시, 동기화)으로 단계가 바뀔 때는 전환 없이 바로 바뀐다.
- 전체 보기 축소판은 1단계 모습이다. 인쇄(`@media print`)는 모든 단계를 보인다. 편집기 캔버스가 모든 단계를 한 번에 보여 주려면 `<html data-sk-show-steps>`를 붙인다.
- 편집기 지원: Inspector의 Appearance에 "Appears at step" NumberField(min 1, 1이면 속성 삭제)와 effect Select(Rise, Fade, None)가 있다.

- 슬라이드 상태 변화(진입과 이탈)를 알아야 하는 덱 코드는 슬라이드 요소의 `sk:enter`, `sk:leave` 이벤트(버블링)를 듣거나 `data-active` 속성을 읽는다.

### 6.4 URL 쿼리 모드

| 쿼리 | 효과 |
|---|---|
| `?sync=1` | BroadcastChannel 동기화를 켠다(6.5) |
| `?embed=1` | 부모 앱이 조종하는 임베드 모드(6.6). `<html data-sk-embed>` 속성도 같은 효과를 낸다(쿼리를 붙일 수 없는 `blob:` 문서용) |

둘 다 없으면 단독 덱이다. 동기화하지 않고 부모와 통신하지 않는다. 둘을 함께 쓰면 `embed`가 우선하고 `sync`는 무시한다. 엔진의 쿼리는 이 둘뿐이다. 슬라이드 번호는 해시(`#N`)로 정하며 `?slide=N` 같은 쿼리는 없다. 앱의 발표자 화면 `/present/<덱>?from=N`은 엔진 쿼리가 아니라 앱 경로이고, 발표 창을 열 때 `?sync=1#N`을 붙인다.

### 6.5 BroadcastChannel 동기화

`?sync=1`인 인스턴스(발표 화면 창)와 같은 출처의 앱 페이지(발표자 화면)가 같은 위치를 본다.

- 채널 이름: `slidekit:<deckId>`. `deckId`는 `deck-meta.id`, 없으면 `location.pathname`의 폴더 이름(예: `/decks/vibe-coding-workshop/index.html`이면 `vibe-coding-workshop`)이다. 번들 한 파일(`dist/<덱>.html`)을 `id` 없이 열면 폴더 이름이 `dist`가 되어 서로 다른 번들의 채널이 겹칠 수 있으므로 `id`를 항상 적는다.
- 메시지는 JSON 객체이고 `v: 1`을 포함한다. `from`은 인스턴스마다 무작위로 만든 문자열이다.

| `type` | 필드 | 보내는 때 |
|---|---|---|
| `state` | `slide`, `step` | 사용자 입력으로 위치가 바뀐 직후 |
| `hello` | 없음 | 인스턴스가 시작할 때(발표자 화면은 이후 2초마다 다시 보낸다) |
| `blank` | `mode`(`"black"`, `"white"`, `null`) | 가리기(B, W)를 켜거나 끌 때, `hello`를 받았을 때 가리기가 켜져 있으면 |

- `state`를 받으면 `enter(true)`와 `goto(step)` 규칙(6.3)으로 이동한다. 받아서 이동한 경우에는 다시 보내지 않는다. 자기 `from`의 메시지는 무시한다.
- 앱 쪽 메시지(발표자 화면)에는 `role: "presenter"`가 붙는다. 엔진은 이 필드를 읽지 않고, 앱은 `role`이 없는 메시지가 오면 발표 창이 살아 있다고 보고 5초 안에 답이 없으면 닫힘으로 본다. 앱은 `hello` 뒤 800ms 안에 사용자가 직접 움직였으면 늦게 온 `state`를 따르지 않는다.
- `state`는 사용자 입력 외에 `hashchange`와 전체 보기에서 슬라이드를 고를 때도 보낸다. 시작 때의 초기 위치와 `state`를 받아 이동한 경우는 보내지 않는다.
- `hello`를 받으면 현재 위치를 `state`로 답한다. 가리기가 켜져 있으면 `blank`도 보낸다(재연결 때 상태 복원).
- `blank`는 알림일 뿐이다. 받은 인스턴스는 자기 화면을 가리지 않는다(가리기는 창별 독립). 발표자 화면이 상태를 보이는 데 쓴다.
- 동시에 입력이 오면 나중에 도착한 `state`가 이긴다.
- 앱 페이지는 이 채널에 직접 참여하고, 자기 iframe은 postMessage로 조종한다(6.6).

```json
{ "v": 1, "type": "state", "from": "k3j9x", "slide": 12, "step": 3 }
```

### 6.6 부모 앱과 iframe 사이 postMessage

`?embed=1`로 열린 덱이 부모 창(앱)과 주고받는다. 임베드 모드의 엔진은 키 입력, 전체 보기, 해시 갱신, 숫자 입력을 처리하지 않는다(앱이 `pointer-events:none`으로 iframe을 띄우고 키는 앱이 받는다). 시작할 때 해시를 한 번 읽어 초기 위치로만 쓴다. 페이지 번호와 진행률도 그리지 않는다.

- 같은 출처만 허용한다. 엔진은 `event.source === window.parent`이고 `event.origin === location.origin`인 메시지만 받고, 보낼 때 `targetOrigin`은 `location.origin`이다. 덱은 `file:`이 아니라 http로 연다.
- 모든 메시지는 `{ source: "slidekit", v: 1, type, ... }`이다.

부모 -> 덱 (명령):

| `type` | 필드 | 동작 |
|---|---|---|
| `goto` | `slide`, `step`(선택, 기본 1) | 해당 위치로 즉시 이동 |
| `next` | 없음 | 방향키 오른쪽과 같은 동작 |
| `prev` | 없음 | 방향키 왼쪽과 같은 동작 |
| `get-info` | 없음 | `info`를 다시 보낸다 |

덱 -> 부모 (알림):

| `type` | 필드 | 보내는 때 |
|---|---|---|
| `ready` | `info` | 엔진 시작 직후 1회 |
| `info` | `info` | `get-info`에 대한 답 |
| `state` | `slide`, `step` | 위치가 바뀔 때마다(명령으로 바뀐 경우 포함) |

`info` 객체:

```json
{
  "meta": { "title": "...", "author": "...", "date": "2026-10-12", "visibility": "public", "lang": "ko", "pageNumber": false, "progress": false, "id": "vibe-coding-workshop" },
  "slide": 1, "step": 1,
  "slides": [
    { "n": 1, "kind": "cover", "title": null, "chapter": 0, "steps": 1, "notes": "" },
    { "n": 3, "kind": "chapter", "title": "바이브 코딩", "chapter": 1, "steps": 1, "notes": "" }
  ],
  "chapters": [ { "n": 3, "title": "바이브 코딩" } ]
}
```

- `slides`는 문서 순서 전체이고 `n`은 슬라이드 번호다. `steps`는 `data-steps`(없으면 1)다. `title`은 `data-title`이 없으면 `null`이다. `notes`는 2절 규칙의 마크다운 원문 문자열이다.
- `chapters`는 `chapter` 슬라이드만 문서 순서로 모은 목차다.
- 발표자 화면의 구성: 현재 슬라이드 iframe과 다음 슬라이드 iframe(`goto`로 `slide+1`, step 1)에 `?embed=1`을 쓰고, 노트와 장 위치는 `info`에서 읽는다. 위치 변화는 BroadcastChannel `state`와 iframe `state`를 함께 듣는다.

## 7. 문구와 디자인 규칙

덱 본문과 노트, 이 규격 문서에 적용한다.

- 덱은 신뢰된 콘텐츠다. 덱은 앱과 같은 출처에서 열려 앱의 API에 닿을 수 있으므로, 덱 스크립트는 `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `/api/` 호출을 쓰지 않는다(`slidekit lint`가 경고한다). 남에게 받은 덱은 열기 전에 스크립트를 읽는다.
- 금지: em-dash, en-dash, 가운뎃점, 이모지, 구어체. 비유와 은유도 금지한다. 사용자가 직접 요청한 경우는 예외다.
- 배경은 검은색, 글자는 흰색이 기본이다. 페이지 번호와 꾸밈 요소 없이 미니멀하게 간다(`pageNumber`, `progress` 기본 꺼짐).
- 로고는 브랜드 색을 쓴다. 사용자가 준 이미지는 원본 그대로 쓴다.

## 8. 워크숍 덱 변환 매핑

(변환은 끝났다. 이 절은 기록이고, 줄 번호와 `class="slide"` 형태는 변환 전 원본 기준이다. 현재 파일은 이미 1절 형식이다.)

대상: `decks/vibe-coding-workshop/index.html`(1306줄, 슬라이드 53장). 현재 파일은 `<html>`, `<head>`, `<body>` 없이 `<title>`, `<link>`, `<style>`, `<div>`, `<script>`만 있는 조각이다.

### 구조

| 현재 | 규격 |
|---|---|
| `<title>바이브 코딩 기초</title>` | `<head>` 안 `<title>`을 `deck-meta.title`과 같은 "디자이너를 위한 바이브 코딩 워크숍"으로 바꾼다 |
| 최상위 조각 (html, head, body 없음) | 1절의 완전한 문서로 감싼다. `lang="ko"`, `data-slidekit="1"` |
| 없음 | `#deck-meta` 추가: title, subtitle "Google Antigravity로 시작하는 바이브 코딩", author "이성빈", date "2026-10-12", visibility "public", id "vibe-coding-workshop" |
| Google Fonts `<link>` 3줄 (Noto Sans KR, JetBrains Mono) | 그대로 `<head>`에 둔다 |
| `<div id="viewport"><div id="stage">` ... `</div></div>` | 삭제. 슬라이드를 `<body>` 직계로 둔다 |
| `<section class="slide cover">` 첫 번째 (463줄) | `<section data-slide="cover">` |
| `<section class="slide section">` 7개 | `<section data-slide="chapter" data-title="...">`. 제목은 안의 `<h1>` 글자와 같게 한다: 바이브 코딩, 코딩 에이전트 생태계, 프로젝트 폴더와 파일 구조, 마크다운, 스킬 MCP 플러그인(원문 "스킬, MCP, 플러그인"), Git과 GitHub, 배포 |
| `<section class="slide">` 일반 | `<section data-slide="content">` |
| `<section class="slide tok-slide" id="tok-slide">` | `<section data-slide="content" data-steps="4" id="tok-slide" class="tok-slide">` |
| `<section class="slide cover">` 마지막 (1138줄, "감사합니다") | `<section data-slide="end">` |
| 슬라이드 개수: cover 1, section 7, 일반 44(`tok-slide` 포함), 마지막 cover 1 = 53 | 변환 후 `data-slide` 개수가 같아야 한다 |
| 노트 없음 | 변환 범위 밖. 이후 `<aside data-notes>`를 추가한다 |

### CSS

| 현재 | 규격 |
|---|---|
| `:root{--bg,--fg,--muted,--faint,--line,--panel,--sans,--mono}` | 각각 `--sk-bg`, `--sk-fg`, `--sk-muted`, `--sk-faint`, `--sk-line`, `--sk-panel`, `--sk-font`, `--sk-font-mono`. 값은 같다. 덱 CSS의 `var(--bg)` 등을 새 이름으로 바꾼다 |
| `--r-model:#a78bfa` | `--sk-accent`로 올린다. 덱 안 `var(--r-model)`은 `--r-model: var(--sk-accent)`로 별칭을 두어 유지해도 된다 |
| `--r-user`, `--r-tool`, `--r-pc`, `--t1`..`--t7` | 덱 전용이므로 이름 그대로 `<style>`에 남긴다 |
| `color-scheme:dark` | 엔진 CSS가 준다. 삭제 |
| `html,body{...}`, `body{font-family...}` | 엔진 CSS가 준다. 삭제 |
| `#viewport{...}`, `#stage{...}` | 삭제 |
| `.slide{position:absolute; padding:150px 170px; display:none; flex...; gap:56px}` | 삭제. 엔진 CSS가 `--sk-pad-y`, `--sk-pad-x`, `--sk-gap`으로 준다 |
| `.slide.on{display:flex}` | 삭제 |
| `.slide.on{animation:in .35s}` 및 `@keyframes in` | 삭제. 엔진이 준다 |
| `.slide.on svg.wf-bot{animation:wf-bob ...}` (99줄) | `[data-slide][data-active] svg.wf-bot` |
| `h1`(120px), `h2`(68px), `p`(36px), `.small`(28px) 크기 | `--sk-fs-*` 토큰이 같은 값을 준다. 덱 CSS의 중복 선언은 삭제 |
| 마지막 장이 `cover` 모양(gap 40px, h1 96px)을 쓰면 덱 CSS에서 `[data-slide="cover"],[data-slide="end"]`를 함께 선택한다 |
| `.cover{gap:40px}`, `.cover h1`, `.cover-head`, `.cover .sub`, `.meta*` | 선택자 `.cover`를 `[data-slide="cover"]`로 바꾸고 `.cover-head`, `.sub`, `.meta`는 그대로 |
| `.section h1{font-size:132px}`, `.section .icon-lg` | 선택자 `.section`을 `[data-slide="chapter"]`로 |
| `.tok-slide{align-items:center; padding-block:90px}` | 그대로 둔다(`class="tok-slide"` 유지) |
| `.td-c.on`, `.wf.on`, `.sk-case.on`, `.dp-c.on`, `.drop-s.on`, `.sk-list span.on` | 슬라이드 활성 표시가 아니라 덱 안 컴포넌트 상태다. 그대로 둔다 |

### 스크립트 (1145-1305줄)

| 현재 | 규격 |
|---|---|
| `fit()`, `resize`, `fullscreenchange`, `webkitfullscreenchange` 처리 | 삭제. 엔진이 한다 |
| `show()`, `go()`, 해시 읽기와 `history.replaceState` | 삭제. 엔진이 한다 (`#N` 동작은 동일) |
| `keydown`: 방향키 4개로 이동, `F` 전체화면, `INPUT` 대상 무시 | 삭제. 엔진이 같은 동작을 한다. `O`와 숫자 + `Enter`는 새로 생긴다 |
| `toggleFull()` | 삭제 |
| `slides[i].stepper` 계약 (`enter`, `next`, `prev`, 소비하면 `true`) | `SlideKit.stepper(el, {...})`로 등록. 같은 세 메서드에 `get`, `goto`를 추가한다 |
| 토큰 데모의 `set(s, anim)` | `goto(n)`은 `set(n, false)`, `get()`은 `step`을 반환한다. `enter`는 현재와 같다(`set(fwd?1:4,false)`) |
| 토큰 데모의 `stage.getBoundingClientRect().width/1920` (FLIP 배율) | `SlideKit.scale` |
| 토큰 데모 `tokenize`, `tokId`, `window.tokenize` | 덱 스크립트로 그대로 남긴다 |
| Claude Code 캐릭터 순찰: `setInterval`, `ft.closest('.slide').classList.contains('on')` | `ft.closest('[data-slide]').hasAttribute('data-active')`. 나머지는 그대로 |
| `fit(); show(hash)` 마지막 두 줄 | 삭제 |
| 덱 스크립트 위치 | `</body>` 앞, 엔진 `<script src>` 뒤 |

### 변환 뒤 확인 항목

- 슬라이드 수 53, `chapter` 7, `cover` 첫 장, `end` 마지막 장.
- 토큰 데모: 4단계 앞뒤 이동, 뒤에서 돌아올 때 4단계, 입력창에서 방향키가 이동하지 않음.
- Claude Code 캐릭터가 해당 슬라이드가 활성일 때만 움직임.
- `F` 전체화면, 방향키 4개, `#N` 직접 진입, 클릭과 스페이스로 이동하지 않음.
- 표지 Gemini 로고(SVG `mask`, `filter`의 `url(#ag9_*)`)가 전체 보기 축소판에서도 그려짐.

## 9. 편집

편집기(`/edit/<덱>`)가 지키는 약속이다. 엔진은 편집을 모른다. 편집기는 임베드 모드(6.6)로 덱을 같은 출처 iframe에 띄우고 그 DOM을 직접 만진다.

### 9.1 저장 형식

- 저장 결과는 1절 형식이다. 슬라이드는 `<body>` 직계 `<section data-slide>`이고, 엔진이 붙인 `#sk-stage`, `data-active`, 전체 보기 사본이 없다. 직렬화 때 빈 `style=""`를 지우고 `<aside data-notes="">`는 `data-notes`로 되돌린다.
- 살아 있는 DOM 전체를 직렬화하지 않는다. 원문을 `prefix`(첫 슬라이드 앞까지), 슬라이드 단위(앞 간격 + `<section>...</section>`), `suffix`(마지막 슬라이드 뒤부터)로 쪼개 두고, 저장할 때 다시 이어 붙인다.
  - 쪼갤 때 `<script>`, `<style>`, 주석, `textarea`, `title`, `xmp`, `noembed`, `noframes`, `plaintext`, `iframe` 안의 글자는 무시하고 `section` 여닫이 깊이를 센다. 쪼갠 뒤 이어 붙인 결과는 원문과 글자 단위로 같아야 한다(`app/test/roundtrip.ts`).
  - 편집하지 않은 슬라이드, `prefix`, `suffix`(덱 CSS, `deck-meta`, 스크립트)는 원문 그대로다. 들여쓰기와 줄바꿈이 보존된다.
  - 편집한 슬라이드만 `outerHTML`로 다시 쓴다. 이때 `data-active`, `contenteditable`, `inert`를 뺀다. 따옴표 모양과 속성 공백은 브라우저 직렬화를 따른다.
  - 순서를 바꿔도 각 슬라이드는 자기 앞 간격을 달고 이동한다. 맨 앞 슬라이드의 앞 간격은 `prefix`에 속하므로 쓰지 않고, 복제와 추가로 만든 슬라이드는 기준 슬라이드의 앞 간격을 이어받고, 간격 정보가 없으면 덱에서 처음 보이는 공백 간격을 쓴다.
- 덱 스크립트가 런타임에 바꾼 DOM(stepper가 붙인 클래스 등)은 편집한 슬라이드를 직렬화할 때 섞일 수 있다. 도식과 인터랙션이 든 슬라이드는 텍스트만 고치고, 구조는 파일에서 고친다.
- 저장은 `PUT /api/decks/<폴더>`(본문 `{source, base, force, slideMap}`)다. `slideMap`은 슬라이드를 옮기거나 지웠을 때 옛 번호에서 새 번호로의 대응이고 서버가 코멘트 번호를 갱신하는 데 쓴다(9.3). 본문에 `data-slidekit=`와 `<section data-slide>`가 없으면 400으로 거부하고, 읽기 전용 덱(테스트 서버의 `SLIDEKIT_READONLY_DECKS`)에는 403을 낸다. 서버는 임시 파일에 쓴 뒤 `rename`한다. `base`는 읽을 때 받은 파일 수정 시각이고, 그 뒤 파일이 바뀌었으면 `409`를 돌려준다. `force`가 참이면 덮어쓴다. 이력은 git이 맡으므로 백업 파일을 만들지 않는다. `GET /api/decks/<폴더>/source`는 `{source, mtime}`을 준다.

### 9.2 편집 범위

- 텍스트: 글자만 담은 요소(자식이 `b`, `i`, `span`, `code`, `br` 같은 인라인뿐)를 `contenteditable="plaintext-only"`로 고친다. `Enter`나 포커스 이동으로 끝낸다. `chapter` 슬라이드의 `h1`을 고치면 `data-title`도 같은 글자로 맞춘다(2절).
- 스타일: 선택한 요소의 인라인 `style`만 바꾼다. Inspector가 다루는 속성은 글자(`font-size`, `font-weight`, `font-family`, `line-height`, `letter-spacing`, `text-align`, `color`), 배경(`background-color`, `background-image` 그라디언트), 테두리(`border*`, `border-radius`), `opacity`, `rotate`, `position`, `z-index`, `display`와 flex, gap, 정렬(margin), `object-fit`, `filter`, `box-shadow`, `mix-blend-mode`, `overflow`다. 슬라이드의 배경색(인라인 `style`)과 `data-steps`, 요소의 `data-step`(2 이상)과 `data-step-effect`도 편집한다. 클래스와 덱 CSS는 건드리지 않는다.
- 슬라이드: 순서 변경, 복제, 삭제, 추가(본문 슬라이드), 종류(`data-slide`), 장 제목(`data-title`), 노트(`<aside data-notes>`)를 바꾼다. 노트는 캔버스 아래 pane에서 마크다운 원문으로 고치고 `textContent`로 써서 `<`, `&`가 이스케이프된다. 노트가 없던 슬라이드는 입력할 때 `aside`를 만들고, 비우면 `aside`를 지운다. 복제본은 루트 `id`와 `data-steps`를 잃는다(`id`가 겹치지 않게, stepper는 `id`로 붙으므로 복제본은 일반 슬라이드가 된다).
- 레이어: 편집기 좌측 Layers 탭에서 요소 이름을 바꾸면 `data-name` 속성에 저장한다(없으면 태그나 첫 줄 글자로 보인다). 엔진은 이 속성을 쓰지 않는다. 눈 아이콘은 `style="display: none"`을 넣고 빼므로 저장하면 발표에서도 숨겨진다.
- 위치와 크기: 캔버스에서 요소를 끌어 옮기면 인라인 `translate: Xpx Ypx`(CSS 개별 속성, 0이면 속성 삭제)가 바뀌고, 8방향 핸들로 크기를 바꾸면 인라인 `width`와 `height`(px)가 바뀐다. 흐름 레이아웃과 클래스는 건드리지 않으며, `translate`는 표준 속성이라 엔진 렌더, PDF, 번들 모두에서 같게 보인다(`data-step`의 `transform` 등장 효과와도 합쳐진다). 한 번 끌기는 실행 취소 한 건이다. Shift는 축 고정(이동)이나 비율 유지(모서리 핸들), Alt는 중심 기준(리사이즈), `Esc`는 취소이고, 다른 요소와 슬라이드 가장자리에 스냅 가이드가 나온다. 리사이즈는 고정할 변이 움직이지 않도록 `translate`도 함께 보정하고, `flex: 1 1`을 지우며 flex 부모 안에서는 `flex-shrink: 0`을 넣는다. 글자 블록은 높이를 바꾸지 않아 가로 변과 모서리 핸들만 나온다. 이동 수치가 `%`나 `calc`인 요소, 크기 0, `display: none`, 회전한 조상이 있는 요소와 `viewBox`가 없는 `svg`는 끌거나 크기를 바꾸지 않는다. 방향키는 1px, Shift+방향키는 10px씩 옮긴다(Inspector의 Offset X, Y도 같은 `translate`다). 잠긴 요소(`data-locked`, Layers의 잠금 토글)는 끌지 않고 캔버스에서 고르지도 않는다(9.5).
- 도식(`svg`)과 인터랙션 내부는 편집하지 않는다. 선택과 코멘트, 삭제와 복제는 된다.
- 편집기가 iframe 문서에 넣는 선택용 스타일은 `<head>`에만 들어가고 저장되지 않는다. 선택 표시와 호버 외곽선은 덱 DOM이 아니라 앱 쪽 레이어에 그린다.

### 9.3 코멘트 위치

- 요소는 `path`로 가리킨다. 슬라이드 `<section>` 아래 `tag:nth-of-type(n)`을 ` > `로 이은 값이고(`h1`, `div:nth-of-type(2) > p`), `slide`는 1부터 센 슬라이드 번호다. 편집기가 저장할 때 `slideMap`(9.1)을 보내면 서버가 이미 남긴 코멘트의 `slide`를 새 번호로 바꾸고, 지워진 슬라이드의 코멘트는 남겨 두되 `slideDeleted`를 참으로 표시한다.

### 9.4 덱 스타일 편집

- 대상은 덱 `<head>`의 `<style>` 안 최상위 `:root { }` 블록에 선언된 CSS 변수(`--sk-` 토큰과 덱 전용 변수)뿐이다. `@media` 안의 `:root`와 다른 규칙은 읽지도 고치지도 않는다.
- 원문 보존: 바뀌는 값 글자 외에 주석, 다른 규칙, 순서, 공백을 그대로 둔다. 같은 변수가 여러 번 선언되면 마지막 선언이 대상이다(CSS에서 이기는 쪽).
- 없는 변수는 마지막 `:root` 블록의 끝에 같은 들여쓰기로 한 줄 추가한다. `:root` 블록이 없으면 첫 `<style>` 끝에 `:root { }`를 새로 만들고, `<style>`이 없으면 `</head>` 앞에 만든다.
- 값에는 문자열과 괄호 밖의 `;`, `{`, `}`, `<`, `/*`를 쓸 수 없다(선언을 깨뜨리므로 거부한다).
- 저장은 슬라이드 편집과 같은 흐름이다. 편집기는 쪼갠 덱의 prefix(첫 슬라이드 앞까지)에 변경을 적용하고 전체를 PUT한다(`base` 충돌 검사 유지). 서버 API는 늘리지 않는다. 구현은 `app/src/lib/deck-tokens.ts`(`readTokens`, `setToken`).
- 편집 중 미리보기는 캔버스 문서의 `:root`에 인라인으로 바로 반영하고, 확정은 입력이 멈춘 뒤 한 번(undo 1건)이다.

### 9.5 요소 선택 규칙

Figma식 계층 선택이다. 구현은 `app/src/lib/selection.ts`(DOM 없이 시험하는 순수 함수)와 `Canvas.tsx`다.

- 선택 범위(scope)는 따로 저장하지 않는다. 선택된 요소가 있으면 그 부모가, 없으면 슬라이드 루트(`section[data-slide]`)가 범위다. 슬라이드 자체는 선택 대상이 아니다.
- 한 번 클릭: 범위의 직계 자식 중 클릭 지점을 포함하는 요소를 고른다. 처음에는 슬라이드의 직계 자식(최상위 요소)이다. 범위 밖을 누르면 범위가 위로 풀려 그 단계의 요소를 고른다. 요소 밖(슬라이드 배경)을 누르면 선택이 풀린다.
- 더블클릭: 선택한 요소에 선택할 자식이 있으면 클릭 지점을 포함하는 직계 자식으로 한 단계 내려간다(반복하면 한 단계씩 더 내려간다). 글자 블록이면 텍스트 편집에 들어간다.
- leaf(더 내려가지 않는 요소): `img`, `svg`(내부 도형은 선택하지 않는다), `video`, `canvas`, `input`, `select`, `textarea`, `iframe`, `object`, `picture`, 글자 블록(글이 있고 자식이 `span`, `strong`, `em`, `a`, `br`, `code`, `small` 같은 인라인 요소뿐인 요소), 자식이 없는 빈 요소. 노트(`aside[data-notes]`), `script`, `style`, `template`은 선택하지 않는다.
- 잠금: `data-locked` 요소와 그 안쪽은 캔버스 클릭으로 고르지 않고 Layers에서만 고른다. 조상이 잠긴 행은 Layers에 "Locked by parent"로 표시한다.
- Cmd(Ctrl)+클릭: 범위와 상관없이 클릭 지점의 가장 안쪽 leaf를 고른다.
- 키보드: `Enter`는 첫 자식을 고른다(글자 블록이면 편집 시작), `Shift+Enter`는 부모(슬라이드 루트 직전까지), `Tab`과 `Shift+Tab`은 같은 범위의 형제를 돈다, `Esc`는 편집 중이면 편집을 끝내고 아니면 선택을 푼다. 포커스가 입력창이나 버튼, 패널에 있으면 이 키를 가로채지 않는다.
- 편집기 단축키: `Cmd+S` 저장, `Cmd+K` 명령 팔레트, `Cmd+/` 도움말, `Cmd+Enter` 발표(`Shift+Cmd+Enter`는 현재 슬라이드부터), `Cmd+B`와 `Cmd+I` 선택 글자를 `strong`과 `em`으로 감싸기, `Cmd+C`와 `Cmd+V` 요소 복사와 붙여넣기(붙일 때 `id` 제거), `Cmd+D` 복제, `Cmd+[`와 `Cmd+]` 형제 순서, `F2` 이름 변경, `Cmd+Z`와 `Shift+Cmd+Z` 실행 취소와 다시 실행, `Delete`와 `Backspace` 삭제, `C` 코멘트, `Cmd+0`과 `Shift+1` 맞춤, `Cmd+=`와 `Cmd+-` 확대와 축소, `Cmd+\` 패널, `Shift+Cmd+\` 필름스트립, `Space`+끌기 팬, `Cmd`+휠 확대. 선택이 없을 때 방향키는 슬라이드를 옮긴다.
- 자동 저장은 입력이 1.5초 멈추면 일어난다. 서버가 보내는 `deck-changed`로 외부 변경을 알아채고, 충돌하면 Reload 또는 Overwrite를 고르게 한다. 실행 취소는 최대 200건이고 같은 키 입력은 0.8초 안에 한 건으로 묶는다.
- 호버 외곽선은 지금 클릭하면 선택될 요소를 보인다. Layers 행을 누르면 그 요소가 선택되고 범위는 그 부모가 된다.
