# Optional Windows QQ supervisor

This separate HTTPS service manages **one already prepared Shell installation
and one explicitly configured QQ account**. It uses Agent Arcade's existing
process ownership checks. It does not bundle QQ/NapCat, install or upgrade a
component, run an arbitrary command, connect an AI, or prove that QQ is logged in.

The first supported deployment is Windows with Node 24.18.x and a managed,
prepared NapCat Shell **4.18.42** installation. Node-engine installations and
unverified legacy folders are not supported by this service version.

## Prepare the target machine

1. On that machine, use Agent Arcade's **QQ accounts → Components / First setup**
   flow to prepare the fixed Shell version and create an isolated managed
   installation with an existing QQ executable. The verified package ZIP and
   prepared tree must remain in the component store: startup rechecks them
   locally and never downloads replacements.
2. Configure the intended account normally in that installation. No new login is
   performed by the supervisor. Close the prior manager normally and verify it
   no longer manages that installation. Never concurrently control the same QQ
   account from NapCat Desktop, a second Arcade installation, or another service.
3. Obtain the installation's `setupId` from its folder under
   `<componentStoreRoot>\qq-installations\<setupId>\installation.json`.
   Use the existing component-store and shared runtime-lock locations. For a
   default same-user Arcade setup these are `%LOCALAPPDATA%\AgentArcade\qq-components`
   and `%LOCALAPPDATA%\AgentArcade\qq-runtime-locks`. Do not copy account data,
   WebUI tokens, AI keys or a descriptor to another path. The descriptor binds
   its original paths and component manifest.
4. Create a new private empty state directory, a dedicated HTTPS certificate/key,
   and an independent control-token file. Generate at least 32 random bytes
   encoded as base64url (43 characters). Protect these files with your Windows
   user/service account permissions. This service does not configure Windows
   firewall rules, certificate issuance, DNS or automatic startup.
5. Copy `config.example.json` to a private local configuration file. Every value
   in the example is synthetic. Generate a unique instance UUID, set the exact
   QQ account, the original `setupId` and roots, and the certificate/token paths.
   The default listener is loopback; choose the intended local listen address
   explicitly for remote use. Use a valid HTTPS hostname/certificate in the
   desktop client, with its independent trust settings.

Set the recommended optional `installation.webuiPort` to a fixed available local
port if the existing remote WebUI entry must keep a stable URL. The supervisor
checks availability before spawning, then passes that value through the existing
runtime's preferred-port mechanism. It cannot reserve the port after that check
or guarantee the upstream listener actually uses it. Without this field the
runtime chooses a fresh preferred port, so a previous WebUI URL may no longer
work. The supervisor neither changes that saved URL nor exposes a WebUI token;
verify the actual listener and QQ identity separately. HTTP requests cannot
choose this port or change any deployment setting.

Run under the same Windows user that owns the installation and shared locks.
Different users are not proven to share the existing lock domain. Prefer a
dedicated installation and account; the service will reject known external
ownership rather than take it over.

## Install and run the original service

From this repository checkout:

```powershell
npm --prefix deploy/qq-supervisor ci --ignore-scripts
npm --prefix deploy/qq-supervisor run prepare-app
npm --prefix deploy/qq-supervisor start -- C:\ArcadeSupervisor\private-config.json
```

The assembly command copies only the original CommonJS dependency closure into
the ignored `app/` directory and writes a hash manifest. The separate runtime
dependency is pinned `yauzl` 3.4.0, used by the existing component verifier. The
service does not load Electron. Preserve the project MIT license and dependency
licenses when copying the assembled service and `node_modules`. No QQ or NapCat
binary is included in that assembly.

In Arcade, register the supervisor URL, instance ID, expected QQ and its separate
control token. A stopped QQ process can still be managed because the supervisor
has its own listener. Start, stop and recovery require explicit previews. A
process result is separate from the NapCat WebUI's actual QQ identity/login check.

## Shutdown, recovery and unknown results

- Closing a desktop view or losing HTTP does **not** cancel a server operation
  or stop QQ. Query the original request ID; do not resend under a new ID.
- Normal **service** SIGINT/SIGTERM shutdown waits for accepted work, then stops
  only QQ processes that this service can still prove it owns. A failed cleanup
  retains ownership and reports `supervisor_cleanup_unconfirmed`; resolve the
  cause and explicitly request shutdown again. No `process.exit` shortcut hides
  a running child or a failed cleanup.
- Abnormal service death can leave QQ running. After restart, use **Recover
  management**. Recovery reuses the existing exact process/lease checks; it can
  adopt a surviving owned tree or clear a proven-dead record. It does not guess
  an owner, kill unrelated processes, or prove QQ is logged in. This ordinary
  path requires the installation to remain resolvable. A pending update marker
  or preservation journal can block it, as described below.
- Interrupted journal entries remain unknown and never run again automatically.
  A matching later state is an independent observation, not proof that an
  unknown earlier action succeeded. The service stores operation IDs durably.
  It stops accepting new operations at 32,768 records or 64 MiB rather than
  silently deleting deduplication history. There is no HTTP journal-reset route.
- Keep `ledger.json`, `operations.sqlite` and any SQLite recovery journal
  together. Missing one side refuses startup. Total state loss creates a new
  ledger identity if deliberately initialized again; clients must reject that
  identity change when resolving a pending operation; an administrator must
  treat total state loss as a new deployment, using
  a new instance ID. Never reuse old request IDs to guess a lost result.

No WebUI endpoint token, process command line, private path or raw QQ log is
returned by the API. The control credential is not a NapCat token or API key.

## Optional pending-update record recovery

This permission is **off by default**. A host administrator may explicitly set
`recovery.pendingUpdateRecords` to `true` in the private deployment configuration,
then restart the service. A desktop request cannot enable it. The independent
control token then also authorizes this capability; no NapCat credential is used.

Before enabling it for an existing service, shut the service down successfully
and preserve a private backup of the complete state directory. The first enabled
startup validates the existing ledger and migrates its SQLite schema from 1 to 2
in one transaction, retaining the ledger identity and process-operation records.
The previous service binary rejects schema 2. Turning the permission off again
does not downgrade or erase the ledger: the current binary can still query
existing recovery results. Do not replace only the database or ledger marker,
or restore an older backup over a deployment that has accepted newer operations.

The separate recovery entry can inspect a pending record even when ordinary
process status is blocked. Inspection reports metadata only. **Preview and
confirmation require a healthy, fully verified prepared Shell 4.18.42 tree,
all associated QQ/launcher processes stopped, and all shared account and
installation locks resolved.** This is an installation-wide check, not merely
a check that the configured QQ account is stopped. The service does not stop
processes automatically or accept a path or update-file contents from HTTP.

Each operation is explicit: inspect, preview, confirm once, then read the result.
Disabling a plan preserves its original bytes in the helper's private history;
it does not roll back code, upgrade a component, or start QQ. The helper accepts
at most a 2 MiB marker and 64 retained operations. Full-tree verification may
take time. Reconciliation is a separate preview and confirmation, and can
legitimately leave the original plan active with no retained copy. Read its
`disabled` and `retained` results separately from whether reconciliation ran.

If a reply is lost, query its original service request ID. A stored unknown
result or a later matching inspection does not establish earlier success.
Only after querying may the user explicitly inspect and reconcile a remaining
helper journal. Ending a client's unknown-result investigation does not remove
that journal or repair installation locks. Ordinary process operations and
recovery share one service operation slot; accepted work settles even if the
desktop connection closes.

**Separate orphan-lock extension:** if the service dies while the preservation
helper owns the installation lock, that orphan lock can coexist with the marker
or journal. Both remote recovery and the existing local lock-recovery helper
can then refuse their prerequisites. Ordinary Stop/Recover can also be
unavailable while the marker blocks normal installation resolution. This
working tree now provides a separate, default-disabled
[`recovery.pendingUpdateLocks` extension](../../docs/QQ_SUPERVISOR_LOCK_RECOVERY.md)
for verified dead component-lock owners. It requires an explicit schema-3
migration and retains old receipts. A live QQ process or account lease remains
outside that extension. Do not delete a lock or bypass validation based only on
a PID or this guide. Successful reconciliation
after an I/O error whose normal cleanup released the lock does not demonstrate
recovery from this process-crash state.

## Optional previous-run cleanup and native Passkeys

The deployment example leaves both additional capabilities off. They use the
independent supervisor credential and fixed installation scope; enabling them
does not copy or replace any model API key.

- `recovery.orphanCleanup: true` enables explicit inspection, preview and cleanup
  of the supported previous-run process/resource state. Start/Stop permission
  alone does not enable it. The server never accepts an arbitrary executable or
  account. See [remote cleanup](../../docs/QQ_REMOTE_ORPHAN_CLEANUP.md) for the
  supported typed contracts and the remaining legacy-path limitation.
- `passkeys.enabled: true` enables native WebUI credential listing and offline
  revocation for the fixed Shell installation. Set `passkeys.origin` to the exact
  DNS HTTPS WebUI origin, which may differ from this supervisor's origin. All
  related instances must already be stopped. The feature does not stop them or
  alter a local authenticator. `recoveryRouteDeclared` defaults to false; a true
  value declares, but does not verify, an alternative WebUI sign-in route before
  revoking the final credential. See [Passkey management](../../docs/QQ_PASSKEY_MANAGEMENT.md).

All managers controlling the installation must include the maintenance startup
barrier before this capability is enabled. A retained maintenance marker blocks
managed startup even when the capability is later disabled. An old application
binary cannot recognize a new marker. Query the original request after a lost
response; use the explicit reconciliation flow for the native-store transaction.
Neither a new empty list nor a restarted service establishes an old outcome.

Enabling these extensions migrates their durable operation tables as needed;
v5 retains earlier process, recovery, lock and orphan records. Keep the database
and ledger identity together. Disabling an extension does not erase its records
or make an attempted operation safe to replay.

## Verification boundary

Dedicated tests run with real HTTPS and SQLite, synthetic tokens/account IDs,
temporary component declarations and self-owned inert processes. The actual
Windows component case uses the production RuntimeManager, CIM inspection and
process stop implementation with a private Node executable copy; it does not
launch QQ or load a NapCat plugin. These checks are not real remote-host, QQ
login, existing-account recovery or deployment acceptance. No current user
installation is touched by the tests.

The pending-update extension additionally exercises HTTPS through the production
selector and preservation helper on isolated NTFS files. A fixed official
684-file prepared Shell input is copied into a private test tree; component
code is verified but never executed. Managed descriptors, QQ programs and
process inventories in that case are synthetic. The newer lock extension
additionally exercises three actual test-service exit-86 chains, including a
second interruption during guard cleanup. Each uses verified lock removal and
separate plan reconciliation, without manual lock deletion to pass the test.
The migration compatibility check opens a new temporary v1 database with the
previous assembled service, migrates it with this version, and verifies that
the previous binary rejects v2 without changing database bytes. The lock
extension separately checks schema2→3 migration and old-binary refusal while
preserving previous rows and ledger identity.

```powershell
npm --prefix deploy/qq-supervisor test
```
