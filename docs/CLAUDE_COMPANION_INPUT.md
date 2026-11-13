# Claude API companion input

Current source, 2026-11-08. Claude API companion conversations use `verbatimPrompts: true` in [`runner.cjs`](../src/bot/runner.cjs). This applies only to `conversationOnly` execution, including the App-local companion route. The coding/tool route and [local Claude program mode](CLAUDE_PROGRAM.md) are separate and were not switched by this change.

## Why use this option

Agent Arcade assembles a companion prompt from the current message, character definition and bounded context. That is application-composed input, rather than text entered into a coding terminal. The [official SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript#options) documents `verbatimPrompts` for this case: the SDK marks each user message `client_composed: true`, preserving its text instead of expanding file/MCP mentions or dispatching slash commands. This is an input-processing contract, not a guarantee of reply quality.

The installed SDK **0.3.317** declarations also describe the current CLI's broader skip of turn-start attachments, including its usual reminders; they warn that this behavior is CLI-dependent. The pinned bundled CLI is **2.1.317**. This supports reducing unrelated coding-context interpretation in a no-tool companion conversation. It does not establish that any particular reminder caused a previous bad reply.

[`claude-companion-verbatim.test.cjs`](../test/claude-companion-verbatim.test.cjs) exercises the actual installed SDK serializer with an in-memory process peer. It checks `client_composed`, unchanged literal text and PNG content, the unmarked coding/resume route, existing budget/turn outcomes and cancellation. Together with the existing runner tests, the recorded check passed **27 tests**. The peer did not execute the native CLI or contact a model; this evidence verifies serialization and application handling only.

No model, thinking/effort setting, production cost limit, turn limit or tool permission changed. Companion tools remain disabled. Ordinary discussion about budgets is retained; the app does not remove words or filter XML from otherwise successful replies. A completed reply remains `reply_ended`, not verified task success.

## Bounded real comparison

Two isolated API experiments compared the default option with `verbatimPrompts: true`, using the same synthetic budget question and system prompt. Both reported **`claude-opus-5-5`** and **`ANTHROPIC_API_KEY`** as the credential source. Thinking appeared in separate blocks; each final result matched its assistant text by hash. Neither text/result contained the watched `reasoning_effort` or `invoke` tag forms. Init did not report effective thinking/effort settings, so those were not inferred.

Each run reported **$0.006033** in SDK-estimated cost, **$0.012066** combined. These are estimates, not verified charges. The experiments used a 1-turn, 1024-output-token, 60-second limit and a $0.10 stopping threshold; those diagnostic settings were not adopted as new production limits. SDK cost thresholds can be exceeded by an in-flight response. See [official cost-tracking guidance](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

The original real “D” reply containing unexpected XML **was not reproduced**. The comparison therefore does not prove a semantic fix, identify that reply's cause, or prove that the two requests contained different CLI attachments. The diagnostic runs retained text hashes rather than raw HTTP or reply bodies; the original D SDK/HTTP stream is unavailable. The private metadata-only comparison is `work/claude-sdk-metadata-diagnosis-20261108/COMPARISON_20261108.json`; original failed observations remain separate. Both diagnostic workers/native children closed, temporary profiles were removed, and the original encrypted vault and Local State hashes were unchanged.

## Operated QQ retest

In `single-window-companion-verbatim-20261108`, the original saved Claude API
connection answered the same kind of 200-yuan weekend question with two relevant
sentences and the requested H marker. A separate current orange-portrait input
produced matching hair, flower, ribbon and brooch details with its I marker.
Both replies were visible in the owner's ordinary QQ and independently joined
to their durable tasks, with two accepted bubbles each. Neither bounded reply
contained the earlier internal tags or budget aside. The actual selected model
was not persisted for these turns; the diagnostic model name is not attributed
to them. This is a successful real retest, not proof that the old D failure is
explained or cannot recur. Private evidence:
`outputs/companion-verbatim-actual-20261108.json`.
