# Default AI personas

Source revision, **2026-11-04**. Personas change presentation and an optional light conversational tone. They do not connect a provider, create another agent, grant permissions, or validate work. The existing backend and channel availability rules remain authoritative.

| Backend | Default character | Basis |
| --- | --- | --- |
| Claude Code / Claude API | Ju / 橘 — long orange hair, amber eyes, orange blossom and charcoal ribbons | Owner's latest confirmed community mapping; independently generated project artwork. |
| Codex / GPT API | Dragon Girl / 龙娘 — silver hair, purple horns/eyes, ivory/lilac outfit and amethyst | Community GPT dragon motif. Local App Server and separate GPT API adapters implemented; see [Codex](CODEX.md) and [GPT scope](GPT.md). |
| DeepSeek | Whale Girl / 鲸鱼娘 — blue hair and whale-fin accents | Community whale motif. API adapter implemented; real paid API acceptance pending. See [scope](DEEPSEEK.md). |
| Gemini | Rainbow Cat / 彩虹猫 — pastel hair, cat ears, star clip, contrasting eyes | Community cat/rainbow motif. [API source integration](GEMINI.md) is available; real provider acceptance remains pending. |
| Doubao | Doubao / 豆包 — short black bob, warm everyday outfit | Project interpretation of an approachable short-haired helper; no single leading community persona was established. [Ark API source integration](DOUBAO.md) is available; real provider acceptance remains pending. |

The owner's latest clarification selects **Claude = Ju/橘 and Codex = Dragon Girl/龙娘**, matching the inspected mapping in Bothouse's `avatars/README.md` and `bridge/core/persona_presets.go`. This replaces the earlier Claude dragon choice. The owner also confirmed that anime portraits, names and light conversational style should work together. The mapping is not a universally agreed popularity ranking.

## Controls and behavior

**Connections → Default persona** defaults to the AI's character. Sprout remains an explicit alternative. **Use a light persona tone** is on by default and can be disabled. Character/tone changes require a disconnected chat and apply to the next connection; they do not rewrite an already running CLI's instructions. Anime/pixel artwork can change during a connection and does not change the selected character, model or voice setting.

In API mode the fixed style block is appended to the existing system instructions. In native WeChat mode it is appended to the MCP Channel's instructions, without replacing Claude Code's system prompt or reading its credentials. Native runtime configuration contains only an allowlisted character choice and a boolean tone flag. The shared catalog module is unpacked with the native sidecar so packaged system Node can load it.

Style is subordinate to the user's requested language, format and tone. Casual conversation can have a little character; permission requests, errors, work reports and safety-critical information remain plain and direct. No invented feelings, relationships, actions or validation results are required. These are fictional interface characters, not official provider mascots. The separate background-session prototype does not inject this chat persona.

## Research and limits

Research consulted on 2026-11-04. No comparable cross-platform dataset established a universal **most popular** persona for every AI, so this build makes no such claim.

- [GPT dragon fan-work](https://www.bilibili.com/video/BV1Qhpy6uE1s/): search index identifies a GPT dragon character. Direct page retrieval was unavailable; no live engagement count or full-frame inspection is claimed.
- [DeepSeek fan-work](https://www.bilibili.com/video/BV1WHgh6RE2s/): search index showed about 513,000 plays during research, a single indexed signal rather than a live audit or cross-platform ranking.
- [Community thread](https://linux.do/t/topic/2878430): visibly discusses the whale design and links model-personification images, including GPT, Claude and Gemini. Posts disagree about origin; we do not resolve authorship from that discussion.
- [Doubao official entry](https://www.doubao.com/) and [community examples](https://www.douyin.com/video/7679777467925663010): multiple portrayals coexist. The short-haired design here is our default art choice, not a verified most-popular claim.
- Local Bothouse portraits and persona descriptions were inspected read-only. Avatar documentation records a Discord download but does not establish a blanket art redistribution license. Other community collections list mixed terms, including noncommercial restrictions. No downloaded illustration or copied Bothouse portrait is bundled as a new asset.

## New artwork and prompts

The current five defaults use the owner's selected Japanese anime-game / moe portrait direction: expressive faces, detailed costumes, fine cel shading and distinctive ornaments. Their paths end in `-anime-v2.png`. All were generated with the built-in image generation tool and copied unchanged into `src/ui/portraits/`. The whale and cat received one framing edit using their own newly generated images; no Bothouse or other third-party image was supplied. Provider logos and official branding are absent. Previous portraits are retained as iteration records and are not selected by the default catalog.

- [Current anime v2 art direction, exact prompts, assets and hashes](ANIME_PORTRAITS_V2.md)

Earlier generation records:

- [Ju portrait: exact prompt, source file and hash](JU_ASSET.md)
- [Codex dragon and earlier unused Claude dragon: prompts, source files and hashes](DRAGON_ASSETS.md)
- [Whale and cat portraits: exact prompts, source files and hashes](PERSONA_ASSETS.md)
- [Doubao portrait: exact prompt, source file and hash](DOUBAO_ASSET.md)

The persona catalog is `src/core/personas.cjs`. Real UI and protocol tests verify selected names, local asset loading, settings persistence and fixed instruction delivery. These checks do not prove how a live model will express the persona or that phone replies have been accepted.
