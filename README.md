# slidekit

Slide decks as plain HTML. Edit them visually in a local editor, present from your browser with a speaker view, and let a coding agent fix your slides from comments.

[한국어](README.ko.md) | [Deck spec](spec/SPEC.md) | [Changelog](docs/CHANGELOG.md) | [Contributing](CONTRIBUTING.md) | [MIT license](LICENSE)

> **Beta (v0.1.0-beta), built in public.** It works and I use it every week, but expect rough edges, changing behavior, and a macOS-first setup. See [Known limitations](#known-limitations).

<!-- TODO: add docs/media/editor.png (editor with comment panel) and docs/media/present.gif (speaker view). See docs/media/README.md for the naming rules. -->

## What it is

- **A deck is one HTML file.** `decks/<name>/index.html` is the whole source. No build step, no proprietary format, diffs read like diffs.
- **A tiny vanilla engine.** `engine/slidekit.js` and `engine/slidekit.css` handle navigation, fit-to-screen, fullscreen, overview, steps and audience sync. No framework and no dependencies in the slide model: your deck is HTML, CSS and a little JavaScript.
- **A local editor** (Figma-style hierarchy selection, layers, filmstrip, inspector, deck tokens, find and replace, version history) that writes back to the same HTML file.
- **A presenter mode** with speaker notes, timer, next slide preview, audience window, and an optional phone remote.
- **Comments that a coding agent can act on.** Leave a comment on an element or an area of a slide; a running [Claude Code](https://claude.com/claude-code) session receives it through an MCP channel, edits the deck, and replies. You can revert the agent's edit with one click.

### Philosophy

The slide model stays dependency-free: vanilla HTML, CSS and JS, so a deck keeps working long after any tool is gone. The editor app (`app/`) is a separate thing with its own dependencies (React, Radix, Tailwind); it is a convenience on top of the file, never a requirement to open or present a deck. The engine ships no layout presets: you write classes in the deck's own `<style>`, and the spec only fixes the HTML structure.

## Quick start

Requirements: **macOS** and **[Bun](https://bun.sh) 1.2.3 or newer** (developed and tested on Bun 1.4.2). See [Requirements](#requirements) for the optional pieces.

```sh
git clone https://github.com/vynnlee/slidekit.git
cd slidekit
bun install
bun run slidekit new my-talk      # creates decks/my-talk/ from a template
bun run slidekit                  # opens the app at http://127.0.0.1:3200
```

Open `my-talk` from the deck list to edit it. Double-click text to change it; edits autosave after 1.5 seconds (Cmd+S also works). Present with Cmd+Enter (from the current slide) or Shift+Cmd+Enter (from the start). Arrow keys move, `F` is fullscreen, `O` is overview, `B` and `W` black out and white out the screen.

A short sample deck, `decks/demo` (eight slides, English), shows how steps, notes and the editor behave. Open it from the deck list first.

## Features

**Editor**
- Hierarchical selection (click, double-click to go inside, Cmd+click for the innermost element), layers panel, filmstrip, zoom and pan, smart guides, multi-select, group and ungroup
- Inspector for typography, color, gradients, spacing, animation steps; deck tokens and six themes
- Find and replace across the deck, command palette (Cmd+K), image paste and drop, right-click menus
- Autosave, conflict detection when the file changes on disk, version history with restore, undo

**Presenting**
- Speaker view with notes (Markdown), timer and target time, section position, rehearsal summary
- Audience window with crossfade, overview, black and white screens
- Phone remote over QR code and a one-time code (needs an address your phone can reach)

**Comments and agents**
- Comment on an element, a slide, or a dragged area (Shift+C toggles comment mode); area comments carry an image of the area
- Claude Code channel (`channel/`, a research-preview feature) delivers comments, the agent edits the deck with an update-style tool (`slidekit_edit`) and replies in the app
- Presence: the editor shows what the agent is changing while it works
- Speech-bubble pins on the slide with a hover preview, a tray at the bottom of the panel ("N saved" and Send all), and a toggle to show or hide resolved pins
- Enter sends a comment when Claude is connected and saves it otherwise (Cmd+Enter always sends, Shift+Enter is a new line)
- Per-comment states (Saved, Sent, Working, Replied, Resolved) with the reason a comment is waiting, Resend and Cancel for stalled requests, Detached comments when a slide disappears, an hourly limit and a Pause switch for auto-processing
- Signed comments: a deck from someone else cannot talk to your agent until you trust it

**Command line**
- `lint`, `doctor` (including layout overflow checks), `bundle` (single offline HTML file), `pdf` (slides, notes, handouts), `outline` (Markdown), `image`, `new`, `templates`

## Commands

```sh
bun run slidekit                         # start the app on 127.0.0.1:3200 (PORT=... to change)
bun run slidekit help                    # command list
bun run slidekit new <name> [--template talk|blank|workshop]
bun run slidekit templates               # list templates
bun run slidekit lint <deck>             # check the deck against the spec
bun run slidekit doctor [<deck>] [--layout]   # environment and deck checks (--layout also measures overflow)
bun run slidekit image <deck> <file> [--max 2400]   # store an image in the deck's assets/ safely
bun run slidekit outline <deck> [--notes]  # print a Markdown outline
bun run slidekit bundle <deck>           # dist/<deck>.html, one self-contained file
bun run slidekit pdf <deck> [--notes | --handout [2|3|4|6]]   # dist/<deck>.pdf
# `deploy` and `unpublish` also exist but are experimental and off by default (see Known limitations)
bun run test                             # the full check suite (slow, see CONTRIBUTING.md)
bun run test:changed                     # only the steps mapped to your changes
```

Before a talk: `doctor <deck> --layout` until it reports no warnings, `bundle <deck>` and open the result offline once, and keep a `pdf <deck> --notes` backup. `docs/DEVICE-CHECKLIST.md` lists what to check on real devices.

## Using it with a coding agent

The repository ships a skill, `.claude/skills/slidekit/SKILL.md`, that teaches an agent the deck rules (structure, tokens, steps, notes, wording, verification). Point your agent at it, or use Claude Code in this repository.

For comments, start the app, then in another terminal run Claude Code with the channel:

```sh
(cd channel && bun install)
claude --dangerously-load-development-channels server:slidekit
```

The editor shows "Claude connected" when it is wired up. Details, the tool list and the security model are in [`channel/README.md`](channel/README.md). The channel is a Claude Code research preview and may change.

## Requirements

- **macOS** and **Bun 1.2.3+**. `bun install` fetches the app's dependencies. The comment channel is a separate package: run `bun install` in `channel/` once if you use it or run the full tests.
- **Chrome** (optional): needed for `slidekit pdf`, `doctor --layout`, area-comment images and browser tests. slidekit looks for Playwright's chromium headless shell first, then installed Google Chrome, Chromium or Edge. Set `SLIDEKIT_CHROME` to an executable path to choose one.
- **uv** (optional): needed only to `bundle` decks that use external web fonts (it builds font subsets; the first bundle needs the internet, results are cached in `~/.cache/slidekit`). Decks without font links do not need it.
- **git** (optional): fills the `author` of a new deck from `git config user.name`.
- `bun run slidekit doctor` checks your setup and tells you what is missing.

### Environment variables

All optional.

| Variable | What it does |
|---|---|
| `PORT` | Port of the app (default 3200). It always binds to `127.0.0.1`. |
| `SLIDEKIT_CHROME` | Path of the Chrome executable to use for PDF, layout checks and area images. |
| `SLIDEKIT_ALLOWED_HOSTS` | Extra host names the preview proxy (`app/preview-proxy.ts`) accepts, comma separated, no ports. |
| `SLIDEKIT_COMMENT_HOURLY` | Hourly limit for comments sent to an agent (default 60, `0` turns the limit off). |
| `SLIDEKIT_EXPERIMENTAL_DEPLOY` | Set to `1` to turn on the experimental publishing feature (needs `SLIDEKIT_PUBLISH_HOST` too). |
| `SLIDEKIT_PUBLISH_HOST` | `https://` host where your own Worker serves published decks. |
| `SLIDEKIT_URL` | Where the comment channel finds the app (local addresses only). |

## Project layout

```
app/        the editor app and local server (React, Bun.serve), comment and version APIs
app/test/   tests; app/test/fixtures/decks holds the decks the tests copy and edit
engine/     the vanilla slide engine (slidekit.js, slidekit.css), CLI tools (lint, doctor, pdf, outline)
bundler/    single-file bundle builder (inlines engine, images, font subsets)
channel/    MCP channel that connects comments to a Claude Code session
decks/      your decks, one folder each (decks/<name>/index.html)
spec/       the deck spec (SPEC.md) and design notes
docs/       changelog, device checklist, media; docs/internal/ has maintainer notes (status log, original plan)
deploy/     experimental publishing to your own Cloudflare Worker (off by default)
scripts/    the test runner and helpers
.claude/    the slidekit skill and project settings for Claude Code
```

## Security notes

slidekit is a local tool. The server binds to `127.0.0.1` only; do not bind it to `0.0.0.0` or expose it to the internet. Mutating API calls check `Host` and `Origin` and accept JSON only. Comment text, element excerpts and images reach an agent as data, never as instructions. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Known limitations

This is a beta. Things you may run into:

- **macOS first.** Image resizing uses `sips`, some checks use the macOS keychain, and everything is developed and tested on macOS. Linux and Windows are untested.
- **Publishing is experimental and off by default.** The code for publishing to your own Cloudflare Worker is in `deploy/`, but the Publish menu, the `deploy` and `unpublish` commands and their API routes stay switched off until you set up your own Worker and domain (`deploy/README.md`) and run with `SLIDEKIT_EXPERIMENTAL_DEPLOY=1` and `SLIDEKIT_PUBLISH_HOST=https://static.your-domain.example`. Otherwise export to a single HTML file or PDF and host it yourself.
- **Many comments render slowly on slow machines.** With 300+ comments (including 24 area comments with images) on a slow or heavily loaded machine, opening the Comments panel can take 3 to 4 seconds and the `comments-perf` test may be unstable. Comments are not lost, only rendering is slow.
- **Browser tests are heavy and some are flaky.** The full suite takes a long time and loads a laptop CPU hard. Run single steps with `bun scripts/test.ts --only <step>`. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **System Chrome for PDF is less tested** than Playwright's headless shell.
- **The comment channel is a research preview** in Claude Code and its flag and behavior can change.
- Deck behavior and the editor UI will change between betas. Back up decks you care about (they are plain files, so git is perfect for this).

## Roadmap

<!-- TODO: link the public roadmap or GitHub milestones here before the first release. -->
Coming soon. For now, open an issue to discuss ideas.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, especially the notes on tests and dependencies.

## License

[MIT](LICENSE) © 2026 Seongbeen Lee
