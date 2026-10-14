# slidekit 핸드오프 (2026-10-15 갱신)

새 세션은 이 문서를 먼저 읽는다. 기획은 `PLAN.md`(초기 기획, 일부 낡음), 덱 규격은 `spec/SPEC.md`(9절은 편집), 속성 패널 설계는 `spec/INSPECTOR.md`, 컨텍스트 메뉴와 커서는 `spec/INTERACTION.md`, 사용법은 `README.md`, 배포는 `deploy/README.md`.

## 목적

HTML 슬라이드를 만들고, 편집하고, 발표하고, 배포하는 로컬 도구. 덱은 폴더 하나(`decks/<이름>/index.html`)이고, 엔진이 1920x1080 맞춤, 방향키 이동, F 전체화면, O 전체 보기, 발표 동기화를 맡는다. 예제 덱은 워크숍 덱(53장, `decks/vibe-coding-workshop`)과 기능 안내 덱(25장, `decks/slidekit-guide`).

## 구성

| 경로 | 내용 |
|---|---|
| `engine/` | 런타임 `slidekit.js`와 `slidekit.css`(인쇄 CSS 포함), 단계 효과 목록 `steps.ts`, 레이아웃 `layouts.ts`, 템플릿 `templates.ts`와 `template/`, CLI(`new`, `lint`, `pdf`와 `handout.*`, `doctor`와 `deck-check.ts`와 `layout-check.ts`, `image-cli`와 `assets.ts`, `outline`), `deck-meta.ts`, `publish-record.ts`, `chrome.ts`, 테스트 `test/` |
| `app/` | Bun 서버(`server.ts`, `guard.ts`, `deck-lock.ts`, `decks-api.ts`, `editor-api.ts`, `comments.ts`, `versions.ts`, `export-api.ts`, `remote-api.ts`, `search-api.ts`, `folder.ts`, `preview-proxy.ts`), React 앱(`src/`), 테스트(`test/`) |
| `bundler/` | 덱을 외부 파일 없는 단일 HTML로 묶음(이미지, srcset, 글꼴 서브셋 인라인) |
| `deploy/` | `deploy.ts`, `unpublish.ts`와 `kv.ts`, Cloudflare Worker(`worker/`: KV, 비밀번호 쿠키, Durable Object 시도 제한) |
| `channel/` | Claude Code Channels MCP 서버(코멘트 전달) |
| `scripts/` | `test.ts`(`bun run test` 집계), `lib/`(Playwright 공용 `pw.cjs`와 `pw-server.cjs`, 테스트 덱 사본 `test-deck.cjs`), `preview.ts`(미리보기 감독자), 스크린샷 도구(`ux-shots-comments2`; 앱 전체 화면은 `app/test/audit-shots.cjs`, 리모컨은 `app/test/remote-qa.cjs`), `scan-secrets.*` |
| `.claude/skills/slidekit/` | AI가 덱을 만들 때 읽는 스킬(규격, 토큰, 문구 규칙, 확인 방법) |
| `spec/` | SPEC.md, INSPECTOR.md, INTERACTION.md |
| `decks/`, `dist/` | 덱 원본, 번들과 PDF 산출물(dist는 git 무시, `decks/_*/`도 무시) |

## 현재 기능 (코드와 git log 기준, 상세는 SPEC과 README)

- **편집**: Figma식 계층 선택, Layers(숨김, 잠금, 이름, 드래그 순서), 필름스트립, 줌, Cmd+K 팔레트, 찾기와 바꾸기(Cmd+F), 그룹(Cmd+G), 스타일 복사와 붙여넣기, 텍스트 스타일 프리셋, 레이아웃 5종 추가와 변경, 이미지 붙여넣기와 끌어 놓기(`assets/`), 컨텍스트 메뉴(`spec/INTERACTION.md`), 덱 설정(제목, 부제, 작성자, 날짜, 언어, 공개 범위), 덱 토큰과 테마 6종, 채우기와 배경 그라디언트(스톱 2~4개, `var()` 허용), 단계 등장 편집(효과 6종은 `engine/steps.ts`), 넘침 표시, 자동 저장(1.5초)과 충돌 처리.
- **발표**: 청중 화면(크로스페이드, 전체 보기, 숫자 이동, B와 W 가리기, `data-step` 단계 등장, 스크린리더 안내), 발표자 화면(노트, 타이머와 목표, 장 위치, 리허설 요약, Cmd+K 팔레트), 외장 모니터 배치, `?debug=1` 진단.
- **휴대폰 리모컨**: 발표자 화면에서 코드와 QR, 이동과 가리기와 타이머, 세션 2시간, 코드 1회용, SSE는 1회용 티켓.
- **버전 기록**: 저장 직전과 편집기 밖 수정 직전 스냅샷, 비교, 새 탭 sandbox 미리보기, 복원(현재를 먼저 남기고 Undo). 덱당 50개와 30MB, restore 종류는 10개 상한.
- **코멘트**: 요소 코멘트를 Claude Code 세션에 전달하고 답과 해결까지 추적(아래 결정 절).
- **내보내기와 게시**: HTML 번들, PDF(`--notes`, `--handout 2|3|4|6`), `deploy`(공개 또는 비밀번호), `unpublish`(확인 뒤 KV 삭제, 이름이 다르면 이름 입력), 게시 기록 `.publish.json`, `deploy --smoke`.
- **CLI**: `new --template talk|blank|workshop`, `templates`, `layouts`, `lint`, `doctor [덱] [--layout]`, `image`, `bundle`, `pdf`, `deploy`, `unpublish`.

## 실행과 명령

- 앱: `bun run slidekit`(127.0.0.1:3200, `PORT`로 변경). tailnet 미리보기는 개발 서버가 Host를 막으므로 `PORT=3220 bun run app/server.ts`와 `UP=3220 PORT=3221 bun app/preview-proxy.ts`를 띄우고 https://mac-cloud.tail5a652b.ts.net:3221 로 연다(열고 닫는 일은 미리보기 도구 `/preview`로 한다). 3221은 사용자가 쓰는 포트라 임의로 끄지 않는다. 안정 미리보기와 라이브 미리보기를 함께 관리하는 감독자는 `scripts/preview.ts`.
- 모든 하위 명령은 `bun app/server.ts <하위 명령>` 또는 `bun run slidekit <하위 명령>`. 사용법은 README.
- Playwright: `/tmp/claude-501/sp/pw`의 playwright-core, `~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell`(args `--disable-gpu`). 러너가 공용 서버와 브라우저를 `scripts/lib/pw*.cjs`로 띄운다.

## 테스트

- `bun run test [--only <이름|글로브|그룹>] [--changed] [--list] [--bail] [--slow] [--trace]`. 공정 큐(`/tmp/slidekit-heavy.queue`)로 잠금 `/tmp/slidekit-heavy.lock`을 순서대로 잡고, 단계 로그는 `/tmp/slidekit-test-logs/`, 단계당 상한 900초(`SLIDEKIT_STEP_TIMEOUT`). 실패한 브라우저 단계는 트레이스를 켜고 한 번 더 돈다. **단계 이름은 위치 인자가 아니라 `--only`로 준다**(위치 인자는 무시되고 전체가 돈다). `--only editor`는 editor 단계 하나만(정확 일치), 여럿은 글로브 `--only 'editor*'`, 그룹 별칭은 `unit`, `channel`, `ux-shots`, `bundler`(`scripts/lib/select-steps.ts`). 시작 줄의 `선택:`으로 고른 단계를 확인한다.
- 집계 단계 33개(약 880초): roundtrip, deck-source.fuzz, deck-tokens, deck-fonts, editor-readonly, export-api, comments, lint, bundler-bundle, bundler-fonts, scan-secrets, deploy-worker, unit-other, unit-isolated, channel, channel-resilience, channel-trust, engine-verify(약 75초, 145검사), engine-moved, engine-gradient, routes, list, present, remote, responsive, inspector, inspector-a11y, editor, editor-assets, editor-multi, comments-e2e, versions-e2e, tokens, export. `--slow`나 `--only`로만 도는 단계: ux-shots-1440, ux-shots-390, bundler-fonts-e2e(인터넷과 uv 필요).
- 덱 60개 성능(2026-10-15, 격리 worktree, 덱 20개는 53장 워크숍 사본, mac-cloud `taskpolicy -b`): `/api/decks` 15~22ms(12.5KB), `/api/search-index` 첫 호출 57ms와 이후 4~6ms(653KB), 목록 카드 60개 표시 1.4~2.3초, 썸네일 로드가 메인 스레드를 400~800ms 점유하는 긴 작업이 몇 번 생긴다(같은 출처 iframe, 동시 3개 상한). 병목은 서버가 아니라 팔레트였고 입력 상태를 별도 컴포넌트(`DeckPalette.tsx`)로 빼고 줄 수를 제한해 글자당 입력 지연 264~304ms에서 128ms(일반 우선순위)로, 팔레트 열기 923ms에서 542ms로 줄었다. 캐시는 필요 없었다.
- 수동 도구(집계 밖): `app/test/list-load.cjs`(덱 30개 합성 부하), `app/test/a11y-app.cjs`(axe와 스크린샷), `app/test/remote-qa.cjs`(폰 4종 크기).
- 시간은 sleep이 아니라 낮은 우선순위(`taskpolicy -b`)에서의 페이지 로드와 렌더 CPU가 지배한다(sleep 정리와 가짜 시계의 효과는 약 4%). 남은 고정 sleep(editor.cjs 약 137곳, inspector-a11y.cjs 약 32곳)은 시간 단축보다 흔들림 감소 목적으로만 조건 대기로 바꾼다. `[느림 +N초]` 표시로 찾는다.

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
  - 흐름: 편집기에서 C 키(또는 우클릭, 툴바)로 요소나 슬라이드 전체(path가 빈 값)에 코멘트, 빠른 문구 칩 3개, Cmd+Enter 전송 -> 서버가 이 기기 키(`~/.config/slidekit/comments.key`, 0600)의 HMAC 서명을 달아 저장 -> 채널(SSE `?client=channel`)이 서명 검증된 코멘트만 Claude 세션에 전달(연결 때 못 받은 것은 오래된 순 10개 + "더 있다" 알림, `get_pending`) -> Claude가 `ack`, 수정, `reply` -> 패널 상태(Waiting, Sent to Claude, Claude is working, Replied, Resolved, Unverified), 번호 핀, 답 토스트. 해결(E), 삭제(Delete, Undo 토스트), 우클릭 메뉴, J/K 이동.
  - 서명 없는(또는 본문이 바뀐) 코멘트는 Unverified로 보이고 전달되지 않는다. 사용자가 Trust 하면 이 기기 키로 다시 서명한다. 키 파일을 지우면 기존 코멘트는 모두 Unverified가 된다.
  - Revert Claude's edit: 답이 달릴 때 서버가 그 사이의 편집기 밖 수정(`.versions`의 external 스냅샷)을 코멘트에 연결한다. 덱이 그 수정 뒤로 더 바뀌지 않았을 때만(해시 비교) 한 번에 되돌리고, 바뀌었으면 거절하고 Version history를 안내한다. 수정 연결은 ack부터 reply 사이의 시간 창 기준이라 그 사이 사용자가 직접 고친 것도 같은 수정으로 묶일 수 있다(해시 검사가 막아 준다).
  - Version history(Export 메뉴): 위 기능 절 참조. `decks/<덱>/.versions/`는 .gitignore이고 복제에서 제외된다. HTML만 기록하고 이미지 변경은 기록하지 않는다. 복원 뒤 발췌문이 그 슬라이드에 없는 열린 코멘트는 확인 필요로 표시된다.
- 사용자는 오케스트레이터 방식을 선호한다: 큰 일은 팀원과 서브에이전트에 나누고 결과를 직접 검증한 뒤 보고한다. 선택지가 있는 결정은 AskUserQuestion.
- 보안: Host와 Origin 검사(`app/guard.ts`, 모든 메서드), 입력 크기 제한, 127.0.0.1에만 바인딩, 공개 노출(Funnel, 포트포워딩) 금지.

## 배포 상태

- 주소 `static.vynnlee.com/<덱>`, 덱마다 공개 또는 비밀번호. Worker(`slidekit-static`)와 KV(`DECKS`, id는 `deploy/worker/wrangler.toml`). Cloudflare 토큰은 키체인 `slidekit-cloudflare-token`(값은 출력 금지), `COOKIE_SECRET`은 `wrangler secret`. 배포 순서는 meta 먼저, html 나중(공개에서 비밀번호로 바꿀 때 노출 방지).
- 2026-10-13에 Worker와 워크숍 덱(public)을 배포했다: https://static.vynnlee.com/vibe-coding-workshop . mac-cloud의 로컬 DNS 캐시가 실패를 들고 있어 `curl`이 000일 수 있다. 그때는 `dig +short @1.1.1.1 static.vynnlee.com`의 IP로 `curl --resolve static.vynnlee.com:443:<IP> ...`로 확인한다. 응답 없음을 미배포로 판단하지 않는다.
- **미배포(사용자 승인 대기)**: 2026-10-13 이후의 Worker 변경 전부(안내 페이지, Durable Object 시도 제한 `Limiter`, 쿠키 salt 바인딩, 보호된 덱은 문서 요청에만 서빙, COOP와 HSTS와 CORP, nonce CSP, `lockTitle`, 405와 Origin 검사, 캐시 `must-revalidate`). 비밀번호 덱의 기존 쿠키는 모두 무효가 된다. 실행 순서, 롤백, 구버전과의 차이는 `deploy/README.md`. 배포와 `unpublish --yes`의 실제 실행은 개발 중에 한 번도 하지 않았다(드라이런과 가짜 KV 단위 테스트만).
- 게시 기록(`.publish.json`)의 `url`은 `https://static.vynnlee.com/<name>`만 받는다. 취소 라우트는 기록의 name이 폴더와 다르면 이름 직접 입력(`confirmName`)을 요구한다.

## 알려진 한계

- 번들러 글꼴: 원격 글꼴 CSS와 로컬 `@font-face`를 덱이 쓰는 글자만 남긴 woff2로 인라인한다(`uv`와 인터넷 필요, `~/.cache/slidekit/fonts` 캐시). 시스템 글꼴만 쓰면 아무것도 받지 않는다. `<video>` 파일과 글꼴이 아닌 외부 CDN 자원은 인라인하지 않는다.
- 인쇄(PDF)는 `data-step` 요소를 모두 보인다. 전체 보기 축소판과 필름스트립은 1단계 모습이다. 그라디언트는 PDF에 벡터 셰이딩으로 들어가고 투명도 스톱은 SMask다(`engine-gradient`가 PDF 바이트로 확인).
- production JS는 단일 청크(약 1MB, 2026-10-13 측정). Bun.serve HTML 번들이 코드 분할을 하지 않는다.
- lint는 정규식 기반이라 특이한 마크업에서 오탐이 있을 수 있다. error만 종료 코드에 반영한다.
- 발표 동기화는 같은 출처의 BroadcastChannel 전용. Chrome 계열 전용(Window Management API). mac-cloud에는 화면이 없어 외장 모니터는 검증하지 못한다.
- 편집기는 슬라이드 단위 원문 보존(`app/src/lib/deck-source.ts`)을 전제로 한다. 인라인 편집은 글자만 담은 요소 중심.
- 리모컨은 서버 메모리에만 세션을 두고(재시작하면 사라짐) 명령을 next, prev, goto, blank, timer로 제한한다. **tailnet 안의 기기가 앱 전체 API에 닿을 수 있다는 한계를 넓히지도 좁히지도 않는다.** 휴대폰이 편집 API에 닿지 못하게 하려면 `/remote/*`와 `/api/remote/*`만 허용하는 전용 프록시를 별도 포트에 두는 후속 작업이 필요하다.
- 번들에는 노트(`aside[data-notes]`)가 그대로 남는다. 청중에게 노트가 새는 것을 막으려면 게시 전에 지우는 옵션이 필요하다(후속 후보).
- SVG 업로드 검사(`engine/assets.ts`)는 정규식 금지 목록이라 완전하지 않다. 정적 서빙이 `assets/` 응답에 sandbox CSP와 `nosniff`를 붙이는 것이 두 번째 방어선이다.

## 알려진 위험 (보안 감사 1차 2026-10-14, 2차 2026-10-15)

- 앱 API에는 인증 토큰이 없다. 127.0.0.1 바인딩, Host와 Origin 검사(`app/guard.ts`), 프록시(tailnet)에만 의존하며 사용자 기기만 접근한다는 전제다.
- 덱은 앱과 같은 출처에서 열려 덱 스크립트가 앱 API를 부를 수 있다(출처 분리나 iframe sandbox는 편집기가 contentDocument를 직접 다뤄 보류). 완화: lint가 덱 스크립트의 fetch, XMLHttpRequest, WebSocket, EventSource, `/api/`를 경고하고 SPEC 7절에 신뢰된 콘텐츠 규칙이 있다. 남에게 받은 덱은 열기 전에 스크립트를 읽는다.
- `/deploy`와 게시 취소(Export 메뉴)는 `confirm` 플래그 하나로 동작한다. 공개 범위와 비밀번호는 서버가 덱 원본 `deck-meta`로만 판단하고 읽지 못하면 거부한다.
- 반영 완료: 채널 입력 정제, 번들러 읽기 범위 제한과 외부 글꼴 SSRF 방어, 비밀번호 8자 이상, wrangler와 fonttools 버전 고정(`deploy/deploy.ts`, `bundler/fonts.ts`의 숫자를 올릴 때는 의도적으로 바꾼다), 덱 단위 잠금(저장과 설정과 복원 경합), 리모컨 세션 가로채기 차단과 SSE 티켓, 버전 기록 상한, 정적 응답 `nosniff`.
- 보안 감사 3차(2026-10-15, 2차 이후 추가된 표면만, 읽기 중심): 고친 것 둘. (1) `POST /api/comments/send-all`이 보류를 풀 때 한 번에 처리하는 수를 10개로 제한했다(이전에는 개수만큼 묶음 알림이 연달아 나갈 수 있었다). 남은 것은 그대로 두고 응답의 `remaining`으로 알리며 다시 누르면 다음 묶음이 간다. 서명이 검증된 열린 코멘트만 대상이고 한 덱의 코멘트만 한 알림에 담기며 채널도 알림당 10개로 한 번 더 자른다. (2) 서명 키(`~/.config/slidekit/comments.key`)를 처음 만들 때 프로세스 둘이 동시에 와도 키가 하나만 남게 임시 파일에 쓰고 `link`로 건다(예전에는 나중 쓴 쪽이 이겨 먼저 서명한 코멘트가 Unverified가 될 수 있었고, 읽는 쪽이 쓰다 만 파일을 볼 수도 있었다). 문제없음으로 확인한 것: 이미지 업로드(폴더 이름 검증, 20MB 상한과 본문 크기, 확장자와 매직 바이트, SVG 검사, `assets` 심볼릭 링크 거부, O_EXCL과 O_NOFOLLOW 쓰기, 읽기 전용 덱 거부), 휴지통과 복제와 이름 바꾸기와 삭제(새 이름은 소문자 규칙, 기존 이름은 점으로 시작하는 폴더와 슬래시 제외, 휴지통 항목은 이름과 타임스탬프 형식을 검사, 영구 삭제는 폴더 이름 확인 필요), outline API(덱 폴더 검증 뒤 그 덱의 `index.html`만 읽고 코멘트와 게시 기록과 비밀번호는 담지 않으며 모든 `/api/` 경로의 Host와 Origin 검사를 받는다), 리모컨 SSE 티켓(15초, 1회용, 검증 전에 먼저 폐기, 세션과 덱에 묶임, 세션당 미사용 20개, 해시만 보관). 남은 한계: 앱 API에 인증 토큰이 없는 점은 그대로이고, 휴지통으로 옮긴 덱이 게시 중이면 Cloudflare에는 계속 열려 있다(휴지통 복원 뒤 Published에서 취소한다. 휴지통 화면에서 게시 여부는 알려 주지 않는다).
- 후속 후보: 코멘트 패널 R(답 보기) 단축키, 앱에서 공개 범위 바꾸기, 서명 키 교체와 여러 기기 공유, 버전 기록의 이미지 포함, 설치 때 npm `bun`이 중복으로 깔리는 문제(76MB, `bun-plugin-tailwind`의 peer) 정리, `bun audit` 정기 실행(2026-10-15 기준 0건).

## 사용자 확인이 필요한 것

1. **Worker 배포 승인**: 위 미배포 변경 전부. 실행 순서는 `deploy/README.md`.
실기기 확인은 한 장짜리 [docs/DEVICE-CHECKLIST.md](docs/DEVICE-CHECKLIST.md)에 방법, 기대, 실패 시 알려 줄 정보와 함께 모아 두었다(자동 검증된 것은 빼고 사람이 봐야 할 것만).

2. **실기기 iPhone 리모컨**: Safari에서 QR 스캔, 화면 잠금 뒤 재연결, Wake Lock, 지연 체감(두 컨텍스트 e2e와 QR 디코드는 통과).
3. **mac-local 첫 실행**: 새 clone에서 `bun install`, `bun run slidekit doctor`, 한글 IME 편집, Cmd 단축키, 드래그 체감, 외장 모니터 발표(권한 팝업, 창 배치, 두 창 동기화). 시스템 Chrome 경로의 PDF는 headless shell로만 검증했다.
4. **맥 미리보기에서 그라디언트 PDF가 검게 보임**: macOS 미리보기와 Quick Look(CoreGraphics)이 Chrome의 PDF 셰이딩을 검게 그린다. PDF 자체는 정상(셰이딩과 SMask가 들어 있음)이고 Chrome이나 Acrobat에서는 맞게 보이는 것으로 추정하며, 사용자의 Chrome에서 한 번 확인해 달라.
5. 비밀번호 덱의 실제 배포 뒤 접근과 시도 제한(5회 뒤 429와 `Retry-After`).

## 환경 메모

- 경로 `~/Developer/slidekit`(mac-local과 mac-cloud 동일). 기계 지침은 `~/.claude/CLAUDE.md`. 점검은 `bun app/server.ts doctor`.
