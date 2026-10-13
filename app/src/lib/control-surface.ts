// Fluid Select(bordered 트리거)와 같은 표면 토큰을 우리 입력류가 공유한다. 새 토큰은 만들지 않는다.
// 1px 보더(레이아웃에 포함, outline으로 밀지 않음), 투명 바탕, 호버 채움, ring-1 포커스(box-shadow), 비활성 50%, 오류는 destructive 보더.
export const controlSurface = "border border-border bg-transparent text-foreground transition-all duration-80 hover:bg-hover";
export const controlFocus = "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]";
export const controlFocusWithin = "focus-within:ring-1 focus-within:ring-[color:var(--focus-ring,#6B97FF)]";
export const controlError = "border-destructive/50 hover:border-destructive/50";
export const controlDisabled = "opacity-50";
