# 핸드오프: mac-local → mac-cloud (2026-10-13)

이 문서는 mac-local에서 진행한 Claude Code 세션의 맥락을 이어받기 위한 것이다. 새 세션은 이 문서와 PLAN.md를 먼저 읽는다.

## 지금까지 한 일

1. **디자이너 대상 바이브 코딩 워크숍 슬라이드 제작** (2026-10-12 수업용)
   - 결과물: `decks/vibe-coding-workshop/index.html` (53장, HTML 파일 하나)
   - 게시본: https://claude.ai/artifact/LyTh1UhvJJz5QsmvRp361p (Claude 아티팩트, 비공개)
   - `history/`에는 수정 단계별 백업(v4~v49)과 Karpathy 사진 원본이 있다.
2. **HTML 슬라이드 동향 리서치** (요약은 아래)
3. **slidekit 기획 인터뷰** → PLAN.md 작성, 기술 구성 확정, GitHub 비공개 저장소 생성

## 다음 할 일: 1단계 (규격 + 발표)

PLAN.md "단계별 계획" 1단계를 순서대로 진행한다.

1. `spec/SPEC.md` 작성: 슬라이드 종류(`data-slide`: cover, chapter, content, end), 장 제목(`data-title`), 노트(`data-notes`), 디자인 토큰(`--sk-` 변수), 메타정보(`#deck-meta` JSON)
2. `engine/slidekit.js`, `engine/slidekit.css`: 1920×1080 화면 맞춤, 방향키 이동, F 전체화면, O 전체 보기, 장 목록과 페이지 번호 자동 생성, URL 해시(`#N`), BroadcastChannel 발표 동기화, 슬라이드별 stepper API(토큰 데모처럼 슬라이드 안에서 단계를 넘기는 장)
3. 워크숍 덱을 규격으로 변환: 덱 안에 직접 넣은 이동 스크립트를 엔진으로 교체한다. 토큰 데모(stepper), Claude Code 캐릭터 애니메이션, F 전체화면이 그대로 동작하는지 Playwright로 확인한다.
4. 앱(Bun + React + Tailwind v4 + shadcn/ui + Fluid Functionalism): 덱 목록, 발표자 화면, "발표 시작" 시 Window Management API로 외장 모니터에 발표 화면 전체화면.

진행 방식: 사용자는 오케스트레이터 방식을 선호한다. 큰 작업은 워커에게 맡기고 결과를 직접 검증한다. 선택지가 있는 결정은 AskUserQuestion으로 묻는다.

## 사용자가 정한 것 (PLAN.md에 없는 세부)

- 발표자 화면 항목(현재와 다음 슬라이드, 노트, 타이머와 시계, 장 위치)은 **각각 토글로 켜고 끌 수 있어야** 한다.
- 슬라이드 이동은 **방향키만** 쓴다. 클릭, 스페이스, 스와이프로 넘어가면 안 된다. F는 전체화면 토글이고, 화면에 버튼은 보이지 않아야 한다.
- 배포 하위 주소는 `static.vynnlee.com`이다. 파일 보관용 관례를 따라 정했다.
- 덱별 공개 범위는 공개와 비밀번호 중에서 고른다. 비밀번호는 덱 파일에 넣지 않는다.
- 코멘트는 Claude Code Channels(연구 프리뷰)로 보내고, `comments.json`에도 저장해 둔다. 직접 만든 채널은 `claude --dangerously-load-development-channels server:<이름>`로 띄워야 한다. 공식 예제는 Bun으로 작성되어 있다(https://code.claude.com/docs/en/channels-reference).
- 앱 UI의 기본 컴포넌트는 Fluid Functionalism이다(shadcn 레지스트리 방식, React와 Tailwind v4가 필요하다). https://www.fluidfunctionalism.com/docs

## 슬라이드 문구와 디자인 규칙 (워크숍 덱에서 확정됨)

- em-dash(—), en-dash(–), 가운뎃점(·), 이모지, 구어체는 금지한다. 비유와 은유도 금지하는데, 사용자가 직접 요청한 경우는 예외다(예: "스킬은 업무 지침서").
- 배경은 검은색, 글자는 흰색을 쓴다. 페이지 번호나 꾸밈 요소 없이 미니멀하게 간다.
- 로고는 브랜드 색을 쓴다(Claude #D97757, Gemini 그라디언트 등).
- 사용자가 준 이미지는 원본 그대로 쓴다. 흑백 처리 같은 변형은 하지 않는다.
- 숫자에 고정폭(mono) 글꼴을 쓰지 않는 곳이 있다(목차 등).

## 리서치 요약 (HTML 슬라이드 동향, 2026-10)

- **제작:** Claude Code 스킬로 HTML 파일 하나를 만드는 방식이 주류다. 대표 스킬은 frontend-slides(약 3만★), guizang-ppt-skill, html-ppt-skill이다. 이 밖에 reveal.js, Slidev, Marp 같은 프레임워크에 AI를 붙이는 방식이 있고, Claude Design은 PPTX, PDF, HTML로 내보낸다.
- **관례:** 1920×1080 고정 화면을 창에 맞춰 줄이고 늘린다. 슬라이드마다 URL 해시를 달고, 방향키와 F/S/O 단축키를 쓴다. 덱은 파일 하나로 묶는다.
- **편집 도구:** 기존 HTML 덱을 클릭해서 고치는 도구로는 HTML Deck(htmldeck, MIT, v0.1.12, 초기 단계), Pinegrow(유료), 브라우저 designMode가 있다. slidekit 편집기를 기획한 배경이 이것이다.
- **코멘트 전달:** Agentation은 pull 방식(MCP watch)이다. 실행 중인 세션에 밀어 넣는 공식 수단은 Channels다. 아티팩트 코멘트의 내부 프로토콜은 공개되어 있지 않다.

## 환경 메모

- mac-local 경로는 `~/Developer/slidekit`이고, mac-cloud도 같은 경로를 쓴다.
- 앱의 개발 서버를 mac-cloud에서 띄우면 `https://mac-cloud.tail5a652b.ts.net:<포트>`로 연다(tailscale serve). 0.0.0.0에는 바인딩하지 않는다.
- 외장 모니터 발표 기능(Window Management API)은 실제 발표하는 맥의 Chrome에서 확인해야 한다.
