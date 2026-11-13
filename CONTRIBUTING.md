# Contributing

Small, verifiable changes are welcome. State accuracy comes before extra animations.

1. Fork the repository. Use Node.js 24.18+ within the 24.x line for the complete current test suite, including the optional transfer service.
2. Run `npm ci`, then `npm ci --prefix deploy/transfer-helper --ignore-scripts --omit=optional --no-audit --no-fund`. Run `npm test`, `npm run check`, and `npm run test:transfer-helper`. The second install is isolated from Electron's dependencies and does not start or deploy a service.
3. For behavior changes, add an event sequence test covering the failure and recovery. Use synthetic IDs and folder names.
4. Run `npm run test:ui` for desktop changes. Attach a screenshot for UI or theme work; test reduced motion and both languages.
5. Explain the user-visible change, validation, and limitations in the pull request.

Never submit API keys, private prompts, transcript files, actual Claude settings, or confidential results. Themes need an author and a license compatible with AGPL-3.0; do not submit assets copied from games. Read [THEMES.md](docs/THEMES.md).

Use respectful, specific feedback. Harassment and discriminatory conduct are not welcome. By contributing, you agree that your contributions may be distributed under the project's AGPL-3.0 license.
