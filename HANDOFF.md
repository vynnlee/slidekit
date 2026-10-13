# slidekit 핸드오프 (2026-10-13 갱신)

새 세션은 이 문서를 먼저 읽는다. 기획은 `PLAN.md`, 덱 규격은 `spec/SPEC.md`(9절은 편집), 속성 패널 설계는 `spec/INSPECTOR.md`, 사용법은 `README.md`.

## 목적

HTML 슬라이드를 만들고, 편집하고, 발표하고, 배포하는 로컬 도구. 덱은 폴더 하나(`decks/<이름>/index.html`)이고, 엔진이 1920x1080 맞춤, 방향키 이동, F 전체화면, O 전체 보기, 발표 동기화를 맡는다. 앱은 덱 목록, 발표자 화면, 편집기, 코멘트 UI를 준다. 첫 예제는 워크숍 덱(53장, `decks/vibe-coding-workshop`).

## 구성

| 경로 | 내용 |
|---|---|
| `engine/` | `slidekit.js`, `slidekit.css`(인쇄 CSS 포함), `new.ts`, `lint.ts`, `pdf.ts`, `doctor.ts`, `template/`, `test/verify.cjs`, `test/lint.test.ts` |
| `app/` | Bun 서버(`server.ts`, `guard.ts`, `comments.ts`, `editor-api.ts`, `decks-api.ts`, `preview-proxy.ts`), React 앱(`src/`), 테스트(`test/`) |
| `bundler/` | 덱을 외부 파일 없는 단일 HTML로 묶음(이미지, srcset, 글꼴 서브셋 인라인) |
| `deploy/` | `deploy.ts`와 Cloudflare Worker(`worker/`, KV, 비밀번호 쿠키) |
| `channel/` | Claude Code Channels MCP 서버(코멘트 전달) |
| `scripts/test.ts` | `bun run test` 집계 |
| `.claude/skills/slidekit/` | AI가 덱을 만들 때 읽는 스킬(규격, 토큰, 문구 규칙, 확인 방법) |
| `spec/` | SPEC.md, INSPECTOR.md |
| `decks/`, `dist/` | 덱 원본, 번들과 PDF 산출물(dist는 git 무시, `decks/_*/`도 무시) |

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

## 알려진 한계

- 번들러: 글꼴 서브셋은 `uv`와 Google Fonts 원본 다운로드(또는 `~/.cache/slidekit/fonts`)가 필요. `<video>` 파일, 외부 CDN 자원은 인라인하지 않는다.
- lint는 정규식 기반이라 아주 특이한 마크업에서 오탐이 있을 수 있다. error만 종료 코드에 반영한다.
- 발표 동기화는 같은 출처의 BroadcastChannel 전용(기기 간 동기화 없음). 인쇄 PDF의 stepper 슬라이드는 1단계 모습.
- 편집기는 슬라이드 단위 원문 보존(`app/src/lib/deck-source.ts`)을 전제로 한다. 인라인 편집은 글자만 담은 요소 중심.
- Chrome 계열 전용(Window Management API). mac-cloud에는 화면이 없어 외장 모니터 기능은 검증하지 못한다.

## mac-local에서 사용자가 직접 확인할 것

1. 외장 모니터 발표 시작: 권한 팝업, 창 배치, 전체화면(F), 두 창 동기화.
2. 한글 IME로 편집기에서 텍스트 입력(조합 중 단축키 충돌, 저장 결과).
3. Cmd 단축키(저장, 되돌리기, 복제), 드래그와 스크럽 체감, 패널 폭 조절.
4. 비밀번호 덱의 실제 배포 후 접근과 시도 제한.
5. 확인 완료: 코멘트 채널의 실제 Claude 세션 연결.

## 환경 메모

- 경로 `~/Developer/slidekit`(mac-local과 mac-cloud 동일). 상세한 기계 지침은 `~/.claude/CLAUDE.md`.
- 점검은 `bun app/server.ts doctor`.
