# Recovering an orphan lock beside a pending update

This extension is included in the prepared, unlaunched
`single-window-supervisor-locks-20261107` package. Packaging and isolated crash
evidence are tracked in [the active goal](ACTIVE_GOAL.md).
It does not change the currently operated app or enable any server permission
automatically. It complements [pending-update recovery](QQ_SUPERVISOR_RECOVERY.md).

## When to use it

A service can exit while preserving an update plan and leave its installation
lock behind. That lock prevents plan recovery; ordinary lock recovery can also
be blocked by the plan. The new entry verifies the stopped installation and the
exact dead owner before offering to remove that one lock. If a recovery guard
also remains, it requires its own preview and confirmation first.

The account processes and account leases must already be absent. This entry
does not stop QQ, adopt a surviving process, delete an account lease, change a
configuration transaction, install code or reconcile the update plan. A live
process or legacy account lease combined with a pending plan remains a separate
unfinished recovery case. Matching a PID alone never authorizes removal.

## Enable on the server

Stop the old supervisor, retain its complete state directory, and enable the
new permission in its local configuration before starting the new binary:

```json
{"recovery":{"pendingUpdateRecords":true,"pendingUpdateLocks":true}}
```

The two permissions are independent and default to disabled. The desktop cannot
grant them. The separate supervisor control credential continues to be used;
saved AI keys, QQ authentication and WebUI credentials are not replaced.

Explicitly enabling lock recovery migrates the ledger to schema 3. Existing
identities and process/plan receipts are preserved. Older binaries reject the
new schema. Disabling the permission again allows queries of original receipts
but does not permit new lock work or downgrade storage. Do not restore an old
ledger over one that has accepted newer operations.

## Same-window workflow

1. Open **QQ accounts → Remote instances → Remote QQ process → Pending-update
   recovery → Clear locks left by exited processes**. Expanding the section performs no network request.
2. Inspect. A listed file means a record exists; it does not yet prove its owner
   is dead. An unreadable or changed record cannot be selected for removal.
3. Preview the selected lock. The service checks the complete fixed prepared
   Shell 4.18.42 tree, managed installation, plan/journal identities, related
   processes, shared account leases and owner identity. The preview expires.
4. Confirm once. Only the selected installation lock or recovery guard is
   eligible. A guard removal can leave the installation lock; inspect again
   and obtain a new preview for that separate record.
5. Return to plan inspection and explicitly reconcile its journal. Clearing a
   lock does not disable the plan or show that QQ is ready to start.

If the reply is lost, query the original request. Closing the desktop cancels
its wait; an already accepted service operation continues to settle. There is
no automatic retry of the selected deletion. An unknown result can be retained
in local history without changing any remote file or rewriting it as success.

## Interpreting receipts

| Recorded facts | Meaning |
| --- | --- |
| Lock cleared; cleanup confirmed | The selected record is gone and the helper's owned resources were closed. Read the remaining-lock fields separately. |
| Lock cleared; cleanup unconfirmed | The known removal is preserved, but owned cleanup remains unresolved and further mutations are blocked. |
| Completed; lock not cleared | The helper returned a known no-clear result, for example because another authorized operation already removed it. Completed is not equivalent to removal. |
| Unknown | The original request remains unresolved. A later empty inspection cannot prove what that request did. |
| Not submitted | This request did not enter core confirmation. It does not describe prior requests. |

`recoveryRequired` describes unresolved locks or helper cleanup.
`pendingUpdateRecoveryRequired` always remains true for this operation: plan
recovery is separate. Remaining installation/guard presence can be true, false
or unknown. No receipt asserts successful QQ login or code rollback.

## Limits and verification

Only two fixed lock records are exposed; HTTP and the renderer cannot supply
paths, PIDs or commands. All three operation families share the existing service
slot, 32,768-operation / 64 MiB ledger, and the desktop's one pending request and
16 retained unknowns. The encrypted desktop format upgrades on an explicit
write, preserving old registrations and receipts.

Verification uses real local HTTPS, SQLite, temporary NTFS files and owned
test-service processes. Synthetic descriptors and component programs are never
QQ login evidence. Real remote deployment, existing-user installation recovery,
surviving account processes, cross-version updates and the original human
acceptance gates remain separate. No current account is damaged to exercise
this feature.

The stable-source actual service-child suite passed three exit-86 chains:
interruption after hard-linking the plan, after unlinking its original name,
and after removing the installation lock but before guard cleanup. Each requires
new explicit lock work and separate plan reconciliation; independently checked
bytes and file identities remain consistent. The final production renderer/main/
TLS flow passed 40 checks with 33 inspected images, including the actual crashed
child path. One earlier combined UI attempt refused removal but did not retain
its core error code; the cause could not be recovered after temporary cleanup.
That failure remains recorded. Subsequent successful bounded checks do not
establish long-term reliability or resolve that unexplained refusal.
