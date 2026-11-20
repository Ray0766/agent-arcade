# README screenshots

The English and Simplified Chinese README screenshots show
**0.4.0-preview.61**, a local Apple Silicon verification build. The
[pinned public source](FIRST_RUN.md#exact-remote-source--精确远端源码)
remains **0.4.0-preview.8**.

| Screen | Layout | 简体中文 | English |
| --- | --- | --- | --- |
| Companion → Chat, with a sample conversation about a trip to the coast | Immersive, night | [PNG](images/preview61/companion-chat-zh.png) | [PNG](images/preview61/companion-chat-en.png) |
| Saved profile and built-in character picker | Immersive, night | [PNG](images/preview61/companion-switcher-zh.png) | [PNG](images/preview61/companion-switcher-en.png) |
| First run, with GPT selected and an empty API key field | Messenger, day | [PNG](images/preview61/first-run-zh.png) | [PNG](images/preview61/first-run-en.png) |
| Together → Memory, with Edit and Forget controls | Minimal, day | [PNG](images/preview61/memory-zh.png) | [PNG](images/preview61/memory-en.png) |
| Mac QQ group setup, with a suggested local OneBot port | Messenger, day | [PNG](images/preview61/mac-qq-zh.png) | [PNG](images/preview61/mac-qq-en.png) |

Captured on 2026-11-20 from the production renderer in the verification
ZIP's `app.asar`. The embedded build source is
`2c9de2dab7154820e86e5c3d03d3f196eb6a9395`. The viewport is
1160 × 760 CSS pixels, or 1160 × 1080 for Mac QQ. Memory and Mac QQ use
full-page capture. The chats, memories, profile and OneBot port are
synthetic. Both the API key and QQ number are blank. The capture reported
zero renderer errors and zero external page requests.
[Image and package SHA-256 hashes](images/preview61/manifest.json).
[Local verification scope](CANDIDATE_STATUS.md#local-apple-silicon-preview61).

The logo and portraits are the project's existing
[brand assets](../src/assets/brand/README.md) and
[credited character artwork](ANIME_PORTRAITS_V2.md).

## Screens from the public source

These earlier captures show the exact [public preview.8 source checkpoint](https://github.com/Ray0766/agent-arcade/tree/e7b58508ffc79a108dc95f20685288ae3ca078d6),
with synthetic demo data. [Capture manifest](images/manifest.json) ·
[Real DeepSeek acceptance scope](REAL_MEMORY_FLOW_20261116.md).

| Screen | 简体中文 | English |
| --- | --- | --- |
| Companion chat | [PNG](images/companion-chat-zh.png) | [PNG](images/companion-chat-en.png) |
| Companion switcher | [PNG](images/companion-switcher-zh.png) | [PNG](images/companion-switcher-en.png) |
| First run | [PNG](images/first-run-zh.png) | [PNG](images/first-run-en.png) |
| App memory | [PNG](images/memory-zh.png) | [PNG](images/memory-en.png) |

## Earlier local captures

The `0.4.0-preview.34` set remains archived with its
[image hashes and build identity](images/preview34/manifest.json).

## Reproduce

From a checkout of this documentation, install the locked dependencies and
run the public-source capture. It writes a new demo set in
`docs/images/preview8/`.

```sh
npm ci --ignore-scripts --omit=optional --no-audit --no-fund
node scripts/readme-screenshots.cjs
```

If you have the local preview.61 verification ZIP, extract it to a temporary
directory and pass its bundle's `app.asar` to the same script. Keep the
extracted `app.asar.unpacked` directory next to the archive.

```sh
node scripts/readme-screenshots.cjs --asar '/path/to/Agent Arcade.app/Contents/Resources/app.asar'
```

The script uses headless Chrome on macOS when available. It also supports
Playwright Chromium or a browser supplied through `ARCADE_HEADLESS_BROWSER`.
Each run writes an ignored `outputs/readme-media/receipt.json`. Browser
and font differences can change the hashes.
