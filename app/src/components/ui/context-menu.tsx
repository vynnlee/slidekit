"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownSub, DropdownSubContent, DropdownSubTrigger, DropdownTrigger } from "@/components/ui/dropdown";
import { MenuItem as FluidMenuItem } from "@/components/ui/menu-item";
import { formatShortcut, isMacPlatform } from "@/components/ui/command-menu";
import type { MenuItem } from "@/lib/menu-model";

// ---------------------------------------------------------------------------
// ContextMenu: Fluid 레지스트리에는 context-menu가 없어서, 기존 Dropdown(Radix 메뉴) 위에
// "포인터 위치의 보이지 않는 앵커"를 트리거로 세워 만든다. 같은 항목 목록(lib/menu-model.ts)을
// ... 버튼 메뉴에도 쓸 수 있게 항목 그리기(MenuItems)를 따로 내보낸다.
//
// 사용법:
//   const cm = useContextMenu();
//   <div {...cm.bind(() => deckMenu(actions))}>…</div>     // 우클릭, ContextMenu 키, Shift+F10
//   <ContextMenu menu={cm} />                                  // 화면에 하나만 둔다
// 코드에서 직접 열 때: cm.open({ x, y }, items)  또는  cm.openFor(element, items)
//
// 동작: 화살표, Enter, Esc, 첫 글자 이동은 Radix가 하고, 화면 가장자리에서 뒤집기도 Radix가 한다.
// 이 부품이 더하는 것: 포인터 위치 앵커, 입력 칸에서는 네이티브 메뉴 유지, 닫힌 뒤 포커스 복귀,
// 스크롤과 창 크기 변경과 창 포커스 이동 때 닫힘, 다른 곳 우클릭하면 교체.
// ---------------------------------------------------------------------------

type Open = { id: number; x: number; y: number; items: MenuItem[]; returnTo: HTMLElement | null };
export interface ContextMenuController {
  state: Open | null;
  open(at: { x: number; y: number }, items: MenuItem[], returnTo?: HTMLElement | null): void;
  /** 요소의 왼쪽 아래에서 연다(키보드로 열 때). */
  openFor(el: HTMLElement, items: MenuItem[]): void;
  /** id를 주면 그 메뉴가 아직 열려 있을 때만 닫는다(교체된 새 메뉴를 옛 메뉴의 닫힘 알림이 닫지 않게). */
  close(id?: number): void;
  /** 우클릭과 ContextMenu 키와 Shift+F10을 한 번에 연결한다. getItems가 빈 목록이나 null을 주면 열지 않는다. */
  bind(getItems: (e: MouseEvent | KeyboardEvent) => MenuItem[] | null | undefined): {
    onContextMenu: (e: MouseEvent) => void;
    onKeyDown: (e: KeyboardEvent) => void;
  };
}

// 입력 칸과 글자 편집 중인 곳은 브라우저의 네이티브 메뉴(복사, 붙여넣기, 맞춤법)를 쓴다.
const native = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("input,textarea,select,[contenteditable=true],[contenteditable='']");

export function useContextMenu(): ContextMenuController {
  const [state, setRaw] = useState<Open | null>(null);
  const cur = useRef<Open | null>(null);
  const seq = useRef(0);
  const closedAt = useRef(0);
  const set = useCallback((v: Open | null) => { if (!v) closedAt.current = Date.now(); cur.current = v; setRaw(v); }, []);
  const close = useCallback((id?: number) => { if (cur.current && (id === undefined || cur.current.id === id)) set(null); }, [set]);
  const open = useCallback((at: { x: number; y: number }, items: MenuItem[], returnTo?: HTMLElement | null) => {
    if (!items.length) return;
    const next = { id: ++seq.current, x: at.x, y: at.y, items, returnTo: returnTo ?? cur.current?.returnTo ?? (document.activeElement as HTMLElement | null) };
    // 옛 메뉴가 열려 있거나 방금 닫혔으면(바깥 우클릭은 눌리는 순간 옛 메뉴를 먼저 닫는다) 그 메뉴가 포커스를 돌려놓은 뒤에 새 메뉴를 연다.
    // 겹치면 옛 메뉴의 포커스 복귀가 새 메뉴를 "바깥 포커스"로 보고 닫는다.
    if (cur.current) set(null);
    const wait = Math.max(0, 120 - (Date.now() - closedAt.current));
    if (wait > 0 && closedAt.current) setTimeout(() => set(next), wait); else set(next);
  }, [set]);
  const openFor = useCallback((el: HTMLElement, items: MenuItem[]) => {
    const r = el.getBoundingClientRect();
    open({ x: r.left + 8, y: r.bottom - 4 }, items, el);
  }, [open]);
  const bind = useCallback<ContextMenuController["bind"]>((getItems) => ({
    onContextMenu: (e) => {
      if (native(e.target) || e.defaultPrevented || (e.buttons & 1)) return; // 왼쪽 버튼을 누른 채(드래그 중)에는 열지 않는다
      const items = getItems(e);
      if (!items?.length) return;
      e.preventDefault();
      e.stopPropagation(); // 바깥 맥락의 메뉴가 같이 열리지 않게(가장 안쪽 맥락이 이긴다)
      open({ x: e.clientX, y: e.clientY }, items, e.target instanceof HTMLElement ? (e.target.closest<HTMLElement>("button,[tabindex],a") ?? e.target) : null);
    },
    onKeyDown: (e) => {
      if (!(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) || native(e.target)) return;
      const items = getItems(e);
      if (!items?.length) return;
      e.preventDefault();
      e.stopPropagation();
      openFor(e.target as HTMLElement, items);
    },
  }), [open, openFor]);
  return { state, open, openFor, close, bind };
}

const DESTRUCTIVE = "text-destructive [&_span]:text-destructive [&_svg]:text-destructive";
const KEYCAP = "after:ml-auto after:pl-6 after:text-caption after:text-muted-foreground after:[font-family:var(--font-keys)] after:content-[attr(data-shortcut)]";

/** 항목 목록을 Fluid 메뉴 행으로 그린다. DropdownContent 안에서 쓴다(우클릭 메뉴와 ... 버튼 메뉴가 같이 쓴다). */
export function MenuItems({ items }: { items: MenuItem[] }) {
  const mac = isMacPlatform();
  const cap = (s?: string) => (s ? formatShortcut(s, mac).join("") : undefined);
  let i = 0;
  return (
    <>
      {items.map((it, k) =>
        it.type === "separator" ? (
          <DropdownSeparator key={`s${k}`} />
        ) : it.type === "sub" ? (
          <DropdownSub key={it.id}>
            <DropdownSubTrigger index={i++} icon={it.icon} label={it.label} disabled={it.disabled} />
            <DropdownSubContent><MenuItems items={it.items} /></DropdownSubContent>
          </DropdownSub>
        ) : (
          <FluidMenuItem
            key={it.id}
            index={i++}
            icon={it.icon}
            label={it.label}
            disabled={it.disabled}
            onSelect={it.onSelect}
            data-shortcut={cap(it.shortcut)}
            aria-keyshortcuts={it.shortcut ? it.shortcut.split("+").map((p) => (p === "mod" ? (mac ? "Meta" : "Control") : p[0].toUpperCase() + p.slice(1))).join("+") : undefined}
            className={cn(it.shortcut && KEYCAP, it.destructive && DESTRUCTIVE)}
          />
        )
      )}
    </>
  );
}

export function ContextMenu({ menu }: { menu: ContextMenuController }) {
  const { state, close } = menu;
  const returnTo = useRef<HTMLElement | null>(null);
  returnTo.current = state?.returnTo ?? returnTo.current;

  // 스크롤, 휠, 창 크기, 창 포커스, 포커스 이동, 줌 키에서 닫는다(메뉴 안의 입력은 제외).
  useEffect(() => {
    if (!state) return;
    const onScroll = (e: Event) => { if (Date.now() - openedAt > 400 && !(e.target instanceof HTMLElement && e.target.closest("[role=menu]"))) close(); }; // 열린 직후의 스크롤(우클릭한 카드를 화면에 맞추는 이동 등)은 무시
    const openedAt = Date.now();
    const closeAll = () => close();
    const inMenu = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("[role=menu]");
    // 휠(Cmd+휠 줌 포함)과 메뉴 밖으로 가는 포커스 이동, 줌 키(Cmd 또는 Ctrl과 + - 0)에서도 닫는다.
    const onWheel = (e: WheelEvent) => { if (!inMenu(e.target)) close(); };
    // 교체로 열린 직후에는 옛 메뉴의 포커스 복귀가 늦게 도착할 수 있어(부하) 잠깐 무시한다.
    // 우클릭을 뗄 때(mouseup)는 포인터 아래에 막 열린 메뉴 항목이 있을 수 있다(화면 가장자리에서 메뉴가 밀려 올라올 때).
    // 열린 직후 250ms 안에 메뉴 안으로 오는 포인터 해제(pointerup, mouseup)는 항목에 닿지 않게 막는다. 키보드는 영향 없다.
    const swallow = (e: Event) => { if (Date.now() - openedAt < 250 && inMenu(e.target)) { e.stopPropagation(); e.preventDefault(); } };
    for (const t of ["pointerup", "mouseup"]) window.addEventListener(t, swallow, true); // click은 제외한다: 키보드 Enter의 click까지 막으면 안 된다
    const onFocusIn = (e: FocusEvent) => { if (!inMenu(e.target) && Date.now() - openedAt > 400) close(); };
    const onKey = (e: globalThis.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && /^[=+\-_0]$/.test(e.key)) close(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", closeAll);
    window.addEventListener("blur", closeAll);
    return () => {
      for (const t of ["pointerup", "mouseup"]) window.removeEventListener(t, swallow, true);
      window.removeEventListener("scroll", onScroll, true); window.removeEventListener("wheel", onWheel, true); document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", closeAll); window.removeEventListener("blur", closeAll);
    };
  }, [state?.id, close]);

  // 모달 메뉴는 바깥에 pointer-events:none을 걸어서, 다른 곳을 우클릭해도 그 곳의 contextmenu 이벤트가 오지 않는다.
  // 바깥에서 오른쪽 버튼을 누르는 순간만 풀어 주면 이벤트가 도착해 새 메뉴로 교체된다(Radix가 닫을 때 원래 값으로 되돌린다).
  useEffect(() => {
    if (!state) return;
    const down = (e: PointerEvent) => {
      if (e.button === 2 && !(e.target instanceof HTMLElement && e.target.closest("[role=menu]"))) document.body.style.pointerEvents = "auto";
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [state?.id]);

  // 닫힌 뒤에는 메뉴를 연 요소로 포커스를 돌려준다(Radix는 보이지 않는 앵커로 돌려놓는다).
  const live = useRef(state);
  live.current = state;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (state) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const el = returnTo.current;
    // 부하로 프레임이 늦어져 그 사이 다른 메뉴가 열렸다면(우클릭 교체) 포커스를 되돌리지 않는다: 새 메뉴에서 포커스를 빼앗아 바깥 포커스로 닫히게 만든다.
    requestAnimationFrame(() => { if (!live.current && el?.isConnected) el.focus({ preventScroll: true }); });
  }, [state]);

  if (!state) return null;
  // 항상 document.body로 포털한다: transform이 걸린 조상(캔버스 래퍼, 핀 오버레이) 안에서는 position:fixed 앵커가 그 조상 기준이 되어 메뉴가 어긋난다.
  return createPortal(
    <DropdownMenu key={state.id} open onOpenChange={(o) => { if (!o) close(state.id); }}>
      <DropdownTrigger render={<span aria-hidden="true" tabIndex={-1} style={{ position: "fixed", left: state.x, top: state.y, width: 1, height: 1, pointerEvents: "none" }} />} />
      {/* 포인터 아래가 아니라 오른쪽 아래 2px에서 시작한다: 누른 버튼을 떼는 순간 첫 항목이 실행되지 않게 */}
      <DropdownContent side="bottom" align="start" sideOffset={2} alignOffset={2}>
        <MenuItems items={state.items} />
      </DropdownContent>
    </DropdownMenu>,
    document.body,
  );
}
