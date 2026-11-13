# SillyTavern feature parity

Checked on 2026-11-13 against SillyTavern revision
`06bde939fb1e9c4c8d8641d810f0a916b5bce127`. Agent Arcade is AGPL-3.0 and
adapts upstream logic file by file; provenance is in
[`src/vendor/sillytavern/README.md`](../src/vendor/sillytavern/README.md).
The interface is written in Agent Arcade's own style, not copied.

Everything below applies to the in-App conversation with a character from the
character library. The built-in companions, QQ and WeChat keep their own flow.

"Verified" here means unit tests with injected fake model runners and isolated
demo-window screenshots with synthetic data. No row has been exercised with a
real model or by a person using it day to day unless it says so.

## Ported

| Feature | Where | Notes |
|---|---|---|
| Character cards V1/V2/V3, PNG and JSON, import and export | `src/vendor/sillytavern/character-card-parser.cjs`, `character-card.cjs`, `src/bot/character-cards.cjs`, `src/bot/character-library.cjs` | CHARX archives are not read. |
| First message and alternate greetings | `src/bot/st/local-pipeline.cjs` | Inserted once at the start of an empty conversation. |
| Description, personality, scenario, example dialogue | `src/bot/st/prompt-builder.cjs` | Example blocks are dropped first when over budget, as upstream does by default. |
| Card system prompt and post-history instructions | `src/bot/st/prompt-builder.cjs` | Apply only to tool-less conversation. The application's own policy text always comes first and cannot be replaced. |
| Macros `{{char}}`, `{{user}}`, `{{persona}}`, time/date, `{{random}}`, `{{roll}}`, comments | `src/vendor/sillytavern/macros.cjs` | Variable, pipe, input and script macros are left untouched. |
| World info / lorebooks: keys, secondary-key logic, regex keys, whole-word and case options, probability, order, budget, recursion, inclusion groups, sticky/cooldown/delay, before/after/at-depth positions | `src/vendor/sillytavern/world-info.cjs`, `src/bot/st/lorebooks.cjs` | Budget is in characters, not tokens. |
| User persona | `src/bot/st/local-settings.cjs` | One persona per profile. |
| Author's note with depth and role | `src/bot/st/prompt-builder.cjs` | |
| Prompt order and presets, import of chat-completion presets | `src/bot/st/presets.cjs` | Maps main prompt, post-history, order, temperature, top-p and max tokens; other preset keys are listed as ignored. |
| Sampling: temperature, top-p, reply cap | `src/bot/generation.cjs` and the API runners | Temperature and top-p reach DeepSeek, Gemini and Doubao. Current Claude and GPT models accept only the reply cap. |
| Edit, delete, regenerate, swipes, continue | `src/bot/local-companion.cjs`, `src/bot/social-store.cjs` | Up to 10 swipes per message. |
| Streaming replies | API runners, `src/bot/generation.cjs` | Not available through the local Claude program or the optional Claude Agent SDK. |
| Chat branches | `src/bot/st/branch-store.cjs` | A branch is a full copy up to the chosen message. Memory facts are shared by all branches of a character. |
| Regex scripts: placements, markdown-only / prompt-only, depth window, run-on-edit, trim strings, capture groups | `src/vendor/sillytavern/regex-scripts.cjs`, `src/bot/st/regex-pipeline.cjs` | Global scripts only. Patterns run under a time limit. |
| Group chat: natural, list, pooled and manual order, talkativeness, mentions, muted members, swap/join card fields | `src/vendor/sillytavern/group-chat.cjs` | Name mentions also match CJK names, which upstream does not. |

## Not ported, and why

| Feature | Reason |
|---|---|
| Third-party extension loader, UI extensions, server plugins | Runs arbitrary downloaded code inside the app. Agent Arcade does not execute content it imports. |
| STscript, slash commands, Quick Replies | A scripting language driven by chat and card text; same reason. |
| Card-embedded scripts, tools and extension settings | Kept as inert data only. |
| Image generation, image captioning | Needs separate model services and their own cost/consent handling. Not part of the companion core. |
| Vector storage, Data Bank, RAG, summarisation extension | Agent Arcade keeps an explicit, owner-approved memory list instead; automatic retrieval is a separate decision. |
| Text-completion backends (KoboldAI, text-generation-webui, NovelAI, Horde), instruct and context templates, tokenizers | Agent Arcade talks to chat-style APIs only. Budgets are counted in characters. |
| Multi-user accounts, server mode, remote access | Agent Arcade is a single-user local desktop app. |
| World info: group scoring, minimum activations, generation-type triggers, character/tag filters, outlets, vectorised entries, per-entry persona/description matching switches | Not adapted yet; affected entries still import and the unsupported settings are ignored with a warning. |
| Character-scoped and preset-scoped regex scripts, regex debugger | Only one global ordered list exists. |
| Group chat auto mode, group-level scenario overrides, join prefixes/suffixes | Not adapted yet. |
| Expressions/sprites, backgrounds, themes, TTS and STT extensions | Agent Arcade has its own appearance and voice features. |
| CHARX card archives, character tags/folders UI, bulk edit | Not adapted yet. |

## Behaviour that differs on purpose

- The application's safety and identity text is always first in the system
  prompt. A card or preset can replace the main prompt section but never that
  text.
- Imported text is data. A lorebook, card, preset or regex script cannot give
  the character tools, account access or the ability to contact anyone.
- Regex patterns from imported files are screened and run with a time limit; a
  pattern that is rejected or times out is skipped and the text is left as it
  was.
- Correcting or forgetting a memory fact clears the conversations derived from
  it, including every branch of that character.
