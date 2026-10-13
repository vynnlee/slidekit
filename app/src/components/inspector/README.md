Inspector parts live in `components/ui/` (demo and checks: `/dev/inspector`, `app/src/InspectorDemo.tsx`, `node app/test/inspector.cjs`).
- `NumberField` `{label: ReactNode, value: "12px", onChange(v), onScrubStart?(), onScrubEnd?(), step=1, min?, max?, unit="px", mixed?, muted?, aria-label}`. Label drag scrubs (Alt x0.1, Shift x10, cursor above/below x2/x0.5), arrows nudge, `+10 *2 /4` formulas. `onChange` is live: open one undo group in `onScrubStart`, close it in `onScrubEnd`.
- `ColorField` `{value: any CSS color, onChange(v), allowNone?, aria-label}`: swatch popover, hex, alpha %.
- `SegmentedControl` `{value, onChange(v), options: {value, icon, label}[], aria-label}` (radiogroup, arrows).
- `InspectorSection` `{id, title, action?, defaultOpen?}`: collapsed ids in localStorage `slidekit.inspector.collapsed`.
- `AlignBox` `{direction: "row"|"column", justify, align, onChange(justify, align)}` 3x3 flex alignment.
- `SidesField` `{label, values: {top,right,bottom,left}, onChange(sides[], v), unit?}`: pair or four fields, expand toggle.
- Toggle button: `<Button size="compact" variant="ghost" aria-pressed>` with a lucide icon, wrapped in `Tooltip`.

## TokensPanel (deck tokens, `app/src/TokensPanel.tsx`)
`<TokensPanel prefix={shell.prefix} onPrefixChange={(next) => setShell({ ...shell, prefix: next })} canvas={canvasDoc} />`
- `prefix`: deck text before the first slide (holds `<head><style>`). `onPrefixChange(next)`: fires once per change (debounced 400ms, scrub fires at end), so make it ONE undo entry. `canvas`: canvas iframe `Document`, enables live preview via inline `:root` properties (the canvas should reload from the new prefix after commit).
- Sections: Colors, Fonts, Spacing, Text sizes, Deck variables. Only `:root` variables are edited (`lib/deck-tokens.ts`, SPEC 9.4). Put it in the Inspector when no element is selected.
- Demo and check: `/dev/tokens?deck=<folder>`, `node app/test/tokens.cjs`, `bun test app/test/deck-tokens.test.ts`.

## ExportMenu (`app/src/ExportMenu.tsx`)
`<ExportMenu folder={deck.folder} dirty={dirty} onSave={async () => save()} />` in the editor header (a secondary compact "Export" button).
- `folder`: deck folder under `decks/` (must match `^[a-z0-9][a-z0-9-]*$`, same as the publish path). `dirty`/`onSave`: if dirty, `onSave()` runs first and must resolve `false` on failure or conflict (nothing is exported then).
- Menu: Download HTML, Download PDF (POST bundle/pdf, then `GET /api/decks/:id/download?kind=`), Publish to static.vynnlee.com... (confirm dialog with address and visibility, password + confirm for Password decks, streamed progress, URL + Copy on success). API: `app/export-api.ts` (one export at a time, 409). Tests: `bun test app/test/export-api.test.ts`; browser: `SLIDEKIT_DEPLOY_DRY_RUN=1` server + `node app/test/export.cjs` (demo `/dev/export?deck=<folder>`). Dry run never uploads.

## deckFonts (`app/src/lib/deck-fonts.ts`)
`deckFonts(shell.prefix): string[]` returns the font families this deck declares (`@font-face`, Google Fonts `<link>`, `--sk-font` tokens; no generic or system names). Show them first in the Typography font family Select, above the generic list; `familyNames(css value)` splits a `font-family` value.
