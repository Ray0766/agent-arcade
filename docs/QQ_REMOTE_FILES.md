# Remote files in the single-window app

Open **QQ accounts → Remote instances → selected instance → Files** after
**Connect and read** has verified the registered QQ and NapCat **4.18.42**.
The file view reuses that private authenticated client. It does not ask for an AI
API key, start a companion, or sign QQ in. Unresolved token recovery must be
finished first. The existing main window, mist-pink appearance and 17/14 type
scale are retained.

The basic-file checkpoint was `single-window-remote-files-20261107`. Its actual empty
registration list, blank form, return and close were checked without contacting
a remote server. Original Ju/Whale QQ and AI settings restored without QR or key
entry; real authorized remote-file acceptance remains unfinished.
See [the active goal](ACTIVE_GOAL.md) for the complete scope.

An optional [resumable transfer helper](QQ_RESUMABLE_TRANSFERS.md) is implemented
in the working source through a separate same-window entry and independently deployed
service. It does not turn the ordinary NapCat APIs below into resumable ones.

## Browse and edit

Enter an explicit remote directory, such as `C:\BotWorkspace` on Windows or
`/srv/bot-workspace` on Linux, then read it. No home directory or file content is
read merely by opening the view. Use directory rows and the breadcrumb to navigate.
Selecting a file displays its available actions; **View text** explicitly reads
up to 48 KiB of UTF-8 text. Content stays in this editor and its main-process
operation, outside AI prompts and global diagnostic snapshots.

The view supports empty-file creation, new directories, text edits, rename, move,
deletion, batch move and batch deletion. Review the exact source, destination and
effect before confirming each change once. Moves preserve names; an observed
existing destination is rejected. Directory deletion is recursive and has no
trash or automatic undo. Batch selection is bounded to 20 items.

The application checks fresh observations before writing. The server has no
conditional-write or immutable-file API, so another client can still change a
file between that check and the operation. A chosen directory is a navigation
scope, **not a symlink sandbox**. Matching the QQ does not prove that every file
belongs to that account; these APIs use the remote process's filesystem access.

The upstream text API may mask a recognized `webui.json` token and preserve its
in-memory value when writing. Its returned text hash is not proof of exact disk
bytes. Use the dedicated security settings to change that token. Other files do
not receive a general secret-redaction guarantee.

## Upload and download

Choose local files through the native picker, review their names, sizes and the
remote destination, then confirm the upload. App limits are 64 MiB per file,
128 MiB per selection and 20 files. Original local files are held and checked;
they are not edited. A same-named remote upload may receive a generated name.
The server's acknowledgement omits that final name, so the result does not claim
an overwrite or identify an unrelated newly appearing file as yours.

Download one file as its original bytes. One directory or several selected items
downloads as a ZIP. Choose the local save location before the transfer starts.
Downloads are limited to 128 MiB. A saved result requires local publication and
byte readback. ZIP checks validate the received archive without extracting or
executing it; they cannot prove a consistent snapshot of the remote directory.

When replacing a chosen local file, a failed publication may require preserving
the old copy. If restoration cannot proceed without overwriting a newly appearing
file, the result identifies the retained copy's basename in the chosen download
folder. It is not silently discarded or presented as a successful download.

## Copy within the selected remote

The current source adds **Copy…** for one file or directory and **Copy selected
items…** for up to 20 non-overlapping selections. Browse to an observed target
directory, then preview. Names are preserved; known collisions, the same
location and destinations inside a selected directory are rejected.

The fixed server has no native copy operation. Preview downloads original file
bytes into app-owned local temporary files, then prepares an exact bounded
manifest. Directory downloads may also create temporary ZIPs on the server.
Confirm uses the existing mkdir/upload APIs and independently reads the expected
destination bytes afterward. This costs download, upload and readback traffic;
it is not an atomic server-side copy. The model is not involved and file contents
are not added to AI prompts or diagnostic snapshots.

Directory ZIPs from this server omit empty directories. The app combines their
file contents with separately observed directories to retain observed empty
folders. Hidden or unreported empty folders, a consistent source snapshot,
source-link isolation, timestamps, ACLs and alternate streams cannot be verified
or preserved by these APIs. A matching result means the copied **observable
content** matches the prepared manifest, not that the complete original tree or
its metadata was reproduced. Raw downloads do not apply the text viewer's token
masking; only deliberately selected files should be copied.

The plan is limited to 64 MiB per file, 128 MiB copied data, 4,096 archive entries,
32 path levels and 48 write steps. Unsupported names, links or special archive
entries, traversal, collisions, corrupt CRCs and excessive expansion are rejected
before target writes. Confirmation is single-use and expires after five minutes,
also bounded by the file view's lifetime.

The result separates acknowledged steps, per-selection outcomes and later
content observations. An error or cancellation may leave some targets in place;
there is no automatic replay, removal or rollback. Upload collisions may cause
the server to invent a name it does not return, so later matching bytes cannot
turn an unknown request into confirmed success. Temporary-file cleanup must also
be confirmed; a failed cleanup retains ownership for an explicit retry. Process
crash recovery and secure erasure are not implemented for this temporary spool.

## Extract a selected ZIP

Select a ZIP file, choose **Extract ZIP…**, and pick a directory already read in
this file view. Preview downloads and validates the original archive before any
target write. It shows the archive, destination, output roots and bounded file
counts. Confirm once to create those directories and upload their files. The
source archive is retained; no model, remote shell or plugin execution is used.

Entry paths are preserved exactly, including a wrapper directory. Explicit
empty directories and required parents are included. Existing top-level outputs
are rejected: extraction does not merge, overwrite or silently rename them.
An empty archive has no changes to confirm. The supported archive content is
checked in full before writing, but cannot prove what was omitted when the ZIP
was originally created or restore its source filesystem metadata.

Limits are 128 MiB per ZIP and summed extracted content, 64 MiB per file,
4,096 archive entries/materialized paths, 32 levels and 48 mkdir/upload steps.
Encrypted or unsupported entries, links, special files, unsafe paths, duplicate
or case-conflicting names, invalid CRCs and excessive expansion are rejected.
Local spool names are generated independently of archive paths; files are not
extracted into arbitrary local directories. Temporary-space usage is bounded
to 512 MiB of cumulative writes, including independent readback.

The five-minute confirmation and account/view checks also apply immediately
before each write. A later collision, timeout or cancellation can leave partial
outputs; there is no automatic retry, merge, rollback or resumable transfer.
Receipts identify each output root and distinguish acknowledged steps from
subsequent content observations. Matching bytes cannot resolve an unknown
submission or prove durable storage. Real remote extraction remains unaccepted.

## Cancel, close and uncertain results

Cancel applies to the displayed operation. Closing or switching scope retires
that operation and waits for its owned local resources. A late reply cannot
replace another view. An unconfirmed local cleanup remains retryable and is not
reported as a successful close.

Cancellation does not undo a remote write, remove a partially uploaded file or
prove that server-side compression stopped. A timeout, malformed response or
batch error after submission remains **unconfirmed**; earlier batch items may
already have changed. There is no automatic retry or inverse operation. Re-read
the directory to inspect the current state before making another decision.

An acknowledgement, a later matching observation, a locally saved download and
durable remote storage are separate facts. The app does not claim remote
durability or atomic transactions from these endpoints.

## Verification and retained limits

The fixed [official file handlers](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/File.ts)
and [disk uploader](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/uploader/disk.ts)
were reviewed as API evidence; the public implementation is original.

Private component probes ran the fixed upstream handlers in fresh temporary
directories: 11 filesystem checks and six multipart/download/archive checks
passed, including actual partial batch failure and upload collision behavior.
The transfer probe used real loopback HTTP and pinned direct Multer/compressing
dependencies; unused QQ/runtime imports were inert. It did not run a full NapCat
server, authenticate an account or validate a deployed remote environment.

Production main, session, client, transfer and local-file tests separately cover
owner changes, one-use confirmation, cancellation, lost responses and recovery.
UI fixtures use the production view with synthetic endpoints. These checks do
not replace a real authorized remote-server workflow.

The package matched 236 source files, two notices, 11 metadata fields and three
unpacked assets; the approved voice asset was unchanged. 467 syntax files and
3,072 tests passed, with one existing opt-in skip and zero failures. Desktop
smoke and the new 21-check/13-image UI fixture passed. The initial whole-suite
run found an outdated IPC-handler count in an older test; updating that count
and rerunning the suite produced the passing result above.

The copy increment is packaged in `single-window-copy-first-use-20261107`.
Its 480 syntax files and 3,150 tests passed, with one existing opt-in skip and
zero failures; standard desktop smoke passed. Package identity matched all
240 source files, two notices, 11 metadata fields and three unpacked assets,
including the unchanged approved voice. Eleven focused copy UI checks and nine
reviewed images cover the production view, actual session/client/private spool
and a synthetic remote. The earlier 21-check basic-file UI regression passed
before the final copy-only text hierarchy adjustment.

Backend checks include a real local TLS connection with synthetic credentials
and byte storage, not an authorized deployed remote service. The three new
actual-main cases check private source bytes, scoped authority and
retirement before a late write. The shared ZIP reader now keeps the original
owned file descriptor; release failure remains retryable. Real remote copy is
still unaccepted. The preceding package totals describe the earlier basic-file
checkpoint, rather than additional runs of this candidate.

Independent fixed-handler probes reproduced binary/zero-byte files, nested and
empty directories through ZIP/list/mkdir/multipart composition. They also
confirmed omitted ZIP directory entries and UUID collision renaming. This is
component evidence, not a full remote service or production-copy acceptance.

The extraction increment is packaged in
`single-window-extraction-reviewed-20261107`. Final checks passed for 484 syntax
files and 3,173 tests, with one existing opt-in skip and zero failures. Desktop
smoke passed; all 241 source files, two notices, 11 metadata fields and three
unpacked resources matched, including the unchanged voice asset. The focused
backend set passed 68 checks (20 extraction, 25 copy, 23 basic files); 16 separate
actual-main checks include three new extraction cases. These totals describe
their own runs and must not be added as independent acceptance counts.

The final extraction UI passed 13 checks and nine inspected images. Copy's
11-check and basic files' 21-check UI regressions passed before a final
extraction-only correction for legal POSIX archive names; the new regression
also verifies that Windows rules still reject those names. The UI follows the
source file view's path style without changing other editor policies. Owned TLS
and private temporary-file tests use synthetic credentials and storage. The
actual package's management entrance was inspected, but no real remote was
registered or contacted. Real extraction remains in the consolidated test stage.

The optional [resumable helper](QQ_RESUMABLE_TRANSFERS.md) has isolated component
and renderer evidence; real remote deployment and operated-package acceptance
remain unfinished. Ordinary NapCat transfers do not acquire resume support.
Remote process inventory/start/kill, transactional component/data replacement
and remote Passkey revocation remain
unfinished. The fixed process API only offers the existing restart request.
These retained gaps are listed in [the integration inventory](QQ_INTEGRATION.md);
basic file management does not close them.
