# Security policy

Swipe Clean uninstalls programs and deletes folders, so security problems matter a lot here. Thank you for helping keep it safe.

## Supported versions

Only the [latest release](https://github.com/xdropp/swipe-clean/releases/latest) receives fixes. The installed app checks for new versions on startup and updates with one click.

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Instead, report it privately through [**Security → Report a vulnerability**](https://github.com/xdropp/swipe-clean/security/advisories/new).

Include what you can:

- What the problem is and what an attacker could do with it.
- Steps to reproduce, or a proof of concept.
- The app version (**⚙ Settings**, at the bottom) and your Windows version.

You'll get a reply within a few days. Once a fix is released, you'll be credited in the release notes if you'd like.

Reports in English or Portuguese are both welcome.

## What counts

Examples of things worth reporting:

- A way for the app to remove something the user didn't confirm in the review screen.
- A way for the interface (or a web page, cover image or file name) to run commands through the main process.
- A way to make the updater install a file that doesn't match the published `SHA256SUMS.txt`.

## How the app protects you

- The interface runs with `contextIsolation` and `sandbox` and only talks to the main process through a small, fixed set of functions.
- The interface never sends uninstall commands: it sends item IDs, and the main process only accepts IDs from the latest scan.
- Personal files go to the Recycle Bin; programs are removed with their own official uninstaller.
- Releases are built by GitHub Actions from this repository. The updater only runs an installer whose SHA-256 matches the published `SHA256SUMS.txt`.
