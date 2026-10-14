# Privacy policy — Swipe Clean

**English** · [Português](PRIVACIDADE.md)

Swipe Clean runs entirely on your computer. There is no account, no ads, no telemetry and no server of its own.

## What the app reads

- The list of installed programs (Windows registry) and Microsoft Store apps.
- The Steam and Epic Games libraries installed on your PC (name, size, folder and last-played date).
- The size of folders such as Downloads, Videos, Documents, Desktop, caches and AppData.
- With administrator rights, the `C:\Windows\Prefetch` folder, only to know when each program was last opened.

None of this is sent anywhere.

## What leaves your computer

Only when **Fetch game covers from the internet** is on (it's on by default and can be turned off in Settings):

- A **game's name**, or its **Steam/Epic ID**, is used to download its cover image from the Steam store (`store.steampowered.com`, `steamstatic.com`) or Epic Games (`graphql.epicgames.com`).
- Those stores receive the request like any website visit (including your IP address), under their own privacy policies.

Downloaded covers are saved on your PC so they don't need to be fetched again.

## Donations

The donation button (Portuguese version only) just shows a Pix QR code and code generated inside the app. Payment happens in your banking app; Swipe Clean never receives, sees or stores any payment data.

## What is saved on your PC

In `%APPDATA%\Swipe Clean\`:

| File | Contents |
|---|---|
| `config.json` | Your settings |
| `decisoes.json` | What you chose to keep, so it isn't shown again |
| `covers\` | Game covers already downloaded |
| `log.txt` | Diagnostics for the last run (recreated every time the app opens) |

To delete everything, uninstall the app and remove that folder.
