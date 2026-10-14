"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
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
  close(): void;
  /** 우클릭과 ContextMenu 키와 Shift+F10을 한 번에 연결한다. getItems가 빈 목록이나 null을 주면 열지 않는다. */
  bind(getItems: (e: MouseEvent | KeyboardEvent) => MenuItem[] | null | undefined): {
    onContextMenu: (e: MouseEvent) => void;
    onKeyDown: (e: KeyboardEvent) => void;
  };
}

// 입력 칸과 글자 편집 중인 곳은 브라우저의 네이티브 메뉴(복사, 붙여넣기, 맞춤법)를 쓴다.
const native = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("input,textarea,select,[contenteditable=true],[contenteditable='']");

export function useContextMenu(): ContextMenuController {
  const [state, setState] = useState<Open | null>(null);
  const seq = useRef(0);
  const close = useCallback(() => setState(null), []);
  const open = useCallback((at: { x: number; y: number }, items: MenuItem[], returnTo?: HTMLElement | null) => {
    if (!items.length) return;
    setState({ id: ++seq.current, x: at.x, y: at.y, items, returnTo: returnTo ?? (document.activeElement as HTMLElement | null) });
  }, []);
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
const KEYCAP = "after:ml-auto after:pl-6 after:text-caption after:text-muted-foreground after:content-[attr(data-shortcut)]";

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

  // 스크롤, 창 크기, 창 포커스를 잃을 때 닫는다(메뉴 안의 스크롤은 제외).
  useEffect(() => {
    if (!state) return;
    const onScroll = (e: Event) => { if (!(e.target instanceof HTMLElement && e.target.closest("[role=menu]"))) close(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", close); window.removeEventListener("blur", close); };
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
  const wasOpen = useRef(false);
  useEffect(() => {
    if (state) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const el = returnTo.current;
    requestAnimationFrame(() => { if (el?.isConnected) el.focus({ preventScroll: true }); });
  }, [state]);

  if (!state) return null;
  return (
    <DropdownMenu key={state.id} open onOpenChange={(o) => { if (!o) close(); }}>
      <DropdownTrigger render={<span aria-hidden="true" tabIndex={-1} style={{ position: "fixed", left: state.x, top: state.y, width: 1, height: 1, pointerEvents: "none" }} />} />
      {/* 포인터 아래가 아니라 오른쪽 아래 2px에서 시작한다: 누른 버튼을 떼는 순간 첫 항목이 실행되지 않게 */}
      <DropdownContent side="bottom" align="start" sideOffset={2} alignOffset={2}>
        <MenuItems items={state.items} />
      </DropdownContent>
    </DropdownMenu>
  );
}
