> 초기 기획서(역사 문서). 현재 상태는 spec/SPEC.md와 HANDOFF.md를 본다.

# slidekit 기획서

내부용 HTML 슬라이드 도구. 슬라이드 규격, 발표, 편집, 번들링, 배포를 한 저장소에서 다룬다.

## 목표

- HTML 슬라이드를 위한 자체 규격을 정하고, 모든 강의 덱을 이 규격으로 만든다.
- Keynote처럼 발표한다. 맥 내장 화면에는 발표자 화면, 외장 모니터에는 발표 화면만 띄운다.
- 텍스트, 간단한 스타일, 슬라이드 순서를 마우스와 키보드로 직접 고친다.
- 요소에 코멘트를 남기면 열려 있는 Claude Code 세션이 받아서 고치고 답한다.
- 덱을 완전한 HTML 파일 하나로 묶어 `static.vynnlee.com/<덱이름>`에 올린다.

## 확정된 결정

| 항목 | 결정 |
|---|---|
| 이름 | `slidekit` (폴더, 저장소, 배포 이름 모두 동일) |
| 앱 형태 | 로컬 웹앱. 명령 하나로 띄우고 Chrome 계열 브라우저로 쓴다. |
| 규격 원본 | HTML + 약속된 태그와 속성 |
| 규격 범위 | 구조(슬라이드 종류, 장 구분), 발표자 노트, 디자인 토큰, 메타정보 |
| 직접 편집 범위 | 텍스트, 간단한 스타일, 슬라이드 단위(순서, 복제, 삭제, 추가) |
| AI 연결 | 요소 코멘트를 Claude Code Channels로 열린 세션에 전달하고, 파일에도 저장한다. |
| 발표 브라우저 | Chrome 계열. 외장 모니터 자동 배치 사용. |
| 발표자 화면 | 현재와 다음 슬라이드, 노트, 타이머와 시계, 현재 장과 목차 위치. 항목마다 켜고 끌 수 있다. |
| 내보내기 | 글꼴과 이미지까지 넣은 완전한 HTML 파일 하나 |
| 배포 | `static.vynnlee.com/<덱이름>`, 덱마다 공개 범위 선택(공개, 비밀번호) |
| 덱 보관 | `slidekit/decks/<덱이름>/` |
| 첫 예제 | 디자이너를 위한 바이브 코딩 워크숍 덱 |
| 첫 버전 | 규격 + 발표 |
| 런타임 | Bun (서버, 코멘트 채널, 번들러, `slidekit` 명령) |
| 앱 화면 | React + Tailwind v4 + shadcn/ui + Fluid Functionalism 컴포넌트 |
| 덱 엔진 | 순수 HTML/CSS/JS. 덱은 파일 하나로 어디서나 열려야 하므로 React를 넣지 않는다. |
| 도메인 | vynnlee.com은 Cloudflare에서 관리 중 |
| 저장소 | github.com/vynnlee/slidekit (비공개) |

## 구성 요소

```
slidekit/
├── spec/        규격 문서 (SPEC.md)
├── engine/      덱 안에서 도는 런타임 (화면 맞춤, 이동, 목차, 번호, 발표 동기화)
├── app/         로컬 웹앱 (덱 목록, 발표자 화면, 편집기, 코멘트). 덱은 iframe 안에 띄운다.
├── channel/     코멘트를 Claude Code 세션으로 보내는 MCP 서버 (Claude Code가 자식 프로세스로 띄움)
├── bundler/     덱을 HTML 파일 하나로 묶는 명령
├── deploy/      static.vynnlee.com 배포 (Cloudflare)
└── decks/       강의 덱 모음
    └── vibe-coding-workshop/
```

## 규격 초안

덱 하나는 폴더 하나이고, 원본은 `index.html`이다.

```html
<html data-slidekit="1">
<head>
  <script type="application/json" id="deck-meta">
    { "title": "디자이너를 위한 바이브 코딩 워크숍",
      "author": "이성빈", "date": "2026-10-12",
      "visibility": "public" }
  </script>
  <style>
    :root { --sk-bg: #000; --sk-fg: #fff; --sk-accent: #a78bfa; --sk-font: "Noto Sans KR"; }
  </style>
</head>
<body>
  <section data-slide="cover"> ... </section>
  <section data-slide="chapter" data-title="바이브 코딩"> ... </section>
  <section data-slide="content">
    ...
    <aside data-notes>발표자만 보는 노트</aside>
  </section>
  <section data-slide="end"> ... </section>
  <script src="../../engine/slidekit.js"></script>
</body>
</html>
```

- 슬라이드 종류: `cover`, `chapter`, `content`, `end`
- 목차는 `chapter` 슬라이드의 `data-title`로 엔진이 자동으로 만든다.
- 페이지 번호와 진행률은 엔진이 붙이고, 덱마다 켜고 끈다.
- 노트(`data-notes`)는 발표 화면에 보이지 않고 발표자 화면에만 나온다.
- 디자인 토큰은 `--sk-` 접두사의 CSS 변수로 둔다.
- 슬라이드 안의 내용(도식, 인터랙션)은 자유 HTML이다. AI가 마음대로 그릴 수 있게 둔다.
- 화면은 1920×1080 고정이고, 창 크기에 맞춰 줄이고 늘린다.

## 발표 시스템

- 앱에서 "발표 시작"을 누르면 발표 화면을 외장 모니터에 전체화면으로 띄운다(Chrome의 Window Management API).
- 맥 내장 화면에는 발표자 화면을 띄운다. 두 화면은 같은 덱을 보며 BroadcastChannel로 동기화한다.
- 발표자 화면 구성: 현재 슬라이드, 다음 슬라이드, 노트, 경과 시간과 현재 시각, 현재 장과 목차 위치. 항목별 토글.
- 단축키: 방향키(이동), F(전체화면), O(전체 보기), 숫자 + Enter(해당 장으로 이동)

## 코멘트 흐름 (2단계 이후)

앱 서버와 채널 서버는 따로 돈다. 앱 서버는 발표할 때도 항상 떠 있고, 채널 서버는 Claude Code 세션이 켜져 있을 때만 떠서 앱 서버에 연결한다.

1. 앱에서 요소를 클릭하고 코멘트를 쓰면 로컬 서버(127.0.0.1)로 보낸다. 덱, 슬라이드 번호, 요소 경로, 요소 텍스트 일부를 함께 담는다.
2. 서버는 코멘트를 `decks/<덱>/comments.json`에 저장한다.
3. channel MCP 서버가 열려 있는 Claude Code 세션으로 코멘트를 보낸다.
4. Claude가 `index.html`을 고치고 `reply` 도구로 답한다.
5. 앱은 답을 코멘트 옆에 띄우고, 파일 변경을 감지해 화면을 새로고침한다.
6. 전달이 실패해도 `get_pending` 도구로 쌓인 코멘트를 가져가 처리할 수 있다.

제약: Channels는 연구 프리뷰다. 직접 만든 채널은 Claude Code를 `--dangerously-load-development-channels`로 시작해야 하고, 사양이 바뀔 수 있다.

## 번들링과 배포 (3단계)

- `slidekit bundle <덱>`: 엔진과 이미지를 HTML 안에 넣고, 덱에 쓰인 글자만 골라 글꼴을 넣는다. 결과는 `dist/<덱>.html` 하나.
- `slidekit deploy <덱>`: Cloudflare에 올려 `static.vynnlee.com/<덱>`으로 연다. 비밀번호 덱은 Cloudflare Worker가 비밀번호를 확인한 뒤 보여 준다.

## 단계별 계획

1. **규격 + 발표 (첫 버전)**
   - SPEC.md 작성
   - engine 작성
   - 워크숍 덱을 규격으로 변환
   - 앱에 덱 목록과 발표자 화면, 외장 모니터 발표
2. **편집기 + 코멘트**
   - 텍스트와 스타일 직접 편집, 슬라이드 순서와 복제와 삭제, 저장
   - channel MCP 서버와 코멘트 흐름
3. **번들링 + 배포**
   - 파일 하나로 묶기, 글꼴 서브셋
   - static.vynnlee.com 배포와 덱별 비밀번호

## 아직 정하지 않은 것

- 앱 실행 방식 (예: `slidekit` 명령으로 서버를 띄우고 브라우저를 여는 방식)
- 덱 비밀번호를 어디에 보관할지 (덱 파일에는 넣지 않는다)
