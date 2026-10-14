# slidekit 핸드오프 (2026-10-14 갱신)

새 세션은 이 문서를 먼저 읽는다. 기획은 `PLAN.md`, 덱 규격은 `spec/SPEC.md`(9절은 편집), 속성 패널 설계는 `spec/INSPECTOR.md`, 사용법은 `README.md`.

## 목적

HTML 슬라이드를 만들고, 편집하고, 발표하고, 배포하는 로컬 도구. 덱은 폴더 하나(`decks/<이름>/index.html`)이고, 엔진이 1920x1080 맞춤, 방향키 이동, F 전체화면, O 전체 보기, 발표 동기화를 맡는다. 앱은 덱 목록, 발표자 화면, 편집기, 코멘트 UI를 준다. 첫 예제는 워크숍 덱(53장, `decks/vibe-coding-workshop`).

## 구성

| 경로 | 내용 |
|---|---|
| `engine/` | `slidekit.js`, `slidekit.css`(인쇄 CSS 포함), `new.ts`, `lint.ts`, `pdf.ts`, `doctor.ts`, `template/`, `test/verify.cjs`, `test/lint.test.ts`, `test/cli.test.ts` |
| `app/` | Bun 서버(`server.ts`, `guard.ts`, `comments.ts`, `editor-api.ts`, `decks-api.ts`, `export-api.ts`(번들, PDF, 게시 API), `launch.ts`, `preview-proxy.ts`), React 앱(`src/`), 테스트(`test/`) |
| `bundler/` | 덱을 외부 파일 없는 단일 HTML로 묶음(이미지, srcset, 글꼴 서브셋 인라인) |
| `deploy/` | `deploy.ts`와 Cloudflare Worker(`worker/`, KV, 비밀번호 쿠키) |
| `channel/` | Claude Code Channels MCP 서버(코멘트 전달) |
| `scripts/` | `test.ts`(`bun run test` 집계), `lib/test-deck.cjs`(테스트 덱 사본 `decks/_e2e-*`), `inspector-shots.cjs`와 `ux-shots-comments.cjs`(UX 리뷰용 스크린샷 도구, 사용법 주석 참조), `scan-secrets.*` |
| `.claude/skills/slidekit/` | AI가 덱을 만들 때 읽는 스킬(규격, 토큰, 문구 규칙, 확인 방법) |
| `spec/` | SPEC.md, INSPECTOR.md |
| `decks/`, `dist/` | 덱 원본, 번들과 PDF 산출물(dist는 git 무시, `decks/_*/`도 무시) |

## 2026-10-14 UX 라운드 요약 (코드와 git log 기준)

- **편집기**: 요소 선택은 Figma식 계층(클릭은 최상위, 더블클릭은 한 단계 안쪽, Cmd+클릭은 가장 안쪽, Enter는 첫 자식, Shift+Enter는 부모, Tab은 같은 범위 형제, SPEC 9.5). 요소 트리(Layers: 숨김, 잠금, 이름 바꾸기, 드래그 순서), 슬라이드는 캔버스 위 가로 필름스트립. 줌 25~400%(Cmd+휠, Cmd+=, Cmd+-, Cmd+0 맞춤), Space 드래그로 이동, 선택 크기 칩. Cmd+K 명령 팔레트(슬라이드 이동, 발표, 추가, 복제, 삭제, 저장 등), Cmd+/ 단축키 안내. 코멘트는 요소를 고르고 `C`(전송 Cmd+Enter): 상태 Waiting, Sent to Claude, Replied, Resolved, 패널 필터, 캔버스 핀, 답이 오면 토스트. Inspector는 설정됨 점과 Reset, 크기 모드 추정, 단계 등장 편집(Appears at step), 덱 토큰 패널(Deck styles), Export 메뉴(번들, PDF, 게시). 자동 저장은 편집 뒤 1.5초, Cmd+S, 충돌 시 Reload 또는 Overwrite.
- **발표자 화면**: 현재와 다음 슬라이드, 노트(마크다운, 14~56px), 타이머와 목표 시간(분, 초과는 빨강), 장 위치, 항목별 토글. 키는 방향키, F, T(타이머), R(리셋), + -(노트 크기), PageUp과 PageDown(노트 스크롤). 현재 슬라이드부터 발표는 Cmd+Enter, 처음부터는 Shift+Cmd+Enter, `?from=N`도 된다.
- **덱 목록**: 검색 팔레트, 날짜 또는 이름 정렬, 그리드와 리스트, 카드 키보드 이동과 Cmd+Enter 빠른 발표, 새 덱(폴더명 자동 제안과 실시간 검사), 복제, 이름 바꾸기, 휴지통(Undo 토스트, 영구 삭제는 폴더명 입력).
- **청중 화면(엔진)**: 방향키 이동은 크로스페이드, O 전체 보기는 반응형 격자와 선택 윤곽과 현재 점, 마우스는 2초 뒤 숨김, 숫자 입력은 장 제목을 보여 주는 알약, B와 W는 검은 화면과 흰 화면(창별), 단계 등장은 `data-step`(JS 없이). 진행 막대는 2px.
- **CLI와 DX**: `slidekit help`, 알 수 없는 명령은 사용법과 함께 종료 코드 1, `new`는 다음 단계를 안내, lint와 doctor와 bundle 메시지는 고치는 방법을 말한다. 새 덱 템플릿과 `slidekit-guide` 덱(12장, 기능 데모)과 SKILL.md 6-1 디자인 가이드.
- **번들**: head에 파비콘, og:title, description, 비밀번호 덱 noindex, lang을 채우고 큰 이미지(400KB 초과)를 경고한다.

## 실행과 명령

- 앱: `bun run slidekit`(127.0.0.1:3200, `PORT`로 변경). tailnet 미리보기는 개발 서버가 Host를 막으므로 `PORT=3220 bun run app/server.ts`와 `UP=3220 PORT=3221 bun app/preview-proxy.ts`를 띄우고 https://mac-cloud.tail5a652b.ts.net:3221 로 연다(tailscale serve --https=3221, 끝나면 off). 3221은 사용자가 쓰는 포트라 임의로 끄지 않는다.
- `slidekit new <이름>`: 템플릿에서 덱 생성. `lint <덱>`: SPEC 위반을 규칙별로 출력(오류 시 종료 코드 1). `bundle <덱>`: `dist/<덱>.html`. `pdf <덱>`: `dist/<덱>.pdf`(Chrome은 `SLIDEKIT_CHROME` 또는 ms-playwright 캐시). `deploy <덱>`: Cloudflare 업로드(`deploy/README.md`). `doctor`: 환경 점검. 모두 `bun app/server.ts <하위 명령>` 또는 `bun run slidekit <하위 명령>`.
- 테스트: `bun run test`(왕복, 워커, 채널, 엔진 verify.cjs, 편집기 등 전체. 잠금을 잡고 돈다). 개별: `bun test engine bundler`, `bun app/test/deck-source.fuzz.ts`, `node app/test/inspector.cjs`(PW, CHROME, BASE 환경 변수).
- Playwright: `/tmp/claude-501/sp/pw`의 playwright-core, `~/Library/Caches/ms-playwright/chromium_headless_shell-1243/*/chrome-headless-shell`(args `--disable-gpu`). verify.cjs는 정적 서버 3150에서 덱이 바뀌지 않게 git HEAD 사본을 서빙해 돌린다.

## 팀 운영 규칙

- mac-cloud는 열에 약하다. 빌드, 타입 검사, 브라우저 테스트는 팀 전체에서 한 번에 하나: `mkdir /tmp/slidekit-heavy.lock`(잡을 때 `echo <이름> > .../pid`로 표시, 끝나면 내 표시일 때만 `rm -rf`), `taskpolicy -b`, 작업자 1개. 서브에이전트는 빌드와 테스트를 직접 돌리지 않는다.
- 담당: engine-dev(engine, bundler, deploy, channel, guard, 스킬, SPEC 1~8절), editor-dev(편집기와 속성 패널, SPEC 9절), app-dev(앱 서버와 발표자 화면, 덱 목록). 남의 영역 결함은 고치지 않고 team-lead에게 파일, 줄, 재현 방법으로 보고한다.
- 커밋: 내 파일만 `git add`(남의 미커밋 변경이 섞인 파일은 내 hunk만 index에 올린다). 한국어 한 줄 제목, 끝에 trailer 두 줄(Co-Authored-By, Claude-Session). 푸시는 사용자가 한다. 서버는 내가 띄운 PID만 종료.
- 커밋 전 비밀 값 검사: `.githooks/pre-commit`(`git config core.hooksPath .githooks`, 저장소 로컬 설정). 값은 키체인에만 두고, 비밀이 아닌 오탐은 `scripts/scan-secrets.allow`에 등록한다. 설정은 clone마다 다시 해야 한다.
- 모든 UI, 덱 문구에 문구 규칙 적용(아래).

## 확정된 결정과 선호

- 앱 UI는 Fluid Functionalism 컴포넌트만 쓴다(`app/src/components/ui/`). 컴팩트 크기(28px), Figma Design 패널식 UX, UI 문구는 영어(다국어 없음).
- 슬라이드 이동은 방향키만. 클릭, 스페이스, 스와이프, 휠로 넘기지 않는다. F는 전체화면(화면에 버튼 없음), O는 전체 보기, 숫자와 Enter는 장 이동.
- 발표자 화면 항목(현재와 다음 슬라이드, 노트, 타이머와 시계, 장 위치)은 각각 토글. 노트는 마크다운 원문.
- 문구: em-dash, en-dash, 가운뎃점, 이모지, 구어체, 비유 금지(사용자가 직접 요청한 예외만). 배경 검정, 글자 흰색, 페이지 번호와 꾸밈 없이 미니멀. 로고는 브랜드 색, 사용자 이미지는 원본 그대로.
- 코멘트는 Claude Code Channels(연구 프리뷰)로 보내고 `comments.json`에도 저장. 띄우기: `claude --dangerously-load-development-channels server:slidekit`(`channel/README.md`).
- 사용자는 오케스트레이터 방식을 선호한다: 큰 일은 팀원과 서브에이전트에 나누고 결과를 직접 검증한 뒤 보고한다. 선택지가 있는 결정은 AskUserQuestion.
- 보안: Host와 Origin 검사(`app/guard.ts`, 모든 메서드), 입력 크기 제한, 127.0.0.1에만 바인딩, 공개 노출(Funnel, 포트포워딩) 금지.

## 배포 상태

- 주소 `static.vynnlee.com/<덱>`, 덱마다 공개 또는 비밀번호. Worker와 KV(`DECKS`, id는 `deploy/worker/wrangler.toml`), 비밀번호는 PBKDF2 해시로 KV meta에 두고 쿠키 서명, 시도 제한은 덱과 IP별 15분 5회.
- Cloudflare 토큰은 키체인 `slidekit-cloudflare-token`(2026-10-13 생성, 이름 slidekit-static-deploy, 값은 출력 금지). 쓰는 법과 범위는 `deploy/README.md`. `COOKIE_SECRET`은 `wrangler secret`.
- 2026-10-13에 Worker(`slidekit-static`)와 워크숍 덱(public)을 배포했다: https://static.vynnlee.com/vibe-coding-workshop . mac-cloud의 로컬 DNS 캐시가 실패 결과를 들고 있어 `curl`이 000(DNS 실패)일 수 있다. 그때는 `dig +short @1.1.1.1 static.vynnlee.com`의 IP로 `curl --resolve static.vynnlee.com:443:<IP> ...`로 확인한다(캐시 비우기는 sudo 필요). 응답 없음을 미배포로 판단하지 않는다.
- 배포 순서: meta를 먼저, html을 나중에 올린다(공개에서 비밀번호로 바꿀 때 노출 방지).
- **미배포(승인 대기)**: 2026-10-14에 Worker 안내 페이지(비밀번호, 잠금, 404 통일, 덱 제목 표시, 로딩 상태)와 `deploy`가 meta에 `title`을 올리는 변경, 번들 head 변경을 코드와 테스트까지만 했다. 반영하려면 사용자 승인 뒤 `bun run deploy --worker`를 실행한다(이미 올린 덱은 다시 `slidekit deploy <덱>`으로 올려야 제목이 보인다).
  - 배포 준비는 `deploy/README.md` 마지막 절에 있다(드라이런 결과, 구버전과의 차이, 사용자에게 보일 변화, 롤백). 배포 뒤 `bun run deploy --smoke [공개덱 [비밀번호덱]]`로 점검한다(GET만).
  - 로그인 시도 제한은 Durable Object `Limiter`로 구현했다(코드, 바인딩, 마이그레이션 v1, 동시 요청 단위 테스트, 드라이런 통과, KV 폴백 유지). Worker 배포는 사용자 방향 결정 대기이며, 실행 순서와 한도 근거 URL은 `deploy/README.md` 마지막 절에 있다. 같은 배포에 Worker 보안 변경(쿠키에 salt 바인딩, 보호된 덱은 문서 요청에만 서빙, COOP, HSTS, 입력 폼 nonce CSP, 비밀번호 덱 제목은 `lockTitle` 옵트인)도 들어 있어 비밀번호 덱의 기존 쿠키는 모두 무효가 된다.

## 알려진 한계

- 번들러 글꼴: 원격 글꼴 CSS(Google Fonts, jsdelivr 등)와 로컬 `@font-face` 파일을 덱이 쓰는 글자만 남긴 woff2로 인라인한다(`uv`와 인터넷 필요, 받은 파일은 `~/.cache/slidekit/fonts`에만 캐시하고 저장소에 글꼴 파일을 커밋하지 않는다). 시스템 글꼴만 쓰는 덱은 아무것도 받지 않는다. `<video>` 파일과 글꼴이 아닌 외부 CDN 자원은 인라인하지 않는다. 종단 검증: `node bundler/test/fonts.cjs`.
- 인쇄(PDF)는 `data-step` 요소를 모두 보인다. 전체 보기 축소판과 편집기 필름스트립은 1단계 모습이다.
- 화면별 lazy import(`App.tsx`)가 있지만 Bun.serve HTML 번들은 코드 분할을 하지 않아 production JS가 단일 청크(약 1MB, 2026-10-13 측정). 필요하면 서버 시작 때 Bun.build splitting 사용.
- lint는 정규식 기반이라 아주 특이한 마크업에서 오탐이 있을 수 있다. error만 종료 코드에 반영한다.
- 발표 동기화는 같은 출처의 BroadcastChannel 전용(기기 간 동기화 없음). 세로나 좁은 창은 무대 비율을 유지하고 남는 영역을 배경색으로 채운다.
- 편집기는 슬라이드 단위 원문 보존(`app/src/lib/deck-source.ts`)을 전제로 한다. 인라인 편집은 글자만 담은 요소 중심.
- Chrome 계열 전용(Window Management API). mac-cloud에는 화면이 없어 외장 모니터 기능은 검증하지 못한다.

## 테스트 후속 후보

- 풀 게이트(`bun run test`)는 약 550초다. 오래 걸리는 단계는 editor 174초, engine-verify 59초, list 56초, inspector-a11y 51초.
- 2026-10-14 실측: editor.cjs의 저장, 복제, 삭제, 순서 변경 뒤 고정 sleep 약 14초를 조건 대기(Saved 상태, 슬라이드 수, 제목 위치)로 바꿨지만 단계 시간은 197초에서 207초로 줄지 않았다. 시간은 sleep이 아니라 낮은 우선순위(`taskpolicy -b`)에서의 페이지 로드와 렌더 CPU 시간이다. 남은 sleep 교체는 시간 단축보다 흔들림 감소가 목적이다.
- `scripts/test.ts`가 출력 사이가 3초 넘게 벌어지면 `[느림 +N초]` 줄을 넣는다. 이 표시로 고정 sleep이 있는 검사를 찾아 조건 대기(waitForFunction)로 바꾸면 줄어든다. editor.cjs에 sleep 137곳(합계 약 68초), inspector-a11y.cjs에 32곳(약 13초)이 있다. 디바운스처럼 일어나지 않음을 보는 대기와 애니메이션 종료 대기는 남긴다. list.cjs는 이미 조건 대기 위주다.
- 코멘트 후속 후보: 압축 파일로 받은 덱의 comments.json에는 서명이 없다(형식 검증과 길이 제한만 있음). 로컬 비밀 키 HMAC 서명으로 우리 서버가 만든 코멘트만 채널로 보내게 할 수 있다. 코멘트 패널의 R(답 보기) 단축키와 Claude 응답 중(처리 중) 상태 표시는 미구현.
- 수동 점검 도구(집계 단계에는 넣지 않았다. 시간 부담): `app/test/list-load.cjs`(덱 30개 합성 사본으로 스크롤 중 iframe 수와 동시 로드 수, 검색 반응을 잰다. `CHECK=1`이면 검증), `app/test/a11y-app.cjs`(덱 목록과 발표자 화면의 axe 점검과 1440, 1024, 390 스크린샷. `AXE=<axe.min.js> SHOTS=<폴더>`). 둘 다 테스트 덱을 `decks/_e2e-*`와 `zz-e2e-qa-*`로 만들고 끝나면 지운다. Fluid SidebarMenu의 `ul` 안 `div`(axe list 규칙)는 레지스트리 파일 한계로 예외 처리했다.

## 알려진 위험 (2026-10-14 보안 감사, 결정 보류)

- 앱 API에는 인증 토큰이 없다. 127.0.0.1 바인딩, Host와 Origin 검사, 프록시(tailnet)에만 의존하며 사용자 기기만 접근한다는 전제다.
- 덱은 앱과 같은 출처에서 열려 덱 스크립트가 앱 API를 부를 수 있다(출처 분리나 iframe sandbox는 편집기가 contentDocument를 직접 다뤄 보류). 완화: lint가 덱 스크립트의 fetch, XMLHttpRequest, WebSocket, EventSource, `/api/`를 경고하고 SPEC 7절에 신뢰된 콘텐츠 규칙이 있다. 남에게 받은 덱은 열기 전에 스크립트를 읽는다.
- `/deploy`(Export 메뉴)는 `confirm` 플래그 하나로 동작한다. 공개 범위와 비밀번호는 서버가 덱 원본 `deck-meta`로만 판단하고 읽지 못하면 거부한다. 별도 nonce는 없다.
- 이미 반영한 수정: 채널 입력 정제와 로컬 URL 제한, 번들러가 덱 폴더와 `engine/`만 읽음(.git, .env, comments.json 거부)과 외부 글꼴 SSRF 방어, 비밀번호 8자 이상, wrangler와 fonttools 버전 고정(`deploy/deploy.ts`, `bundler/fonts.ts`의 숫자를 올릴 때는 의도적으로 바꾼다).

## mac-local에서 사용자가 직접 확인할 것

1. 외장 모니터 발표 시작: 권한 팝업, 창 배치, 전체화면(F), 두 창 동기화.
2. 한글 IME로 편집기에서 텍스트 입력(조합 중 단축키 충돌, 저장 결과).
3. Cmd 단축키(저장, 되돌리기, 복제), 드래그와 스크럽 체감, 패널 폭 조절.
4. 비밀번호 덱의 실제 배포 후 접근과 시도 제한.
5. 확인 완료: 코멘트 채널의 실제 Claude 세션 연결.

## 환경 메모

- 경로 `~/Developer/slidekit`(mac-local과 mac-cloud 동일). 상세한 기계 지침은 `~/.claude/CLAUDE.md`.
- 점검은 `bun app/server.ts doctor`.
