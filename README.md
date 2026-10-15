# slidekit

HTML 슬라이드를 만들고, 편집하고, 발표하고, 배포하는 로컬 도구. 설계는 `PLAN.md`, 덱 규격은 `spec/SPEC.md`, 진행 현황은 `HANDOFF.md`.

## 5분 시작하기
macOS와 [Bun](https://bun.sh)이 있으면 된다(요구사항 절 참고).

```sh
git clone git@github.com:vynnlee/slidekit.git && cd slidekit   # 이미 받았다면 그 폴더에서 시작
bun install                              # 의존성
bun run slidekit new my-talk             # decks/my-talk/ 를 템플릿(talk)에서 만든다
bun run slidekit                         # 앱을 연다: http://127.0.0.1:3200
```

1. 덱 목록에서 `my-talk`를 눌러 편집기(`/edit/my-talk`)로 간다. 글자는 더블클릭으로 고치고, 입력이 1.5초 멈추면 자동 저장된다(Cmd+S도 된다).
2. 발표는 Cmd+Enter(현재 슬라이드부터) 또는 Shift+Cmd+Enter(처음부터). 방향키로만 넘기고 F는 전체화면, O는 전체 보기, B와 W는 화면 가리기다.
3. 점검하고 내보낸다.

```sh
bun run slidekit lint my-talk            # 규격 위반 점검
bun run slidekit doctor my-talk          # 이미지, 대비, 노트 점검 (--layout: 넘침과 잘림까지)
bun run slidekit bundle my-talk          # dist/my-talk.html 한 파일
bun run slidekit pdf my-talk             # dist/my-talk.pdf (--notes, --handout 3)
```

게시(선택)는 `bun run slidekit deploy my-talk`이고 준비는 `deploy/README.md`. AI에게 덱을 맡기려면 저장소의 `slidekit` 스킬(`.claude/skills/slidekit/SKILL.md`)을 읽게 한다. 화면이 도는 방식을 눈으로 보려면 덱 목록의 `slidekit-guide`를 연다.

## 발표 전 체크리스트
```sh
bun run slidekit doctor my-talk --layout   # 경고 0이 될 때까지 (넘침, 대비, 노트, 외부 글꼴)
bun run slidekit bundle my-talk            # 오프라인에서도 같은 HTML 한 파일. 외부 글꼴이 있으면 필수
bun run slidekit pdf my-talk --notes       # 백업: 노트가 붙은 PDF
```
1. 위 `doctor`가 경고 없이 끝난다.
2. `bundle`로 만든 `dist/my-talk.html`을 네트워크를 끊고 한 번 열어 처음부터 끝까지 넘겨 본다. 외부 글꼴 덱은 번들하지 않으면 망이 느릴 때 화면이 늦게 뜬다.
3. 백업 PDF를 같은 노트북과 휴대폰에 둔다.
4. 휴대폰 리모컨과 프로젝터는 `docs/DEVICE-CHECKLIST.md`로 실기기에서 확인한다.

## 설치와 실행
- `bun install` 후 `bun run slidekit`. 앱은 http://127.0.0.1:3200 에만 열린다(`PORT`로 바꿈).

## 요구사항
- macOS와 Bun 1.2.3 이상(`bun upgrade`, 1.4.2에서 개발하고 검증했다). `bun install`이 의존성을 받는다.
- Chrome: `slidekit pdf`와 브라우저 테스트에 필요하다. Playwright의 chromium headless shell(`~/Library/Caches/ms-playwright`)을 먼저 찾고, 없으면 설치된 Google Chrome, Chromium, Edge를 쓴다. 직접 지정하려면 `SLIDEKIT_CHROME`에 실행 파일 경로를 준다. PDF는 headless shell로 검증했고 시스템 Chrome 경로는 아직 검증하지 못했다.
- uv: 외부 글꼴(Google Fonts 등)을 쓰는 덱을 `bundle`할 때 글꼴 부분집합을 만드는 데 필요하다(`brew install uv`). 첫 번들에는 인터넷도 필요하고 내려받은 글꼴은 `~/.cache/slidekit`에 캐시된다. 글꼴 링크가 없는 덱은 필요 없다. 없으면 번들이 설치 방법을 알려 주고 멈춘다.
- git: 새 덱의 `author`를 `git config user.name`으로 채운다(없으면 빈 값).
- 배포(선택): Cloudflare 토큰을 macOS 키체인 `slidekit-cloudflare-token`에 둔다. wrangler는 `bunx`가 고정 버전을 받는다(인터넷). 준비는 `deploy/README.md`.
- 휴대폰 리모컨(선택): 휴대폰이 닿는 주소(예: Tailscale)로 앱을 열어야 한다.
- 확인: `bun run slidekit doctor`가 bun 버전, uv, Chrome, 키체인 토큰, 포트, 덱 lint를 한 화면에 점검하고 없는 것은 설치 방법을 알려 준다.

## 편집과 발표
- 편집기: 요소 트리(Layers)와 슬라이드 필름스트립, 캔버스 직접 편집(더블클릭), 속성 패널(Inspector), 덱 토큰 편집, 노트(마크다운), 코멘트, 내보내기(Export 메뉴). 계층 선택은 클릭(최상위), 더블클릭(한 단계 안쪽), Cmd+클릭(가장 안쪽), Enter와 Shift+Enter(자식, 부모), Tab(형제)이다. 줌은 Cmd+휠과 Cmd+=, Cmd+-, Cmd+0이다. Cmd+K는 명령 팔레트, Cmd+/는 단축키 안내, 코멘트는 요소를 고르고 C이다. 편집 뒤 1.5초 동안 입력이 없으면 자동 저장하고 Cmd+S로도 저장한다. 저장하면 `decks/<덱>/index.html`이 바뀐다.
- 읽기 전용 가드(테스트 서버 전용): `SLIDEKIT_READONLY_DECKS=폴더,폴더`를 주고 띄운 서버는 그 덱의 쓰기를 403으로 거부한다. 사용자가 쓰는 서버에는 설정하지 않는다.
- 새 슬라이드: 본문 레이아웃(제목과 본문, 두 열, 큰 숫자, 인용, 전체 이미지)을 `data-layout`으로 고른다. 목록은 `bun run slidekit layouts`이고 규칙은 `spec/SPEC.md` 2.1이다. 새 덱은 템플릿(talk, blank, workshop)으로 시작한다(`slidekit new <이름> --template <id>`).
- 발표: 방향키로만 넘기고 F가 전체화면, O가 전체 보기, 숫자와 Enter가 장 이동, B와 W가 검은 화면과 흰 화면이다. 발표자 화면은 노트, 타이머와 목표 시간, 장 위치를 각각 켜고 끄며 외장 모니터로 시작할 수 있다. 편집기에서 Cmd+Enter는 현재 슬라이드부터, Shift+Cmd+Enter는 처음부터 발표한다. 발표 중인 청중 화면(`?sync=1` 창과 전체화면)에서는 우클릭 메뉴가 뜨지 않는다. 휴대폰 리모컨(`/remote/<덱>`)은 발표자 화면의 대화상자에서 코드를 받아 이동, 가리기, 타이머를 원격으로 한다(한계는 `HANDOFF.md`).
- 내보내기: Export 메뉴에서 HTML 번들, PDF(슬라이드, 노트 포함, 쪽당 2/3/4/6장 유인물), 게시, 버전 기록(Version history)을 쓴다. 버전 기록은 저장할 때마다 `decks/<덱>/.versions/`에 최근 50개까지 남기고 복원하면 현재를 먼저 남긴다.
- 덱 목록: 검색, 정렬, 카드 키보드 이동, Cmd+Enter 빠른 발표, 새 덱, 복제, 이름 바꾸기, 휴지통.

## 명령
- `bun run slidekit help`: 명령 목록. 알 수 없는 명령은 사용법을 보여 주고 종료 코드 1이다.
- `bun run slidekit new <이름> [--template talk|blank|workshop]`: `decks/<이름>/`을 템플릿에서 만든다(`slidekit templates`로 목록). `slidekit layouts`는 슬라이드 레이아웃 프리셋 목록.
- `bun run slidekit image <덱> <파일> [--max 2400]`: 이미지를 덱의 `assets/`에 안전하게 저장하고 상대 경로를 출력한다(이름 정리, svg 스크립트 거부, GPS 정보 제거, 큰 이미지 축소는 macOS `sips`).
- `bun run slidekit lint <덱>`: 덱이 SPEC을 지키는지 규칙별로 점검한다(오류가 있으면 종료 코드 1).
- `bun run slidekit pdf <덱> [--notes | --handout [2|3|4|6]]`: 번들한 덱을 `dist/<덱>.pdf`로 인쇄한다(슬라이드당 한 페이지, 16:9). `--notes`는 A4 세로 쪽마다 슬라이드 한 장과 노트, `--handout`은 쪽마다 슬라이드 여러 장의 유인물이다. PDF는 텍스트를 선택하고 검색할 수 있고, 슬라이드의 `<a>` 링크가 클릭되며, 제목(`h1`, `h2`)이 책갈피(outline)로 들어간다. 글꼴은 Chrome이 Type3로 임베드한다.
- `bun run slidekit doctor`: bun, Chrome, 키체인 토큰, 포트, Host 가드, 덱 lint를 한 화면에 점검한다. `doctor <덱>`은 그 덱의 lint, 크기, 큰 이미지, 노트 현황, 색 대비(WCAG)를 요약한다(게시 전 점검과 같은 근거). `--layout`을 붙이면 헤드리스 Chrome으로 슬라이드 밖으로 넘치거나 잘리는 요소도 잰다(편집기의 넘침 표시와 같은 기준, 약 2초).
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
