# Manage remote WebUI Passkeys

The optional QQ supervisor can list and revoke native WebUI Passkeys while its
fixed managed installation is stopped. This is a separate Agent Arcade
extension, disabled by default. It does not replace the existing Windows
Passkey registration or authentication prompts and does not alter the server's
official registration/authentication code.

The supported credential store belongs to a managed NapCat **Shell 4.18.42**
installation. Maintenance is shared by the entire WebUI installation, including
other QQ accounts using it. A selected QQ number does not narrow this scope.
Managed Node installations retain their startup barrier if a maintenance marker
is present, but native credential maintenance for Node is not supported.

## Enable the optional service extension

Use the separately deployed HTTPS supervisor with its existing independent
token, certificate validation and fixed installation binding. The desktop never
reuses an AI API key or an authenticated WebUI session as supervisor authority.
All installed managers controlling this installation must include the
maintenance startup barrier; older binaries cannot recognize the new marker.

The host administrator may explicitly add this configuration:

```json
{
  "passkeys": {
    "enabled": false,
    "origin": "https://webui.example.invalid",
    "recoveryRouteDeclared": false
  }
}
```

Set `enabled` to `true` only when this maintenance capability is wanted. `origin`
is the exact DNS HTTPS origin of the **WebUI**, which can differ from the
supervisor's HTTPS origin. IP addresses, URL credentials, paths and queries are
not accepted. The desktop checks this origin against the registered remote.

`recoveryRouteDeclared` is a host administrator's statement that another usable
WebUI sign-in method has been arranged. It is **not** an application verification
of that method. Keep it false unless that preparation is understood: without it,
the last credential cannot be revoked. Enabling or disabling this capability
does not clear an interrupted operation or its startup barrier.

## Read and revoke in the same window

Open **QQ accounts → Remote instances → selected remote → Remote QQ process →
Manage Passkeys**. Opening the view reads local registrations only. Choose
**Read credential list** to make an explicit HTTPS request.

The fixed component, all related processes and shared management records must
pass the stopped-installation checks. If QQ or another owner is still running,
stop the appropriate instance explicitly and read again. Reading or revoking
does not stop or start QQ automatically.

Each row displays a credential-ID fingerprint and its recorded transports. The
service provides no device nickname or current-device marker. A transport such
as “Built into device” or “USB” is not a verified device identity. Do not revoke a
row whose fingerprint you cannot identify. Missing, empty and invalid stores
are different states; invalid data is never presented as an empty list.

Choose **Review revocation**, check the fingerprint and shared scope, then
confirm once. The preview is bound to the exact observed store, registered
origin, installation and credential; it expires after 60 seconds. A changed
store or installation requires a fresh read. The original file is retained,
only the selected native row is removed, and the replacement is read back
before the service records a known result.

“Remote credential revoked” means the native server store no longer contains
that row at the recorded readback. It does not delete the key from a local
authenticator, invalidate an already issued WebUI session, prove a later
authentication attempt failed, or prove the installation is ready to start.
The result separately reports any unconfirmed component-lock cleanup.

## Interrupted requests and startup protection

The desktop saves a typed request in its encrypted supervisor registration
before sending the operation. When a reply is lost, choose **Query original
operation**. Querying does not resubmit the revocation. A missing request after
an attempted send remains unresolved; an empty credential list is not evidence
that the operation succeeded.

If the service has ended processing but the result remains unknown, the view
can explicitly retain the complete unknown receipt and end **local request
recovery**. This does not change remote credentials or clear the maintenance
marker. Read again and choose **Preview reconciliation** to examine the exact
preserved journal and current file. Reconciliation records the verified original
or replacement outcome without repeating deletion. Unknown, changed or damaged
journal/file identities remain blocked for administrator investigation; the
application does not guess, restore or delete them automatically.

Both local and supervisor managed start paths check the marker, including when
the optional capability is disabled. Node checks each known instance config
directory but offers no Node credential editing. Closing a window, ending local
recovery or changing a feature flag cannot clear this protection.

Maintenance retains at most 64 operation directories per installation. The
supervisor's five operation families share one 32,768-row budget and request-ID
namespace. A desktop registration retains at most 16 explicitly archived
unknown results. Nothing is silently evicted to make room.

## Scope of validation

The implementation checks temporary native files, exact replacement/readback,
fault recovery, HTTPS/SQLite requests, encrypted-container persistence and the
same-window interface. Process inventories in the Passkey component fixtures
are synthetic. Tests of the fixed official helper use synthetic credentials
and stub cryptographic verification; they are not real Passkey ceremonies.

Real registration, authentication before and after revocation, actual remote
host deployment, and credential/session persistence remain separate acceptance
steps. This extension cannot defend a file from an unrelated malicious program
running as the same OS user. All managers for the installation must honor the
same locks and startup barrier.

The pinned official [authentication router](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/router/auth.ts)
provides ceremony endpoints rather than a listing/revocation API. The optional
offline extension therefore operates only under the stopped managed gate; it
is not a live WebUI file-editor action.
