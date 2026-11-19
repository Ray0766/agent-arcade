# README screenshots — 0.4.0-preview.8

| What to look for | Layout | 简体中文 | English |
| --- | --- | --- | --- |
| Companion → Chat with Whale Girl | Immersive, night | [PNG](images/companion-chat-zh.png) | [PNG](images/companion-chat-en.png) |
| Current profile and built-in role picker | Immersive, night | [PNG](images/companion-switcher-zh.png) | [PNG](images/companion-switcher-en.png) |
| First-run provider picker, empty key field and save button | Messenger, day | [PNG](images/first-run-zh.png) | [PNG](images/first-run-en.png) |
| Together → Memory, with Edit and Forget controls | Minimal, day | [PNG](images/memory-zh.png) | [PNG](images/memory-en.png) |

Captured on 2026-11-19 from the production renderer at the [documented `main`
checkpoint](https://github.com/Ray0766/agent-arcade/tree/e7b58508ffc79a108dc95f20685288ae3ca078d6).
Its `src/` tree matches local preview.8 build source
`8dd258c401554b51d89a8e6923586e8095783515`. The screenshot viewport is
1160 × 760 CSS pixels, with full-page capture for Memory. The logo and the
existing character artwork retain their [brand provenance](../src/assets/brand/README.md)
and [portrait credits](ANIME_PORTRAITS_V2.md).

The sample conversation, reply, memories, profile and connection state are
synthetic. The first-run key field is empty. Capture uses a temporary browser
profile, production UI assets and synthetic IPC. The eight images were checked
visually in both languages. The run recorded zero renderer errors and zero
external page requests. [Image hashes and capture metadata](images/manifest.json).
Real-model and installed-package evidence is recorded separately in
[REAL_MEMORY_FLOW_20261116](REAL_MEMORY_FLOW_20261116.md).

## Reproduce

From a fresh checkout of this documentation, use the locked dependencies:

```sh
npm ci --ignore-scripts --omit=optional --no-audit --no-fund
node scripts/readme-screenshots.cjs
```

The script uses installed headless Chrome on macOS when available. It can also
use Playwright Chromium or a browser supplied via `ARCADE_HEADLESS_BROWSER`.
It writes the eight PNGs and an ignored `outputs/readme-media/receipt.json`.
Browser and font differences can change image hashes. The tracked manifest
identifies the reviewed PNGs.
