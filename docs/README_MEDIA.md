# README screenshots

The current English and Simplified Chinese README screenshots show
**0.4.0-preview.34**, the local Apple Silicon Mac candidate. The public
source instructions use **0.4.0-preview.8**. The pinned source and its
original screenshots are listed below.

| Screen | Layout | 简体中文 | English |
| --- | --- | --- | --- |
| Companion → Chat, with a sample conversation about a rainy Saturday | Immersive, night | [PNG](images/preview34/companion-chat-zh.png) | [PNG](images/preview34/companion-chat-en.png) |
| Saved profile and built-in character picker | Immersive, night | [PNG](images/preview34/companion-switcher-zh.png) | [PNG](images/preview34/companion-switcher-en.png) |
| First run, with GPT selected and an empty API key field | Messenger, day | [PNG](images/preview34/first-run-zh.png) | [PNG](images/preview34/first-run-en.png) |
| Together → Memory, with Edit and Forget controls | Minimal, day | [PNG](images/preview34/memory-zh.png) | [PNG](images/preview34/memory-en.png) |
| Mac QQ group setup, with a suggested local OneBot port | Messenger, day | [PNG](images/preview34/mac-qq-zh.png) | [PNG](images/preview34/mac-qq-en.png) |

Captured on 2026-11-20 from the production renderer. The viewport is
1160 × 760 CSS pixels, or 1160 × 1080 for Mac QQ. Memory and Mac QQ use full-page capture. The capture checkout was
`5452a4bb53075a25483b30ba27a742e0d085a32c`, the evidence commit immediately
after build source `19e7878deb3053cb22d048dca45a7a93cab54aba`. The renderer
and its capture fixture match the build source. The chat, memories, profile,
and QQ port recommendation are synthetic. Both the API key and QQ number are
blank. The browser run recorded zero renderer errors and zero external page
requests. [Image hashes](images/preview34/manifest.json) ·
[Local candidate scope](CANDIDATE_STATUS.md#local-mac-candidate--2026-11-20).

The ribbon logo and character artwork use the project's existing
[brand assets](../src/assets/brand/README.md) and
[credited portraits](ANIME_PORTRAITS_V2.md).

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

## Reproduce

From a fresh checkout of this documentation, install the locked dependencies
and run the public-source capture. It writes a new illustrated fixture under
`docs/images/preview8/`.

```sh
npm ci --ignore-scripts --omit=optional --no-audit --no-fund
node scripts/readme-screenshots.cjs
```

To rerender the preview.34 set, run the same script with the path to a clean
local preview.34 checkout as its first argument. The script uses installed
headless Chrome on macOS when available. It also supports Playwright Chromium
or a browser supplied via `ARCADE_HEADLESS_BROWSER`. Each run writes an ignored
`outputs/readme-media/receipt.json`. The tracked manifests identify the
reviewed PNGs. Browser and font differences can change the hashes.
