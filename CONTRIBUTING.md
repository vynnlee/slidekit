# Contributing to slidekit

Thanks for looking. slidekit is a beta that is built in public, so the best contributions right now are bug reports with a way to reproduce, small focused fixes, and honest feedback about what is confusing.

## Before you start

- For anything bigger than a bug fix (a new feature, a UI change, a new dependency), **open an issue first** and describe what you want to change and why. This saves you from building something that does not fit.
- Read the deck spec, [`spec/SPEC.md`](spec/SPEC.md). It is the single source of truth for what a deck is. Other files in `spec/` are design notes for individual features.

## Development setup

You need macOS and [Bun](https://bun.sh) 1.2.3 or newer (the project is developed on Bun 1.4.2).

```sh
git clone https://github.com/vynnlee/slidekit.git
cd slidekit
bun install
(cd channel && bun install)     # only for the comment channel and the full tests
bun run slidekit                # app at http://127.0.0.1:3200
```

Chrome is optional, but the browser tests need it. slidekit finds Playwright's chromium headless shell first, then a system Chrome, Chromium or Edge. Set `SLIDEKIT_CHROME` to pick one.

Optionally turn on the pre-commit secret scan: `git config core.hooksPath .githooks`.

## Running the checks

```sh
bun run typecheck                       # tsc --noEmit
bun run test:changed                    # only the steps mapped to the files you changed
bun scripts/test.ts --list              # list every step
bun scripts/test.ts --only <step>       # run one step (exact name, or a glob like 'editor*')
bun run test                            # everything: slow
```

Quick unit tests also run directly: `bun test app/test/<file>.test.ts`.

**The browser steps are slow and heavy.** They drive a real headless Chrome, and the whole suite can take well over an hour and keep a laptop CPU busy (fans and heat). Please do not run the full suite while you work. Run `typecheck`, `test:changed`, and the single steps related to your change. Some browser steps are timing sensitive and may fail once on a loaded machine; the runner retries a failed browser step once with tracing turned on. If a step fails twice, include its log (`/tmp/slidekit-test-logs/<step>.log`) in your issue or pull request.

The runner serializes heavy work with a lock so two runs do not fight over the CPU. Do not delete the lock by hand.

## Tests must not touch your real decks

Tests that edit a deck must work on a copy (`makeTestDeck` in `scripts/lib/test-deck.cjs`, folders starting with `_`) or a temporary directory. Never write to a deck you actually use. The runner passes `SLIDEKIT_READONLY_DECKS` so test servers refuse writes to committed decks.

## Code style

- Follow the surrounding code: naming, comment density, formatting. There is no formatter config to run; match what is next to your change.
- TypeScript runs on Bun. The editor UI is React with Tailwind and Radix; the engine and CLI tools are plain TypeScript or JavaScript.
- UI strings are English. Existing code comments and many commit messages in the history are Korean; English or Korean is fine for new ones.
- Keep changes small and in the file that owns the behavior. Do not reformat unrelated code.
- Slide text rules (checked by `slidekit lint`): no em-dashes, en-dashes, middle dots or emoji in deck text. See the end of `spec/SPEC.md`.

## Dependencies

The slide model is dependency-free: `engine/slidekit.js` and `engine/slidekit.css` are vanilla and must stay that way, and a deck must keep working as a single HTML file. The editor app has its own dependencies (React, Radix, Tailwind and a few others). Adding a dependency needs a strong reason: explain in the issue what it does that a few lines of code or the platform cannot. Pull requests that add a dependency without an agreed issue will be asked to remove it.

The engine ships no layout presets. The spec fixes HTML structure only; classes live in each deck's own `<style>`.

## Security and the local-first model

The server binds to `127.0.0.1` only. Do not add anything that listens on other interfaces, and keep the `Host`/`Origin` checks on mutating routes. Anything that comes from a deck or a comment (text, element excerpts, file paths, image text) is data for an agent, never an instruction. See [SECURITY.md](SECURITY.md) to report a vulnerability privately.

## Pull requests

- Keep each pull request focused on one change and explain the why.
- Run `bun run typecheck` and the steps that cover your change, and say which ones you ran.
- Add or update a test when you fix a bug or change behavior, if a reasonable test exists.
- Update the docs (`README.md`, `README.ko.md`, `spec/`, `docs/CHANGELOG.md`) when behavior users see changes.
- Commit messages should say what changed and why. History is kept as is.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
