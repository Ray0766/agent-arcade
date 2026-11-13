# Moving local QQ management into Agent Arcade

Checked against NapCat Desktop **3.5.19**, NapCat **4.18.42** and the current
Agent Arcade runtime on 2026-11-06. This is a reversible procedure and an
integration checklist. The new application's real migration, owned-process
start/stop and crash recovery are **not yet accepted** merely because the
read-only discovery and fixture tests passed.

## What moves, and what stays

Agent Arcade becomes the everyday management window. QQ and NapCat remain
separately installed helper processes. The app reuses the selected installed
QQ executable, NapCat directory and account configuration; it does not copy
QQ login credentials, delete device/profile data or register a new QQ account.
Creating an instance means preparing a local connection for an existing QQ
number.

Select the **data directory containing `components`**, normally
`%ProgramData%\NapCatQQ Desktop`. Do not select the directory containing only
`NapCatQQ-Desktop.exe`. The currently supported layout contains:

- `components\QQ\current.txt` and its selected version directory, or the
  supported direct `components\QQ\QQ.exe` fallback;
- `components\NapCatQQ\NapCatWinBootMain.exe`, its hook and `napcat.mjs`;
- `components\NapCatQQ\config\onebot11_<QQ number>.json`.

Agent Arcade uses an original private loader rather than replacing Desktop's
`loadNapCat.js`. The upstream Windows launch plan uses the same installed QQ
executable, hook, account argument and NapCat working directory. That supports
preserving the existing local layout; it does not prove that an expired QQ
session will become valid again.
[Upstream launch plan](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/crates/ncd-runtime/src/launch/plan.rs)

## Closing Desktop is not detaching its local bots

In version 3.5.19, the normal exit flow refuses exit while local bots are
active. Its dialog tells the user to stop those bots first. After that gate,
shutdown cleans up local resources; remote deployments are handled separately.
A title-bar close configured as `tray` only hides the window. Therefore, an
invisible Desktop window is not evidence that the old manager or its local QQ
processes have exited.
[Exit command](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/src-tauri/src/commands/exit.rs),
[exit dialog](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/src-ui/app/DesktopExitGate.tsx),
[window close behavior](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/src-tauri/src/lib.rs)

The installed executable's file/product version was checked as 3.5.19. The
expected local `config\app-settings.json` was absent during the read-only
inspection; upstream defaults to `close`. This is a source/config observation,
not a real exit test or proof of the current in-memory setting.
[Default settings](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/crates/ncd-domain/src/app_config.rs)

The current Agent Arcade conflict guard rejects management while Desktop is
running. Consequently, moving the existing local set requires one coordinated
stop of the old manager's local instances. Do not claim that one account can
be migrated while the other two remain controlled by that running Desktop.
Once they belong to Agent Arcade, independent-account start/stop is the intended
flow and needs its own real acceptance.

## One-time migration

1. **Record the current association.** In the app, match each actual QQ number
   to its existing companion and owner. Keep each companion's data directory,
   model selection, encrypted vault, memories and character unchanged. A
   nickname or avatar is not an account identity check.
2. **Finish or pause current work.** Disconnect the companion channels before
   changing their process manager. Preserve ambiguous outgoing-message and
   post records; do not replay them as part of migration.
3. **Stop the local instances in NapCat Desktop.** Use its normal per-instance
   stop controls and wait for confirmation. Do not log out, delete an instance,
   clear its profile, uninstall QQ or terminate arbitrary processes by name.
4. **Exit Desktop normally.** If it says a local bot remains active, resolve
   that state in Desktop first. Hiding it to the tray is insufficient.
5. **Check the handoff.** Agent Arcade must see Desktop absent and no external
   launcher/QQ tree belonging to the selected installation. An unidentified
   surviving child blocks the handoff; it is not silently adopted or killed.
6. **Reuse the existing connection.** Select its exact enabled loopback
   WebSocket server and import it into the intended disconnected companion.
   Its token is passed only inside the main process into the existing encrypted
   vault. No manual token copying is needed. Importing is not starting QQ or
   connecting the AI, and it must not change the chosen model, persona or owner.
7. **Start one instance from Agent Arcade.** Verify process ownership first,
   then authenticated QQ identity and online status. If the saved session is
   still usable, use that session. When supported, an explicit existing-session
   login request is available; only a server-required new login needs the
   account owner's normal QR/confirmation flow.
8. **Connect the matching companion.** Require OneBot `get_login_info` to match
   the expected QQ number before accepting messages. Check one owner message
   and reply, then repeat for the other accounts and check isolation.
9. **Verify a normal app restart.** Stop/close through Agent Arcade, reopen the
   same data profile and test reconnection. Record what actually happened;
   process startup, a QR scan and a visible reply are separate evidence.

Do not make QR scanning a required step of every launch. The normal route
preserves the saved session and only asks for authentication when QQ requires
it. Keeping the files cannot guarantee that Tencent will never invalidate a
session. The observed login-expiry events do not establish their service-side
cause, and changing managers does not prove that cause is fixed.

## Configuration changes and rollback

Read-only discovery and importing an existing connection are allowed while the
old runtime is visible. Editing its configuration is stricter: Desktop must be
closed, the selected instance must be stopped and the app must hold its editing
lock. The editor changes only the selected WebSocket server, keeps unknown
fields, checks configured/live port conflicts, preserves a valid existing token
and generates a fresh random token only when needed.

Before replacing an existing file, the app saves its original bytes below its
private `qq-profile-backups` directory. These backups contain bridge credentials:
keep them local and out of Git, screenshots and diagnostic exports. A new config
has no previous file to back up. The app does not modify Desktop's own
`config\bot.json` registry, so a newly created Arcade-only instance will not
automatically appear as a Desktop-managed card.

To return to the old manager:

1. Disconnect the companion channels and stop all Agent Arcade-owned QQ
   runtimes. Verify that their complete process trees have exited. Do not open
   Desktop while those runtimes are still active.
2. If only the manager changed, reuse the existing installation as it is; no
   credential/profile restore should be necessary. If a connection file was
   edited, restore only its verified original backup while **both managers and
   the affected runtime are stopped**. Preserve the current file as another
   private backup first. The source implementation now provides an explicit
   per-account **Configuration backups → Preview changes → Restore this
   configuration** flow; see [its integrity checks and validation boundary](QQ_PROFILE_BACKUPS.md).
   A source/UI fixture pass does not mean a real account was restored or that
   the currently running build includes this feature.
3. Reopen NapCat Desktop and use its existing account entries. If it reports a
   disk/desktop configuration conflict, inspect the selected fields rather than
   replacing unknown runtime fields blindly. A new Arcade-only entry needs
   explicit registration in Desktop if it is to be managed there.
4. Start the required accounts in Desktop and verify their actual identities.
   Agent Arcade may then use their existing OneBot connections as an external
   client; its lifecycle controls remain disabled for those external runtimes.

Never copy one account's configuration onto another, delete ownership files to
force a running process takeover, or remove a QQ profile to resolve a port or
management conflict.

## Interrupted shutdown and explicit recovery

Normal app close waits for its active operations and stops only the process
trees it owns. It does not stop Desktop-owned accounts. If shutdown is partial,
the ownership record remains and the UI must not claim the account stopped.

After an app crash, **Recover** is an explicit request to inspect a prior
ownership record. The previous manager's PID, creation time and executable are
checked by a direct Windows query. A filtered snapshot missing that process is
not proof that it died. Recovery may adopt a still-matching complete runtime
tree under a new ownership identity, or clear a record after the whole known
tree is proven dead. It does not reauthenticate QQ.

A live former owner, reused runtime PID, incomplete identity, surviving child
without a verifiable launcher, corrupt lease or interrupted editing/recovery
guard keeps management blocked for inspection. No forced takeover is provided.

## Integration contract and failure handling

`QQProfileConfig.list()` and `configure(accountId, options)` are asynchronous.
`connection(accountId, serverName?)` is synchronous and main-process-only; it
returns a bridge URL/token, not a login proof. Do not serialize that result into
renderer IPC or logs. The public list contains account/server name, port,
enabled, loopback and token-present flags only.

Without a server name, `connection()` selects only a unique enabled,
authenticated server bound to the literal address `127.0.0.1` or `::1`.
`localhost`, wildcard and remote addresses are not eligible. An explicit name
must match exactly once. In contrast, editing an existing configuration with
more than one server always requires its explicit name; `create: true` creates
a new account configuration and refuses an existing one.

| Code | Meaning and next step |
| --- | --- |
| `config_invalid` | Missing, malformed, linked or oversized config; inspect the file before retrying. |
| `config_changed` | Another writer changed it; refresh instead of overwriting. |
| `profile_exists` | Use the existing instance rather than creating it again. |
| `server_ambiguous` | Choose one exact server name; duplicated names need repair. |
| `server_missing` / `server_invalid` | Select an existing enabled, authenticated loopback server. |
| `invalid_server_name` / `invalid_port` | Correct the bounded name or local port input. |
| `port_conflict` / `port_unavailable` | Choose another port; do not kill the unrelated listener. |
| `backup_failed` | Original bytes were not safely backed up, so replacement was aborted. |
| `write_failed` | Refresh and inspect current state before retrying; do not assume nothing changed. |

Runtime conflict, ownership, unsupported-platform and process-check errors pass
through unchanged. A successful configuration write followed by a failed
refresh must still be reported as **saved, refresh failed**. Saving a connection
file, importing its token into the vault, verifying the real QQ identity and
testing a conversation are separate operations, not one atomic transaction.
Likewise, a vault write followed by a connection-config write error needs an
explicit incomplete-save result and a recheck; it must not report success or
promise that all local state stayed unchanged.

## Acceptance and remaining limits

Completed evidence is limited to original module fixture tests, actual installed
version/discovery checks, per-account WebUI listener/process ownership checks
and safe read-only bridge summaries. No real migration, destructive process
test or production config write was performed for this document.

The migration acceptance record must separately cover preserved login behavior,
exact QQ/companion association, three-account operation, single-account stopping,
normal restart, explicit crash recovery and a rollback. Any required human
authentication remains pending until the owner's scheduled test stage. Existing
owner-only private-chat scope remains; migration does not enable groups,
unsolicited other-friend conversations or additional Space audiences.
