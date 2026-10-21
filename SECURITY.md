# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately with GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe what you found, how to reproduce it, and what you think the impact is.

If private reporting is not available for some reason, open an issue that says only that you have a security report and ask for a private channel. Do not include details in the issue.

slidekit is a beta maintained by one person. I will read reports as soon as I can and aim to reply within a week, but I cannot promise a fix timeline. Please give me a reasonable amount of time to fix an issue before you disclose it publicly.

## Supported versions

Only the latest beta release (and the `main` branch) is supported. There are no backports.

## What counts

slidekit is a **local-first** tool. The editor server binds to `127.0.0.1` and is meant to be used by one person on their own machine. In scope:

- A web page or another local user making the server read, write or delete things it should not (for example a path traversal out of `decks/`, a request that passes the `Host` and `Origin` checks when it should not, or a cross-site request that changes a deck).
- A deck, comment or image that makes slidekit run code, leak a file, or write outside its folder (for example SVG scripts, unsafe image handling, or bundling that reads files outside a deck).
- A deck or comment that makes a coding agent connected through the comment channel treat deck content as an instruction. Comment text, element excerpts, paths and image text are supposed to reach the agent as data only.
- Signature bypass in the comment channel (comments that are not signed by your key must not reach the agent until you trust them).
- Secrets or personal data ending up in the repository, in bundles, or in exported files.

Out of scope:

- Running the server on `0.0.0.0` or exposing it to the internet. This is explicitly unsupported; do not do it.
- Problems that need an attacker who already controls your machine, your account or your shell.
- A deck you wrote yourself that contains your own scripts. A deck is an HTML page and may run JavaScript when you open or present it; only open decks you trust.
- Denial of service by a very large local file you chose to open.

## Hardening notes for users

- Keep the server on `127.0.0.1`. If you need access from your phone or another device, use a private network tool and forward to `127.0.0.1`; never forward it to the public internet.
- Treat decks and `comments.json` files from other people as untrusted. Comments without your signature show as Unverified and are not sent to an agent until you press Trust.
- The comment signing key lives in `~/.config/slidekit/comments.key` (mode 0600). Do not share it.
