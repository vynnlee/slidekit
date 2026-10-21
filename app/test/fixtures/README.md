# Test fixtures

`decks/sample` (53 slides: steps, a stepper slide, an image, inline SVG, external font links) and `decks/guide` (26 slides, no external references) are the source decks for the tests. `scripts/lib/test-deck.cjs` copies one into `decks/_e2e-<name>` and tests edit only the copy.

Both were generated once from real decks by replacing all text with meaningless English words (names and brands replaced, the photo replaced with a generated gradient), so they carry structure and layout but no real content. Do not edit them to add real content. If a test needs a new structure, add it here or create a small deck in the test itself.
