# slidekit

HTML 슬라이드를 만들고, 편집하고, 발표하고, 배포하는 로컬 도구. 설계는 `PLAN.md`, 덱 규격은 `spec/SPEC.md`, 진행 현황은 `HANDOFF.md`.

## 설치와 실행
- `bun install` 후 `bun run slidekit`. 앱은 http://127.0.0.1:3200 에만 열린다(`PORT`로 바꿈).
- 덱 목록에서 덱을 고르면 발표자 화면(`/present/<덱>`)과 편집기(`/edit/<덱>`)로 간다.

## 편집과 발표
- 편집기: 요소 트리(Layers)와 슬라이드 필름스트립, 캔버스 직접 편집(더블클릭), 속성 패널(Inspector), 덱 토큰 편집, 노트(마크다운), 코멘트, 내보내기(Export 메뉴). 계층 선택은 클릭(최상위), 더블클릭(한 단계 안쪽), Cmd+클릭(가장 안쪽), Enter와 Shift+Enter(자식, 부모), Tab(형제)이다. 줌은 Cmd+휠과 Cmd+=, Cmd+-, Cmd+0이다. Cmd+K는 명령 팔레트, Cmd+/는 단축키 안내, 코멘트는 요소를 고르고 C이다. 편집 뒤 1.5초 동안 입력이 없으면 자동 저장하고 Cmd+S로도 저장한다. 저장하면 `decks/<덱>/index.html`이 바뀐다.
- 읽기 전용 가드(테스트 서버 전용): 환경 변수 `SLIDEKIT_READONLY_DECKS=폴더,폴더`를 주고 띄운 서버는 목록의 덱에 대한 저장(`PUT /api/decks/<폴더>`)을 403으로 거부한다. 자동화 테스트가 실제 덱을 고치지 못하게 하려는 장치이므로 사용자가 쓰는 서버(미리보기 3220 등)에는 설정하지 않는다.
- 새 슬라이드: 본문 레이아웃(제목과 본문, 두 열, 큰 숫자, 인용, 전체 이미지)을 `data-layout`으로 고른다. 목록은 `bun run slidekit layouts`이고 규칙은 `spec/SPEC.md` 2.1이다. 새 덱은 템플릿(talk, blank, workshop)으로 시작한다(`slidekit new <이름> --template <id>`).
- 발표: 방향키로만 넘기고 F가 전체화면, O가 전체 보기, 숫자와 Enter가 장 이동, B와 W가 검은 화면과 흰 화면이다. 발표자 화면은 노트, 타이머와 목표 시간, 장 위치를 각각 켜고 끄며 외장 모니터로 시작할 수 있다. 편집기에서 Cmd+Enter는 현재 슬라이드부터, Shift+Cmd+Enter는 처음부터 발표한다. 발표 중인 청중 화면(`?sync=1` 창과 전체화면)에서는 우클릭 메뉴가 뜨지 않는다. 휴대폰 리모컨(`/remote/<덱>`)은 발표자 화면의 대화상자에서 코드를 받아 이동, 가리기, 타이머를 원격으로 한다(한계는 `HANDOFF.md`).
- 내보내기: Export 메뉴에서 HTML 번들, PDF(슬라이드, 노트 포함, 쪽당 2/3/4/6장 유인물), 게시, 버전 기록(Version history)을 쓴다. 버전 기록은 저장할 때마다 `decks/<덱>/.versions/`에 최근 50개까지 남기고 복원하면 현재를 먼저 남긴다.
- 덱 목록: 검색, 정렬, 카드 키보드 이동, Cmd+Enter 빠른 발표, 새 덱, 복제, 이름 바꾸기, 휴지통.

## 명령
- `bun run slidekit help`: 명령 목록. 알 수 없는 명령은 사용법을 보여 주고 종료 코드 1이다.
- `bun run slidekit new <이름> [--template talk|blank|workshop]`: `decks/<이름>/`을 템플릿에서 만든다(`slidekit templates`로 목록). `slidekit layouts`는 슬라이드 레이아웃 프리셋 목록.
- `bun run slidekit lint <덱>`: 덱이 SPEC을 지키는지 규칙별로 점검한다(오류가 있으면 종료 코드 1).
- `bun run slidekit pdf <덱> [--notes | --handout [2|3|4|6]]`: 번들한 덱을 `dist/<덱>.pdf`로 인쇄한다(슬라이드당 한 페이지, 16:9). `--notes`는 A4 세로 쪽마다 슬라이드 한 장과 노트, `--handout`은 쪽마다 슬라이드 여러 장의 유인물이다.
- `bun run slidekit doctor`: bun, Chrome, 키체인 토큰, 포트, Host 가드, 덱 lint를 한 화면에 점검한다.
- `bun run slidekit bundle <덱>`: 엔진, 이미지, 글꼴 서브셋을 담은 `dist/<덱>.html` 하나로 묶는다.
- `bun run slidekit deploy <덱>`: Cloudflare로 올려 static.vynnlee.com/<덱>으로 연다. 준비는 `deploy/README.md`.
- `bun run slidekit unpublish <덱> [--yes]`: 배포한 덱을 지운다. `--yes`가 없으면 지울 목록만 보이고 종료 코드 2다(`deploy/README.md` 마지막 절).
- `bun run deploy --smoke [공개덱 [비밀번호덱]]`: 배포 뒤 점검(GET만, 토큰 불필요).
- `bun run test`: 전체 검증(왕복, 워커, 채널, 엔진, 편집기). `/tmp/slidekit-heavy.lock`을 잡고 돈다.

## 코멘트 채널
앱에서 요소를 골라 코멘트를 쓰면 열린 Claude Code 세션이 받아 덱을 고치고 답한다.
- 저장소 루트에서 `claude --dangerously-load-development-channels server:slidekit` (연구 프리뷰). 자세한 설정은 `channel/README.md`.
- 코멘트는 `decks/<덱>/comments.json`에 쌓이고, 놓친 것은 `get_pending` 도구로 가져온다.
- 변경 API는 Host와 Origin을 검사하고 JSON만 받는다(`app/guard.ts`).

## 개발 서버 미리보기
`UP=<앱 포트> PORT=<프록시 포트> bun app/preview-proxy.ts`. Host와 Origin을 다시 써서 tailnet HTTPS 주소로 열 수 있게 하고, 허용되지 않은 Host와 Origin은 403이다.

## 커밋 전 비밀 값 검사
`git config core.hooksPath .githooks`로 켜면 커밋 때 `scripts/scan-secrets.ts`가 추가된 줄에서 토큰, 개인 키, 비밀 할당을 찾아 막는다. 비밀이 아닌 값은 `scripts/scan-secrets.allow`에 등록. 이력 전체 점검: `git log -p -U0 | bun scripts/scan-secrets.ts --stdin`.

## 문구 규칙
em-dash, en-dash, 가운뎃점, 이모지, 구어체, 비유 금지. 자세한 디자인 규칙은 `HANDOFF.md`와 `spec/SPEC.md` 끝부분.
