# Third-party notices

Agent Arcade's own source, Sprout Bot and theme assets are MIT licensed. Dependencies retain their own licenses; the project MIT license does not relicense bundled third-party code or model services.

- **Claude Agent SDK 0.3.317** and its bundled native Claude Code 2.1.317 runtime: Anthropic's package identifies its own license/terms, not MIT. See the shipped package `README.md`, native package `LICENSE.md`, [upstream repository](https://github.com/anthropics/claude-agent-sdk-typescript), and [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms). API access and charges are separate. The upstream SDK is a required bot runtime dependency, not original Agent Arcade code.
- **qrcode 1.5.4**: MIT, [upstream](https://github.com/soldair/node-qrcode); used for local QR encoding.
- **Model Context Protocol TypeScript SDK 1.32.2**: MIT, [upstream](https://github.com/modelcontextprotocol/typescript-sdk); used for the local Claude Code channel protocol.
- **zod 4.6.7**: MIT, [upstream](https://github.com/colinhacks/zod); validates the channel's bounded message schemas.
- **Tencent OpenClaw Weixin channel**, protocol consulted at commit `874637a0dbc24050f72d1385add4fc6170a2d726`: MIT, [upstream license](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/LICENSE). The small text-only adapter is independently implemented from its documented protocol; it does not bundle OpenClaw or Tencent's plugin. Tencent service/account conditions still apply.
- **Electron 45.2.1**: MIT with Chromium/Node and other third-party notices distributed by Electron. Keep the runtime's license files with packaged distributions.

Pinned direct/transitive versions are recorded in `package-lock.json`. Reference artwork discussed in `docs/DECISIONS.md` is not shipped. No third-party sounds, fonts, logos or character art have been copied into the original themes.
