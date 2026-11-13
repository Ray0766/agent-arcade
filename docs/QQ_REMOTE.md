# Remote QQ management

Remote file management was operated in `single-window-remote-files-20261107` in
the existing single-window app. It retains the seven management operations and
QQ sign-in/Passkey views, and adds [manual remote files](QQ_REMOTE_FILES.md).
Actual empty-list,
blank-form, return and close checks passed without entering a token, saving
a registration or making a remote request. No real remote server or credential
has been used to validate these management operations.

The new **QQ accounts → Remote instances** view manages a separately registered
NapCat WebUI from the same window. It is independent of the local QQ installation,
the selected companion's API key and the OneBot message connection. Registering
a server does not connect AI, expose a local listener or start a remote process.

## Register and observe

Register a label, exact HTTPS origin, expected QQ identity and the server's WebUI
token. Optional private-CA import and SPKI pinning are explicit trust settings.
Normal certificate-chain and hostname verification still apply; a pin does not
bypass them. Plain HTTP, redirects, URL credentials and guessed fallback origins
are not accepted. Private-LAN servers are supported by the transport; loopback
instances use the existing local manager.

The separate registry uses OS-backed encryption with no plaintext fallback.
Saving or listing it makes no remote request. Choose **Connect and read** for one
authentication and observation. A required authenticator code is transient.
The signed WebUI credential stays in the main process and is not a model API key.
Changing or forgetting a remote entry does not clear a companion's credentials.

The observation distinguishes the TLS destination, authenticated WebUI access,
reported server version and expected QQ identity. These do not prove the remote
machine's process tree or filesystem. Logged-out servers remain readable. The
seven management changes require matching QQ identity and NapCat **4.18.42**;
the separate sign-in actions below use their own logged-out-state checks.

## Passkey access to a registered remote WebUI

Open **QQ accounts → Remote instances → selected instance → Passkey**. Checking
local availability does not contact the server or enroll a credential. This
path uses the Windows native WebAuthn prompt with a registered DNS HTTPS origin;
IP-address origins retain token authentication. Normal CA, hostname and optional
pin checks still apply. Platform-authenticator availability is separate from
whether an external security key is usable or a credential is registered.

To add a Passkey, first use **Connect and read** with the saved WebUI token and
any required authenticator code. Registration requires the expected QQ and
supported version to match, with no unresolved token rotation. Review the
WebUI-wide scope, then choose **Add and verify**. A previously authenticated
Passkey session with the same verified state can also authorize registration.
The system prompt may create a local credential; the app submits remote
verification once. The acknowledgement does not independently prove durable
storage. Cancellation before remote verification may still leave a local
authenticator credential, and an unknown response is never retried automatically.

Passkey sign-in is a separate explicit action with no silent token/TOTP fallback.
It authenticates WebUI access, then independently observes version and QQ identity.
It neither replaces an AI provider key nor signs QQ in. If QQ is logged out,
choose **Sign in to QQ**: the same still-current private client is handed to the
login view without repeating token authentication. Changing the registration,
trust, panel or owning context prevents this transfer. A mismatched QQ grants no
management capability.

Pending token-recovery candidates are neither selected nor discarded by Passkey
authentication. Their original explicit resolution and final confirmation remain
required; the seven management writes stay disabled while recovery is pending.
Options and assertions stay within main and its owned native helper; signed
WebUI credentials stay in main. They do not enter the renderer, model context
or a new persistent cache. Closing cancels the
owned local ceremony and unsent verification; it cannot undo remote registration.

The fixed server shares its challenge and Passkey storage across the WebUI user.
Another client can replace a challenge, and an older cleanup timer can invalidate
a newer one. The app serializes its own ceremonies per origin; it cannot control
other clients. Upstream storage writes are non-atomic. The fixed 4.18.42 source
has no reliable Passkey listing or revocation endpoint; its network-settings
setter ignores credential fields. An isolated probe of the actual upstream
helper also showed that an in-flight authentication counter write can restore
a credential removed directly from the file. Consequently the authenticated WebUI client does not
edit that file or present its file editor as credential revocation. A separate,
default-disabled [stopped-installation maintenance extension](QQ_PASSKEY_MANAGEMENT.md)
provides explicit native credential listing and revocation under the managed
process/installation gate. Its validation boundaries are documented separately. Closing the view, signing
out or rotating a WebUI token does not revoke a Passkey. Actual remote revocation
remains unaccepted; the separate maintenance implementation has only isolated
verification with synthetic credentials and temporary storage.

Source tests use synthetic authenticator responses and isolated storage; a
separate native probe checks ABI/availability without opening an authenticator
ceremony. Both source and packaged-ASAR probes returned API9 with ABI support
and confirmed the newly owned helper's exit. The platform authenticator was
unavailable; no external key or credential was tested. Real Windows Hello/security-key registration, authentication,
cancellation and remote persistence remain in consolidated acceptance.

## QQ sign-in in the same window

Choose **QQ scan sign-in** inside the selected remote instance. Its source,
package and synthetic flows are checked; real-server acceptance remains pending. After an
explicit entry and authentication, the app observes the fixed server and reads
its cached QR code when available. It renders that URL locally as a PNG; it does
not open a browser, fetch a QR image or save the login URL. The displayed code
has an app-imposed lifetime, not a verified server expiration time.

Scanning, initialization, reconnecting and verified online identity have
separate states. Success requires consistent online observations, core readiness
and the registration's exact expected QQ. A different account stops login
actions. A visible login view polls at most every three seconds, for five
minutes and no more than 100 observation operations. Closing, changing the
selected registration or hiding the app retires the local observation. It does
not sign QQ out or withdraw a request already delivered to the server.

Automatic observation starts after a displayed QR. If entry finds the server
already generating, scanned or initializing, use **Check sign-in** explicitly.
The UI does not silently authenticate again, refresh the code or retry login.

**Refresh QR** and **Try existing login** each need a preview and one-use
confirmation. Reading a cached code does not generate a new one. Quick login
requests only the expected QQ already present in the server's cached list; it
does not set the persistent auto-login preference or start a local QQ process.
A response acknowledges a request, not successful login. Timeout, malformed or
nonzero responses after possible submission remain unknown and are not retried.

If token rotation is unresolved, choose one retained token explicitly for this
temporary login session. It does not select or discard the stored candidates
and grants none of the seven management operations below. After matching QQ
login, return to the separate credential-recovery confirmation. Authenticator
codes remain transient. No passwords, new-device challenge flow or device reset
are added by this feature.

## Explicit changes

Seven operations use separate forms and one-use previews:

- Network settings: bind address, port, login rate, WebUI disabled state, access
  control mode, address lists and forwarded-address handling.
- WebUI token rotation.
- Authenticator enrollment and enabling.
- Authenticator disabling.
- Replacing the TLS certificate and matching private key selected locally.
- Removing the remote certificate files.
- Requesting a remote restart.

Before applying a change, the app rechecks the selected registration, actual
endpoint and observed baseline. A five-minute preview is consumed once. A
successful response, subsequent matching observation, durable saving and process
restart are different facts. The upstream configuration helper can update memory
without writing disk, certificate files are replaced separately, and restart
returns a request acknowledgement. Unknown results remain unknown; no automatic
retry, rollback, restart or HTTP downgrade follows.

Token rotation can revoke the current signed credential even when old-token
verification fails. Before the request, the app encrypts both old and proposed
tokens. An uncertain result retains them. Select one candidate explicitly for a
single authentication attempt; after successful scoped verification, a separate
confirmation removes the recovery candidates while retaining the chosen token.
Opening or closing the page never chooses or retries a candidate automatically.

Enrollment seeds appear only in the dedicated enrollment view. The app does not
fetch the existing remote TLS private key. Local certificate inspection validates
the selected pair; it does not upload until the exact change is confirmed.
Closing cancels unsent work and clears local drafts. It cannot undo a request
already received by the server or revoke every server-side session.

## Scope and evidence

This client does not implement remote safe plugin deployment, host process
ownership, remote component installation, data backup/restore or OneBot WSS chat.
The local plugin file transaction requires filesystem identities, a durable
journal and stopped-process evidence that the WebUI does not supply. Those
features remain in the [full delivery scope](ACTIVE_GOAL.md), requiring their
own remote execution contract. Passkey source support above does not establish
remote revocation or real-server acceptance; QQ sign-in is not a remote-host
or OneBot connection.
Existing local loopback and owner-only message rules remain unchanged.

The preceding remote-login checkpoint's focused checks passed: 49 transport cases, 31 new login plus 29 adjacent
client/policy/session cases, and eight new actual-main cases plus 19 adjacent
IPC/panel cases. The login production-DOM fixture passed 21 checks with 13
inspected screenshots; the existing 23-check remote UI fixture also passed.
These use isolated encrypted-storage doubles and fixed synthetic transport.
Separate backend checks use real local TLS handshakes with explicitly public
test certificates and injected test address routing. They verify boundaries
and races, not a deployed remote installation.

That preceding package matched 226 source files, two notices, 11 metadata fields and three
unpacked assets; the approved voice asset was unchanged. Full regression passed
446 syntax files and 2,933 tests, with one existing opt-in skip and zero failures;
the standard desktop UI smoke also passed. Actual packaged empty-list/form
checks are separate from the synthetic management scenarios. Existing Ju/Whale
QQ and AI connections were restored from their original settings without QR,
key input, model requests or test messages; independent identity, configuration
and single-main checks passed. Dragon remains unstarted with its earlier
authentication gate deferred. This does not validate any remote registration.

The preceding Passkey package matched 230 source files, two notices, 11 metadata
fields and three unpacked assets, with the approved voice asset unchanged.
454 syntax files and 3,000 tests passed, with one existing opt-in skip and zero
failures; standard desktop smoke passed. The new UI passed 20 checks/12 images,
with the previous remote23 and login21 checks passing. Its actual packaged
entry and original Ju/Whale restoration have the same bounded result above:
no new QR/key input, test message, model request or real remote registration.
Dragon remains unstarted. A successful native availability query is not
Passkey enrollment, authentication, cancellation or durable server storage.

Real acceptance still requires a controlled HTTPS test server with the fixed version and an
independent recovery route for connectivity changes. No such host has yet been
provided; it remains in the later consolidated acceptance stage.

A separate Windows/Electron probe saved a synthetic credential with actual OS
encryption and read it back in a second process after normal application exit.
It used a new isolated profile, zero windows and no remote requests. An earlier
probe using immediate `app.exit` could not decrypt on reopening; that failure is
retained, and its exact shutdown timing cause is not established. The normal-exit
result does not prove sudden-termination recovery or validate existing real keys.

Reviewed primary source, 2026-11-06, fixed commit
`9335843246e3b7a17944861f3ac8731a259732c2`:
[authentication handlers](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/Auth.ts),
[network and certificate handlers](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/WebUIConfig.ts),
[configuration persistence](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/helper/config.ts)
and [restart handler](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/Process.ts).
The implementation is original; no upstream manager source is copied.

Passkey sources reviewed 2026-11-07: the fixed
[registration/authentication handlers](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/Auth.ts),
[shared challenge and storage helper](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/helper/PasskeyHelper.ts)
and Microsoft's [native WebAuthn API](https://learn.microsoft.com/en-us/windows/win32/api/webauthn/).
