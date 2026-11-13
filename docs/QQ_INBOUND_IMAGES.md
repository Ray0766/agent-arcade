# Current QQ pictures in companion chat

The image pipeline is included in the locally operated package. Four actual
owner QQ picture submissions were checked on 2026-11-08: Claude API and DeepSeek
Flash each described two different original portraits supplied with the same
local basename. Hair color and visible accessories matched the originals, and
the replies appeared in the owner's QQ. One Claude reply contained unrelated
budget bookkeeping, so natural wording did not fully pass. Component and request-payload
checks remain distinct evidence; the actual package and outcomes are recorded in
[the active delivery scope](ACTIVE_GOAL.md).

A later real Claude retest in `single-window-companion-verbatim-20261108`
correctly described a newly supplied orange portrait, including the flower,
ribbon and sun-shaped brooch, and delivered both bubbles to the owner QQ.
No unrelated budget aside or internal tags appeared in that reply. The earlier
naturalness failures remain recorded; this is a bounded retest after the
[companion input change](CLAUDE_COMPANION_INPUT.md), not a general reliability
claim or a proven explanation of those failures.

## Use

In a connected QQ companion conversation, send one JPG or PNG from the bound
owner's private chat. A nearby text question can join the existing short-message
batch. You can also explicitly quote one earlier picture in that same private
conversation and add a question. It may be your picture or a picture sent by
the companion. Supported connections are Claude API, GPT API and DeepSeek Flash. The
existing **相处方式 → 看懂我发来的 QQ 图片** preference defaults on and can be
disabled after disconnecting, like the other companion settings. An unsupported
backend, including DeepSeek Pro, does not upload pixels
or silently change models. The response explains when the picture could not be
read. Normal provider usage applies.

Only the single picture selected by the current message is supplied to the model.
Old conversation rows retain a text placeholder. An explicit quote re-verifies
the exact referenced message in the bound owner's conversation; it never picks
the latest picture or searches by filename. If that source is no longer
available, the reply says it could not be read. Opening history does not send
its pictures to the model. Ordinary text quotes remain text conversations,
including when image input is disabled. Albums, forwarded pictures, other
contacts and group pictures remain outside this path; broader support is unfinished. Picture text never
authorizes a tool, publication, permission or memory command.

## Why this implementation

The existing no-tools companion dispatch and API runners remain in place.
OpenAI Responses receives an `input_image`; Claude's existing streaming SDK
input receives a base64 image block; DeepSeek Flash receives an `image_url` data
URL. Provider formats follow their official [OpenAI image guide](https://developers.openai.com/api/docs/guides/images-vision),
[Claude SDK input guide](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
and [DeepSeek vision guide](https://api-docs.deepseek.com/guides/vision/).

The fixed NapCat 4.18.42 filename cache can associate a later same-name picture
with an earlier lookup. Instead, the application re-reads the exact current
message and verifies its owner, account, time, segments and stable resource
identity before downloading its message-specific URL. The allowlist derives
from the pinned [upstream URL construction](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-core/apis/file.ts#L300).
This is an application contract for that version, not a general Tencent CDN
guarantee. No filename-cache or arbitrary-file fallback is used.

Downloads have bounded size/time, one DNS resolution, verified public-address
TLS, no credentials and no redirects. Existing Electron image decoding produces
a bounded PNG before upload. Images stay in the private active-task path, with
cleanup on cancellation, account changes and completion. Switching the visible
character alone does not cancel another account's background conversation.
Public task snapshots, diagnostics and stored history do not receive the source
URL, filename, token or image payload.

## Actual acceptance and remaining limits

The four actual flows used orange-haired and blue-haired original portraits,
each copied to a file named `portrait.png`. A current-message question was sent
with each picture. The later blue picture did not receive the earlier orange
description. This is a bounded result, not proof that QQ preserves the local
filename or that all pictures will be understood. Each input was joined to its
own completed reply in the local journal; that record alone is not the visual
acceptance evidence.

Two additional actual owner-picture quote flows passed after packaging: Claude
API and DeepSeek Flash each described the referenced blue original in ordinary
owner QQ. The DeepSeek question also requested eye color and mouth expression,
matching details absent from its earlier description. Journal task correlation
and accepted sends were checked separately from the actual visible image/reply.
A subsequent real DeepSeek Flash flow also accepted a bot-origin picture:
the app explicitly shared the original orange portrait to the owner, ordinary
owner QQ displayed it, and the owner quoted that exact received image. Two
visible reply bubbles matched its hair, flower, ribbon and sun-shaped brooch.
This is one bot-origin example, not acceptance of expired references or arbitrary
history; it does not attest byte-for-byte remote image preservation.

The unexpected Claude budget aside was present in a successful result. The
application's extraction path ignores thinking/system/partial frames and rejects
budget/error outcomes. No raw SDK stream was retained, so the upstream cause is
unknown. A conversation-only wording constraint has been added in source; it
does not strip budget words, alter the cost limit or change coding permissions,
and is not a demonstrated fix. A later ordinary budget question returned only
internal-looking XML tags, with no advice or requested marker. The quoted-image
round was clean, but normal conversation reliability remains failed. The
current input and fixed production prompts do not contain those tags; complete
historical prompts and original SDK events were not retained, so their source
is unestablished. Accurate failure handling and natural wording remain open.

Synthetic transport tests, actual runner payload construction and renderer
checks establish narrower boundaries only. The wider release and remaining
human tests stay in [the delivery scope](ACTIVE_GOAL.md).
