# Optional remote QQ supervisor

The source and operated `single-window-qq-supervisor-20261107` desktop package
contain these controls; the optional service has a separate deployment assembly.
No real remote-host deployment, QQ authentication or account migration is accepted.

The current source also includes independently enabled same-window features:
[cleanup of a previous run](QQ_REMOTE_ORPHAN_CLEANUP.md) and
[native WebUI Passkey management](QQ_PASSKEY_MANAGEMENT.md),
[connection-configuration backups](QQ_REMOTE_PROFILE_BACKUPS.md), and
[fixed-version Shell code repair](QQ_SHELL_CODE_REPAIR.md). Their source is
integrated on top of owner QQ message history; final combined package and
real-host acceptance are tracked in [the current scope](ACTIVE_GOAL.md).

## Purpose and boundary

NapCat's fixed 4.18.42 WebUI can receive a restart request while it is running.
It cannot start its own stopped process. A separately deployed Agent Arcade
supervisor provides a stable HTTPS entrance for a single explicitly declared
QQ instance on a Windows host. It reuses the application's existing process
identity, ownership and recovery rules instead of introducing remote shell
execution.

The supervisor has its own access token and TLS identity. The desktop stores
this credential separately, encrypted by the operating system. Existing Claude,
GPT, DeepSeek, QQ bridge and WebUI credentials are neither copied nor replaced.
Installing the supervisor is optional; local accounts continue to use their
current management path.

The target installation and QQ account are declared on the host. Requests cannot
select an executable, argument list, filesystem path or different account.
Starting a process does not prove QQ sign-in, an AI connection or a completed
task. Those observations remain separate.

## Use in the desktop application

Open **QQ accounts → Remote instances**, select a saved remote, then choose
**Remote QQ process**. The page shares the existing window, palette and 17px/14px
typography. It does not require a connected WebUI session.

1. Deploy the separate service using its [Windows setup guide](../deploy/qq-supervisor/README.md).
   It requires an existing prepared, managed Shell 4.18.42 installation and a
   fixed account declaration. The desktop does not install it on another host.
2. Add a control connection with that service's HTTPS origin, instance ID and
   independent token. The expected QQ comes from the selected remote registration.
   Select a private CA explicitly when needed; there is no certificate bypass.
   Saving and reopening the page are local-only operations.
3. Choose **Connect and read process state**. Starting, stopping and recovery each
   have an explicit preview bound to the current installation and process identity.
   Stopping interrupts that owned process's connections but retains account data.
4. After starting, use the existing WebUI login/identity flow to check QQ itself.
   A process-management receipt does not confirm login or connect a model.

Closing this page stops only the desktop's wait and connection. An operation
already received by the server can still finish. Closing the **supervisor service**
normally waits for accepted work and stops only the QQ process it proves it owns.
An abnormal service exit can leave a process running; recovery must be explicit.

## Connection loss and recovery

Each mutation is saved locally before sending, and recorded durably by the service
before invocation. Reusing its request ID cannot invoke it again. An authenticated
pre-execution rejection has a durable `not_submitted` receipt; a lost response is
not treated as successful or automatically retried.

Use **Query original operation** to inspect the same request in the same ledger.
`completed` and `not_submitted` receipts resolve the local pending operation.
If the desktop recorded preparation but never sent request bytes, an explicit
query returning no such request in the same ledger can also settle it as
not submitted. An attempted send with a missing request remains unresolved.
If the service has finished handling it but records a terminal `unknown`, a
separate confirmation can retain the full encrypted unknown receipt and end this
recovery. This declares neither success nor rollback. New actions still require
a new process observation and preview.

The desktop retains up to 16 ended unknown receipts per connection and refuses
another mutation before exhausting that capacity. Removing the connection
explicitly removes those local records, not the server journal or its token.
A missing request, changed ledger, lost service or changed parent registration
cannot clear an attempted operation. Such unresolved cases still need the host
administrator; do not edit the encrypted file to guess an outcome.

The service retains up to 32,768 operation IDs / 64 MiB. It does not expire IDs
silently or offer a remote reset route. Keep the ledger identity and database
together. A replaced or lost ledger is not evidence that an old action never ran.

## Evidence boundary

### Prepared recovery extension

An optional [pending-update recovery extension](QQ_SUPERVISOR_RECOVERY.md) is
included in the prepared, unlaunched `single-window-supervisor-recovery-20261107`
package. The currently operated supervisor package above does **not** include it. The entry
inspects the fixed installation independently of ordinary process Status, which
a pending updater plan can block. It reuses the existing opaque-plan preservation
transaction; it does not execute instructions or paths found in that plan.

The host administrator must explicitly enable
`recovery.pendingUpdateRecords` in the separate service configuration. This adds
installation recovery authority to its existing supervisor credential, without
copying or replacing any AI key. Disabled and older services remain usable for
their existing process controls. A desktop capability check cannot enable this
permission or migrate service storage.

The useful recovery case is an **already stopped, lease-free, fully verified
prepared Shell 4.18.42 installation**. The installation may be shared by several
accounts. When a plan coexists with a live process or unresolved management lease,
ordinary Stop/Recover in that earlier package can also be blocked. The newer
prepared [owner recovery](QQ_OWNER_RECOVERY.md) supports a startup-recorded,
installation-bound Shell process through the existing Stop/Recover controls.
It requires new verified ownership evidence; legacy records, incomplete trees
and unproved processes do not gain authority. The newer
[remote cleanup extension](QQ_REMOTE_ORPHAN_CLEANUP.md) supports the typed
pending-installation and retained-inspection-resource paths. The older healthy
installation preview contract and actual remote-host acceptance remain unfinished.

Preserving a plan does not roll back files an updater already changed. An
interrupted preservation needs a separate explicit reconciliation. In one valid
reconciliation outcome, the original plan remains active and the extra retained
link is removed: a settled operation is therefore not always a disabled plan.
Querying an operation only reads its receipt; it does not reconcile the files.
An actual process crash can leave a component lock that both this entry and the
existing local lock recovery reject while the plan or journal remains. That
dead component-lock subset now has a separate
[default-disabled extension](QQ_SUPERVISOR_LOCK_RECOVERY.md) in the newer prepared
locks package. The later owner candidate adds the bounded account-lease cases
described above. No new real-remote or user-installation acceptance is claimed.

For the preceding process-only checkpoint, the actual desktop IPC, production
client, HTTPS service, SQLite journal and
production renderer passed 16 UI checks with 11 inspected images, using synthetic
credentials and an inert runtime boundary. The separate service suite passed 16
checks, including production RuntimeManager/CIM/stop with actual owned Windows
inert processes. Normal close removed its child; after service exit 86 the child
was independently absent, so recovery cleared a dead record. Surviving-child
adoption was not observed. The 32-source service assembly matched its manifest.
These do not prove a real remote QQ account's login,
recipient messaging, network reliability, or Windows credential encryption on
the target host. The original-profile app opened its empty remote registry and
blank form, returned and closed without registering a remote or submitting a
request. Existing Ju/Whale credentials and QQ configurations were retained, and
both accounts restored through explicit local management recovery. Current
package and final test receipts remain in
[the delivery scope](ACTIVE_GOAL.md).

This increment does not add remote installation or component/data upgrades,
cross-user takeover, unattended QQ sign-in, automatic restart policies or a new
QQ protocol core. These remain in the [complete delivery scope](ACTIVE_GOAL.md).


The optional [connection configuration backup extension](QQ_REMOTE_PROFILE_BACKUPS.md)
adds fixed-instance OneBot backups and reviewed restoration, with a separate
default-disabled capability. It neither stops nor starts QQ automatically.
