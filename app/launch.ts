import { hostname } from "node:os";

// 이미 떠 있는 slidekit인지 확인한다(/api/decks가 배열을 주면 맞다).
export async function alreadyUp(port: number) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/decks`, { signal: AbortSignal.timeout(800) });
    return Array.isArray(await r.json());
  } catch { return false; }
}

// 인자 없는 `slidekit`: mac-local은 브라우저를 열고, 원격(ssh, mac-cloud)은 주소만 출력한다.
// PORT를 직접 준 개발 실행에서는 열지 않는다.
export function openApp(url: string) {
  const remote = !!(process.env.SSH_CONNECTION || process.env.SSH_TTY) || /cloud/i.test(hostname());
  if (process.env.PORT || process.env.SLIDEKIT_NO_OPEN || remote || process.platform !== "darwin") return;
  Bun.spawn(["open", url]);
}
