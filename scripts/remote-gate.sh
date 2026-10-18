#!/bin/sh
# 발열 때문에 브라우저 검증은 mac-local에서 돌린다(mac-cloud는 덮개 연 Intel 노트북이라 순간 부하에 95°C 이상).
# 커밋된 상태만 mac-local의 ~/Developer/ci/slidekit-gate에 풀어 놓고 러너를 돌린다. 작업트리의 미커밋 변경과 사용자 덱 편집은 가지 않는다.
#   scripts/remote-gate.sh start [커밋] [러너 인자...]   예: start HEAD --slow,  start HEAD --only present
#   scripts/remote-gate.sh status | log [줄수] | stop
# 종료는 이 스크립트가 띄운 프로세스(.pid)에만 건다. mac-local의 다른 프로세스는 건드리지 않는다.
set -eu
HOST=mac-local
DIR=Developer/ci/slidekit-gate
cmd=${1:-status}; shift || true
case "$cmd" in
  start)
    sha=${1:-HEAD}; shift || true
    full=$(git rev-parse "$sha")
    args="$*"
    ssh "$HOST" "bash -lc 'if [ -f ~/$DIR/.pid ]; then kill \$(cat ~/$DIR/.pid) 2>/dev/null || true; fi; rm -rf ~/$DIR && mkdir -p ~/$DIR'"
    git archive "$full" | ssh "$HOST" "tar -x -C ~/$DIR"
    # 설치(arm64 네이티브 모듈, 번들러 버전 차이로 lockfile 고정은 쓰지 않음)와 러너의 axe 탐색용 빈 폴더(Bun 1.3은 없는 폴더의 glob에서 던진다) 뒤 러너를 낮은 우선순위로 띄우고 끝나면 exit 줄을 남긴다.
    ssh "$HOST" "bash -lc 'cd ~/$DIR && echo $full > .sha && mkdir -p /tmp/claude-501; bun install >install.log 2>&1 && (cd channel && bun install >>install.log 2>&1); nohup sh -c \"taskpolicy -b bun scripts/test.ts $args > gate.log 2>&1; echo exit=\\\$? >> gate.log\" >/dev/null 2>&1 & echo \$! > .pid'"
    echo "시작: $(echo "$full" | cut -c1-7) $args  (status, log로 확인)"
    ;;
  status)
    ssh "$HOST" "bash -lc 'cd ~/$DIR 2>/dev/null || { echo 없음; exit 0; }; echo sha=\$(cut -c1-7 .sha 2>/dev/null); if kill -0 \$(cat .pid 2>/dev/null) 2>/dev/null; then echo 실행중; else echo 정지; fi; grep -E \"^-- |exit=\" gate.log 2>/dev/null | tail -${1:-12}; echo 통과=\$(grep -cE \"^-- .*통과\" gate.log 2>/dev/null)'"
    ;;
  log)
    ssh "$HOST" "tail -${1:-40} ~/$DIR/gate.log"
    ;;
  stop)
    ssh "$HOST" "bash -lc 'cd ~/$DIR && pkill -P \$(cat .pid) 2>/dev/null; kill \$(cat .pid) 2>/dev/null; echo 종료 요청'"
    ;;
  *) echo "사용법: $0 start|status|log|stop" >&2; exit 2 ;;
esac
