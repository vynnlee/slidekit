Inspector parts live in `components/ui/` (demo and checks: `/dev/inspector`, `app/src/InspectorDemo.tsx`, `node app/test/inspector.cjs`).
- `NumberField` `{label: ReactNode, value: "12px", onChange(v), onScrubStart?(), onScrubEnd?(), step=1, min?, max?, unit="px", mixed?, muted?, aria-label}`. Label drag scrubs (Alt x0.1, Shift x10, cursor above/below x2/x0.5), arrows nudge, `+10 *2 /4` formulas. `onChange` is live: open one undo group in `onScrubStart`, close it in `onScrubEnd`.
- `ColorField` `{value: any CSS color, onChange(v), allowNone?, aria-label}`: swatch popover, hex, alpha %.
- `SegmentedControl` `{value, onChange(v), options: {value, icon, label}[], aria-label}` (radiogroup, arrows).
- `InspectorSection` `{id, title, action?, defaultOpen?}`: collapsed ids in localStorage `slidekit.inspector.collapsed`.
- `AlignBox` `{direction: "row"|"column", justify, align, onChange(justify, align)}` 3x3 flex alignment.
- `SidesField` `{label, values: {top,right,bottom,left}, onChange(sides[], v), unit?}`: pair or four fields, expand toggle.
- Toggle button: `<Button size="compact" variant="ghost" aria-pressed>` with a lucide icon, wrapped in `Tooltip`.
