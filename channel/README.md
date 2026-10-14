# slidekit 채널

앱 편집기에서 단 코멘트를 열려 있는 Claude Code 세션이 받아 덱을 고치고 답하게 하는 연결이다. 저장소 루트의 `.mcp.json`에 등록되어 있다. 연구 프리뷰 기능이라 사양이 바뀔 수 있다.

## 처음 쓰는 순서

1. 앱을 켠다(기본 `127.0.0.1:3200`).
   ```
   bun run slidekit
   ```
2. 다른 터미널에서 Claude Code를 채널과 함께 켠다. bun이 PATH에 있어야 하고, 처음 한 번만 `bun install`이 필요하다.
   ```
   cd channel && bun install && cd ..
   claude --dangerously-load-development-channels server:slidekit
   ```
   이 플래그는 `claude --help`에 나오지 않지만 Claude Code 2.1.x에서 받는다. 시작할 때 개발용 채널이라는 확인을 한 번 묻는다.
3. 연결을 확인한다. 편집기의 Comments 탭 위 배지가 "Claude connected"이면 된다. "Claude not connected"이면 그 줄을 펼쳐 명령을 복사해 2번을 다시 한다.
4. 코멘트를 남긴다. 요소를 고르고 `C`를 눌러 요청을 쓴 뒤 `Cmd+Enter`로 보낸다. 요소를 고르지 않고 `C`를 누르면 슬라이드 전체에 건다. 연결되어 있으면 바로 전달되고 상태가 Sent to Claude, Claude is working으로 바뀐다. 연결이 없어도 저장되어 있다가 세션이 붙으면 오래된 것부터 전달된다.
5. 답을 받는다. Claude가 고치고 답하면 상태가 Replied가 되고 토스트가 뜬다. 마음에 들면 Resolve, 아니면 Revert Claude's edit로 그 수정만 되돌린다(그 사이 덱이 더 바뀌었으면 Version history에서 고른다).

## 도구와 설정

- 도구: `reply(id, text)`는 답하고 done 처리, `ack(id)`는 작업 시작 표시, `get_pending()`은 놓친 open 코멘트를 오래된 순으로 가져온다.
- 앱 서버 포트가 다르면 `.mcp.json`의 server에 `"env": {"SLIDEKIT_URL": "http://127.0.0.1:<포트>"}`를 넣는다. 로컬 주소만 받는다.
- 앱이 꺼져 있으면 채널은 조용히 재연결을 시도하고, 앱을 켜면 붙는다.
- 서명 키: 앱 서버가 코멘트에 서명하는 키를 `~/.config/slidekit/comments.key`(0600)에 둔다. 없으면 처음 코멘트를 쓸 때 만들고, 권한이 넓으면 0600으로 줄인다. 읽을 수 없거나 손상됐으면 덮어쓰지 않고 경로와 해결 방법을 오류로 알린다. 서명이 없는 코멘트(남에게서 받은 덱의 코멘트, 키를 지운 뒤의 기존 코멘트)는 앱에서 Trust를 눌러야 Claude에 전달된다. 테스트는 `SLIDEKIT_KEY_FILE`로 다른 파일을 쓴다.
- Claude가 코멘트를 처리하는 규칙은 `.claude/skills/slidekit/SKILL.md` 11절에 있다.
