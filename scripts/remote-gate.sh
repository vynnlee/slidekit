#!/bin/sh
# 다른 기계(ssh로 닿는 성능 좋은 기계)에서 브라우저 검증을 돌린다. 로컬이 느리거나 뜨거워질 때 쓴다.
# SLIDEKIT_GATE_HOST=<ssh 호스트 이름>이 필요하다(원격에 bun과 Chrome이 있어야 한다).
# 커밋된 상태만 원격의 ~/Developer/ci/slidekit-<NAME>에 풀어 놓고 러너를 돌린다. 작업트리의 미커밋 변경과 덱 편집은 가지 않는다.
#   scripts/remote-gate.sh start [커밋] [러너 인자...]   예: start HEAD --slow,  start HEAD --only present
#   WORKTREE=1 scripts/remote-gate.sh start HEAD --only present   커밋 전 작업트리(추적+미추적 파일, 미커밋 변경 포함)를 그대로 보낸다: 개발 중 검증용, 게이트(푸시 근거)에는 쓰지 않는다
#   scripts/remote-gate.sh status | log [줄수] | stop   (NAME=... 으로 자기 폴더 지정)
# 종료는 이 스크립트가 띄운 프로세스(.pid)에만 건다. 원격의 다른 프로세스는 건드리지 않는다.
set -eu
HOST=${SLIDEKIT_GATE_HOST:?SLIDEKIT_GATE_HOST에 ssh 호스트 이름을 준다}
NAME=${NAME:-gate}   # 사람마다 폴더를 따로 쓴다(예: NAME=app). 러너 잠금은 원격의 /tmp에서 공유되어 한 번에 하나만 돈다.
DIR=Developer/ci/slidekit-$NAME
cmd=${1:-status}; shift || true
case "$cmd" in
  start)
    sha=${1:-HEAD}; shift || true
    full=$(git rev-parse "$sha")
    args="$*"
    ssh "$HOST" "bash -lc 'if [ -f ~/$DIR/.pid ]; then kill \$(cat ~/$DIR/.pid) 2>/dev/null || true; fi; rm -rf ~/$DIR && mkdir -p ~/$DIR'"
    if [ "${WORKTREE:-0}" = 1 ]; then
      git ls-files -co --exclude-standard -z | xargs -0 tar -c -f - 2>/dev/null | ssh "$HOST" "tar -x -C ~/$DIR"
      full="$full+worktree"
    else
      git archive "$full" | ssh "$HOST" "tar -x -C ~/$DIR"
    fi
    # 설치(네이티브 모듈과 번들러 버전 차이로 lockfile 고정은 쓰지 않음) 뒤 러너를 낮은 우선순위로 띄우고 끝나면 exit 줄을 남긴다.
    ssh "$HOST" "bash -lc 'cd ~/$DIR && echo $full > .sha; bun install >install.log 2>&1 && (cd channel && bun install >>install.log 2>&1); nohup sh -c \"taskpolicy -b bun scripts/test.ts $args > gate.log 2>&1; echo exit=\\\$? >> gate.log\" >/dev/null 2>&1 & echo \$! > .pid'"
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
