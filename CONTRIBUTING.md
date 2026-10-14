# Contributing to Swipe Clean

Thanks for wanting to help! Bug reports, ideas, translations and code are all welcome, in English or Portuguese.

## Reporting a bug

[Open a bug report](https://github.com/xdropp/swipe-clean/issues/new/choose) and attach `log.txt` (**⚙ Settings → Open folder**). The log shows what was found and what failed, which usually makes the problem obvious.

Something that showed up as a card but shouldn't have (or a game that's missing) is a bug too. Mention the program's name and where it's installed.

For security problems, please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Suggesting an idea

[Open an idea](https://github.com/xdropp/swipe-clean/issues/new/choose) describing the problem you'd like solved, not just the solution. "I have 300 GB of old Steam screenshots and the app doesn't show them" is more useful than "add a screenshots category".

## Contributing code

1. Fork the repository and create a branch from `main`.
2. Follow the [development guide](docs/DEVELOPMENT.md) to run the app. Outside Windows it opens in demo mode, which is enough for most UI changes.
3. Keep pull requests focused on one thing, and explain what changed and how you tested it.
4. Any text the user sees goes in `i18n.js`, in **both** `pt-BR` and `en`.

A few rules the code follows and pull requests should keep:

- **Nothing is removed without the review screen.** Swiping only marks.
- **The interface never builds commands.** It sends item IDs; the main process decides what to run.
- **Heavy work stays off the main process.** Use `scanner.js` (a worker thread) for disk and registry scans.
- **No new network requests without a setting to turn them off**, and a line in [PRIVACY.md](PRIVACY.md) and [PRIVACIDADE.md](PRIVACIDADE.md).
- **No new runtime dependencies unless really needed.** The app is small on purpose.

## Releases

Only the maintainer publishes versions. Bumping `version` in `package.json` and adding a section to `CHANGELOG.md` on `main` makes GitHub Actions build and publish it. See [Publish a version](docs/DEVELOPMENT.md#publish-a-version).

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE.txt).
