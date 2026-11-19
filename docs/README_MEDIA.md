# README images — preview.8, 2026-11-19

The current README shows the production companion renderer and the existing
ribbon logo. The former pixel-observer banner and Windows-session illustration
are no longer the front-page product images; historical evidence stays in its
original files and versioned documentation.

## What the screenshots show

| Page | Chinese | English |
| --- | --- | --- |
| Companion chat | [PNG](images/companion-chat-zh.png) | [PNG](images/companion-chat-en.png) |
| First-run AI key card | [PNG](images/first-run-zh.png) | [PNG](images/first-run-en.png) |
| Together / App memory | [PNG](images/memory-zh.png) | [PNG](images/memory-en.png) |

All six images were newly rendered on 2026-11-19 from the production HTML,
JavaScript, styles, portraits and logo at source checkpoint
`6e38ccf5fc7fd3c219164bf96505885d59517e14`. Its `src/` tree is byte-identical to
preview.8 build source `8dd258c401554b51d89a8e6923586e8095783515`.
The screenshots use the immersive dark layout at 1280 CSS pixels wide;
chat/first-run are 900 pixels high, while memory includes its complete page.
The ribbon and character artwork are reused unchanged, with their existing
[provenance](../src/assets/brand/README.md) and [portrait records](ANIME_PORTRAITS_V2.md).

**These are UI demonstrations with synthetic data.** The displayed conversation,
reply, profile, preferences, timestamps and ready/paused state are scripted
fixtures. They are not real model output, a real account connection, a record of
the owner's preferences or a new acceptance result. The API-key field is empty.
The screenshots do not establish model quality, persistence or credential access.
The separately recorded real DeepSeek checks remain in
[REAL_MEMORY_FLOW_20261116](REAL_MEMORY_FLOW_20261116.md).

No running Electron App, owner profile, chat database, API key, Keychain item,
signing credential or external provider was opened for these images. All page
requests were fulfilled from the repository; external requests were blocked.
There were zero renderer errors and zero external requests. The 108 observed
render/fixture input files were checked for changes after capture.
[Image identities and capture metadata](images/manifest.json) contain only
relative repository paths and hashes, without private receipts or transcripts.

## Reproduce

From a new checkout, use the documented Node version and locked dependencies:

```sh
npm ci --ignore-scripts --omit=optional --no-audit --no-fund
node scripts/readme-screenshots.cjs
```

This script uses an installed Google Chrome in headless mode when present;
otherwise install the matching Playwright Chromium, or provide its executable
path through `ARCADE_HEADLESS_BROWSER`. The browser runs with a new temporary
profile. The script never launches Electron, installs credentials, saves a key
or sends a model request. It rewrites only the six generated PNGs and an ignored
`outputs/readme-media/receipt.json`. Font/browser differences can change PNG
hashes; the tracked manifest identifies the exact reviewed files, not every
future render. After regeneration, inspect all images before updating that
manifest or publishing documentation.
