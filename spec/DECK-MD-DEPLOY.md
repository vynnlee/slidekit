# deck.md 배포와 에이전트 이어서 작업 (M3b)

M3a(`spec/DECK-MD.md`, engine-dev)가 `dist/<덱>.md`를 만든다(노트 없음). 이 문서는 그 파일을 **배포**하고, 덱 `<head>`에 alternate 링크를 넣고, 앱의 배포 완료 화면에 **Copy agent prompt**를 두는 일이다(Claude Artifacts의 Remix와 `.md` 콘텐츠 제공을 본뜸). 덱과 엔진은 바닐라 그대로이고 새 의존성은 없다. **Worker 실제 배포와 `unpublish`는 사용자 승인 뒤**(코드, 단위 시험, 로컬 리허설까지).

## 1. 주소와 저장

- 덱은 `https://your-domain.example/<덱>`이다. `deck.md`는 **`/<덱>/deck.md`** 에 둔다. 이유: 비밀번호 쿠키가 `Path=/<덱>`이라 `/<덱>.md`에는 쿠키가 가지 않는다(경로 일치 규칙은 다음 글자가 `/`여야 한다). `/<덱>/deck.md`는 같은 쿠키가 가서 같은 관문을 지난다.
- KV 키 `md:<덱>`에 마크다운 본문을 저장한다(`html:<덱>`, `meta:<덱>` 옆). 올리는 순서는 meta, md, html이다(html이 마지막이라 alternate 링크가 있는 덱이 열릴 때 md는 이미 있다. 공개에서 비밀번호로 바꿀 때 노출 방지 순서도 그대로).
- 게시 취소(`unpublish`)는 `md:<덱>`도 지운다(meta, html, md 순. 먼저 meta를 지우는 기존 규칙 유지). 키 이름은 지울 목록에 나온다.

## 2. Worker 라우트 `/<덱>/deck.md`

- `GET`/`HEAD`만(그 밖은 405). 덱 이름은 기존 규칙(`[\w-]+`)이고 `deck.md` 이외의 하위 경로는 404다.
- meta가 없거나 `md:<덱>`이 없으면 404(옛 게시본은 deck.md가 없다).
- **공개 덱**: 200, `Content-Type: text/markdown; charset=utf-8`, `Cache-Control: public, max-age=0, must-revalidate`, 기존 보안 헤더(`nosniff`, `Referrer-Policy`, HSTS, COOP, CORP), `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline`.
- **`Sec-Fetch-Dest` 검사는 비밀번호 덱에만 걸린다.** 공개 덱의 `deck.md`는 에이전트가 `curl`로 받아 가야 하므로 요청 종류와 상관없이 읽힌다. 비밀번호 덱은 URL만 복사하고, 로그인한 브라우저 컨텍스트에서 주소창으로 열 때(`Dest: document`)만 읽힌다. `curl`처럼 헤더가 없는 요청은 유효한 쿠키만 보고(쿠키가 없으면 403), 헤더가 있는데 `document`가 아니면 쿠키가 있어도 403이다.
- **비밀번호 덱**: 덱 HTML과 **같은 관문**이다. 유효한 쿠키(`validCookie`)가 없으면 **403**(본문 없는 안내 한 줄: "이 덱은 비밀번호가 필요합니다. 먼저 덱 주소를 열어 비밀번호를 입력하세요."). 로그인 폼은 주지 않는다(에이전트의 `curl`에 HTML 폼을 돌려주지 않는다). 쿠키가 있어도 `Sec-Fetch-Dest`가 있고 `document`가 아니면 403이다(같은 출처의 다른 덱 스크립트가 `fetch`로 읽는 것을 막는 덱 HTML 규칙과 같다). 통과하면 공개 덱과 같은 응답에 `Cache-Control: private, no-store`.
- `POST`는 받지 않는다(405). 로그인 시도 제한 대상이 아니다(쿠키 검증만).

## 3. 배포 (`deploy.ts`)

1. `dist/<덱>.md`를 읽는다. 없으면 같은 번들 HTML에서 `deckMarkdown(html)`(노트 없음)로 만든다. 둘 다 안 되면 deck.md 없이 올리고 경고한다(deck.md는 선택 기능이다).
2. **노트 누출 검사(방어를 한 겹 더)**: 번들 HTML의 `aside[data-notes]` 글(8자 이상)이 `.md`에 한 줄이라도 들어 있으면 올리지 않고 중단한다. M3a의 보장이 깨졌을 때를 위한 안전장치다.
3. alternate 링크는 **올리는 HTML에만** 넣는다: `<link rel="alternate" type="text/markdown" href="/<덱>/deck.md">`를 `</head>` 앞에 끼운다(이미 있으면 그대로). 로컬 `dist/<덱>.html`(내려받아 공유하는 번들)과 원본 덱은 바꾸지 않는다. 번들러의 `--alternate <href>` 옵션은 쓰지 않는다: 옵션을 번들 단계에 넣으면 내려받은 번들에도 존재하지 않는 사이트를 가리키는 링크가 들어간다. (번들러 쪽 옵션은 그대로 두고, 덱을 다른 곳에 올릴 사람이 쓸 수 있다.) 결정 1.
4. 순서: meta, md, html. md는 `kv put md:<덱>`이고 크기는 2MiB까지(넘으면 deck.md 없이 올리고 경고). 알려진 한계: 이후 배포에서 deck.md를 못 만들면 이전 배포의 `md:`가 남는다(드문 경우이고 다음 정상 배포가 덮는다).
5. 드라이런은 deck.md 크기와 노트 검사 결과를 출력한다(앱이 읽는 줄 접두는 기존 그대로).

## 4. 앱: 배포 완료 화면의 Copy agent prompt

(구현: `app/src/lib/agent-prompt.ts`, `ExportMenu.tsx`. 게시된 주소 형식이 아니면 복사하지 않는다.)

- 배포가 끝난 화면(`data-testid="publish-done"`)과 `Published...` 대화상자에 **Copy agent prompt** 단추를 둔다(Copy link 옆). 문구는 영어, 순수 함수 `agentPrompt(url, visibility)`(`app/src/lib/agent-prompt.ts`)가 만든다.
- 공개 덱:
  ```
  Read this slide deck and help me continue it.
  Deck: <url>
  Markdown (all slide text, no speaker notes): curl -s <url>/deck.md
  ```
- 비밀번호 덱: **URL만**, 비밀번호와 `curl`은 넣지 않는다.
  ```
  This deck is password protected: <url>
  Ask me for its contents.
  ```
- 복사는 기존 Copy link와 같은 방식(`navigator.clipboard`, 실패하면 토스트)이다. URL은 서버가 준 게시 기록의 URL만 쓴다(`https://your-domain.example/<이름>` 검증은 기존 게시 기록 규칙).

## 5. 합격 기준

1. 공개 덱: `GET /<덱>/deck.md`가 200, `text/markdown`, 위 헤더. `HEAD`도 된다. `md`가 없으면 404. 하위 경로와 `POST`는 404와 405.
2. 비밀번호 덱: 쿠키 없이 `deck.md`를 요청하면 403이고 본문에 덱 글자가 없다. 로그인(쿠키) 뒤에는 200 `private, no-store`. `Sec-Fetch-Dest: empty`면 쿠키가 있어도 403. 쿠키가 다른 덱의 것이면 403.
3. 노트가 든 덱의 `.md`와 KV `md:`에 노트 문구가 없다(배포 시험이 확인). 노트가 `.md`에 들어 있는 입력은 `deploy`가 중단한다.
4. 올리는 HTML에만 alternate 링크가 있고 `dist/<덱>.html`은 바이트가 같다. 링크가 이미 있으면 중복하지 않는다.
5. `unpublish`가 `md:<덱>`도 지운다(가짜 KV 시험).
6. 앱: 공개는 `curl` 한 줄이 든 프롬프트, 비밀번호 덱은 URL만(비밀번호 문자열이 어디에도 없음). 단추는 키보드로 닿고 이름이 있다(axe).
7. 기존 Worker 시험(로그인 제한, Origin 검사, 문서 요청만 서빙, CSP)이 그대로 통과한다.

## 6. 시험 계획

- 단위(`bun test`): Worker 라우트(합격 1, 2, 5), `withAlternate`/노트 검사 함수(3, 4), `agentPrompt`(6), `unpublish-core`(5).
- 배포 드라이런 e2e(`export-api`): 노트 문구가 든 덱으로 `deck.md` 줄과 노트 비포함 출력을 확인.
- 브라우저: `export` 화면 시험에 Copy agent prompt 단추와 클립보드 내용(공개, 비밀번호)과 axe. 로컬 Worker(`csp-serve`)로 `deck.md` 응답 헤더 한 번 확인.
- 배포 뒤(승인 필요): `deploy --smoke`에 `deck.md` 검사 추가(공개 덱 200 `text/markdown`, 비밀번호 덱 403).

## 7. 구현 순서

1. Worker 라우트와 단위 시험. 2. `deploy.ts`(md 읽기, 노트 검사, alternate 삽입, 올리기), `unpublish`. 3. `agentPrompt`와 UI, 시험. 4. README와 HANDOFF.

## 8. 결정이 필요한 것

1. alternate 링크를 번들러 옵션이 아니라 **올리는 HTML에만** 배포 때 끼운다(추천). 번들러 `--alternate`로 하면 로컬에서 내려받은 번들에도 링크가 들어간다.
2. 비밀번호 덱의 `deck.md`를 에이전트가 읽으려면 사용자가 내용을 전달해야 한다(프롬프트에 비밀번호를 넣지 않는 원칙). 쿠키 대신 읽기 전용 토큰 URL 같은 방식은 이번 범위에서 제외한다.
3. 옛 게시본(`md:`가 없는 덱)의 프롬프트: 앱은 게시 기록에 md가 있었는지 모르므로 공개 덱은 항상 `curl` 줄을 보인다. 없으면 404이므로 다시 배포하면 생긴다(안내 문구는 넣지 않는다).
