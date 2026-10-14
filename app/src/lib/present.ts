import { deckUrl } from "./deck";

type Screen = { label?: string; availLeft: number; availTop: number; availWidth: number; availHeight: number; isInternal?: boolean };
type Details = { screens: Screen[]; currentScreen: Screen };

let cached: Details | null = null;

// 외장 화면 선택 기억: 화면 라벨(없으면 순번)을 localStorage에 둔다.
const SCREEN_KEY = "slidekit:screen";
const externals = () => (cached ? cached.screens.filter((s) => s !== cached!.currentScreen) : []);
const labelOf = (s: Screen, i: number) => s.label || `Display ${i + 1}`;
/** 발표자 화면이 있는 곳 말고 쓸 수 있는 화면들. 권한 전이면 null. */
export const listScreens = (): string[] | null => (cached ? externals().map(labelOf) : null);
export const chosenScreen = () => localStorage.getItem(SCREEN_KEY);
export const chooseScreen = (label: string) => { try { localStorage.setItem(SCREEN_KEY, label); } catch {} };
const pickExternal = (): { screen: Screen; label: string } | null => {
  const ex = externals();
  if (!ex.length) return null;
  const saved = chosenScreen();
  const i = Math.max(0, ex.findIndex((s, k) => labelOf(s, k) === saved));
  return { screen: ex[i], label: labelOf(ex[i], i) };
};
let win: Window | null = null;

// 이 페이지 세션에서 연 발표 창이 아직 열려 있는지. 연 적이 없으면 null.
export const presentationOpen = () => (win ? !win.closed : null);

// 권한이 이미 허용된 경우에만 미리 읽어 둔다. 클릭 뒤에 await를 거치면 창 열기가 차단될 수 있다.
export async function warmScreens() {
  try {
    const p = await navigator.permissions.query({ name: "window-management" as PermissionName });
    if (p.state === "granted") cached = await (window as any).getScreenDetails();
  } catch {}
}

// 외장 모니터가 있으면 그 화면 가득, 없거나 권한이 없으면 일반 새 창.
// fromSlide(1부터)를 주면 그 장에서 시작한다. 범위 밖이면 엔진이 가장 가까운 장으로 맞춘다.
// 사용: startPresentation(deck.folder, currentSlide) 또는 처음부터는 startPresentation(deck.folder).
// 실패 사유는 반환값(창 열기 전 상황)과 onNote(전체화면 실패)로 발표자 화면에 알린다.
export async function startPresentation(folder: string, fromSlide?: number, onNote: (msg: string) => void = () => {}): Promise<string | null> {
  const hash = Number.isInteger(fromSlide) && fromSlide! >= 1 ? `#${fromSlide}` : "";
  const url = new URL(deckUrl(folder, "?sync=1") + hash, location.href).href;
  let unavailable = false;
  if (!cached) {
    if (typeof (window as any).getScreenDetails !== "function") unavailable = true;
    else {
      // 권한 창이 뜨기 전에 한 줄로 이유를 알린다. 이미 거부했으면 묻지 않고 창으로 연다.
      const state = await navigator.permissions.query({ name: "window-management" as PermissionName }).then((p) => p.state, () => "prompt");
      if (state === "denied") unavailable = true;
      else {
        if (state === "prompt") onNote("Your browser will ask to manage windows. Allow it to open slides on another display.");
        try { cached = await (window as any).getScreenDetails(); } catch { unavailable = true; }
      }
    }
  }
  const pick = pickExternal();
  const ext = pick?.screen;
  const features = ext
    ? `left=${ext.availLeft},top=${ext.availTop},width=${ext.availWidth},height=${ext.availHeight}`
    : "popup,width=1280,height=720";
  const w = window.open(url, "slidekit-present", features);
  if (!w) return "Popup blocked";
  win = w;
  const note = pick ? `Presenting on ${pick.label}.` : unavailable ? "Display access unavailable. Opened in a window. Press F there for full screen." : "No external display found. Opened in a window. Press F there for full screen.";
  if (ext) {
    // 전체화면은 사용자 입력이 필요해 실패할 수 있다. 실패하면 발표 창에서 F를 누른다.
    const t = setInterval(async () => {
      if (w.closed) return clearInterval(t);
      if (w.location.href === "about:blank" || w.document.readyState !== "complete") return;
      clearInterval(t);
      try { await w.document.documentElement.requestFullscreen({ screen: ext } as FullscreenOptions); } catch { onNote("Fullscreen blocked. Press F in the presentation window."); }
    }, 100);
    setTimeout(() => clearInterval(t), 5000);
  }
  return note;
}
