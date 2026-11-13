# Complete QQ runtime setup

This is the separate Windows Node route being integrated into the local
0.4.0-preview.1 candidate. It does not replace the imported QQ installation or
claim a new QQ protocol implementation. The first native startup failed; the
repaired pre-login lifecycle has now passed in the actual
`single-window-diagnostics-recovery-20261106` package. Authentication, messaging
and clean-machine acceptance remain pending.

For an existing managed Node installation with missing or damaged code, use
[same-version code repair](QQ_NODE_REPAIR.md). This preserves the original
installation metadata and account-data directories; creating a new installation
is a separate action.

## Entrance and data policy

Open **QQ accounts → Prepare QQ** in the existing main window. Choose either:

- **Use an installed QQ program**: the existing Shell route, with a verified
  QQ.exe chosen by the user.
- **Prepare complete runtime components**: the official Windows Node package;
  this route has no QQ.exe picker. Download/preparation, creation, installation
  selection, account creation and startup remain separate explicit actions.

Preparing an installation does not log in an account or connect an AI. It
creates a new installation record and an empty instance directory. Each account
later receives its own work/configuration and QQ-data directories. Existing QQ
login state and conversation databases are not copied. **Return to the previous
installation** preserves the prior selection; changing installations requires
disconnected companions and stopped runtimes, including the target installation.

Switching setup routes discards unconsumed program tickets and recovery
confirmations. A Node preparation cannot satisfy the Shell route or vice versa.
The application does not accept a download URL or launch command from this page.

## Fixed upstream package

The selected source is [NapCatQQ v4.18.42](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42),
asset `NapCat.Shell.Windows.Node.zip`, SHA-256
`77397ac38d66f46383e48f08f35d5f9d37ec575c22069f62d6c600e73b4521ed`.
The [fixed release recipe](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/.github/workflows/release-publish.yml)
uses Node 22.11.0 and QQ native components 9.9.31-49738. The observed archive has
704 files and 361,715,623 expanded bytes. The package is separately downloaded;
its code and licenses are not relabeled as Agent Arcade's MIT implementation.

The practical benefit over the existing Shell baseline is removing the external
QQ executable selection and full desktop-client prerequisite from setup. It
adds a distinct supervisor/worker lifecycle and per-account directory layout,
which require their own tests. The bundled Node and native dependencies are
pinned to this upstream release; they are not a recommendation to replace the
application's Node runtime or a promise of indefinite compatibility.

Archive checks and prepared-file hashes cover the whole package. The pinned
4.18.42 native runtime was observed creating an empty root `beacon_report.log`
beside its binaries. Validation now tolerates that exact empty, regular,
single-link diagnostic sidecar, without adding it to the recorded manifest or
changing any code hash. Nonempty/renamed logs, links and every other unknown
file still fail. All 704 original files were independently hash-matched after
the first native run. This narrow compatibility rule does not authorize code
changes or arbitrary runtime files.

Lightweight discovery is labeled metadata-only; it is not proof of execution,
login or successful messaging. Other unknown files, changed descriptors and mismatched engine
identities prevent adoption. Existing component checks remain bounded.

## Acceptance boundary

Latest actual check: the app created a fresh complete-component installation,
selected it, created one independent account configuration, started its hidden
background and displayed a real QR code in the same main window. Independent
process reads matched the three recorded identities, including the exact system
console host; its management listener was `127.0.0.1` only. **Stop QQ** then
removed all three processes, their listeners and the ownership record.
**Return to the previous installation** restored the original environment.
All 704 component files, the three original OneBot configurations, the original
QQ program and 14 ordinary QQ process identities remained unchanged. No scan,
model call or message was part of this check. Private receipts:
`outputs/qq-node-repaired-readonly-20261106.json` and
`outputs/qq-node-repaired-tree-20261106.json`.

Startup and QR verification were noticeably slow in that package. A subsequent
source change combines each Windows observation group into one PowerShell
invocation and shares raw observations across accounts within the same operation.
Each account still requires its own lease, process-tree and listener proof, with
two independent observation rounds. QR results retain an endpoint check before
HTTP and a final check after local image encoding; no result is exposed early.
There is no cross-request identity cache or unverified fallback. In three
alternating read-only comparisons on this development machine, the same raw
query sequence averaged **2,624.89 ms separately versus 1,956.63 ms batched**.
This measures one observation group, not QQ startup or QR latency. Routine
layout reads took 8.42–9.17 ms; a separate complete 704-file component check took
2,362.99 ms and remains required before startup. Private measurement receipt:
`outputs/qq-node-production-observation-comparison-20261106.json`. The optimized
source has targeted identity-change and account-isolation regressions. The
`single-window-x-node-20261106` package subsequently passed selection of the
existing isolated installation, hidden startup to a login-required state, normal
stop and return to the original installation. Independent inspection found all
three recorded processes, listener and lease absent; original configurations,
program and ordinary QQ identities were unchanged. No QR request, scan, login
or messaging occurred in this later check. Actual QR latency, authenticated
Node use and end-to-end latency remain **unaccepted**. Private receipts:
`outputs/qq-node-optimized-readonly-20261106.json` and
`outputs/qq-node-optimized-tree-20261106.json`.

Existing invalid
wildcard settings were preserved in the earlier test installation and were not
used or silently repaired.

At this checkpoint, package preparation, descriptor publication/recovery,
per-account path derivation, coordinator isolation and the two-route UI have
automated and bounded filesystem evidence. The fixed archive was actually
prepared and its file inventory independently compared; the UI screenshots use
fixtures. These do not establish QQ execution or authentication.

The first actual `single-window-node-setup-20261106` package passed download,
704-file preparation, empty installation creation, selection and local account
configuration. Original configurations/program hashes and ordinary QQ identities
remained unchanged. Native startup then failed: Windows created a direct system
console host alongside the Node worker, and the Node-only descendant rule
rejected it. The owner subsequently confirmed the Windows firewall prompt.
No scan, login or messaging was performed. The known three-process test tree was
later matched against historical birth/path/parent evidence, stopped through the
production native host and independently found absent with no remaining listener.
This was a one-time exact-process recovery, not packaged UI stop acceptance; no
firewall rule, lease or login file was edited. The failure remains
recorded privately in `outputs/qq-node-live-tree-started-independent-20261106.json`.
Recovery evidence is `outputs/qq-node-old-tree-exact-stop-1793927430989.json`.
The old public-network allow rules remain, and its existing wildcard-host
configuration is preserved; startup validation must continue to reject it.

The next frozen package, `single-window-node-local-20261106`, matches 135 source
files and has 1,527 passing checks out of 1,528 (one skip), plus 246 JavaScript
syntax files. It has not been launched. Its process rules admit only the exact
System32 console host directly descended from the verified supervisor, with
creation-time checks; arbitrary console hosts or deeper unknown children remain
rejected. A failed-start lease with an empty tree can be recovered only while
the exact supervisor is still alive and its current tree can be verified.

New Node work directories now seed the management host as `127.0.0.1` before
startup. Existing files are never overwritten to obtain that setting: a wildcard
or malformed existing host blocks new startup, but recovery/stop remain possible.
Actual management listeners are also checked for loopback binding. This follows
the pinned upstream configuration parser's `::` default; a logged localhost URL
does not prove loopback binding. It does not guarantee that native QQ networking
will never cause a Windows firewall prompt.

The repaired packaged create → select → account configuration → hidden startup
→ QR display → stop → return flow is now covered by the latest check above.
Successful account login, retained sessions and owner messaging remain
separate checks. A Windows installation with no existing QQ is still needed to
verify the no-preinstallation claim independently of this development machine.

The original nine-feature acceptance boundaries remain in
[the companion ledger](COMPANION_ACCEPTANCE.md).

## Application-crash observation

In `single-window-x-node-20261106`, an existing isolated Node environment was
started only to the login-required state. The three exact process identities,
loopback listener and encrypted endpoint record were observed before abruptly
terminating only the verified application main process. The supervisor, worker
and console then all disappeared. Reopening the same app/profile and choosing
**Recover management** cleared the dead tree's lease without starting QQ.
Returning to the original installation preserved all three OneBot configurations,
the QQ executable, 14 ordinary QQ identities and the verified 704-file component.
No QR, authentication, model or message action occurred.

This is bounded **dead-tree management recovery**, not surviving-supervisor
adoption. The latter was not exercised because no supervisor survived. The
non-detached Windows job behavior in the bundled Node/libuv is consistent with
this observation; kernel job membership was not measured in this run. Private
summary: `outputs/qq-node-crash-recovery-summary-20261106.json`. No process-policy
change was made merely to force an adoption test to pass.
