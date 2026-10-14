# slidekit 배포

1. Cloudflare 대시보드에서 토큰을 만든다(계정 권한: Workers Scripts 편집, Workers KV Storage 편집, Account Settings 읽기. vynnlee.com zone 권한: DNS 편집, Workers Routes 편집, Zone 읽기. 계정 하나와 zone 하나로 범위를 좁힌다). 키체인 저장: `security add-generic-password -a $USER -s slidekit-cloudflare-token -w` (토큰은 프롬프트에 붙여넣기). 토큰 이름은 slidekit-static-deploy이고 2026-10-13에 만들었다.
2. `cd deploy/worker && bunx wrangler kv namespace create DECKS` 결과의 id를 `wrangler.toml`의 `REPLACE_WITH_KV_NAMESPACE_ID`에 넣는다. 토큰은 `export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s slidekit-cloudflare-token -w)`로 셸에 올린다.
3. 쿠키 서명 키 등록: `openssl rand -base64 32 | bunx wrangler secret put COOKIE_SECRET` (deploy/worker에서).
4. vynnlee.com이 Cloudflare DNS에 있으면 Worker 배포 때 `static.vynnlee.com`이 자동 연결된다. 첫 배포: `bun run deploy --worker`
5. 덱 올리기: 번들 후 `bun run deploy <덱>` (비밀번호 덱이면 비밀번호를 물어본다). 주소는 static.vynnlee.com/<덱>.

공개 덱은 올릴 때 `deck-meta`의 `title`도 함께 올라간다. 비밀번호 덱은 인증 전에 제목이 보이므로 `deck-meta`에 `"lockTitle": true`를 적은 경우에만 올린다. 비밀번호는 8자 이상이고, 바꾸면 이미 발급된 쿠키가 모두 무효가 된다. 비밀번호, 잠금(5회 틀리면 15분), 404 안내 페이지는 같은 모양이며 모바일 390px에서도 한 칸 폭을 지킨다. Worker 변경은 `bun run deploy --worker`로 올려야 반영된다.
