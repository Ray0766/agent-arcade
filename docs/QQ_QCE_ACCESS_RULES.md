# QCE access rules

The same-window **Access rules** source adapters target active QCE **5.5.77 or
6.4.2** on owned NapCat **4.18.42**. Version 6.4.2 requires the fixed managed
Shell launch and [startup checks](QQ_QCE.md#fixed-642-startup-boundary); actual
Rust/account acceptance remains pending. The editor reuses QCE's separate saved token and the
existing actual-QQ/listener checks. Claude, GPT and DeepSeek keys are unrelated
and remain unchanged. This is an original bounded adapter, not an embedded QCE
web page or a copied upstream implementation.

## Entrance and actions

Open **QQ accounts → Local components → Manage plugins**, read the installed
list, then choose **Access rules** on the supported active QCE entry. Initial
credential status is local only; choose **Read access rules** to contact QCE.
An empty local token leads to the existing QCE credential editor.

The editor supports adding a literal IP or IPv4 CIDR, removing one observed
rule, enabling/disabling the address filter, adding the address reported by
the last read, and changing QCE's advertised host. Every edit uses a captured
baseline, a preview and one explicit confirmation. The ticket expires after
five minutes and cannot be reused. Switching accounts, hiding the window,
changing credentials or leaving the view invalidates pending edits.

New rules accept canonical dotted IPv4, IPv4 CIDR, exact IPv6 literals and
`*`; IPv6 CIDR, zone IDs, URLs and hostnames are not accepted as address rules.
Existing bounded nonempty legacy entries remain removable without
normalization. An empty legacy entry is shown but cannot be removed through
this fixed API, which rejects an empty literal. If duplicate literals exist,
native removal deletes only their first occurrence.
“Add reported address” submits the literal shown in the preview, rather than
letting a later request choose another address.

For 6.4.2, the baseline combines whitelist reads with a separate authenticated
read. It does not invent the configuration-file path absent from that API. The
token stays in the main process; authentication may update access metadata.
The advertised host accepts a hostname or IPv4, not an IPv6 host string; IPv6
address rules remain supported. CIDR prediction follows this version's stricter
parser rather than the 5.5.77 parser. See the pinned [security routes](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/api/routes/security.rs)
and [manager](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/security/manager.rs).

## What these settings actually change

- A disabled filter, an enabled **empty list**, `*`, or `0.0.0.0` allows all
  supplied IP addresses. Removing the last rule does not deny everyone.
- A nonempty enabled list that excludes the app's loopback connection can
  prevent later reads or edits. The preview shows this possibility. The app
  does not add a recovery rule, restore old rules or retry automatically.
- These settings may share an OS-user configuration with other QCE processes.
  Choosing a companion binds this connection; it does not isolate the upstream
  settings to that QQ account. Existing exports or enabled plans may lose access.
- The advertised host changes displayed addresses only. It does not change
  QCE's listener, port, TLS, firewall or the app's fixed loopback destination.
- QCE trusts forwarded address headers and leaves some routes public. The app
  sends no forwarded headers. A reported address is not proof of physical
  client origin, and this editor is not a firewall for all QCE resources.

## Result and recovery

**Accepted** means a recognized API acknowledgment was received. A separate
observation can match, differ, or be unavailable. Neither acknowledgment nor
matching readback proves durable disk storage: the fixed implementations can
swallow write failures. Even authenticated reads update access bookkeeping
and can write the entire shared configuration. Another process may overwrite
a recent change with its stale in-memory state.

A lost or malformed acknowledgment stays **unknown**, even if a later read
matches. No automatic second write occurs. An accepted self-locking change
keeps its acknowledgment when subsequent authentication fails. Recovery then
requires the appropriate independent QCE administration; this view promises
no out-of-band bypass.

Token rotation and session listing/revocation are not implemented: neither
fixed version exposes a supported management route. Removing the app's saved
token does not revoke QCE's token. Remote QCE and other versions remain
unsupported. [Native shared schedule administration](QQ_QCE_NATIVE_PLANS.md) is
implemented separately; real installed-plugin acceptance remains pending.

## Evidence and limits

The historical **5.5.77** evidence below is not a 6.4.2 runtime result.
The fixed official [API](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/api/ApiServer.ts)
and [security manager](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/security/SecurityManager.ts)
were inspected. Sixteen isolated actual-component checks plus five independent
counterexamples cover rule semantics, swallowed writes, later-read persistence,
shared stale-state overwrite, forwarded addresses and IPv6 limits. They use
synthetic data and temporary storage, without initializing an installed plugin.
They do not prove real-account access restrictions or persistent configuration.

Production policy/client/session checks passed 21 cases. Actual main with
synthetic identity/vault and isolated HTTP passed 95 new/adjacent checks.
An independent received-acknowledgment/close transport case passed separately.
The renderer passed 16 checks with 12 inspected wide/narrow images; adjacent
folder and schedule UI suites each passed 17 checks. These do not replace
real installed-QCE use.

Two counterexamples exposed a local credential-status panel surviving a child
view's close before any remote read. The main owner now retires the matching
status/pending read for all four QCE child views; an old close cannot retire
a replacement panel. Initial failing results and the final passing run are
retained separately.

Full regression passed 3,475 tests with one existing opt-in skip and zero
failures; 560 syntax files passed. The prepared
`single-window-qce-security-20261107` package matched 278 source files and the
approved voice asset. It has not replaced the running app or been launched.
Actual installed-QCE use, real access-rule changes and persistence remain
unaccepted in the consolidated test stage. No real rule, saved model credential
or current launcher was changed for this increment.
