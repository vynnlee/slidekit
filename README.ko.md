# slidekit

HTML 파일 하나가 곧 슬라이드 덱이다. 로컬 편집기에서 눈으로 고치고, 브라우저에서 발표자 화면과 함께 발표하고, 코멘트를 남기면 코딩 에이전트가 덱을 고친다.

[English](README.md) | [덱 규격](spec/SPEC.md) | [변경 기록](docs/CHANGELOG.md) | [기여하기](CONTRIBUTING.md) | [MIT 라이선스](LICENSE)

> **베타(v0.1.0-beta), 공개하면서 만드는 중이다.** 동작하고 매주 쓰고 있지만 거친 부분과 바뀌는 동작이 있고 macOS를 먼저 지원한다. [알려진 한계](#알려진-한계)를 먼저 읽어 보자.

<!-- TODO: docs/media/editor.png(코멘트 패널이 보이는 편집기)와 docs/media/present.gif(발표자 화면)를 넣는다. 이름 규칙은 docs/media/README.md. -->

## 무엇인가

- **덱은 HTML 파일 하나다.** `decks/<이름>/index.html`이 원본 전부다. 빌드 단계도 전용 포맷도 없고 diff가 그대로 읽힌다.
- **아주 작은 바닐라 엔진.** `engine/slidekit.js`와 `engine/slidekit.css`가 이동, 화면 맞춤, 전체화면, 전체 보기, 단계 등장, 청중 화면 동기화를 맡는다. 슬라이드 모델에는 프레임워크도 의존성도 없다. 덱은 HTML, CSS, 약간의 JavaScript다.
- **로컬 편집기**: Figma식 계층 선택, Layers, 필름스트립, Inspector, 덱 토큰, 찾아 바꾸기, 버전 기록. 같은 HTML 파일에 그대로 저장한다.
- **발표 모드**: 발표자 노트, 타이머, 다음 슬라이드, 청중 창, 선택 사항인 휴대폰 리모컨.
- **에이전트가 처리하는 코멘트.** 슬라이드의 요소나 영역에 코멘트를 남기면 실행 중인 [Claude Code](https://claude.com/claude-code) 세션이 MCP 채널로 받아 덱을 고치고 답한다. 에이전트의 수정은 한 번에 되돌릴 수 있다.

### 철학

슬라이드 모델은 의존성 없는 바닐라 HTML, CSS, JS로 둔다. 어떤 도구가 사라져도 덱은 계속 열린다. 편집기 앱(`app/`)은 별개이고 자체 의존성(React, Radix, Tailwind)을 쓴다. 덱을 열고 발표하는 데 편집기는 필요 없다. 엔진은 레이아웃 프리셋을 제공하지 않는다. 클래스는 덱의 `<style>`에 직접 쓰고 규격은 HTML 구조만 정한다.

## 빠른 시작

요구 사항: **macOS**와 **[Bun](https://bun.sh) 1.2.3 이상**(Bun 1.4.2에서 개발하고 검증했다). 선택 사항은 [요구 사항](#요구-사항) 참고.

```sh
git clone https://github.com/vynnlee/slidekit.git
cd slidekit
bun install
bun run slidekit new my-talk      # 템플릿에서 decks/my-talk/ 를 만든다
bun run slidekit                  # 앱을 연다: http://127.0.0.1:3200
```

덱 목록에서 `my-talk`를 눌러 편집한다. 글자는 더블클릭으로 고치고 입력이 1.5초 멈추면 자동 저장된다(Cmd+S도 된다). 발표는 Cmd+Enter(현재 슬라이드부터) 또는 Shift+Cmd+Enter(처음부터)다. 방향키로 넘기고 F는 전체화면, O는 전체 보기, B와 W는 검은 화면과 흰 화면이다.

짧은 샘플 덱 `decks/demo`(영어 8장)가 단계 등장, 노트, 편집기가 도는 방식을 보여 준다. 덱 목록에서 먼저 열어 보자.

## 기능

**편집기**
- 계층 선택(클릭, 더블클릭으로 안쪽, Cmd+클릭으로 가장 안쪽), Layers, 필름스트립, 줌과 팬, 스마트 가이드, 다중 선택, 그룹과 해제
- 글자, 색, 그라디언트, 간격, 단계 애니메이션을 고치는 Inspector, 덱 토큰과 테마 6종
- 덱 전체 찾아 바꾸기, 명령 팔레트(Cmd+K), 이미지 붙여넣기와 끌어 놓기, 우클릭 메뉴
- 자동 저장, 디스크의 파일이 바뀌었을 때의 충돌 감지, 복원이 되는 버전 기록, 실행 취소

**발표**
- 노트(Markdown), 타이머와 목표 시간, 장 위치, 리허설 요약이 있는 발표자 화면
- 크로스페이드, 전체 보기, 검은 화면과 흰 화면이 있는 청중 창
- QR 코드와 1회용 코드로 연결하는 휴대폰 리모컨(휴대폰이 닿는 주소가 필요하다)

**코멘트와 에이전트**
- 요소, 슬라이드, 끌어 지정한 영역에 코멘트(Shift+C로 코멘트 모드). 영역 코멘트에는 그 영역의 그림이 함께 간다
- Claude Code 채널(`channel/`, 연구 프리뷰 기능)이 코멘트를 전달하고, 에이전트가 update 방식 도구(`slidekit_edit`)로 덱을 고쳐 앱에 답한다
- 존재 표시: 에이전트가 일하는 동안 무엇을 바꾸는지 편집기가 보여 준다
- 코멘트 상태(Saved, Sent, Working, Replied, Resolved), Send all, 시간당 상한과 자동 처리 Pause, 서명된 코멘트(남에게 받은 덱의 코멘트는 Trust 전에는 에이전트에 가지 않는다)

**명령줄**
- `lint`, `doctor`(레이아웃 넘침 점검 포함), `bundle`(오프라인 HTML 한 파일), `pdf`(슬라이드, 노트, 유인물), `outline`(Markdown), `image`, `new`, `templates`

## 명령

```sh
bun run slidekit                         # 앱 시작 127.0.0.1:3200 (PORT=...로 변경)
bun run slidekit help                    # 명령 목록
bun run slidekit new <이름> [--template talk|blank|workshop]
bun run slidekit templates               # 템플릿 목록
bun run slidekit lint <덱>               # 규격 위반 점검
bun run slidekit doctor [<덱>] [--layout]   # 환경과 덱 점검 (--layout은 넘침과 잘림까지)
bun run slidekit image <덱> <파일> [--max 2400]   # 이미지를 덱의 assets/에 안전하게 저장
bun run slidekit outline <덱> [--notes]  # Markdown 개요 출력
bun run slidekit bundle <덱>             # dist/<덱>.html 한 파일
bun run slidekit pdf <덱> [--notes | --handout [2|3|4|6]]   # dist/<덱>.pdf
bun run test                             # 전체 검증(느리다, CONTRIBUTING.md 참고)
bun run test:changed                     # 바뀐 파일에 연결된 단계만
```

발표 전에는 `doctor <덱> --layout`이 경고 없이 끝날 때까지 고치고, `bundle <덱>` 결과를 오프라인에서 한 번 열어 보고, `pdf <덱> --notes` 백업을 둔다. 실기기 확인 항목은 `docs/DEVICE-CHECKLIST.md`.

## 코딩 에이전트와 쓰기

저장소에 스킬 `.claude/skills/slidekit/SKILL.md`가 들어 있다. 덱 규칙(구조, 토큰, 단계, 노트, 문구, 확인 방법)을 에이전트에게 가르치는 문서다. 에이전트가 이 파일을 읽게 하거나 이 저장소에서 Claude Code를 쓰면 된다.

코멘트를 쓰려면 앱을 켠 뒤 다른 터미널에서 채널과 함께 Claude Code를 켠다.

```sh
(cd channel && bun install)
claude --dangerously-load-development-channels server:slidekit
```

연결되면 편집기에 "Claude connected"가 보인다. 자세한 설정, 도구 목록, 보안 모델은 [`channel/README.md`](channel/README.md). 채널은 Claude Code의 연구 프리뷰라 바뀔 수 있다.

## 요구 사항

- **macOS**와 **Bun 1.2.3 이상**. `bun install`이 앱 의존성을 받는다. 코멘트 채널은 별도 패키지라 쓰거나 전체 테스트를 돌릴 때 `channel/`에서 `bun install`을 한 번 한다.
- **Chrome**(선택): `slidekit pdf`, `doctor --layout`, 영역 코멘트 그림, 브라우저 테스트에 필요하다. Playwright의 chromium headless shell을 먼저 찾고, 없으면 설치된 Google Chrome, Chromium, Edge를 쓴다. 직접 정하려면 `SLIDEKIT_CHROME`에 실행 파일 경로를 준다.
- **uv**(선택): 외부 웹 글꼴을 쓰는 덱을 `bundle`할 때만 필요하다(글꼴 부분집합을 만든다. 첫 번들은 인터넷이 필요하고 결과는 `~/.cache/slidekit`에 캐시된다). 글꼴 링크가 없는 덱은 필요 없다.
- **git**(선택): 새 덱의 `author`를 `git config user.name`으로 채운다.
- `bun run slidekit doctor`가 환경을 점검하고 없는 것을 알려 준다.

## 폴더 구조

```
app/        편집기 앱과 로컬 서버(React, Bun.serve), 코멘트와 버전 API
engine/     바닐라 슬라이드 엔진(slidekit.js, slidekit.css)과 CLI 도구(lint, doctor, pdf, outline)
bundler/    단일 파일 번들러(엔진, 이미지, 글꼴 부분집합을 내장)
channel/    코멘트를 Claude Code 세션에 잇는 MCP 채널
decks/      내 덱, 폴더 하나에 덱 하나(decks/<이름>/index.html)
spec/       덱 규격(SPEC.md)과 설계 노트
docs/       변경 기록, 실기기 체크리스트, 미디어
scripts/    테스트 러너와 도우미
.claude/    Claude Code용 slidekit 스킬과 프로젝트 설정
```

## 보안 안내

slidekit은 로컬 도구다. 서버는 `127.0.0.1`에만 바인딩한다. `0.0.0.0`에 열거나 인터넷에 노출하지 말자. 변경 API는 `Host`와 `Origin`을 검사하고 JSON만 받는다. 코멘트 본문, 요소 발췌문, 이미지는 에이전트에게 데이터로만 가고 지시로 취급되지 않는다. 취약점 신고는 [SECURITY.md](SECURITY.md).

## 알려진 한계

베타라서 만날 수 있는 것들:

- **macOS 우선.** 이미지 축소는 `sips`, 일부 점검은 macOS 키체인을 쓰고 모든 개발과 검증이 macOS에서 이뤄졌다. Linux와 Windows는 검증하지 않았다.
- **게시(배포)는 v0.1에 없다.** HTML 한 파일이나 PDF로 내보내 직접 올린다. 게시 기능은 나중에 돌아올 수 있다.
- **브라우저 테스트는 무겁고 일부는 불안정하다.** 전체 테스트는 오래 걸리고 노트북 CPU를 많이 쓴다. 단계 하나만 `bun scripts/test.ts --only <단계>`로 돌린다. [CONTRIBUTING.md](CONTRIBUTING.md) 참고.
- **PDF의 시스템 Chrome 경로는** Playwright headless shell보다 덜 검증됐다.
- **코멘트 채널은 연구 프리뷰**라 Claude Code 쪽 플래그와 동작이 바뀔 수 있다.
- 베타끼리 덱 동작과 편집기 화면이 바뀐다. 아끼는 덱은 백업하자(덱은 그냥 파일이라 git이 잘 맞는다).

## 로드맵

<!-- TODO: 첫 릴리스 전에 공개 로드맵이나 GitHub 마일스톤 링크를 넣는다. -->
준비 중이다. 아이디어는 이슈로 알려 주면 된다.

## 기여

이슈와 풀 리퀘스트를 환영한다. 먼저 [CONTRIBUTING.md](CONTRIBUTING.md), 특히 테스트와 의존성에 관한 부분을 읽어 보자.

## 라이선스

[MIT](LICENSE) © 2026 Seongbeen Lee
