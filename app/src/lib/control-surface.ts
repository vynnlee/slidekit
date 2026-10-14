// Fluid 표면 사다리(surface-1 pane 바탕 #171717)보다 한 단계 밝은 채움(surface-3 #252525)만 쓰는 입력 표면.
// 보더는 없다(레이아웃 폭을 같게 하려고 투명 1px만 둔다). 호버는 한 단계 더 밝게, 포커스는 ring-1(box-shadow), 비활성은 50%, 오류만 destructive 보더.
export const controlSurface = "border border-transparent bg-surface-3 text-foreground transition-all duration-80 hover:bg-surface-4";
export const controlFocus = "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]";
export const controlFocusWithin = "focus-within:ring-1 focus-within:ring-[color:var(--focus-ring,#6B97FF)]";
export const controlError = "border-destructive/50 hover:border-destructive/50";
export const controlDisabled = "opacity-50";
