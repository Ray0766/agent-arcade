# Agent Arcade on macOS

Status on 2026-11-14: **adapted on a Windows machine and never started on a
real Mac.** What exists as evidence, all of it produced on Windows:

- unit tests that pass the platform in as `darwin` (`test/platform.test.cjs`,
  `test/platform-discovery.test.cjs`);
- the real main-process startup, IPC registration, one poll and a full quit run
  against a synthetic Electron with `process.platform` set to `darwin`
  (`test/platform-main.test.cjs`);
- one load of the real interface in headless Chromium with the macOS preload
  bridge (no page errors; not kept as a test);
- the full suite on Windows after the change: 5154 tests, 0 failures.

Nothing in this page is a claim that the app has run on macOS. Work through the
checklist at the end before trusting any of it.

Windows behaviour is unchanged. Platform decisions live in
[`src/core/platform.cjs`](../src/core/platform.cjs); the macOS menu is built by
[`src/core/app-menu.cjs`](../src/core/app-menu.cjs).

## What is meant to work

| Area | On macOS |
| --- | --- |
| App conversation | Built-in and library characters over the HTTPS API runners (Claude, GPT, DeepSeek, Gemini, Doubao), character library, lorebooks, groups, conversation settings, notes and reflection |
| Notices and data sources | ICS files, folders and feeds; desktop notifications through Electron |
| Settings, three layouts, first-run flow | Same pages as Windows |
| API keys | Stored through Electron `safeStorage`, which uses the login Keychain |
| Window and menu | Standard title bar, an application menu with the usual Edit, View and Window items, a menu-bar icon, the Dock icon |
| Work side | Claude Code hook observer, background sessions and the task board (git worktrees). These start your own `claude` and `git` |
| Chat channels that are plain network clients | WeChat ClawBot, Feishu, X, Messenger, and QQ **through a OneBot bridge you already run** (enter its WebSocket URL and token under Work › Channels) |

## What is hidden, and why

These features are built on Windows facilities. On macOS (and Linux) the main
process does not construct or poll them, their IPC channels answer
`{ok:false, code:'unsupported_platform'}`, the preload bridge leaves their
functions out, and the interface therefore shows no entry for them.

| Hidden on macOS | Reason |
| --- | --- |
| **QQ accounts** page: finding, starting, stopping and repairing a local NapCat/QQ install, process inspection, component packages, first setup, profile backups, orphan cleanup | Uses Windows PowerShell and CIM, Windows program paths, `.exe` discovery and `%LOCALAPPDATA%` |
| Remote NapCat management, file transfer and the supervisor panels | They live inside the QQ accounts page; the passkey helper calls the Windows WebAuthn API |
| QQ Chat Exporter (QCE) panels and scheduled exports; the SSQQ client view | Depend on the managed Windows QQ runtime |
| QQ owner tools reached from that page (history, remark, images, voice messages, friend requests, profile, groups, plugins) | Bound to an account managed by the QQ accounts page |
| Voice conversation | The only system speech backend is Windows `System.Speech`. `createVoiceRuntime` reports `voice_platform` ("Windows speech is only available on Windows…") instead of failing later. The optional Qwen/GPT-SoVITS backend is hidden with it: it has never been set up outside Windows and its process checks expect `python.exe` |

Two actions stay visible and answer with a plain message instead of working:

- **Start in a terminal** for the Claude Channels mode: opening and verifying a
  terminal window uses PowerShell. The displayed command is built for a POSIX
  shell (each path is one single-quoted literal); copy it into your own terminal.
- **Sign in** for the Claude Code / Codex provider cards: opening the sign-in
  window uses PowerShell, so the card answers `unsupported_platform` and asks
  you to open the original program yourself. Run `claude auth login` or
  `codex login` in your own terminal; the status check itself is not
  Windows-specific.

In the first-run wizard the QQ row reads "Connect an existing QQ" and opens the
OneBot form; on Windows it reads "Manage QQ accounts".

## Run from source

Prerequisites: macOS on Apple Silicon or Intel, Node.js 22.13 or newer (CI uses
24), and for the Work side `claude` (Claude Code 2.1.317 or newer) and `git`.

```sh
npm ci
npm start          # or: npm run demo   (sample data, no account)
```

Unit tests and the syntax check:

```sh
node scripts/check.cjs
npm test
```

## Build the unsigned package

```sh
npm run pack:mac   # host architecture only: dist/mac-arm64/Agent Arcade.app (dist/mac/ on Intel)
npm run dist:mac   # dmg and zip for arm64 and x64
```

Both first run `scripts/build-icon.cjs`, which writes `src/assets/app-mac.png`
(1024 px, generated from the brand source; not committed). electron-builder
converts it to `.icns`.

The build is **ad-hoc signed** (`"identity": "-"`) and **not notarized**, with
the hardened runtime off. Apple Silicon refuses to run code that has no
signature at all, so "unsigned" here means "signed with no identity". Gatekeeper
still blocks a downloaded copy. To open it:

- In Finder, Control-click the app, choose **Open**, then **Open** again; on
  recent macOS versions you may instead need System Settings › Privacy &
  Security › **Open Anyway**; or
- remove the quarantine attribute:
  `xattr -dr com.apple.quarantine "/Applications/Agent Arcade.app"`

A build made on the same Mac that runs it is not quarantined.

The proprietary Claude Agent SDK is excluded from every package, as on Windows.

## Tests and CI

`.github/workflows/ci.yml` runs `npm ci`, `node scripts/check.cjs` and the unit
tests on `windows-latest`, `macos-latest` and `ubuntu-latest`. Only the Windows
leg blocks the build: the suite has never had a green run on macOS, and its
current Linux state is unknown, so both are `continue-on-error` until someone
has looked at a first run. The job `mac-package` builds `npm run pack:mac` on
`macos-latest` and uploads the bundle as the artifact
`agent-arcade-macos-unsigned`; it publishes nothing and uses no secret.

On macOS these tests are registered as skipped, each with its reason
(`test/helpers/platform-skip.cjs`):

- 43 `qq-*` files that exercise the local QQ management layer or the QQ
  supervisor / transfer-helper services. All of them need an operating-system
  owned single-owner lock, which is a Windows named pipe or a Linux abstract
  socket; macOS has neither, and the app does not build that layer there. On
  Windows and Linux these files import `node:test` itself, unchanged.
- Four single tests in otherwise portable files, for the same reason.
- `test/qq-qce-startup.test.cjs` on every platform but Windows: the module it
  tests refuses any other platform.
- The tests that already carried `skip: process.platform !== 'win32'` (live
  PowerShell, NTFS and process tests).

The list was derived on Windows by reading the platform checks in the code and
by one run of the suite with `process.platform` reported as `darwin`. It is a
prediction: a real macOS run may show more tests to fix or skip.

## `claude`, `git`, `node` and `codex`

An app started from Finder or the Dock does not inherit your shell's `PATH`.
At startup the app appends these locations (only those that exist) to its own
`PATH`, and the discovery code searches them directly. No login shell is run.

- `~/.local/bin`, `~/.claude/local`, `~/bin`, `~/.npm-global/bin`
- `~/.volta/bin`, `~/.bun/bin`, `~/.asdf/shims`, `~/.local/share/mise/shims`,
  `~/.nodenv/shims`, `~/Library/Application Support/fnm/aliases/default/bin`
- the three newest versions under `~/.nvm/versions/node/*/bin`
- `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `/usr/local/bin`, `/usr/bin`,
  `/bin`, `/usr/sbin`, `/sbin`

A tool installed anywhere else is found only when the app is started from a
terminal (`npm start`, or `open -a "Agent Arcade"` does **not** count: use
`"/Applications/Agent Arcade.app/Contents/MacOS/Agent Arcade"`).

`/usr/bin/git` on a Mac without the Xcode Command Line Tools is a stub that
opens an install prompt.

## Where data lives

| What | Path |
| --- | --- |
| App data: config, conversations, characters, lorebooks, notes, sources, the encrypted credential file, hook inbox | `~/.agent-arcade` (override with `AGENT_ARCADE_HOME`) |
| Electron profile (Chromium state) | `~/Library/Application Support/agent-arcade` when run from source; `~/Library/Application Support/Agent Arcade` for the packaged app |
| Key that encrypts saved credentials | Login Keychain, an item named after the app ("… Safe Storage") |
| Claude Code settings edited by **Install hooks** | `~/.claude/settings.json` (override with `AGENT_ARCADE_CLAUDE_SETTINGS`); a timestamped backup is written beside it |
| Installed hook script | `~/.agent-arcade/bin/hook.cjs` |
| Single-window lock | `/tmp/agent-arcade-<hash>.sock` |

The hook is written in exec form (`command` is the Node.js path, `args` holds
the script path), so no shell parses either path.

## Known differences from Windows

- **Send shortcut.** The setting saved as `ctrl-enter` is shown and handled as
  ⌘+Enter (Control+Enter also works). The command palette of the Minimal layout
  shows ⌘K.
- **Closing the window** hides it even when no menu-bar icon could be created;
  the app stays in the Dock and clicking it shows the window. Quit with ⌘Q, the
  application menu or the menu-bar icon.
- **Title bar.** The standard macOS title bar is used on purpose: the top bar
  then cannot sit under the window buttons and needs no drag region. An inset
  title bar is a visual change to make on a real Mac, where it can be seen.
- **Menu-bar icon** is the coloured brand mark at 18 pt, not a monochrome
  template image, so it does not adapt to a dark menu bar.
- **Saved API keys are tied to the app name.** A key saved while running from
  source is expected to be unreadable by the packaged app and the reverse
  (different Keychain items); enter it again. An ad-hoc signed build may also be
  asked for Keychain access again after every rebuild.
- **Stopping a local Claude program task** sends `SIGTERM` to the `claude`
  process the app started. Windows ends its whole process tree
  (`taskkill /T`); on macOS a command that `claude` itself started is left to
  `claude` to clean up.
- **Path comparisons are case-sensitive** in the task board and scope hashes,
  although the default macOS volume is not. A path spelled with different
  capitalisation is treated as a different path and refused, never accepted.
- **No voice, no QQ management, no provider sign-in window, no managed
  terminal** (see above).
- **Fonts.** The Windows fonts stay first in the stack; macOS falls through to
  the system font and PingFang SC / Hiragino Sans GB.
- **CI.** The macOS and Linux test legs do not block the build yet.

## Never run on a real Mac — verify first

Ordered by how much depends on it. Tick each one on the Mac and record what you
saw; a unit test with `platform: 'darwin'` is not that evidence.

Startup and storage

- [ ] `npm ci` completes and `npm start` opens one window; the first-run page
      renders, Chinese text uses PingFang, nothing overlaps the title bar.
- [ ] Saving an API key works: note whether a Keychain prompt appears, restart,
      confirm the key is still usable (`safeStorage.isEncryptionAvailable()`).
- [ ] One full App conversation turn with a real key (streaming, stop, edit,
      regenerate).
- [ ] `~/.agent-arcade` is created with the expected files; the SQLite stores
      open (Electron's built-in `node:sqlite`).
- [ ] Quit with ⌘Q completes; the app does not stay open with a cleanup
      message. Quit again from the menu-bar icon and from the Dock menu.

Window, menu and input

- [ ] ⌘C, ⌘V, ⌘X, ⌘A and ⌘Z work in the message box, the API key field and the
      settings fields (this is what the Edit menu is for).
- [ ] ⌘W hides the window; clicking the Dock icon shows it; closing while in
      full screen does not leave an empty Space.
- [ ] Starting the app a second time focuses the first window. After a forced
      kill (`kill -9`), the next start still works (stale socket removal).
- [ ] Enter / ⌘+Enter send as configured; Shift+Enter inserts a line; a Chinese
      input method's Enter confirms the candidate and does not send.
- [ ] ⌘K opens the command palette in the Minimal layout and the hint reads ⌘K.
- [ ] The three layouts, compact mode and light/dark/follow-system all render;
      switching the system appearance updates the window.
- [ ] The menu-bar icon is visible at a sensible size on light and dark menu
      bars; its menu opens; the application menu follows the interface language.
- [ ] The Dock shows the brand icon when run from source.

Notifications and sources

- [ ] A desktop notification appears (from source it is attributed to
      Electron; check the packaged, ad-hoc signed app separately, where macOS
      may not offer the permission prompt at all).
- [ ] An ICS file, a folder and a feed source can be added through the file
      dialogs and produce notices; a companion notice is mentioned in chat.
- [ ] Reminders still fire after the window has been hidden for a while (App
      Nap can slow timers in a hidden app).

Work side

- [ ] Started from Finder (not a terminal), the app finds `node`, `claude` and
      `git`; try with Homebrew and with nvm/fnm/volta installs.
- [ ] **Install hooks** writes exec-form hooks to `~/.claude/settings.json`,
      Claude Code accepts them, and session events appear. **Remove hooks**
      restores the file.
- [ ] A background session can be created, observed, stopped and resumed.
- [ ] A task-board task gets its own git worktree, a diff and a merge/discard;
      try a repository under a path with spaces, and one opened through a
      symlink or `/tmp` (which is `/private/tmp`).
- [ ] The Claude Channels command copied from the app runs in Terminal for a
      workspace path containing spaces and an apostrophe.
- [ ] Stop a local Claude program task while it is running a long shell
      command; check with `ps` that nothing it started is left behind.
- [ ] The Claude Code and Codex status checks report the right state.
- [ ] Claude API task mode from a source checkout loads
      `@anthropic-ai/claude-agent-sdk-darwin-arm64` (or `-x64`).

Packaging

- [ ] `npm run pack:mac` succeeds: the 1024 px PNG is accepted as the icon,
      ad-hoc signing with `"identity": "-"` works, `codesign --verify --deep`
      passes, and the app opens on Apple Silicon.
- [ ] `npm run dist:mac` produces dmg and zip for both architectures; the x64
      build runs on an Intel Mac or under Rosetta.
- [ ] The packaged app opens on a second Mac after the Gatekeeper steps above.
- [ ] The packaged app contains no `@anthropic-ai/claude-agent-sdk*` directory,
      and the files listed in `asarUnpack` are under `app.asar.unpacked`.
- [ ] The CI job `mac-package` and the `macos-latest` test leg have each been
      looked at once; every failing test is either fixed or skipped with a
      stated reason, then `continue-on-error` is removed for that platform.

Channels (none has been connected from macOS)

- [ ] WeChat ClawBot pairing and one message each way.
- [ ] QQ through an existing OneBot bridge: save URL and token, Test
      connection, one private message each way.
- [ ] Feishu, X and Messenger, if you use them.

Not expected to work, confirm they fail politely

- [ ] No QQ accounts entry appears anywhere, including when the selected
      companion uses the QQ channel.
- [ ] No voice entry appears on the chat page.
- [ ] "Start in a terminal" and the provider "Sign in" button show a readable
      message, not a stack trace.
- [ ] Moving credentials from an older Electron profile was never tried on
      macOS; a fresh profile does not need it.
