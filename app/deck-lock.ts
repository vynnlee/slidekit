// 덱 파일을 읽고 고쳐 쓰는 요청이 서로 덮어쓰지 않게 덱 이름 단위로 차례로 실행한다(한 서버 프로세스 안에서).
// 읽기와 쓰기 사이에 await가 있는 요청(설정, 제목, 이름 바꾸기)과 편집기 저장(PUT)이 같은 잠금을 쓰면 서로의 내용을 지우지 않는다.
const chains = new Map<string, Promise<unknown>>();

export function withDeckLock<T>(folder: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(folder) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(folder, tail);
  void tail.then(() => { if (chains.get(folder) === tail) chains.delete(folder); });
  return run;
}

/** 테스트 서버 전용: SLIDEKIT_READONLY_DECKS=폴더,폴더를 주고 띄운 서버는 그 덱을 어떤 쓰기도 하지 않는다. */
export const readOnlyDeck = (folder: string) => (process.env.SLIDEKIT_READONLY_DECKS ?? "").split(",").some((f) => f.trim() === folder);
