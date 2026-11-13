# NapCat component selection and rollback

Agent Arcade can select a verified prepared **NapCat Shell 4.18.42** directory
and return to the previous selection. This first activation boundary proves
same-version directory relocation. It is **not** a general cross-version
updater or a guarantee that downgrading QQ reverses its data migrations.

The component coordinator and QQ account page use an opaque prepared version
ID and a digest from an explicit preview. They never accept a renderer-supplied
executable, configuration or data path. Preparation can happen while accounts
are running; activation and rollback require the shared installation to be
fully stopped.

## Stable data, selected program

The existing `components/NapCatQQ` directory remains the stable work directory.
The original QQ executable, account configuration and login-data resolution do
not move. At startup the app's original loader imports the selected `napcat.mjs`
and sets `NAPCAT_WORKDIR` to that original directory. It does not set
`NAPCAT_QQ_DATA_DIR`, read or copy QQ login credentials, or create junctions.

Upstream [v4.18.42 path handling](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-common/src/path.ts#L24-L38)
puts config, logs, plugins and cache under `NAPCAT_WORKDIR`; static assets remain
relative to the selected program. QQ data is resolved separately by the
[Shell data-path code](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-shell/data-path.ts#L7-L27).
These are verified version-specific source behaviors, not a promise of future
upstream compatibility.

Packages and prepared versions share the same local component store across
application profiles, adjacent to the shared runtime-lock directory. The
default is `%LOCALAPPDATA%/AgentArcade/qq-components`. Prepared code is kept at
`qq-component-versions/napcat-shell/<versionId>/code`, with its manifest at
`prepared.json`. Selection metadata is shared by installation identity under
the runtime-lock directory, so another application profile does not resolve
the active version against a different private home.

## Transaction and validation

- An explicit preview verifies the current selection, candidate and fixed QQ
  executable. Its digest binds the exact previous selection. The initial digest
  also binds the original mandatory files and QQ executable, before a selection
  file exists. Ordinary status reads do not hash program files or claim that
  they were just verified.
- Prepared code is checked against the preparation manifest and staged archive,
  including all listed file bytes. Unexpected files, missing files, traversal,
  links and hard-linked files are rejected. The original installation has no
  prepared manifest: its baseline covers only `napcat.mjs`, `qqnt.json`,
  `NapCatWinBootMain.exe` and `NapCatWinBootHook.dll`. This does **not** certify
  every original asset or plugin.
- Activation and rollback hold an installation-wide exclusive file lock. They
  reject NapCat Desktop, any process from the shared component locations, QQ
  processes with unverifiable paths, existing account leases/recovery guards,
  and concurrent configuration edits. Stale account leases must be resolved
  through their existing ownership-recovery flow first.
- The same lock covers startup through process-proof registration, not merely
  a preflight existence check. Different account starts in one manager queue
  serially; they can remain online together afterward. A duplicate start for
  the same account remains an explicit in-progress error.
- Current code, target code, QQ executable, process state, console generation,
  cancellation and previous-selection digest are checked again before atomic
  selection replacement. The previous selection bytes are preserved first.
  History is bounded at 64 files and is not silently pruned.
- The manifest only selects program files; configuration and account data are
  not rewritten. The app never automatically starts an account after selecting
  a version. A successful write followed by a failed read-back is reported with
  `committed: true` and a fixed error code, rather than as an unchanged selection.

Upstream startup can apply a pending `config/napcat-update.json` file to program
paths. Its presence therefore blocks selection and startup until explicitly
resolved; the application does not parse or delete it during these operations.
The separate [pending-update recovery entry](QQ_PENDING_UPDATE.md) can preserve
and deactivate one plan only for a fully verified prepared component. This is
not code rollback; unresolved recovery records also block normal startup.
See the [upstream pending-update implementation](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/UpdateNapCat.ts#L362-L397).

## Acceptance and remaining limits

Automated tests use temporary installations and synthetic process tables. They
cover selection/rollback, exact previous bytes, changed digests and files,
unsafe paths, all-account exclusion, startup serialization, old console epochs,
cancellation and committed-write reporting. They do not prove QQ login or
message delivery after a real version switch.

An additional probe uses the actual verified official archive as read-only
input with a synthetic original installation and temporary selection store.
It never executes the prepared code or changes a production selection. Private
receipt: `outputs/qq-component-selection-official-input-20261106.json`.

The packaged same-version round trip has now been observed on the actual
installation: original 4.18.42 → prepared official 4.18.42 → original directory.
All three backgrounds started; stopping one left the other two exact process
identities unchanged. Whale retained login and passed independent identity,
online and good checks before and after rollback. Ju/Dragon authentication is
deferred. Original QQ/data paths and three configuration hashes were unchanged.
Private receipt: `outputs/qq-component-live-summary-20261106.json`. This does
not establish cross-version compatibility, three-account chat or automatic
session recovery. The original four-file baseline, full prepared manifest and
observed QQ identity retain different evidence scopes.

An initial real start wrote relative `guild1.db*` files into prepared code;
the next start was correctly rejected. After normal shutdown, all three files
were preserved outside the immutable tree with exact read-back. The launcher
now uses the original stable workDir as CWD as well as `NAPCAT_WORKDIR`.
Program paths remain absolute. The repaired package's code manifest passed
after multiple actual account starts; no runtime database is exempted from
integrity checking or silently discarded.

An unknown or legacy installation lock is preserved and blocks operations.
The newer source/package adds separate, explicit inspection and recovery of
v2 installation locks, recovery records and configuration-edit markers with
original process identity proof. It never starts QQ or restores configuration
contents; see [interrupted-operation recovery](QQ_COMPONENT_RECOVERY.md).
This is distinct from per-account runtime recovery. Cross-version
NapCat activation, arbitrary QQ upgrades/downgrades, automatic login recovery,
and automatic history cleanup are also outside this implemented boundary.
If the current selected code fails integrity checking, normal selection and
rollback refuse to preserve it as a trustworthy previous version. A separate
[explicit recovery](QQ_COMPONENT_REPAIR.md) now handles a damaged
prepared Shell selection with a healthy recorded same-version previous target.
Other damage remains unsupported. A process outside Arcade that ignores
the lock is not made cooperative by this transaction protocol.
