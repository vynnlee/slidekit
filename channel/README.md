# slidekit 채널

앱 서버(`bun run slidekit`, 기본 127.0.0.1:3200)의 새 코멘트를 열려 있는 Claude Code 세션에 밀어 넣는다. 저장소 루트의 `.mcp.json`에 등록되어 있다.
준비: bun이 PATH에 있어야 한다(`.mcp.json`이 `bun ./channel/index.ts`를 저장소 상대 경로로 띄운다). 처음 한 번 `cd channel && bun install`.
실행: 저장소 루트에서 `claude --dangerously-load-development-channels server:slidekit`. 이 플래그는 `claude --help`에 나오지 않지만 Claude Code 2.1.x에서 받는다(`server:<이름>`은 `.mcp.json`에 직접 등록한 서버라는 뜻이고, 시작할 때 개발용 채널이라는 확인을 한 번 묻는다).
도구: `reply(id, text)`로 답하고 done 처리, `get_pending()`으로 놓친 open 코멘트 조회.
앱 서버 포트가 다르면 `.mcp.json`의 server에 `"env": {"SLIDEKIT_URL": "http://127.0.0.1:<포트>"}`를 넣는다.
앱 서버가 꺼져 있으면 조용히 재연결을 시도한다. 연구 프리뷰 기능이라 사양이 바뀔 수 있다.
연결 표시: 앱 편집기의 코멘트 패널 위 배지가 `/api/channel`을 따른다. 앱만 켜면 "Claude not connected"와 실행 명령 안내, 채널까지 붙으면 "Claude connected"이고, 채널만 켜고 앱이 없으면 위처럼 조용히 재연결을 시도한다(앱을 켜면 붙는다).
서명 키: 앱 서버가 코멘트에 서명하는 키를 `~/.config/slidekit/comments.key`(0600)에 둔다. 없으면 처음 코멘트를 쓸 때 만들고, 권한이 넓으면 0600으로 줄인다. 읽을 수 없거나 손상됐으면 덮어쓰지 않고 경로와 해결 방법을 오류로 알린다. 키를 지우면 기존 코멘트는 앱에서 Trust를 눌러야 Claude에 전달된다. 테스트는 `SLIDEKIT_KEY_FILE`로 다른 파일을 쓴다.
