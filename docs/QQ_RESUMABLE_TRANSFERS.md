# Optional resumable transfers

This increment is implemented in the working source and reviewed local package,
with isolated service, desktop integration and production-renderer evidence.
The package's ordinary remote-management entrance was opened separately; no real
helper registration or remote transfer has been accepted. Existing NapCat file
transfers and saved AI/API credentials remain unchanged.

## Entrance and setup

In **QQ accounts → Remote instances**, connect and read the selected instance.
After its actual QQ identity and supported NapCat version are verified, open
**Resumable transfers** in the same window. The page initially reads only local
helper settings and recovery records. It does not contact a server or resume a
job automatically.

NapCat 4.18.42's ordinary file API ignores download Range requests and cannot
combine upload chunks. Genuine continuation therefore needs a separately
deployed [Agent Arcade transfer helper](../deploy/transfer-helper/README.md).
It is an original optional service, not a patched NapCat endpoint. Deployment
requires an HTTPS hostname/certificate, a persistent helper instance UUID, its
own random token and explicitly configured file roots. It receives no AI,
QQ or NapCat credentials. Its dependencies are installed separately from Electron.

Save the helper address, instance UUID and separate token in this page. A private
CA may be chosen through the native file picker; an optional SPKI fingerprint
binds certificate trust. Saved credentials are system-encrypted and never filled
back into the form. Leaving the token unchanged during editing retains it.
Existing Claude/GPT/DeepSeek API keys do not need to be entered here.

## Transfer and recover

- **Upload:** explicitly connect, choose an allowed root/directory, select one
  local file, review its name, size and destination, and confirm once. The main
  process binds the selected bytes to their SHA-256. A healthy flow uploads,
  verifies the whole file and saves it without another confirmation. It never
  overwrites an existing target. Ordinary NapCat multi-file upload remains a
  separate existing entry.
- **Download:** select one file or up to 20 observed items, choose a new local
  destination, review and confirm. A directory or multiple items become one
  immutable ZIP snapshot, including observed empty directories. Its stable bytes
  can resume; it is not an atomic snapshot of a changing source tree or an
  ACL/metadata backup.
- **Pause:** stops this owned operation and retains its verified private partial.
  Closing the view does not discard the server job. The existing remote-panel
  minimize/account-switch policy also pauses the operation; it does not stop QQ
  or erase model settings.
- **Recovery:** local jobs remain after restart, without background requests.
  Explicitly connect and use the available **Resume**, **Check status** or
  recovery-only **Finish saving** action. A lost finalization response is queried
  using the original job; it is never silently published again. Unknown outcomes
  stay unknown when exact evidence is unavailable.
- **Remove a completed record:** removes only the selected local history entry.
  Saved files, remote files and helper credentials are retained. Running,
  uncertain or unclosed jobs cannot be cleared this way. This local action does
  not require a helper connection and makes room under the 64-record desktop limit.

The parent management client's completed 2FA/Passkey authentication is reused.
Actual QQ/version and registration ownership are checked afresh for transfer
operations. Changed helper, parent, credential or trust bindings disable old
job actions rather than retargeting them. Removing a helper link does not delete
its recovery jobs or published files.

The worktree adds a separate [local record maintenance flow](QQ_TRANSFER_RECORDS.md)
for expired, old-binding and deleted-registration entries. It preserves full
encrypted outcomes before an optional second record-deletion confirmation;
it does not weaken network recovery checks or delete transfer files. The packaged
offline entrance and original empty-store migration were operated; nonempty
archive/forget and exact Pause have isolated-component evidence. This does not
complete real-host transfer acceptance.

## Limits and evidence

Limits are 64 MiB per resumable upload, 128 MiB per download, 4 MiB chunks,
512 MiB of helper private staging, and 24-hour private-job lifetime. Full quota
refuses new jobs. Unknown ownership/publication retains its record and may need
administrator review; it is not automatically repaired by deleting files.
The service has one OS-held owner per state directory. Each writable root has
its own same-volume private staging directory; its SQLite state may be on
another volume. The tested runtime is Node 24.18.0 on Windows/NTFS. Linux is
implemented but not covered by that platform evidence.

Bytes transferred, final hash verified, file saved/published and private cleanup
are separate facts. Process-crash recovery tests do not establish power-loss
durability or protection against an administrator rewriting the service's files.
Use a restricted service identity as described in the deployment guide.

The frozen service component passed 27 checks covering actual isolated
HTTPS/tus/Range, temporary NTFS, five crash boundaries, competing owners and
separate-volume state/staging. The client passed 41 checks, including six actual
desktop-to-helper service cases and two owned child-process exits followed by
explicit recovery and final hash verification. Desktop links, parent identity
checks and main IPC passed 80 focused checks with synthetic credentials/parent
replies. Seventeen production-renderer checks and 16 inspected images also
exercise the real isolated transfer chain;
its parent QQ identity and encryption vault are test fixtures. These results do
not exercise the real OS vault or a real remote host. The separate packaged
empty-registry check does not accept helper configuration or transfer behavior.
No real account file transfer, Linux execution or clean-machine release
acceptance is claimed here. See the
[active goal](ACTIVE_GOAL.md) and [test stage](COMPANION_TEST_STAGE.md).
