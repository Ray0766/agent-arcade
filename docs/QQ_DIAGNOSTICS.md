# Shareable QQ diagnostics

Packaged native saving and cancellation passed **2026-11-06** in `single-window-diagnostics-fixed-20261106`: the UI confirmed a local save without upload, and independent readback verified **2201 bytes / nine events** and the expected schema. Cancelling reported no save, preserved the prior artifact and left the default target absent. This is a local JSON export from the existing QQ account dialog. It does not upload a bug report, contact QQ, sign in, restart a process or test an AI provider.

## Use

Open **QQ accounts → the account's management dialog → View diagnostics → Export redacted report…**. Choose a local `.json` file in the native save dialog, or cancel. The file contains the state captured when you opened diagnostics, plus the bounded classified events shown by the app. Reopen diagnostics if the account, installation or relevant connection state changed. An empty event list is allowed and does not mean that QQ has never failed.

The export includes the app/platform and available component versions, fixed management/login status codes and at most **160** classified runtime events. The file is limited to **64 KiB**. Its account label is always `selected-account`; it contains no QQ/owner number, nickname, stable account hash, private message, task or memory content, API key, bridge token, URL, port, QR image, local path, PID or raw log text. Unknown codes and unsupported metadata are replaced by fixed unknown/null values or dropped. The report records those dropped event counts and explicitly says that it is not complete history.

Classification already exists in **View diagnostics**: legacy installations may read a bounded 128 KiB log tail, while managed installations use the app's bounded classified events. Export reuses a single main-process copy of the projected result; it does **not** reopen the raw log, read chat/credential databases, enumerate processes or refresh the network. It does not include the optional private process-stop trace. The report stays on this computer until you choose to share it elsewhere.

## Results and boundaries

- **Saved:** the app published the JSON and independently read back the exact file identity and bytes. The destination path is not returned to the renderer or written into the report.
- **Cancelled:** the native dialog was cancelled; no report was written.
- **State changed:** account/profile, runtime identity, configuration/installation revision or window lifetime changed before saving. Reopen diagnostics to capture the current view.
- **Save unconfirmed:** publication was attempted but the final file could not be verified. Check your chosen location before retrying; the app does not automatically repeat a save.

The writer rejects linked/hard-linked destination files, linked directories and non-JSON destinations, preserves an observed replacement, and uses a same-directory exclusive temporary file with flush, scope checks and atomic publication. It cannot make an arbitrary external filesystem actor participate in an atomic compare-and-swap. An unverified cleanup can leave a temporary file containing only the projected report; it does not delete unknown replacements.

The created file handle stays open across publication. Exact 64-bit volume/file IDs, the final path, a separate read handle and bounded byte comparison establish that the saved file is still that file. Creation time alone is not a stable identity across Windows rename: [Microsoft documents NTFS/FAT tunneling](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nf-fltkernel-fltgettunneledname), which can restore a recently deleted destination's creation time. A same-content replacement with a different file ID still fails verification.

Event order and observed status are evidence, not a diagnosis of why QQ invalidated a session. UTC app event times are labeled separately from legacy local log times, whose missing year/timezone is not guessed. A cached `online` status is not a new online check. Login-expiry events do not prove risk control or guarantee that scanning again will solve a connection problem.

## Verification

Automated checks use synthetic classified events and real temporary files, never real private chat or credentials. They cover secret/path/identity marker exclusion, nested input projections, malformed and bounded data, exact byte readback, link rejection, changed destinations, publication uncertainty, trusted main-frame IPC, native cancellation and account/runtime/profile changes while the save dialog is pending. The renderer checks use synthetic IPC and inspected screenshots.

The first packaged native save produced a complete JSON file but the UI reported an unconfirmed save. An independent Windows temporary-file test reproduced the old creation-time mismatch after deleting a same-name placeholder, without changing the real output. The writer now retains the original handle across rename; that native regression and same-content/different-file rejection pass. **The corrected packaged native-save flow passed** with an actual success message and independent file readback. The saved report matched the schema and contained none of the checked account IDs, local paths, URLs or API-key prefix. The original failure file is retained; the corrected output uses a new filename. **Actual native cancellation also passed**: the UI reported cancelled/not saved; independent checks found the previous artifact unchanged and the default target absent. Private receipt: `outputs/qq-diagnostic-native-save-acceptance-20261106.json`, including `cancelCheck`. This bounded save/privacy check does not establish a universal privacy audit or diagnose a QQ disconnection.

The corrected package matches 167 source files, two notices, 11 metadata fields and three unpacked assets. Its fix passed **34 targeted checks**. The earlier **2115 total / 2114 passed / one skipped** full regression and **313 JavaScript syntax files** belong to the preceding package, before this writer fix. See [QQ integration](QQ_INTEGRATION.md) for lifecycle and account acceptance separately.
