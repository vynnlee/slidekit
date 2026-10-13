# slidekit 채널

앱 서버(`bun run slidekit`, 기본 127.0.0.1:3200)의 새 코멘트를 열려 있는 Claude Code 세션에 밀어 넣는다. 저장소 루트의 `.mcp.json`에 등록되어 있다.
실행: `bun install` (channel/) 후 저장소 루트에서 `claude --dangerously-load-development-channels server:slidekit`
도구: `reply(id, text)`로 답하고 done 처리, `get_pending()`으로 놓친 open 코멘트 조회.
앱 서버 포트가 다르면 `.mcp.json`의 server에 `"env": {"SLIDEKIT_URL": "http://127.0.0.1:<포트>"}`를 넣는다.
앱 서버가 꺼져 있으면 조용히 재연결을 시도한다. 연구 프리뷰 기능이라 사양이 바뀔 수 있다.
