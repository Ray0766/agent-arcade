# Optional remote pending-update recovery

The extension is included in the prepared, unlaunched
`single-window-supervisor-recovery-20261107` package. The currently operated
`single-window-qq-supervisor-20261107` package predates it. It is not a real
remote-host or QQ-account acceptance claim.

## What it does

An explicitly enabled supervisor can inspect the fixed pending updater plan in
its declared prepared Shell 4.18.42 installation, preserve the original bytes
and disable that remaining plan. A separate action reconciles a verifiable
interrupted preservation. It reuses Agent Arcade's existing local preservation
transaction; it does not parse or follow instructions inside the plan.

This is installation-wide and can affect several accounts sharing the component.
The installation must already be stopped, free of unresolved account and
component locks, and pass complete prepared-code verification. It does not
download, install or roll back code, repair partially overwritten files, migrate
QQ data, or automatically start or stop QQ.

Ordinary process Status can be unavailable because of the plan itself. Recovery
inspection is therefore independent of that Status call. If a live process or
residual management lease coexists with the plan, ordinary Stop/Recover can also
fail. An administrator must first verify and resolve those processes and records;
no existing local or remote button is promised to resolve every case.

A process crash during preservation can also leave an installation lock. The
remote recovery preview rejects that unresolved lock. The existing local lock
recovery path can itself be blocked by the pending plan or journal. This case
is addressed by the separate [orphan-lock extension](QQ_SUPERVISOR_LOCK_RECOVERY.md)
in the newer working tree; it is not in the prepared package named above.
The original plan entry alone does not resolve it. A failed file operation whose normal cleanup released the
lock is a different case and can reach the explicit reconciliation flow.

## Host setup

Follow the [supervisor deployment guide](../deploy/qq-supervisor/README.md), then
explicitly enable this local setting before starting the new service:

```json
{"recovery":{"pendingUpdateRecords":true}}
```

It grants the existing independent supervisor token additional installation
recovery authority. The desktop cannot enable it. No AI key, QQ bridge token or
WebUI credential is reused or replaced. Leaving it absent or false retains the
existing process controls without new recovery permission.

Opting in can migrate the service ledger to schema 2. Stop the old service and
retain a complete copy of its state directory before migration. Existing process
records and ledger identity are preserved; the old binary cannot read schema 2.
The new service can query its recorded recovery operations with the permission
disabled. A capability check cannot migrate storage or grant permission.

The desktop also preserves its old encrypted supervisor links and pending
operations when writing its typed local format. Do not downgrade by deleting
that store: a lost local record does not prove the remote operation never ran.

## Same-window workflow

1. In **QQ accounts → Remote instances → Remote QQ process**, select the saved
   control connection and open **Pending-update recovery**. Opening the section
   does not send a request.
2. Explicitly inspect recovery capability and records. An older service and an
   administrator-disabled service have distinct results. Neither is permission
   to fall back to a generic remote file operation.
3. Select the observed plan and review its full verification and effects. The
   preview is temporary and makes no plan change. It cannot reserve the whole
   installation while the user decides; confirmation repeats the relevant checks.
4. Confirm once. Closing the view cancels the desktop's wait, not an operation
   the service already received. After a lost reply, query the original request.
5. If an interrupted file transaction remains, use a new inspection and explicit
   reconciliation preview. Querying a receipt alone does not reconcile files.

## Read the result accurately

| Recorded result | Meaning |
| --- | --- |
| Plan disabled; original bytes retained | The helper verified preservation. This is not code rollback or QQ sign-in. |
| Reconciliation finished; original plan remains active | The original is still in place. In the two-link case, only the extra retained link was removed. It is not a successful disable. |
| Not submitted | This service proved this request did not enter file confirmation. Earlier operations are unaffected. |
| Attempted or unknown | Keep the request and query it; do not automatically submit it again. |

A terminal unknown can be explicitly retained in local history to end its local
query slot. This does not erase the service ledger, a filesystem recovery journal
or a component lock. A later empty record list does not establish an earlier
operation's success. New work still requires current verification and preview.

## Limits

The service exposes one fixed installation record, never arbitrary paths or plan
contents. Plans are bounded to 2 MiB, and the local preservation helper retains
up to 64 operation directories without automatic deletion. The supervisor's
32,768-operation / 64 MiB journal budget is shared with process operations. The
desktop permits one unresolved operation per control connection across both
families, and up to 16 retained unknown receipts.

Unknown file identities, incomplete unowned fragments, unhealthy code, full
history and unresolved locks remain explicit blockers. Remote deployment,
surviving-process takeover, actual QQ login, cross-version upgrades and data
migration require separate acceptance. See [the complete scope](ACTIVE_GOAL.md).

## Verification boundary

The new main-process flow and adjacent IPC checks passed 34 checks using the
production client, HTTPS service and SQLite with synthetic file-adapter outcomes.
The production renderer passed 28 checks with 21 inspected screenshots. Two UI
flows additionally used the production selector and preservation helper on real
temporary NTFS: exact bytes/inode preservation and a two-link interruption
followed by a new reconciliation that left the original plan active. Their
component metadata and process inventory were synthetic; no QQ process ran.

A separate seven-check HTTPS probe used a private copy of the fixed official
prepared input: 684 files / 114,884,405 bytes. The production selector/helper
retained the plan's exact bytes and inode, rejected a damaged component copy,
and did not replay a repeated request ID. It made eight localhost requests and
started no QQ process. This validates the component path in isolation, not a
remote deployment or user-installation recovery.

The full application regression passed 3,769 tests with one existing opt-in skip
and zero failures. All 315 packaged sources matched; the package has not been
launched. Actual service-child crashes exposed the retained-lock blocker above,
which remains unaccepted. No user installation, account, credential or model was
used for those recovery tests.
