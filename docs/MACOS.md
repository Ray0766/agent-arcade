# Agent Arcade on macOS

Status on 2026-11-14: adapted on a Windows machine, then **started for the
first time on a real Mac the same day** (macOS 27.2.1, Apple Silicon, Node
24.21, Electron 45.2.1). That first run was driven through Playwright against
the real Electron window with an isolated data folder, a made-up API key and a
stand-in for the provider endpoint. What it covered is ticked in the checklist
at the end, each with what was seen. Everything not ticked is still unverified:
above all a real key and a real model, the system dialogs (Keychain,
notifications, file pickers), anything typed or clicked by a person, and the
whole Work side that needs Claude Code 2.1.317 or newer (this Mac has 2.1.283).

Three things were wrong on the real Mac and are fixed:

- **The interface believed it was Windows.** The preload read
  `globalThis.process.argv`, which does not exist in a sandboxed preload, so
  `--arcade-platform` was never seen: Voice chat and all 241 QQ management
  functions were exposed. Unit tests had passed because they supplied `process`
  as a global; they now load the preload the way the sandbox does.
- **Starting twice at the same moment could fail** with "could not reserve its
  single application window": a racing `bind` reports `EEXIST` on macOS, not
  `EADDRINUSE`.
- **`npm test` failed by the hundreds** because the default temporary directory
  sits behind the `/var` → `/private/var` link (see Tests and CI).

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
npm test           # node scripts/test.cjs; add files or node --test options after --
```

Use `npm test`, not a bare `node --test test/*.test.cjs`: see Tests and CI.

The first `npm start` downloads the Electron binary (Electron 45 has no install
script; `node_modules/electron/dist` is filled on first use).

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

**A checkout inside a folder synced by iCloud Drive cannot be signed in place.**
With "Desktop & Documents Folders" turned on, a project under `~/Desktop` or
`~/Documents` gets `com.apple.FinderInfo` and `com.apple.fileprovider.*`
attributes on every `*.app` directory moments after it is created, and
`codesign` stops with "resource fork, Finder information, or similar detritus
not allowed". Removing the attributes right before signing did not help (three
of three builds still failed: they come back), and a `.nosync` folder name gets
them too. Build into a folder outside iCloud instead:

```sh
node scripts/build-icon.cjs
npx electron-builder --dir --mac -c.directories.output="$HOME/Library/Caches/agent-arcade-dist"
```

That build was made and opened on 2026-11-14; `codesign --verify --deep
--strict` reported "valid on disk" with an ad-hoc signature.

The proprietary Claude Agent SDK is excluded from every package, as on Windows.

## Tests and CI

`.github/workflows/ci.yml` runs `npm ci`, `node scripts/check.cjs` and the unit
tests on `windows-latest`, `macos-latest` and `ubuntu-latest`. Only the Windows
leg blocks the build. The macOS leg failed 13 tests on its first run (PR #1);
those are fixed and the same commands pass on a real Mac (4916 tests, 0
failures, 687 skipped), but the leg has not been seen green on GitHub yet, so
it stays `continue-on-error` until it has. Linux is still unexamined.

`npm test` and all three CI legs go through `scripts/test.cjs`. It runs
`node --test` with a temporary directory that is already in its resolved form:
on macOS the default `/var/folders/...` sits behind the `/var` → `/private/var`
link, and the fixtures compare paths under it with resolved ones. Without that,
935 of 4941 tests failed on this Mac and `test/qq-console.test.cjs` never
exited. On Windows the script expands an 8.3 short `TEMP` for the same reason. The job `mac-package` builds `npm run pack:mac` on
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
by one run of the suite with `process.platform` reported as `darwin`. On the
real Mac the count is 717 skipped of 4950, and no further skip had to be added:
the twelve tests that failed there only spelled Windows paths in their fixtures
and now run on every platform.

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
| Electron profile (Chromium state) | `~/Library/Application Support/agent-arcade` when run from source. The packaged app also reports its name as `agent-arcade` (`productName` is set only for the builder), so it most likely uses the same folder; not confirmed by a start with the default profile |
| Key that encrypts saved credentials | Login Keychain, item "agent-arcade Safe Storage" (seen after saving a key from source) |
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
- **Saved API keys and the packaged app.** Source and package use the same
  Keychain item name ("agent-arcade Safe Storage") but are different programs
  to the Keychain, so expect a Keychain access prompt, or an unreadable key that
  has to be entered again, when switching between them or after a rebuild of
  the ad-hoc signed app. Not tried.
- **Starting the app twice** goes through a socket file, `/tmp/agent-arcade-<hash>.sock`.
  After a crash or a forced kill the file stays; the next start asks it four
  times, sees every connection refused, and only then replaces it (about a
  second). Its age alone never removes it.
- **The hook command names one exact Node.js.** Install hooks writes the
  resolved path of the `node` it found, for example
  `~/.local/share/mise/installs/node/24.21.0/bin/node`. With a version manager
  that path disappears when that version is removed; install the hooks again.
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

## Checklist on a real Mac

Ordered by how much depends on it. `[x]` means seen on 2026-11-14 on macOS
27.2.1 (Apple Silicon), with the note saying how. Unless a note says otherwise,
"seen" means: the real Electron window started from source and driven by a
script (Playwright), an isolated data folder, a made-up key, and the provider
endpoint replaced by a local stand-in. Nobody typed or clicked by hand, and no
real model answered. `[ ]` is not verified; a note says what part, if any, was.

Startup and storage

- [ ] `npm ci` completes and `npm start` opens one window; the first-run page
      renders, Chinese text uses PingFang, nothing overlaps the title bar.
      *Seen: one window, first-run card, no page errors, PingFang available;
      three layouts and dark mode rendered without horizontal overflow
      (screenshots looked at). Open: the title bar is outside a page
      screenshot, so whether anything sits under it needs eyes.*
- [ ] Saving an API key works: note whether a Keychain prompt appears, restart,
      confirm the key is still usable (`safeStorage.isEncryptionAvailable()`).
      *Seen: encryption available, a made-up key saved, and after a restart the
      request carried that key again. A script cannot see a Keychain prompt, so
      whether one appears is open. The Keychain item is "agent-arcade Safe
      Storage".*
- [ ] One full App conversation turn with a real key (streaming, stop, edit,
      regenerate). *With the stand-in: a streamed reply grew on screen, Stop
      ended it ("这次回复已停止"), regenerate made one new request and kept the
      earlier version, an edit was saved. A real 401 from DeepSeek for a made-up
      key showed "the AI service did not accept this key" and kept the message
      in the box. No real key, no real model.*
- [x] `~/.agent-arcade` is created with the expected files; the SQLite stores
      open (Electron's built-in `node:sqlite`). *In an isolated folder set by
      `AGENT_ARCADE_HOME`: config, vault, both SQLite files, character and
      conversation data; history survived restarts. The same calls gave
      identical results with the folder reached through a symbolic link.*
- [ ] Quit with ⌘Q completes; the app does not stay open with a cleanup
      message. Quit again from the menu-bar icon and from the Dock menu.
      *`app.quit()` ended the process with code 0 in under 0.1 s, from source
      and packaged, and removed the socket file. The key press, the menu-bar
      icon and the Dock menu were not used.*

Window, menu and input

- [ ] ⌘C, ⌘V, ⌘X, ⌘A and ⌘Z work in the message box, the API key field and the
      settings fields (this is what the Edit menu is for). *The application menu
      exists with Edit (undo, redo, cut, copy, paste, select all), View and
      Window. The keys themselves were not pressed.*
- [ ] ⌘W hides the window; clicking the Dock icon shows it; closing while in
      full screen does not leave an empty Space. *Closing the window hid it
      without destroying it and the `activate` event showed it again. Full
      screen not tried.*
- [x] Starting the app a second time focuses the first window. After a forced
      kill (`kill -9`), the next start still works (stale socket removal).
      *Second start exited with code 0 and the hidden first window became
      visible and focused. After `kill -9` the socket file was left behind and
      the next start had its window up in 0.9 s.*
- [ ] Enter / ⌘+Enter send as configured; Shift+Enter inserts a line; a Chinese
      input method's Enter confirms the candidate and does not send. *Enter
      sent, Shift+Enter added a line, and Enter during a composition event did
      not send. The ⌘+Enter setting and a real input method were not tried.*
- [x] ⌘K opens the command palette in the Minimal layout and the hint reads ⌘K.
- [ ] The three layouts, compact mode and light/dark/follow-system all render;
      switching the system appearance updates the window. *Three layouts and
      the app's own dark setting: seen. Compact mode and a change of the system
      appearance: not tried.*
- [ ] The menu-bar icon is visible at a sensible size on light and dark menu
      bars; its menu opens; the application menu follows the interface language.
      *The application menu was in Chinese with the interface in Chinese. The
      menu-bar icon needs eyes.*
- [ ] The Dock shows the brand icon when run from source. *A Dock entry exists;
      which icon it shows needs eyes.*

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
      `git`; try with Homebrew and with nvm/fnm/volta installs. *Started from a
      terminal only: `git` 2.54.0 and a mise-installed `node` were found.
      `claude` 2.1.283 was found and correctly refused as older than 2.1.317;
      the task page then says Claude Code "was not found", which is the wrong
      word for "too old".*
- [ ] **Install hooks** writes exec-form hooks to `~/.claude/settings.json`,
      Claude Code accepts them, and session events appear. **Remove hooks**
      restores the file. *Against a throwaway settings file
      (`AGENT_ARCADE_CLAUDE_SETTINGS`): twelve events hooked in exec form, an
      existing setting and an existing hook kept, a backup written; two hook
      events fed through the installed script reached the app as a finished
      task for a project path with spaces; removal restored the file exactly.
      Not tried: the real settings file and a real Claude Code session.*
- [ ] A background session can be created, observed, stopped and resumed.
      *Blocked here: needs Claude Code 2.1.317 or newer.*
- [ ] A task-board task gets its own git worktree, a diff and a merge/discard;
      try a repository under a path with spaces, and one opened through a
      symlink or `/tmp` (which is `/private/tmp`). *Blocked here for the same
      reason.*
- [ ] The Claude Channels command copied from the app runs in Terminal for a
      workspace path containing spaces and an apostrophe.
- [ ] Stop a local Claude program task while it is running a long shell
      command; check with `ps` that nothing it started is left behind.
- [ ] The Claude Code and Codex status checks report the right state.
- [ ] Claude API task mode from a source checkout loads
      `@anthropic-ai/claude-agent-sdk-darwin-arm64` (or `-x64`).

Packaging

- [x] `npm run pack:mac` succeeds: the 1024 px PNG is accepted as the icon,
      ad-hoc signing with `"identity": "-"` works, `codesign --verify --deep`
      passes, and the app opens on Apple Silicon. *Only with the output outside
      iCloud Drive (see Build the unsigned package); in place under `~/Desktop`
      signing fails. The bundle (357 MB) verified as "valid on disk", opened
      with the first-run page, reported itself packaged, and quit with code 0.*
- [ ] `npm run dist:mac` produces dmg and zip for both architectures; the x64
      build runs on an Intel Mac or under Rosetta.
- [ ] The packaged app opens on a second Mac after the Gatekeeper steps above.
- [x] The packaged app contains no `@anthropic-ai/claude-agent-sdk*` directory,
      and the files listed in `asarUnpack` are under `app.asar.unpacked`.
- [ ] The CI job `mac-package` and the `macos-latest` test leg have each been
      looked at once; every failing test is either fixed or skipped with a
      stated reason, then `continue-on-error` is removed for that platform.
      *Looked at: `mac-package` was green; the test leg's 13 failures are fixed
      and its commands pass locally. Left to do: see the leg green on GitHub,
      then remove `continue-on-error` for macOS.*

Channels (none has been connected from macOS)

- [ ] WeChat ClawBot pairing and one message each way.
- [ ] QQ through an existing OneBot bridge: save URL and token, Test
      connection, one private message each way.
- [ ] Feishu, X and Messenger, if you use them.

Not expected to work, confirm they fail politely

- [ ] No QQ accounts entry appears anywhere, including when the selected
      companion uses the QQ channel. *The bridge carries no QQ management
      function (131 functions, none starting with `qq`) from source and
      packaged; the pages were not all opened to look for a leftover entry.*
- [x] No voice entry appears on the chat page. *It did appear before the
      preload fix; gone after it, from source and packaged.*
- [ ] "Start in a terminal" and the provider "Sign in" button show a readable
      message, not a stack trace.
- [ ] Moving credentials from an older Electron profile was never tried on
      macOS; a fresh profile does not need it.
