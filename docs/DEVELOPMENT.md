# Development guide

## Run the app

Requirements: Windows 10/11 and [Node.js LTS](https://nodejs.org).

```bash
npm install
npm start
```

Or double-click `iniciar.bat`. `diagnostico.bat` opens the app and starts a scan right away, logging everything to `%APPDATA%\Swipe Clean\log.txt`.

Outside Windows (or when opening `renderer/index.html` in a browser) the app runs in **demo mode** with sample games and data, which is handy for UI work. Add `?lang=en` or `?lang=pt-BR` to the URL to pick the language.

## Project structure

```
main.js           main process: window, covers, settings, removals
scanner.js        heavy scanning and cleanup in a worker thread (keeps the window responsive)
games.js          Steam, Epic and other game detection
system-filter.js  hides system components (Visual C++, .NET, DirectX, drivers…)
i18n.js           all user-facing text, in Portuguese (pt-BR) and English (en)
updater.js        checks GitHub Releases and installs updates after checking SHA-256
pix.js            Pix QR code generation (Brazilian BR Code standard)
preload.js        secure bridge between the UI and the main process
scripts/*.ps1     reads the Windows registry and Store apps
renderer/         UI (summary, cards, review, progress, settings)
vendor/qrcode/    QR code generator (MIT, Kazuhiko Arase)
build/            app icon and installer resources
docs/             README images and this guide
```

Principles the code follows:

- **The UI never receives uninstall commands.** It only sends IDs; the main process accepts only IDs from the latest scan.
- **Heavy work stays off the main process.** On Windows, Electron's main process draws the window, so blocking it freezes the app.
- **Nothing is deleted without review.** Personal files go to the Recycle Bin; programs use their official uninstaller.

## Translations

Every user-facing string lives in `i18n.js`, with the same keys for `pt-BR` and `en`. Entries with `{ one, other }` pick the form by the value of `{n}`. The app follows the Windows language (Portuguese → `pt-BR`, anything else → `en`) and can be changed in Settings.

To add a string, add the key to both languages and use `t('key', { param })`. A quick check that both languages have the same keys:

```bash
node -e "const i=require('./i18n.js');const a=Object.keys(i.STRINGS['pt-BR']),b=Object.keys(i.STRINGS.en);console.log(a.filter(k=>!b.includes(k)),b.filter(k=>!a.includes(k)))"
```

## Build the installer locally

```bash
npm run dist
```

Or double-click `build.bat`. The installer and the portable version are written to `dist\`.

## Publish a version

Versions are built and published automatically by GitHub Actions (`.github/workflows/release.yml`):

1. Bump `"version"` in `package.json` (e.g. `1.5.0`).
2. Add a `## [1.5.0] - YYYY-MM-DD` section to `CHANGELOG.md`. It becomes the release notes.
3. Commit and push to `main`.

If there's no Release for that version yet, GitHub builds on Windows, creates the `v1.5.0` tag and publishes both `.exe` files plus `SHA256SUMS.txt` under **Releases** within a few minutes. Pushes that don't change the version don't publish anything, so documentation fixes are safe to push.

To retry a failed publish, use **Actions → Publicar versão → Run workflow**.

## Updates

On startup (unless turned off in Settings), `updater.js` reads `releases/latest` from the GitHub API and compares the tag with the app version.

- **Installed version:** downloads `SwipeClean-Setup-x.y.z.exe`, checks its SHA-256 against the line with the same file name in `SHA256SUMS.txt`, then runs it with `/S --updated --force-run` (silent install that reopens the app). If the checksum doesn't match, the file is deleted and nothing runs.
- **Portable version and `npm start`:** only shows the banner and opens the download page.

A release without `SHA256SUMS.txt` can't be installed automatically, so keep that file in every release.
