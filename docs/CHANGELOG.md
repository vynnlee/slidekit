# Changelog

All notable changes to slidekit. The project follows semantic-ish versions while it is in beta: minor versions may change behavior. For the full story, read `git log`; for how to use things, read the [README](../README.md); for the deck format, read [`spec/SPEC.md`](../spec/SPEC.md).

## v0.1.0-beta (unreleased)

First public beta. slidekit has been built in the open from its first commit, and the history is published as is.

### Deck format and engine
- A deck is one HTML file (`decks/<name>/index.html`) driven by a vanilla engine (`engine/slidekit.js`, `engine/slidekit.css`) with no dependencies: navigation, fit-to-screen, fullscreen, overview, audience sync.
- Step reveals with `data-step` and `data-step-effect` (rise, fade, left, scale, blur, none), no JavaScript needed.
- A deck spec with `deck-meta` validation, three templates (talk, blank, workshop), and no layout presets: classes live in the deck's own `<style>`.
- Deck tokens (CSS variables) and six themes: Dark, Light, Paper, Midnight blue, Mono, High contrast.

### Editor
- Figma-style hierarchical selection: click, double-click to go inside, Cmd+click for the innermost element, Enter, Shift+Enter and Tab to move around.
- Layers (hide, lock, rename, drag to reorder), a filmstrip, zoom from 25 to 400 percent, space-pan, smart guides, eight-way resize.
- Multi-select with move, align, duplicate, delete and batch inspector edits; group and ungroup; copy and paste styles.
- Find and replace across the deck (one undo step), command palette (Cmd+K), image paste, drop and replace (GPS data is stripped).
- Linear gradients for fills and backgrounds, deck settings, right-click menus, and warnings for elements that overflow the slide.
- Animation timeline for step reveals.
- Autosave (1.5 seconds), automatic retry when saving fails, conflict detection when the file changes on disk, and undo.
- Version history: up to 50 snapshots per deck with restore; a restore keeps the current state first.
- Deck list with search across titles, bodies and notes, pin, filters, sorting, grid and list views, duplicate, rename, trash with undo.

### Presenting
- Speaker view with the current and next slide, Markdown notes, timer and target time, section position, rehearsal summary, and a command palette to jump by number, title or notes.
- Audience window with crossfade, overview, black and white screens (B and W); the window remembers the external display.
- Phone remote over QR code and a one-time code (next, previous, go to, blank, timer); sessions last two hours.

### Comments and coding agents
- Comment on an element, a slide, or a dragged area. Comment mode (Shift+C) works with the mouse and the keyboard; area comments carry an image of the area.
- Claude Code channel (`channel/`, a research-preview feature): comments reach a running Claude Code session through MCP, the agent edits the deck and replies. Text, excerpts, paths and image text always reach the agent as data, never as instructions.
- `slidekit_edit`: an update-style editing tool for agents (a string must match exactly once, edits are atomic, a stale revision is rejected, lint results come back) with presence in the editor: you see what the agent is changing while it works.
- Comment states Saved, Sent, Working, Replied and Resolved, with the reason a comment is waiting (not connected, paused, hourly limit). Stalled requests can be resent or cancelled, and a new session picks up requests that a crashed session had received.
- Anchors are recomputed whenever the deck changes (editor save, agent edit, direct edit, restore), so comments follow moved slides. Comments that lose their place move to a Detached group and come back when the slide does.
- Speech-bubble pins with a hover preview, a bottom tray ("N saved", Send all), a toggle for resolved pins, and Enter that sends when Claude is connected and saves otherwise.
- Send all, Resolve all replied, Revert Claude's edit, an hourly limit (default 60) and a Pause switch for auto-processing.
- Signed comments: a comment that is not signed with your key shows as Unverified and is not sent to an agent until you press Trust.

### Command line
- `new`, `templates`, `lint`, `doctor [deck] [--layout]`, `image`, `outline [--notes]`, `bundle`, `pdf [--notes | --handout]`.
- `bundle` builds one offline HTML file with the engine, images and font subsets inlined. `pdf` keeps text selectable, links clickable and headings as bookmarks.
- `doctor` checks your environment and, for a deck, lint, size, images, notes, WCAG color contrast and external fonts; `--layout` also measures overflow and clipping in headless Chrome.

### Security and robustness
- The preview proxy accepts only local host names plus those in `SLIDEKIT_ALLOWED_HOSTS`.
- The server binds to `127.0.0.1` only; mutating routes check `Host` and `Origin` and accept JSON only.
- Image and SVG checks (no scripts in SVG, pixel limits), bundler read limits, input sanitizing, per-deck write locks, and a read-only guard so tests cannot write to your real decks.
- A pre-commit secret scan (`.githooks/pre-commit`, enable with `git config core.hooksPath .githooks`).

### Accessibility
- Screen reader announcements in the audience view, 44 px touch targets on touch devices, keyboard flows for comments and the filmstrip, and axe checks for the main editor surfaces.

### Development
- `bun run test` runs the steps through a runner with a lock so heavy work never overlaps; `--only`, `--changed`, `--list` and `--slow` select steps. Browser steps use a shared browser server, fake clocks and condition waits to reduce flakiness.
- A short sample deck (`decks/demo`, eight slides) shows steps, notes and the editor; tests copy the decks in `app/test/fixtures/decks` and never touch yours, and `docs/DEVICE-CHECKLIST.md` lists what to verify on real devices.

### Known limitations
- macOS first; Linux and Windows are untested.
- Publishing a deck to your own Cloudflare Worker (`deploy/`) is experimental and off by default; it needs `SLIDEKIT_EXPERIMENTAL_DEPLOY=1` and `SLIDEKIT_PUBLISH_HOST`. Otherwise export to HTML or PDF and host it yourself.
- With 300+ comments (24 area comments with images) on a slow or heavily loaded machine, opening the Comments panel can take 3 to 4 seconds and the comments-perf test may be unstable. Comments are not lost, only rendering is slow.
- Browser tests are heavy and some are timing sensitive.
- The Claude Code channel is a research preview and may change.
