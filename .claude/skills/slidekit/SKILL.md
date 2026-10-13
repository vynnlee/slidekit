---
name: slidekit
description: slidekit 덱(HTML 슬라이드)을 새로 만들거나 고칠 때 쓴다. 규격, 토큰, stepper, 노트, 문구 규칙, 확인 방법을 담고 있다.
---

# slidekit 덱 작성 지침

덱은 폴더 하나이고 원본은 `decks/<이름>/index.html` 한 파일이다. 유일한 규격은 `spec/SPEC.md`다. 이 문서는 그 요약이고, 둘이 다르면 SPEC이 맞다. 엔진(`engine/slidekit.js`, `engine/slidekit.css`)이 이동, 화면 맞춤, 전체화면, 전체 보기, 동기화를 모두 맡는다. 덱은 내용과 모양만 쓴다.

## 1. 새 덱 시작

1. 이름을 정한다. 영문 소문자, 숫자, `-`만 쓴다(예: `design-review`).
2. 저장소 루트에서 `bun app/server.ts new <이름>`을 실행한다. `engine/template/index.html`을 복사해 `decks/<이름>/index.html`을 만든다. 제목, 날짜, id가 채워진다.
3. 만들어진 `decks/<이름>/index.html`을 고친다. 템플릿의 예시 슬라이드는 지우거나 바꾼다.
4. `#deck-meta`의 `title`을 실제 제목으로, `author`를 채우고 `<title>`도 같은 제목으로 맞춘다.

이미 있는 덱을 고칠 때는 먼저 그 파일을 읽고 기존 클래스 이름, 덱 토큰, 문체를 따른다. 다른 덱의 CSS를 통째로 가져오지 않는다.

## 2. 파일 구조

```html
<!doctype html>
<html lang="ko" data-slidekit="1">
<head>
  <meta charset="utf-8">
  <title>덱 제목</title>
  <script type="application/json" id="deck-meta">
    { "title": "덱 제목", "author": "이성빈", "date": "2026-10-13", "visibility": "public", "id": "deck-id" }
  </script>
  <link rel="stylesheet" href="../../engine/slidekit.css">
  <style> /* 덱 토큰과 덱 전용 스타일 */ </style>
</head>
<body>
  <section data-slide="cover"> ... </section>
  <section data-slide="chapter" data-title="장 제목"> <h1>장 제목</h1> </section>
  <section data-slide="content"> ... </section>
  <section data-slide="end"> ... </section>
  <script src="../../engine/slidekit.js"></script>
  <script> /* 덱 전용 스크립트 (stepper 등). 엔진 뒤에 둔다 */ </script>
</body>
</html>
```

- `<html lang="ko" data-slidekit="1">`을 유지한다. 값이 다르면 엔진이 경고한다.
- 슬라이드는 `<body>`의 직계 자식 `<section data-slide>`이다. 문서 순서가 슬라이드 순서다.
- 엔진 `<script src>`는 덱 스크립트보다 앞에 둔다.
- `#deck-meta` 필드: `title`(필수), `subtitle`, `author`, `date`(YYYY-MM-DD), `lang`, `visibility`(`public` 또는 `password`), `pageNumber`, `progress`, `id`. 비밀번호는 덱에 넣지 않는다. `pageNumber`와 `progress`는 기본 꺼짐이고 켜지 않는다.

### 슬라이드 종류

| `data-slide` | 의미 | 규칙 |
|---|---|---|
| `cover` | 표지 | 있다면 첫 슬라이드, 최대 1개 |
| `chapter` | 장 표지 | `data-title` 필수. 목차의 단위 |
| `content` | 본문 | 개수 제한 없음 |
| `end` | 마지막 | 있다면 마지막 슬라이드, 최대 1개 |

- 위 네 값 외의 값은 `content`로 처리되고 경고가 난다. 새 값을 만들지 않는다.
- `data-title`: `chapter`는 필수다. 화면에 그려지지 않으므로 같은 글자를 `<h1>`에도 적고, 둘을 항상 같게 유지한다. 다른 종류에서는 선택이고, 있으면 전체 보기에 표시된다.
- `data-steps="N"`: 슬라이드 안에서 N단계로 나뉠 때(N은 2 이상). 반드시 stepper 구현을 함께 등록한다(4절).
- `id`: stepper를 붙이는 슬라이드나 덱 스크립트가 찾는 슬라이드에만 단다. 덱 안에서 겹치지 않게 한다.
- 장 번호: `chapter`를 위에서부터 1, 2, 3으로 센다. 첫 `chapter` 앞 슬라이드는 0이다. 사용자는 숫자 + Enter로 장 번호에 해당하는 장으로 이동한다. 목차 슬라이드는 만들지 않는다(엔진이 `data-title`로 목차를 만든다).
- 슬라이드 번호는 1부터 센다. URL 해시 `#N`도 1부터다.
- 기본 구성은 cover 하나, chapter 여러 개와 각 장의 content, end 하나다.

## 3. 디자인 토큰과 덱 CSS

### 화면

- 무대는 1920x1080 px 고정이다. 모든 크기를 px로 설계한다. `vw`, `vh`, `100vh`, `%`로 슬라이드 크기를 정하는 일은 하지 않는다. 창에 맞춘 확대와 축소는 엔진이 한다.
- 슬라이드 기본 배치는 엔진 CSS가 준다. 무대 전체를 덮고, 세로 flex, 세로 가운데 정렬, 안쪽 여백과 간격은 토큰을 따른다. 덱 CSS에서 `position`, `padding`, `display`를 슬라이드에 다시 선언하지 않는다. 필요하면 토큰을 덮어쓰거나 특정 슬라이드에만 `padding-block`, `align-items` 정도를 바꾼다.
- 무대 밖으로 넘친 내용은 잘린다. 글이 넘치면 줄이거나 나눈다.
- 활성 슬라이드는 `[data-slide][data-active]`로 선택한다. `.on`, `.active` 같은 슬라이드 상태 클래스를 직접 만들지 않는다.
- 0.35초 페이드는 엔진이 준다. 직접 슬라이드 진입 애니메이션을 쓰지 않는다.

### 토큰

`:root`의 `--sk-` 변수다. 엔진 CSS가 기본값을 주고 덱 `<style>`이 덮어쓴다.

| 변수 | 기본값 | 용도 |
|---|---|---|
| `--sk-bg` | `#000` | 배경 |
| `--sk-fg` | `#fff` | 본문 글자 |
| `--sk-muted` | `#9a9a9f` | 보조 글자 |
| `--sk-faint` | `#5c5c62` | 약한 글자 |
| `--sk-line` | `#2b2b30` | 구분선 |
| `--sk-panel` | `#0f0f12` | 카드 배경 |
| `--sk-accent` | `#a78bfa` | 강조색 |
| `--sk-font` | Noto Sans KR 계열 | 본문 글꼴 |
| `--sk-font-mono` | JetBrains Mono 계열 | 고정폭 글꼴 |
| `--sk-pad-y`, `--sk-pad-x` | `150px`, `170px` | 슬라이드 여백 |
| `--sk-gap` | `56px` | 요소 간격 |
| `--sk-fs-h1`, `--sk-fs-h2` | `120px`, `68px` | `h1`, `h2` 크기 |
| `--sk-fs-body`, `--sk-fs-small` | `36px`, `28px` | 본문 `p`, `.small` |

사용 규칙:

- 색과 글꼴은 하드코딩하지 말고 `var(--sk-*)`를 쓴다. 필요한 색이 없으면 덱 `<style>`에서 토큰을 덮어쓴다(`:root { --sk-accent: #...; }`).
- 덱 전용 변수는 `--sk-` 접두사를 쓰지 않는다(예: `--r-user`, `--t1`).
- `h1`, `h2`, `p`, `.small`의 크기, 굵기, 색은 엔진 CSS가 이미 준다. 같은 값을 다시 선언하지 않는다.
- 종류별 모양은 덱 CSS가 정한다.

```css
[data-slide="cover"] h1 { font-size: 96px; }
[data-slide="chapter"] h1 { font-size: 132px; }
[data-slide][data-active] .bot { animation: bob 2s infinite; }
```

- 마지막 장이 표지와 같은 모양이면 `[data-slide="cover"], [data-slide="end"]`를 함께 선택한다.
- 글꼴은 `<head>`의 Google Fonts `<link>`로 불러도 된다.
- 엔진이 붙이는 요소(페이지 번호, 진행률, 전체 보기)는 `--sk-fg`, `--sk-faint`, `--sk-bg`, `--sk-line`만 쓴다. 이 네 토큰을 바꾸면 엔진 요소도 같이 바뀐다는 점을 안다.

## 4. stepper (슬라이드 안 단계)

한 슬라이드 안에서 방향키로 여러 단계를 넘기고 싶을 때 쓴다. 두 가지를 모두 해야 한다.

1. 슬라이드에 `data-steps="N"`(N은 2 이상)과 `id`를 단다.
2. 덱 스크립트에서 `SlideKit.stepper(요소, {...})`로 구현을 등록한다.

```js
SlideKit.stepper(document.getElementById('tok-slide'), {
  enter(forward) {},   // 슬라이드에 들어올 때. forward면 1단계, 뒤로 돌아오면 N단계. 애니메이션 없이
  next() {},           // 한 단계 앞으로. 움직였으면 true, 마지막이라 못 움직였으면 false
  prev() {},           // 한 단계 뒤로. 같은 규칙
  get() {},            // 현재 단계(1..N)
  goto(n) {},          // n단계로 즉시 이동. 애니메이션 없이
})
```

규칙:

- 다섯 메서드가 모두 있어야 한다. 하나라도 빠지면 엔진이 등록을 거부하고 그 슬라이드는 일반 슬라이드가 된다.
- 엔진은 이동 입력마다 `next()` 또는 `prev()`를 먼저 부른다. `true`면 슬라이드는 그대로이고, `false`면 다음 또는 이전 슬라이드로 넘어간다.
- `enter(true)`는 1단계로, `enter(false)`는 마지막 N단계로 애니메이션 없이 맞춘다.
- `goto(n)`은 동기화와 앱 명령이 쓴다. 애니메이션 없이 상태만 맞춘다.
- 단계 상태는 한 곳(`step` 변수)에 두고, 화면은 `set(step, anim)` 같은 함수 하나가 그린다. `next`만 `anim=true`로 부르고 `prev`, `enter`, `goto`는 `false`로 부른다.
- `data-steps`의 N과 구현의 마지막 단계 수를 같게 한다.
- 애니메이션은 `prefers-reduced-motion`을 확인해 끈다(`matchMedia('(prefers-reduced-motion: reduce)')`).
- 화면 크기를 읽어 계산해야 하면(FLIP 등) `getBoundingClientRect()` 값을 `SlideKit.scale`로 나눈다. 무대가 줄어든 배율이 들어 있기 때문이다.
- `setInterval`이나 타이머로 도는 장식은 `slide.hasAttribute('data-active')`일 때만 움직인다. 슬라이드 진입과 이탈은 요소의 `sk:enter`, `sk:leave` 이벤트(버블링)로도 알 수 있다.
- 전체 보기의 축소판은 `inert` 사본이고 stepper는 동작하지 않는다(1단계 모습). 1단계가 정적으로도 의미 있게 보이게 만든다.

워크숍 덱(`decks/vibe-coding-workshop/index.html`)의 토큰 데모가 기준 패턴이다. 큰 틀은 다음과 같다.

```js
(function () {
  var slide = document.getElementById('tok-slide');
  var step = 1;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  function set(s, anim) {
    var from = step; step = s; anim = anim && !reduce.matches;
    box.classList.toggle('split', s >= 2);   // 단계별 상태는 클래스로
    box.classList.toggle('ids', s >= 3);
    box.classList.toggle('out', s >= 4);
    // anim && from === (s - 1)일 때만 애니메이션을 넣는다
  }
  SlideKit.stepper(slide, {
    enter: function (fwd) { set(fwd ? 1 : 4, false); },
    next: function () { if (step < 4) { set(step + 1, true); return true; } return false; },
    prev: function () { if (step > 1) { set(step - 1, false); return true; } return false; },
    get: function () { return step; },
    goto: function (n) { set(n, false); }
  });
  set(1, false);
})();
```

단계 변화는 CSS 클래스 토글로 만들고, 필요한 곳에만 Web Animations API(`el.animate`)를 쓴다.

## 5. 노트

- 슬라이드의 자식으로 `<aside data-notes>`를 하나만 둔다. 화면에는 항상 숨겨지고 발표자 화면에서만 보인다.
- 마크다운(CommonMark)으로 쓴다. 문단은 빈 줄로 나누고, 목록과 굵게는 필요할 때만 쓴다. 엔진은 렌더하지 않고 원문을 앱에 넘기며, 렌더는 앱이 한다. 원시 HTML은 이스케이프되어 그대로 보인다.
- 글자에 `<`, `&`가 필요하면 `&lt;`, `&amp;`로 적는다.
- 노트에도 7절 문구 규칙이 그대로 적용된다.
- 앞뒤 공백은 제거된다. 들여쓰기로 줄을 맞추지 않는다. 본문에서 읽을 말, 시간 배분, 질문 예상처럼 발표자만 필요한 내용을 쓴다.

```html
<aside data-notes>첫 문단. 이 장에서 전달할 핵심을 쓴다.

두 번째 문단. 예상 질문과 답을 쓴다.</aside>
```

## 6. 슬라이드 작성 요령

- 슬라이드 하나에 메시지 하나. `h2`에 핵심 문장 하나, `p`에 한두 줄 설명을 쓴다.
- 글이 많아지면 슬라이드를 나눈다. 작은 글자(`.small`)는 보조 정보에만 쓴다.
- 구조는 단순하게 쓴다. `h1`, `h2`, `p`, 간단한 `div` 정도로 충분하다. 도식은 인라인 `svg`로 그린다.
- 이미지는 덱 폴더 안에 두고 상대 경로로 부른다(`<img src="img/a.png">`). 사용자가 준 이미지는 원본 그대로 쓰고 흑백 처리 등 변형을 하지 않는다.
- 로고는 브랜드 색을 쓴다(Claude #D97757, Gemini 그라디언트 등).
- 숫자를 항상 고정폭 글꼴로 쓰지는 않는다. 목차 같은 곳은 본문 글꼴을 쓴다.
- 편집기는 글자만 담은 요소를 고친다. 도식과 인터랙션이 든 슬라이드는 텍스트만 편집기로 고치고, 구조는 파일에서 고친다.

## 7. 문구와 디자인 규칙

덱 본문, 노트, 코드 주석 안의 화면 문구에 적용한다.

- 금지: em-dash, en-dash, 가운뎃점, 이모지, 구어체. 비유와 은유도 금지한다. 사용자가 직접 요청한 경우만 예외다.
- 문장은 평서형 문어체로 쓴다(`~한다`, `~이다`, 명사형 종결). 감탄, 말 걸기, 물음표 남발을 하지 않는다.
- 나열이나 범위는 쉼표, 슬래시, "에서 까지", `~`가 아닌 단어로 쓴다. 가운뎃점 자리에는 쉼표를 쓴다.
- 배경은 검은색, 글자는 흰색이 기본이다. 보조 글자는 `--sk-muted`, `--sk-faint`로 낮춘다.
- 미니멀하게 간다. 장식, 그림자, 그라디언트 배경, 아이콘 남발을 하지 않는다. 강조색은 `--sk-accent` 하나를 아껴 쓴다.
- 페이지 번호와 진행률은 켜지 않는다(`pageNumber`, `progress` 기본 꺼짐 유지).

## 8. 금지 사항

- 방향키 외 이동 수단을 추가하지 않는다. 클릭, 스페이스, `Enter`, `PageUp`, `PageDown`, 휠, 터치 스와이프, 화면의 이전과 다음 버튼 모두 금지다. 전체화면 버튼도 화면에 두지 않는다(`F` 키만).
- 덱 스크립트에서 `keydown`, `click`, `touch`, `wheel`로 슬라이드를 움직이는 코드를 쓰지 않는다. 이동은 엔진과 stepper로만 한다.
- `viewport`, `stage` 같은 래퍼 `div`를 만들지 않는다. 엔진이 `#sk-stage`를 만들어 슬라이드를 옮겨 담는다.
- 슬라이드를 `display:none`으로 숨기지 않는다. 비활성 슬라이드는 엔진이 `visibility:hidden`으로 두며, `url(#id)` 참조와 크기 측정이 이 상태에서도 동작해야 한다. SVG `mask`, `filter`의 `url(#...)`가 깨진다.
- 슬라이드 크기에 `vw`, `vh`를 쓰지 않는다.
- 외부 파일에 의존하지 않는다. 번들러가 인라인하는 것은 상대 경로 이미지와 Google Fonts `<link>`뿐이다. 외부 CDN 스크립트, 외부 CSS, 외부 이미지 URL, `fetch`로 불러오는 데이터는 쓰지 않는다. 엔진 `<link>`와 `<script src>`의 상대 경로(`../../engine/...`)는 예외이고 번들러가 처리한다.
- 슬라이드를 다섯 번째 종류로 만들지 않는다. `data-slide` 값은 `cover`, `chapter`, `content`, `end`만 쓴다.
- 엔진 파일(`engine/slidekit.js`, `engine/slidekit.css`)과 `spec/SPEC.md`를 덱 작업 중에 고치지 않는다.
- 비밀 값(비밀번호, 토큰)을 덱에 넣지 않는다.

## 8-1. 본문 구성 요소

엔진 CSS는 `h1`, `h2`, `p`, `.small`만 크기를 정한다. `h3`, 카드, 격자, 큰 숫자는 덱 `<style>`에서 만들고 크기는 px로, 색은 토큰으로 정한다. 카드는 `--sk-panel` 배경과 `--sk-line` 테두리만 쓴다. 수치와 예시 문구는 사용자가 준 값만 쓰고, 지어낸 값이면 슬라이드 안에 예시라고 밝힌다.

## 9. 만든 뒤 확인

0. 먼저 `bun app/server.ts lint <이름>`을 실행한다. SPEC 위반(메타, 슬라이드 종류, 장 제목, stepper, 금지 문자, vw/vh, 래퍼, 이동 핸들러, 외부 리소스)을 한 줄씩 알려 준다. error가 0이어야 한다. warn은 이유를 확인한다.
1. 구조 점검은 파일을 읽어서 한다(lint가 잡지 못하는 항목 위주).
   - `data-slide` 값이 네 종류뿐인지, `cover`와 `end`가 각각 최대 1개이고 첫 장과 마지막 장인지.
   - 모든 `chapter`에 `data-title`이 있고 `<h1>` 글자와 같은지.
   - `data-steps`가 있는 슬라이드마다 `SlideKit.stepper` 등록이 있고 다섯 메서드가 모두 있는지.
   - 엔진 `<script>`가 덱 스크립트보다 앞인지.
   - `rg` 등으로 금지 문자(em-dash, en-dash, 가운뎃점, 이모지)가 없는지 확인한다.
2. 앱 미리보기: `bun app/server.ts`를 실행하면 127.0.0.1:3200에서 열린다. 덱 목록에서 덱을 열어 방향키, `F`, `O`, 숫자 + `Enter`, `#N`을 확인한다. 이 기계는 열에 약하니 서버는 확인이 끝나면 끈다. 브라우저 자동화 테스트는 여기서 돌리지 않는다.
3. 번들: `bun app/server.ts bundle <이름>`을 실행하면 `dist/<이름>.html`이 생긴다. 엔진 CSS, JS, 상대 경로 이미지, Google Fonts가 인라인된 단독 파일이다.
4. 단독 파일 확인: `dist/<이름>.html`을 다른 곳에 복사해서 열어도 슬라이드, 이동, 글꼴, 이미지가 그대로여야 한다. 상대 경로 `../../engine`이 남아 있으면 번들 실패다.
5. 사용자에게 보고할 때는 만든 슬라이드 수와 장 구성, 확인한 항목, 확인하지 못한 항목을 짧게 쓴다.

## 10. 자주 하는 실수

- `chapter`의 `data-title`을 빠뜨리거나 `<h1>`과 다르게 쓴다.
- `data-steps`만 달고 stepper를 등록하지 않는다. 반대로 stepper만 등록하고 `data-steps`와 `id`가 없다.
- stepper의 메서드가 4개뿐이다(`get` 또는 `goto` 누락). 등록이 거부된다.
- `next()`가 마지막 단계에서도 `true`를 돌려줘서 다음 슬라이드로 못 넘어간다. 마지막이면 `false`다.
- `enter(false)`에서 1단계로 맞춘다. 뒤로 돌아오면 마지막 단계여야 한다.
- 슬라이드 활성 상태를 `.on` 클래스와 `display:none/flex`로 직접 관리한다. `[data-slide][data-active]`를 쓴다.
- `vw`, `vh`, `100vh`로 크기를 정한다. 전부 px다.
- 슬라이드를 `viewport`나 `stage` `div`로 감싼다.
- 슬라이드에 `position:absolute`, `padding`을 다시 선언해 엔진 배치가 어긋난다.
- `h1`, `h2`, `p` 크기를 같은 값으로 다시 선언한다. 토큰만 바꾼다.
- 색을 `#fff`, `#000`으로 하드코딩한다. 토큰을 쓴다.
- 덱 전용 변수 이름에 `--sk-`를 붙인다.
- 엔진 `<script>`를 덱 스크립트 뒤에 둔다. `SlideKit`이 정의되지 않아 오류가 난다.
- 슬라이드 클릭, 스페이스, 스와이프, 화면 버튼으로 이동하게 만든다.
- 외부 CDN, 외부 이미지 URL, 절대 경로 이미지를 쓴다. 번들이 인라인하지 못한다.
- 같은 `id`를 여러 슬라이드나 요소에 쓴다. 전체 보기 사본이 `id`를 유지하므로 `getElementById`는 원본을 찾는다는 점을 전제로 쓰고, SVG `url(#id)`도 한 덱 안에서 유일하게 한다.
- 타이머 애니메이션이 비활성 슬라이드에서도 계속 돈다. `data-active`를 확인한다.
- 노트에 원시 HTML을 쓴다. 마크다운만 쓴다.
- 문구에 em-dash, en-dash, 가운뎃점, 이모지, 구어체, 비유를 쓴다. 노트와 `data-title`도 포함이다.
- `cover`나 `end`를 둘 이상 만들거나 중간에 둔다.
- 인라인 편집기가 고치기 어려운 구조를 만든다. 글자만 담은 요소는 `b`, `i`, `span`, `code`, `br` 인라인만 자식으로 둔다.
- 확인 없이 완료로 보고한다. 번들과 단독 파일 열림까지 보고 나서 끝낸다.
