# QQ connection cores and prototype boundaries

## 2026-11-07 — Independent component progress

The separate development prototype now includes an original bounded JSON-line
helper, an explicitly configured signing-provider boundary and owned-client
lifecycle handling at LagrangeGo pin
`f7f8abfaa7f1beab2a30414298c4f8a628b39555`. Owned TLS contract tests and an actual
Windows helper passed with synthetic inputs; an actual pinned TCP object was
connected only to a self-owned loopback listener. The peer observed closure
before the client was online. Sixteen new top-level tests and 14 subtests passed;
the built executable processed eight requests, produced a 77-byte protobuf
body and exited normally without transmitting that body.

Construction was found to attempt an implicit public-key refresh through the
[pinned codec](https://github.com/LagrangeDev/LagrangeGo/blob/f7f8abfaa7f1beab2a30414298c4f8a628b39555/client/internal/oicq/ecdh.go).
The dedicated helper now requires its default-HTTP denial before construction.
The binary recorded two blocked constructor attempts and zero other default
HTTP attempts; no such request left that guard. This corrects the earlier
no-network construction assumption, and is not a general OS network sandbox.

The work-only prototype additionally has an original Node host using its
existing Node 24 SQLite runtime: bounded JSON-line requests, exact child/epoch
ownership, request and incomplete-frame deadlines, and a persisted operation
journal. A prepared request abandoned before the write attempt becomes
`not_submitted`; an attempted request without a result becomes `unknown`.
Neither can be automatically replayed, and an old operation ID stays consumed.
Recovery refuses a still-live or uninspectable old host/helper. It does not
adopt or kill a process based on a reused PID or name.

Fifteen focused host/journal checks passed after independent review found and
fixed two lifecycle defects: an unconfirmed exit could leave a caller waiting,
and a previous epoch could suppress cleanup after a new spawn failure. Five
separate actual Windows process/SQLite cases covered the original Go helper,
owned helper termination/restart, real host crashes at prepared/attempted
boundaries, old-ID refusal and zero replay writes. Native PID/creation-time/
executable checks confirmed the owned children were absent at the end. Hung
and trickled-output cases used separate synthetic Node fixture children, not
misbehaving real QQ. No real account or QQ message was involved. SQLite FULL
transactions are not a power-loss or remote exactly-once guarantee.

The next isolated step connects actual Go decoding to the owned Node host and
the existing metadata-only `MessageJournal`. Ten intake checks and two exact
native-file-identity checks passed; five actual Windows/Go/SQLite cases covered
cross-host duplicate suppression, crashes before and after the durable claim,
stale host epochs and distinct owner UID namespaces. All twelve created
worker/helper processes and both probe parents were independently absent at
the end. Native file identity now retains exact integer values as JSON-safe
strings, without treating a process-path hash as an executable-content hash.

This intake is an **at-most-once inspection prototype**. A crash after claim can
lose an observation; recovery records uncertainty and does not replay it. The
fixtures are synthetic codec input, not authenticated QQ events. The existing
journal's retention/capacity limits still apply. No production dispatcher,
account, signing, login or send path was added by these checks.

A further isolated authentication/QR component now validates synthetic inner
response lengths, TLVs and PNG boundaries before mapping challenge state. It
binds the expected QQ, nonce, epoch and expiry; refresh/cancel invalidates old
responses. Scan confirmation and a parsed registration response still do not
set authenticated or online state. Ten Go checks, ten host checks and six actual
pinned-component/owned-child cases passed; seven created children and the probe
parent were independently absent. Earlier helper/intake files and pins remain
unchanged. This is not a real scannable QR, login or encrypted-network-frame test.

The fixed [network initialization](https://github.com/LagrangeDev/LagrangeGo/blob/f7f8abfaa7f1beab2a30414298c4f8a628b39555/client/network.go)
does DNS/server-quality probes even with a custom server, so this new experiment
does not call its FetchQRCode/Login methods. The prior HTTP guard alone would
not constrain that DNS/TCP path. A bounded native-reader truncation behavior
was reproduced with synthetic input; the new strict parser rejects it before
state mapping. These protocol checks leave trustworthy signing, real bootstrap
and account acceptance unfinished.

The helper exposes no login/send command or default signing service. Authentic
signing, QQ login, real incoming events, delivered messages, QQ Space and a
production replacement remain unfinished. Production host/journal integration,
real connection liveness/recovery and long-running validation also remain open.
The prototype and
its pinned AGPL dependency remain separate from the MIT application package;
the working NapCat adapter, account configuration and credentials are unchanged.
These are component results, not ordinary-account acceptance. Current feature
development does not depend on a commercialization decision.

## Earlier options review

Research checked on 2026-11-06. This is an options review, not a decision to
replace the current QQ adapter, a platform approval, or a legal opinion. No
protocol core, authentication bypass or account migration was implemented for
this research.

## Product requirement and decision boundary

The requested experience is an AI character using its own **ordinary QQ
account**, with friendship, private conversation and account activities. An
official QQ bot is a different account/product type. Its supported chat
capabilities do not establish equivalence with an ordinary account or personal
QQ Space.

An independently authored core could remove a dependency on NapCat's code.
That alone does not grant permission to use Tencent's service, redistribute
the QQ client, or pass a commercial app store's review. App distribution,
service access, source dependencies, assets and model licenses are separate
questions.

## Options

| Route | What it can address | Costs and limits |
| --- | --- | --- |
| Official QQ bot API | Documented C2C/group/channel messages, supported proactive/recall and streaming capabilities | Lowest protocol maintenance burden. Requires the app's actual developer permissions and review. Does not satisfy the ordinary-personal-account requirement by itself. |
| Original QQNT local bridge | Integrating an existing native QQ session and local account experience | Depends on QQ/client/platform compatibility and permitted client integration. Writing a new bridge does not make internal client interfaces public or authorized. |
| Original independent protocol implementation | Removing the NapCat runtime and potentially the native QQ process dependency | Highest ongoing burden: authentication dependencies, connection/state, messages, identities, media, version compatibility and recovery. Login success is not long-term support evidence. |
| Another community implementation | Reusing some protocol and transport work | Its current license, dependencies, supported functionality and compatibility must be checked independently. Public source is not proof of commercial redistribution permission. |

Maintaining our own adapter/runtime manager has a narrower scope than maintaining
an entire QQ protocol implementation. Neither approach can promise to prevent
server-side session invalidation. The observed 2026-11-06 `KickedOffLine` events
show that the two sessions expired; the available logs do not establish why.

## Current official capabilities and documentation conflict

The live [official getting-started page](https://bot.q.qq.com/wiki/develop/api-v2/)
describes a registered bot identified through AppID/AppSecret and access tokens,
not signing in an existing ordinary QQ account. It links official Go, Python
and Node SDKs, while stating that SDK demos are reference implementations and
the API documentation determines supported capabilities.

The live [message overview](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)
and [C2C send API](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html)
currently describe proactive messages and interaction recall using `is_wakeup`.
The recall description gives four periods during the 30 days after a user's
interaction. There is also a documented
[streaming C2C API](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_stream_messages.post.html).
The user's receive preferences and application capabilities still matter; no
real developer application has been checked in this research.

The older [Tencent GitHub message document](https://github.com/tencent-connect/bot-docs/blob/main/docs/develop/api-v2/server-inter/message/send-receive/send.md)
still says proactive push stopped on 2025-04-21. This conflicts with the live
documentation above. Do not use that old statement to claim that current
official bots cannot initiate any conversation. There is also a timing
inconsistency within the live C2C page: its summary says a 60-minute passive
reply window while the `msg_id` field describes five minutes. A real permission
and response test is needed before product behavior relies on either value.

No examined official bot page establishes ordinary-account identity, general
friend-account control or personal QQ Space publishing. Those requirements
remain distinct, not silently replaced by the official bot option.

## Source licenses checked

| Project / revision examined | Observed license | Consequence for selection |
| --- | --- | --- |
| [Tencent botpy, master](https://github.com/tencent-connect/botpy/blob/master/LICENSE) | MIT | A permissive SDK code license; not a grant for ordinary-account access. |
| [Tencent bot-node-sdk, main](https://github.com/tencent-connect/bot-node-sdk/blob/main/License) | MIT | Same distinction; verify API support rather than assuming every current API is covered by the SDK. |
| [Tencent botgo, master](https://github.com/tencent-connect/botgo/blob/master/LICENSE) | Apache-2.0 | SDK reuse is subject to its license and notices; platform capabilities are separate. |
| [Lagrange.Core, current master/V2](https://github.com/LagrangeDev/Lagrange.Core) | No clear license grant found in the examined root and project metadata | Do not treat the old V1 license as proof that current V2 may be incorporated or redistributed commercially. Obtain clarification before selecting it. |
| [Lagrange.Core, v1 branch](https://github.com/LagrangeDev/Lagrange.Core/blob/v1/LICENSE) | GPL-3.0 | The current README calls V1 sunset. Historical licensing does not establish current compatibility or maintenance. |
| [LagrangeGo, master](https://github.com/LagrangeDev/LagrangeGo/blob/master/LICENSE) | AGPL-3.0 | Charging is not inherently prohibited, but source/distribution/network obligations need review for the proposed integration. |
| [Chronocat, master](https://github.com/chrononeko/chronocat/blob/master/LICENSE) | AGPL-3.0 | Same license distinction; this research did not run it or establish feature parity. |
| [SnowLuma, main](https://github.com/SnowLuma/SnowLuma/blob/main/LICENSE) | Source-available non-commercial license, v1.0 dated 2026-06-19 | Commercial use and public modified distributions require written permission. Bundled native addons are separately proprietary. It is not an unrestricted replacement for NapCat. |

Lagrange's [current README](https://github.com/LagrangeDev/Lagrange.Core/blob/master/README.md)
describes a pure C# NTQQ implementation, a native C ABI wrapper, and a Milky
service. [NuGet 2.1.2](https://www.nuget.org/packages/Lagrange.Core/2.1.2) was
updated on 2026-10-27; its existence is evidence of a published package, not of
license clearance or successful integration here. The current
[Milky feature list](https://github.com/LagrangeDev/Lagrange.Core/blob/master/Lagrange.Milky/README.md)
contains unimplemented actions; do not assume a drop-in replacement for every
NapCat capability.

NapCat core and Desktop have different licensing. See the current
[NapCat core license](https://github.com/NapNeko/NapCatQQ/blob/main/LICENSE) and
[Desktop license](https://github.com/NapNeko/NapCatQQ-Desktop/blob/main/LICENSE).
Our original runtime orchestration does not copy either project's source or
bundle either program.

## Platform permission is separate

The publicly accessible [QQ software/service agreement](https://ti.qq.com/agreement/index.html)
contains restrictions on unauthorized third-party login/use and client
attachment/modification in section 8.2.2, and on programmatic messaging and
account activities in section 8.2.3. It also reserves rights not expressly
granted. Whether a proposed commercial distribution is permitted cannot be
concluded from an MIT/GPL/AGPL label or from independently writing code. Obtain
the necessary permission and review the intended distribution before claiming
commercial readiness; this document does not determine legal liability.

## Independent ordinary-account prototype gates

Before replacing the working transport, define a separate, bounded prototype
for one explicitly designated test account:

1. Document implementation and dependency provenance, intended platform access
   and permission basis. No copied restricted implementation, copied login
   credentials or bypassed authentication is an acceptance shortcut.
2. Have the owner complete the normal authentication challenge. Independently
   read the actual signed-in identity before enabling message actions.
3. Complete a real owner message → receive event → AI reply → send receipt →
   visible QQ reply round trip. A simulated adapter or successful build is not
   this acceptance.
4. Exercise duplicate/out-of-order delivery, disconnected network, restart,
   cancellation and an ambiguous send result. Never replay a potentially
   delivered message automatically.
5. Distinguish process existence, authenticated session, channel readiness and
   verified result. A server-invalidated session must stop actions and request
   normal reauthentication, without claiming an automatic fix for its cause.
6. Then verify three-account identity/history isolation and single-account
   stopping. Media, group behavior and QQ Space require separate real tests.
7. Compare against the current adapter on the same Windows installation and
   accounts: owner steps, restart behavior, observed failures and resource use.
   Claim improvement only for the measured scenarios.

## Keeping the current app replaceable

The single-window UI, characters, models, memories and permissions can remain.
`QQRuntimeManager` currently manages a separately installed NapCat runtime; an
independent core would implement another runtime provider rather than replace
those product layers. The message provider would normalize its own events,
identity and send receipts into the existing service contract. Protocol-specific
capabilities should remain explicit, especially for QQ Space and account actions.

An official bot provider needs a separate identity namespace because its OpenIDs
are not ordinary QQ numbers. Existing personal-account contacts and memories
must not be silently reassigned to OpenIDs. An official-provider experiment is
an additional option, not acceptance of the ordinary-account requirement.

Recommended next decision: finish the authorized unified entry and validate a
small official-capabilities experiment if commercially useful; keep any new
ordinary-account core as a separately reviewed prototype until these gates are
met. No replacement has been selected by this research.
