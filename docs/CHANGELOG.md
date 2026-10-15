# slidekit 변경 요약

날짜순 기록이 아니라 영역별 현재 상태 요약이다. 자세한 내용은 `git log`, 사용법은 `README.md`, 규격은 `spec/SPEC.md`에 있다. 2026-10-15 기준.

## 편집기
- 요소는 Figma식 계층으로 고른다: 클릭은 최상위, 더블클릭은 한 단계 안쪽, Cmd+클릭은 가장 안쪽, Enter와 Shift+Enter와 Tab으로 이동한다.
- Layers(숨김, 잠금, 이름 바꾸기, 드래그 순서)와 캔버스 위 가로 필름스트립, 25~400% 줌, Space 팬, 스마트 가이드, 8방향 리사이즈를 둔다.
- 다중 선택(Shift+클릭, 마퀴)에서 이동, 정렬(Align), 복제, 삭제, Inspector 일괄 편집이 된다.
- Group(Cmd+G)과 Ungroup(Shift+Cmd+G), 스타일 복사와 붙여넣기(Cmd+Alt+C, Cmd+Alt+V), 텍스트 스타일 프리셋 5종이 있다.
- Find and replace(Cmd+F)는 덱 전체를 찾고 Replace all은 실행 취소 1건이다.
- Cmd+K 명령 팔레트는 처음 열면 핵심 동작 5개(Present, Add slide, Find, Add comment, Keyboard shortcuts)로 시작한다.
- 슬라이드 모양 프리셋은 제공하지 않는다(레이아웃 프리셋 제거). 두 열과 큰 숫자 같은 모양은 새 덱의 `<style>` 클래스 예(`.two-col`, `.big-number`)를 쓰고, 남은 `data-layout`은 lint가 경고한다.
- 이미지는 붙여넣기, 끌어 놓기, Replace image...로 넣는다. 덱의 `assets/`에 저장되고 GPS 정보는 지워진다.
- 요소 Fill과 슬라이드 Background에 Linear gradient(스톱 2~4개, 덱 토큰 `var()` 허용)를 쓴다.
- 덱 토큰 패널에 Theme 6종(Dark, Light, Paper, Midnight blue, Mono, High contrast)이 있고 한 번에 바뀌며 실행 취소 1건이다.
- Deck settings에서 제목, 부제, 작성자, 날짜, 언어, 공개 범위를 고치면 바로 저장된다.
- 우클릭 메뉴(요소, 그룹, 빈 곳, Layers, 필름스트립 타일, 코멘트, 덱 카드)와 커서 표를 갖췄다.
- 슬라이드 밖으로 나가거나 잘리는 요소는 캔버스 점선 외곽선, Layers 경고 아이콘, 필름스트립 표시로 알리고 View에 Safe area가 있다.
- 첫 열기에 EditorTip 안내 카드가 한 번 뜬다.
- 자동 저장은 1.5초, 저장 실패 때는 영어 알림과 함께 10초마다 자동 재시도하고 Retry 단추가 있다.

## 발표자 화면과 리모컨
- 발표자 화면은 현재와 다음 슬라이드, 노트(마크다운), 타이머와 목표 시간, 장 위치를 각각 켜고 끈다.
- 리허설 요약은 슬라이드별 체류 시간과 직전 기록 비교를 보여 주고 노트 자동 스크롤이 있다.
- 발표자 화면 Cmd+K 팔레트로 슬라이드를 번호, 제목, 노트 글자로 찾아 이동한다.
- 발표 창은 하트비트로 열림과 닫힘을 알아보고 외장 모니터 선택을 기억한다.
- B와 W로 청중 화면을 검게 또는 희게 가리고 발표자가 원격으로 켜고 끈다.
- 청중 화면은 방향키 이동, 크로스페이드, 전체 보기, 숫자와 Enter 이동, 우클릭 차단(발표 중에만)을 갖췄다.
- 휴대폰 리모컨(Phone remote)은 QR과 1회용 코드로 연결하고 next, prev, goto, blank, timer를 보낸다. 세션은 2시간이며 SSE는 1회용 티켓을 쓴다.

## 덱 목록
- 검색 팔레트가 덱 이름과 슬라이드 제목, 본문, 노트까지 찾고 일치한 글자를 굵게 보인다.
- Pin to top, 필터 칩(All, Pinned, Recent, Password), 정렬, 그리드와 리스트, 카드 키보드 이동과 `/`, `N`, `?` 단축키를 둔다.
- 새 덱은 템플릿(Talk, Blank, Workshop)으로 시작하고 복제, Rename..., Settings..., 휴지통(Undo)을 지원한다.

## 코멘트와 Claude 연동
- 요소나 슬라이드에 코멘트(C 키)를 달면 열린 Claude Code 세션이 받아 고치고 답한다.
- 상태는 Waiting, Sent to Claude, Claude is working, Replied, Resolved이며 서명 없는 코멘트는 Unverified로 보이고 Trust 전에는 가지 않는다.
- 작성창의 Hold until I send all to Claude로 모은 뒤 Send all to Claude로 한 번에 최대 10개씩 보낸다. Resolve all replied도 있다.
- Revert Claude's edit로 Claude의 수정만 되돌린다. Version history로 복원하면 위치가 어긋난 코멘트는 확인 필요로 표시된다.
- 코멘트 서명 키는 `~/.config/slidekit/`에 두며 동시 생성과 하드링크 미지원 파일시스템을 처리한다.

## 내보내기와 배포
- Export 메뉴: Download HTML(번들), Download PDF(Slides, With notes, Handout 2/3/4/6), Copy as Markdown, Download .md, 게시와 게시 기록(Published...).
- 게시 전 점검은 lint, 큰 이미지, 노트 없는 장, 색 대비를 보여 주고 비밀번호 덱은 8자 이상이다.
- `slidekit unpublish`와 Export의 Unpublish는 확인을 거쳐 KV에서 지우고, 기록의 이름이 폴더와 다르면 이름을 직접 입력받는다.
- 번들은 엔진, 이미지, 글꼴 서브셋을 내장해 오프라인에서도 같은 화면이 뜬다. PDF는 제목 책갈피와 링크를 남긴다.
- Worker: 비밀번호와 잠금과 404 페이지, 로그인 시도 제한(Durable Object), 보안 헤더. 2026-10-15에 배포되었다(이력과 롤백은 `deploy/README.md`).
- 배포 전 리허설(`deploy/rehearse.ts`)이 로컬 Worker로 로그인과 5회 잠금까지 확인하며 런타임 인자 오류로 로그인이 500이던 것을 잡았다.

## 엔진과 CLI
- 단계 등장은 `data-step`과 `data-step-effect`(rise, fade, left, scale, blur, none)로 JS 없이 쓴다.
- 명령: `new --template`, `templates`, `lint`, `doctor [덱] [--layout]`, `image`, `outline`, `bundle`, `pdf --notes --handout`, `deploy`, `unpublish`.
- `doctor <덱>`은 lint, 크기, 이미지, 노트, 색 대비(WCAG), 외부 글꼴을 요약하고 `--layout`은 넘침과 잘림을 잰다.
- 덱 규격은 `deck-meta` 검증, 템플릿 3종, 버전 기록(`.versions/`, 최대 50개와 30MB)을 포함한다.
- 보안: 이미지와 SVG 검사, 1억 픽셀 상한, 번들러 읽기 범위 제한, 입력 정제, 덱 단위 저장 잠금, 읽기 전용 가드를 갖췄다.

## 접근성과 견고성
- 청중 화면에 스크린 리더 안내 영역이 있고 단계가 넘어가면 새로 나타난 글자도 읽는다.
- 터치 기기에서 히트 영역을 44px로 넓히고(보이는 크기는 그대로) 좁은 화면 드롭다운은 가장자리에서 8px 떨어진다.
- 코멘트 화면, 필름스트립, 크기 칩은 대비와 키보드 흐름을 맞췄고 axe 위반 0을 검사한다.
- 앱 화면은 외부 호스트로 요청하지 않으며 PDF 생성은 네트워크를 기다리지 않는다. `doctor`가 외부 글꼴 사용을 경고한다.
- 편집기 조작 퍼즈가 id 중복, 복제 시 cover 문제, svg id 충돌 같은 결함을 찾아 고쳤다.

## 개발 도구와 테스트
- `bun run test`는 공정 큐로 잠금을 잡고 단계 42개(느린 8개는 `--slow`나 `--only`)를 돈다. 선택은 `--only <이름>`이 정확 일치이고 글로브와 그룹 별칭을 쓴다.
- 공용 브라우저 서버와 가짜 시계, 조건 대기로 흔들림을 줄였고 실패한 브라우저 단계는 트레이스를 켜고 한 번 더 돈다.
- 가이드 덱 `slidekit-guide`는 26장이며 기능 시연용 노트가 있고 `docs/DEVICE-CHECKLIST.md`가 실기기 확인 7가지를 안내한다.
- `HANDOFF.md`가 현재 상태와 한계, 사용자 확인 항목을 한 곳에 모은다.
