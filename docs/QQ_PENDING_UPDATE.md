# Pending QQ component update records

Entry: **QQ accounts → Local components → Manage component versions → Pending
update records**. This is an explicit record-recovery tool in the existing window. It
does not change AI credentials, QQ login data or the selected component.

## What it handles

The fixed upstream updater can leave `config/napcat-update.json` for its next
startup. Agent Arcade blocks startup while this plan is present. The new entry
can preserve and deactivate that exact plan after verifying a prepared 4.18.42
Shell or Node component against its complete manifest, archive and native/QQ
binding. The original installation's four-file baseline is insufficient and is
not eligible. All related processes and management operations must be stopped.

1. Choose **Inspect pending update records**. A list is discovery, not an integrity
   check or proof that an earlier update changed nothing.
2. Inspect one record. Review its byte count, complete component check and
   explicit statement that code will not be rolled back.
3. Confirm **Retain and deactivate** once. The original bytes are retained in
   a private history directory. The application does not start QQ afterward.
4. If an earlier attempt is unconfirmed, inspect and confirm an outcome review.
   This records the observed result; it never replays the deactivation.

Closing, minimizing, changing companions or cancelling revokes an outstanding
preview. A preview also expires after five minutes. Reopening requires a new
inspection. Cancellation does not undo a completed filesystem change.

## Preservation and failure behavior

The plan is opaque data, at most 2 MiB. Embedded source/target paths are never
followed or executed. A durable intent precedes an exclusive same-volume
hard-link publication and removal of the old name; exact inode and byte checks
bind the retained file to the inspected plan. Unknown links, changed files,
process ownership or cleanup stay blocked. History is bounded and not silently
pruned. Node installations expose at most 32 instance records individually.

An unresolved operation blocks ordinary startup even if the original marker
is absent. If an interrupted operation left both proven names, an explicit
review can remove only the newly retained link and leave the original plan
active. A later deactivation then requires a fresh inspection and confirmation.
There is no automatic plan restoration, retry, code execution or login.

The upstream updater attempts file replacement **before** writing its pending
plan. Deactivating that plan cannot undo earlier replacements. An incomplete or
damaged component fails verification and remains blocked; this tool does not
replace a code-repair or data-migration workflow. See the fixed
[updater implementation](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/UpdateNapCat.ts)
and [4.18.42 release](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42),
rechecked 2026-11-07.

## Verification boundary

On 2026-11-07, 27 backend cases, 59 component-coordinator cases and 17 actual-main
IPC/shutdown cases passed in isolation. The production renderer/coordinator
passed 15 UI checks with nine inspected images, using a synthetic recovery
helper. The full regression passed 473 syntax files and 3,120 tests, with one
existing opt-in skip and zero failures; desktop smoke passed. These are separate
from real-account acceptance.

An isolated NTFS experiment used all 684 files (114,884,405 bytes) of the fixed
official Shell component. The real helper preserved the marker bytes and inode,
and the normal selector resolved the healthy component afterward. Deliberate
damage to that new copy caused both normal selection and a new recovery preview
to reject it while retaining the second marker. Original source/archive/manifest
hashes stayed unchanged. HTTP and child-process execution were disabled.

Temporary files and synthetic process tables do not prove recovery of a real
interrupted QQ update. No marker is inserted into a working installation for
this test; existing login data and credentials are retained.

The operated `single-window-pending-update-20261107` package matched 237 source
files, two notices, 11 metadata fields and three unpacked assets. The approved
voice was unchanged. Actual original-installation inspection displayed the
prepared-only refusal without offering deactivation; the drawer closed normally.
Ju/Whale QQ and AI restored from retained settings without QR/key entry, and
independent identity/online/configuration checks matched. This demonstrates
bounded upgrade continuity, not a recovered interrupted production update.

Cross-version upgrades, QQ data migrations and sustained login reliability
remain separate unfinished work. See [component selection](QQ_COMPONENT_SELECTION.md)
and [the full delivery inventory](QQ_INTEGRATION.md).
