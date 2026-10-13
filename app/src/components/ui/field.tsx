import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useSize } from "@/lib/size-context";
import { useShape } from "@/lib/shape-context";
import { controlFocus, controlSurface } from "@/lib/control-surface";

// Fluid에는 Radix용 단순 입력 컴포넌트가 없어, 같은 크기 사다리(기본 36px, 컴팩트 28px)와 Fluid Select의 표면(control-surface)으로 만든다.
const base = cn(
  "w-full min-w-0 outline-none placeholder:text-muted-foreground disabled:opacity-50 aria-[invalid=true]:border-destructive/50",
  controlSurface,
  controlFocus,
);

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => {
  const size = useSize(), shape = useShape();
  return <input ref={ref} className={cn(base, size.control, size.px, size.field, shape.input, "tabular-nums", className)} {...p} />;
});
Field.displayName = "Field";

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => {
  const size = useSize(), shape = useShape();
  return <textarea ref={ref} className={cn(base, size.px, "py-1.5 resize-none", size.field, shape.input, className)} {...p} />;
});
TextArea.displayName = "TextArea";
