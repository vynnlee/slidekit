# slidekit

HTML 슬라이드를 만들고, 편집하고, 발표하고, 배포하는 로컬 도구. 설계는 `PLAN.md`, 덱 규격은 `spec/SPEC.md`, 진행 현황은 `HANDOFF.md`.

## 설치와 실행
- `bun install` 후 `bun run slidekit`. 앱은 http://127.0.0.1:3200 에만 열린다(`PORT`로 바꿈).
- 덱 목록에서 덱을 고르면 발표자 화면(`/present/<덱>`)과 편집기(`/edit/<덱>`)로 간다.

## 편집과 발표
- 편집기: 레이어, 캔버스 직접 편집, 속성 패널, 슬라이드 순서와 복제와 삭제, 저장. 저장하면 `decks/<덱>/index.html`이 바뀐다.
- 발표: 방향키로만 넘기고 F가 전체화면이다. 발표자 화면의 항목(노트, 타이머 등)은 각각 켜고 끈다. 외장 모니터로 시작할 수 있다.

## 명령
- `bun run slidekit new <이름>`: `decks/<이름>/`을 템플릿에서 만든다.
- `bun run slidekit bundle <덱>`: 엔진, 이미지, 글꼴 서브셋을 담은 `dist/<덱>.html` 하나로 묶는다.
- `bun run slidekit deploy <덱>`: Cloudflare로 올려 static.vynnlee.com/<덱>으로 연다. 준비는 `deploy/README.md`.
- `bun run test`: 전체 검증(왕복, 워커, 채널, 엔진, 편집기). `/tmp/slidekit-heavy.lock`을 잡고 돈다.

## 코멘트 채널
앱에서 요소를 골라 코멘트를 쓰면 열린 Claude Code 세션이 받아 덱을 고치고 답한다.
- 저장소 루트에서 `claude --dangerously-load-development-channels server:slidekit` (연구 프리뷰). 자세한 설정은 `channel/README.md`.
- 코멘트는 `decks/<덱>/comments.json`에 쌓이고, 놓친 것은 `get_pending` 도구로 가져온다.
- 변경 API는 Host와 Origin을 검사하고 JSON만 받는다(`app/guard.ts`).

## 개발 서버 미리보기
`UP=<앱 포트> PORT=<프록시 포트> bun app/preview-proxy.ts`. Host와 Origin을 다시 써서 tailnet HTTPS 주소로 열 수 있게 하고, 허용되지 않은 Host와 Origin은 403이다.

## 문구 규칙
em-dash, en-dash, 가운뎃점, 이모지, 구어체, 비유 금지. 자세한 디자인 규칙은 `HANDOFF.md`와 `spec/SPEC.md` 끝부분.
