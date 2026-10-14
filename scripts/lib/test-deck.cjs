/* 테스트용 덱 사본. 실제 덱은 읽기 전용으로만 쓰고, 고치는 테스트는 이 사본에서만 한다.
   사용: const { makeTestDeck } = require('../../scripts/lib/test-deck.cjs');
         const t = makeTestDeck('editor');   // decks/_e2e-editor, 메타 id는 e2e-editor
         t.folder  // '_e2e-editor' (API의 deck 값, /api/decks/<folder>)
         t.id      // 'e2e-editor' (편집기 주소 /edit/<id>)
         t.file    // 사본 index.html 절대 경로, t.commentsFile  // comments.json 경로
         t.cleanup()  // 사본 삭제(프로세스 종료 때도 자동 삭제)
   decks 아래 _로 시작하는 폴더는 .gitignore에 있어 커밋되지 않는다. */
const fs = require('fs');
const path = require('path');

const decks = path.join(__dirname, '..', '..', 'decks');

// 앞의 n장만 남긴다(느린 브라우저 테스트를 작은 덱으로 돌리려고). 마지막 슬라이드 뒤의 꼬리(스크립트, </body>)는 그대로 둔다.
function keepSlides(html, n) {
  const starts = [...html.matchAll(/<section\b[^>]*\bdata-slide\b/g)].map((m) => m.index);
  if (starts.length <= n) return html;
  const tail = html.lastIndexOf('</section>') + '</section>'.length;
  return html.slice(0, starts[n]).replace(/\s+$/, '') + html.slice(tail);
}

function makeTestDeck(name, from = 'vibe-coding-workshop', opts = {}) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('name은 소문자, 숫자, -만 쓴다');
  const folder = `_e2e-${name}`;
  const id = `e2e-${name}`;
  const dir = path.join(decks, folder);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(decks, from), dir, { recursive: true });
  fs.rmSync(path.join(dir, 'comments.json'), { force: true });
  const file = path.join(dir, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  // 원본 id(없으면 폴더 이름)를 사본 id로 바꾼다. 편집기 라우트가 메타 id로 덱을 연다.
  const m = html.match(/"id"\s*:\s*"([^"]+)"/);
  let out = m ? html.replace(m[0], `"id": "${id}"`) : html.replace(/(<script[^>]*id="deck-meta"[^>]*>\s*\{)/, `$1 "id": "${id}",`);
  if (opts.slides) out = keepSlides(out, opts.slides);
  fs.writeFileSync(file, out);
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  process.on('exit', cleanup);
  return { folder, id, dir, file, commentsFile: path.join(dir, 'comments.json'), cleanup };
}

module.exports = { makeTestDeck };
