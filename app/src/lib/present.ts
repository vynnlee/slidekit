import { deckUrl } from "./deck";

type Screen = { availLeft: number; availTop: number; availWidth: number; availHeight: number; isInternal?: boolean };
type Details = { screens: Screen[]; currentScreen: Screen };

let cached: Details | null = null;

// 권한이 이미 허용된 경우에만 미리 읽어 둔다. 클릭 뒤에 await를 거치면 창 열기가 차단될 수 있다.
export async function warmScreens() {
  try {
    const p = await navigator.permissions.query({ name: "window-management" as PermissionName });
    if (p.state === "granted") cached = await (window as any).getScreenDetails();
  } catch {}
}

// 외장 모니터가 있으면 그 화면 가득, 없거나 권한이 없으면 일반 새 창.
export async function startPresentation(folder: string): Promise<string | null> {
  const url = new URL(deckUrl(folder, "?sync=1"), location.href).href;
  if (!cached) {
    try { cached = await (window as any).getScreenDetails(); } catch {}
  }
  const ext = cached?.screens.find((s) => s !== cached!.currentScreen);
  const features = ext
    ? `left=${ext.availLeft},top=${ext.availTop},width=${ext.availWidth},height=${ext.availHeight}`
    : "popup,width=1280,height=720";
  const w = window.open(url, "slidekit-present", features);
  if (!w) return "팝업이 차단되었습니다";
  if (ext) {
    // 전체화면은 사용자 입력이 필요해 실패할 수 있다. 실패하면 발표 창에서 F를 누른다.
    const t = setInterval(async () => {
      if (w.closed) return clearInterval(t);
      if (w.location.href === "about:blank" || w.document.readyState !== "complete") return;
      clearInterval(t);
      try { await w.document.documentElement.requestFullscreen({ screen: ext } as FullscreenOptions); } catch {}
    }, 100);
    setTimeout(() => clearInterval(t), 5000);
  }
  return null;
}
