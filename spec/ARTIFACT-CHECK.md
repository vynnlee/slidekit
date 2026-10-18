# 발행 호환 검사 (M2b): `slidekit doctor <덱> --artifact`

2026-10-18 설계. 구현 전 문서다. 목적은 덱이 **단일 HTML 파일 하나로 올려도 그대로 동작하는지**를 올리기 전에 알려 주는 것이다(Claude Artifacts의 "올릴 수 있는 형식인가" 검사를 본뜸). 덱과 엔진은 바닐라 그대로이고 새 의존성은 없다. 이 검사는 안내용(best effort)이다. 실제 차단은 M2a의 Worker CSP가 한다.

## 1. 결과 모양

```
$ slidekit doctor my-talk --artifact
덱 my-talk: "제목", 12장, 공개

OK   번들     단일 파일로 묶을 수 있다(로컬 파일 9개, 모두 덱 폴더 안)
OK   외부자원  허용 호스트 밖의 외부 자원 없음
OK   크기     예상 3.4 MiB (한도 16 MiB)
FAIL 저장소    localStorage 사용: 슬라이드 4 스크립트
FAIL 네트워크  fetch 사용: 슬라이드 7 스크립트

Artifact로 올릴 수 없음: localStorage를 쓴다(슬라이드 4), fetch를 부른다(슬라이드 7)
```

- 줄은 `OK`, `WARN`, `FAIL`로 시작한다. `FAIL`이 하나라도 있으면 요약은 "올릴 수 없음"과 이유 목록이고 종료 코드는 1이다. 모두 OK나 WARN이면 "Artifact로 올릴 수 있음"이고 종료 코드 0이다.
- `--json`은 같은 결과를 `{ ok, checks: [{ id, level, msg, items }], estimatedBytes }`로 낸다(앱의 게시 전 화면이 쓴다).
- `slidekit lint <덱> --artifact`는 같은 검사를 lint 규칙(`artifact-*`, 모두 error)으로 내고, 평소 `lint`에는 들어가지 않는다(덱이 localStorage를 쓰는 것이 일반 발표에서는 문제가 아니므로).
- 순수 함수 `artifactCheck(dir, opts)`는 `engine/artifact-check.ts`에 둔다(node 전용, `deck-check.ts`처럼 doctor와 앱이 같이 쓴다).

## 2. 검사 항목과 방식

기본은 **정적 검사**다(원본 `index.html`, 덱 폴더의 로컬 CSS, 스크립트를 읽음. 빠르고 오프라인이며 같은 입력이면 같은 결과). `--build`를 주면 실제로 `bundler/bundle.ts`를 돌려 만든 `dist/<덱>.html`로 크기와 "묶을 수 있음"을 확정한다(uv와 인터넷이 필요할 수 있다).

| id | 검사 | 실패(FAIL) 조건 |
|---|---|---|
| bundle | 단일 파일로 묶을 수 있다 | 로컬 참조(`src`, `href`, `srcset`, `poster`, CSS `url()`)가 없는 파일이거나 덱 폴더와 `engine/` 밖을 가리킴, 심볼릭 링크 탈출, 번들러가 거부하는 경로(`.git`, `.env*`, `comments.json`, `node_modules`). `--build`는 번들러의 종료 코드로 판정 |
| hosts | 허용 호스트 밖 외부 자원 없음 | 아래 3절의 자원 속성이 `http(s)://`이거나 `//`로 시작하는데 허용 목록 밖. 허용 목록은 번들러가 인라인하는 글꼴 CSS의 호스트(`fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.jsdelivr.net`)이고 `<link rel=stylesheet|preload>`와 `@import`, `@font-face`의 `url()`에만 적용한다. `--allow-host a.com,b.com`으로 늘린다 |
| size | 렌더 크기 16 MiB 이하 | 예상 크기 > 16 MiB (WARN: 12 MiB 이상). 예상 = `index.html` + 엔진 CSS와 JS + 이미지 바이트 × 4/3(base64) + 글꼴 서브셋 추정(`@font-face`나 글꼴 `link`가 있으면 0.4 MiB씩 최대 2 MiB). 새 번들이 소스보다 나중이면 실제 번들 크기를 쓴다 |
| storage | `localStorage`, `sessionStorage`, `indexedDB`, `openDatabase`, `document.cookie`, `caches` 사용 없음 | 덱 스크립트(`<script>` 본문, 로컬 `.js`, `on*=` 속성)에 식별자가 나타남 |
| network | 외부로 나가는 요청 없음 | `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`, 동적 `import(` 사용. 단일 파일에는 옆 파일이 없으므로 상대 경로 `fetch`도 실패로 본다 |

- 엔진(`slidekit.js`)과 `application/json` 스크립트는 검사 대상에서 뺀다. 대신 엔진 파일 자체가 storage와 network 식별자를 쓰지 않음을 단위 시험이 보증한다.
- 문자열 안이나 주석의 식별자 때문에 오탐이 날 수 있다. 줄 번호와 발췌를 보여 사람이 판단하게 한다(경고가 아니라 FAIL이지만 `--allow-api fetch`처럼 끄는 옵션은 두지 않는다. 필요하면 코드를 고치는 것이 맞다).
- 난독화로 우회한 호출(`window["fe"+"tch"]`)은 못 잡는다. 이 검사는 실수를 잡는 것이고, 막는 것은 CSP다.

## 3. 외부 자원으로 보는 속성

`img/script/link/iframe/embed/object/source/video/audio/track/input[src]`의 `src`, `link/image/use`의 `href`(`a`의 `href`는 이동일 뿐이라 제외), `srcset`, `poster`, `object`의 `data`, `form`의 `action`, `meta http-equiv=refresh`의 URL, CSS의 `url(...)`와 `@import`, SVG `xlink:href`. `xmlns="http://www.w3.org/2000/svg"`는 자원이 아니므로 제외한다. `data:`, `blob:`, `#`, `mailto:`, `about:`는 통과.

## 4. 합격 기준

1. **실덱**: 커밋된 안내 덱과 워크숍 덱(HEAD)은 정적 검사를 통과하거나(WARN 허용) FAIL 이유가 설명된다. 둘 다 localStorage, fetch가 없고 외부 자원은 글꼴 호스트뿐이다.
2. **정밀도**: 항목별로 어긴 최소 샘플은 FAIL, 정상 샘플은 OK. `a href`, `xmlns`, `data:` 이미지, 주석과 문자열 안의 식별자(발췌 표시)에서 오탐 판단이 문서와 같다.
3. **종료 코드와 출력**: FAIL이 있으면 1과 이유 요약, 없으면 0. `--json`이 같은 판정을 낸다.
4. **엔진 청정**: `engine/slidekit.js`, `slidekit.css`, `template/shell.html`에 storage와 network 식별자와 외부 URL이 없다(단위 시험).
5. **성능**: 12 MiB 이미지 덱에서도 정적 검사가 0.5초 안에 끝난다(파일 크기는 `stat`으로, 이미지 내용은 읽지 않는다).
6. **`--build`**: 외부 글꼴 없는 고정 덱으로 실제 번들을 만들어 예상 크기와 실제 크기의 차이를 INFO로 내고 판정이 같다.
7. **CSP 아래 동작**(M2 합격 기준의 브라우저 시험): 번들한 덱을 엄격 CSP 헤더(`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'`)로 HTTP 제공해 열고 `securitypolicyviolation` 0건, 방향키 이동, 단계 등장, 발표자 창 열기까지 정상이다. 정확한 CSP 문자열은 M2a(app-dev)의 값과 맞춘다(열린 질문 1).

## 5. 시험 계획

- `engine/test/artifact-check.test.ts`(단위): 항목별 정상/어긴 샘플 표(`artifact-check.cases.json`), 오탐 샘플, 허용 호스트 옵션, `--json` 모양, 엔진 청정, 실덱 둘(HEAD에서 읽음).
- `engine/test/cli.test.ts` 확장: `doctor <덱> --artifact` 출력과 종료 코드, `lint --artifact`, 인자 오류.
- 러너 단계 `engine-artifact`(브라우저, 느리지 않음 약 20초): 4절 7번 CSP 시험과 `--build` 실제 번들 비교. 잠금 안에서 한 번에 하나.
- 변경 매핑: `engine/artifact-check.ts`, `engine/test/artifact*`는 `unit-other`, `typecheck`, `engine-artifact`.

## 6. 열린 질문

1. M2a의 CSP 정확한 값(`script-src`가 `'unsafe-inline'`뿐인지, 해시/nonce를 쓰는지). 해시를 쓰면 번들 단계가 인라인 스크립트 해시를 내야 하고 이 검사에 `eval`, `new Function` 금지 항목이 추가된다.
2. `<a href="https://...">` 외부 링크는 이동일 뿐이라 통과시켰다. 발표 중 클릭으로 외부로 나가는 것을 막고 싶으면 WARN으로 올릴 수 있다.
3. 허용 호스트 목록을 `deploy/` 설정과 공유할지(M2a가 같은 목록으로 CSP `font-src`를 만들 수 있다).
