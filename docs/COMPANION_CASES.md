# Fixed companion cases

This offline harness checks whether the application supplies the right information
to a model request, respects notice controls, and reports failures honestly. It
runs the production `BotService`, App conversation pipeline, SQLite stores, Wiki
proposal/approval pipeline, folder source registry and notice controller selected
by `--source-root`. It does not start Electron or the owner's App, read a user
profile or native credential vault, call a real model, or rebuild a package.

The fixed inputs are in
[`test/fixtures/companion-cases.json`](../test/fixtures/companion-cases.json).
They are synthetic. The injected conversation runner returns a fixed neutral
sentence: that sentence is never treated as evidence of model recall or answer
quality. Wiki setup uses a verifiable proposal from a fixed owner message and an
explicit approval through the production service. Files and databases live in a
new resolved temporary directory and are removed after each run.

## Run

Use the repository's Node.js 24 toolchain and installed dependencies:

```sh
node scripts/companion-cases.cjs --source-root . --output /private/tmp/companion-cases-base.json
node scripts/companion-cases.cjs --source-root /absolute/path/to/frozen/source-snapshot --output /private/tmp/companion-cases-latest.json
npm test -- test/companion-cases.test.cjs
```

`--source-root` loads production modules from that directory; the fixture and
harness remain the same. It does not copy changes into either source tree. Each
source root must have its normal dependencies available, directly or through the
caller's `NODE_PATH`. `--cases M01,N04,E01` selects a smaller set. Without
`--output`, the JSON goes to standard output. Exit code 0 means all selected required checks passed; the separately declared
M09 exploratory gap does not turn that into a required failure. Exit code 1 means
one or more required failures, case errors or denied unexpected fetches were recorded; 2 means the harness itself could not start. All cases continue
running after an individual failure, so the report retains the complete comparison.

Global `fetch` is denied while cases execute. E01–E03 explicitly inject an
in-memory fetch stand-in into the real DeepSeek conversation runner. Those
stand-ins return HTTP 401, HTTP 429, a thrown network error, or a controlled
successful retry. No endpoint is contacted. The fixture vault is an in-memory
adapter for made-up credentials, not OS encryption evidence.

## Cases and observation boundaries

| IDs | Input / transition | What is actually checked |
| --- | --- | --- |
| M01 | Explicit “remember”, then 25 unrelated turns | A structured fact survives and is present in the next production context after its source chat has left the recent window. |
| M02–M03 | Ordinary conversation / “do not remember” | No structured fact is created. The current chat may still contain those words; refusal to save a fact is not erasure of conversation history. |
| M04–M05 | Correct / forget by the actual fact short code | The current value is stored, the obsolete or forgotten value is absent from the next context, and forgetting removes the fact. |
| M06–M07 | Switch characters and back / construct a new service instance | Private facts do not cross character scopes and remain available after explicit reopening. No new AI provider or credential is selected. |
| M08 | Opt-in built-in role, owner-approved notebook entry, lexical query | The note's fixed marker is actually present in the built-in role's production prompt. |
| M09 | Library role, synonymous query with no lexical overlap | An exploratory retrieval check. A missing note is a separately reported exploratory gap; no semantic-search feature is assumed. |
| M10 | Library role, two differently worded queries about the same page | Both stateless requests contain the actual approved notebook lines. The earlier model reply is not used as proof that the note remains available. |
| N01 | A real temporary folder reader produces one event, then the event is repeated | One durable notice and one wording request, with no duplicate stored App notice. |
| N02–N04 | Pause App chat / turn notices off / disable the source after it queued an event | No model request occurs in the disabled interval; the pending row is withheld. Explicit resume/re-enable can deliver it once while it remains current. |
| N05 | Deliver, reopen registry and service from their saved files | The sent notice and source cursor prevent replay. |
| N06 | Durable claim, then reopen before a delivery result | The unconfirmed row becomes `unknown`, with no replay. This is a controlled claim-boundary exercise, not a real process-crash acceptance. |
| E01–E03 | Real runner + 401 / 429 / offline fetch stand-ins | Main-process failure class, no assistant success row, no immediate automatic retry, and one successful explicit retry without tools. Provider error bodies do not become user-facing evidence. |
| E04 | Replace only the temporary SQLite file path with a directory, attempt a save, restore it and reopen explicitly | The actual SQLite operation fails, no save success is manufactured, the prior fact remains and the failed fact is absent after recovery. This does not test disk exhaustion or every filesystem failure. |

The notice clock is controlled; file reading and persistence are real. These
cases do not establish macOS notification delivery, sleep/wake reliability or
human impressions of appropriate timing. “No immediate automatic retry” covers
the bounded sequence actually observed, not an indefinite uptime guarantee.

## Reference and oracle

The fixed persona is “合成陪伴者”: a calm, concise fictional companion whose
memory remains under the user's control. Its exact description is injected into
the temporary production built-in settings or library card and into both
reference contexts. This controls persona text for the context comparison; it
does not evaluate the shipped characters' personalities.

The simple context reference uses that persona plus the same character's
**last 20 raw messages**,
bounded to **6000 characters**, without structured facts or notebook retrieval.
The production library pipeline is also explicitly configured to 6000 characters;
built-in App prompts retain their existing 6000-character cap.
Its source is an independent transcript of the fixed actions: it does not borrow
the product's fact-clearing logic. It provides a small, inspectable baseline,
not measured results from ChatGPT, SillyTavern or any competing product.
Its format is JSON `{persona, messages}`. The production pipeline keeps its own
application policy, frames and formatting: the common conditions are the fixed
persona text, the case actions and the **total 6000-character budget**, not
byte-identical prompt templates.

Each memory case separately lists an **explicit fact oracle**: the fixed values
that the owner action says should be available or absent. That oracle is an
answer key for context inclusion, not a generated response and not part of the
production prompt. It is actually rendered as a separate JSON `{persona, facts}`
context within the same 6000-character total budget. Required/forbidden marker
checks and a hash are reported for that reference too. Its facts come from the
fixture's declared owner actions, not from the product's returned answer or a
successful product-state assertion. History-only context has no active-notice or error-recovery
implementation, so those reference cells are explicitly unsupported and are not
awarded zero-duplicate or successful-recovery scores.

Reports include the fixture and harness hashes, hashes of loaded production source files,
source Git HEAD when available, per-case checks, required/forbidden marker
presence, prompt lengths and hashes, and separately labelled reference results.
They omit raw production prompts and credential values. Differences can identify
an old cache or disabled-source defect, but a score increase alone is not a
claim of better model answers, semantic memory or user retention.

## Results

Executed on 2026-11-15 on macOS arm64 / Node 24.21.0, using the same fixture
and harness for both source roots. The adopted worktree's App source is unchanged
from `3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4`; its separate documentation
preparation commits are identified by the report's execution Git HEAD. The
maintenance source is the frozen, uncommitted snapshot, not code integrated into
this adoption branch.

| Source | Required passes | Required failures | Separate exploratory gap | Case errors | CLI exit |
| --- | --- | --- | --- | --- | --- |
| Committed product baseline | 16 / 19 | **3: M08, M10, N04** | M09 | 0 | **1**, expected failure |
| Frozen maintenance source | 19 / 19 | 0 | M09 | 0 | 0 |

These are fixed-case observations, not model-quality percentages. The two
sanitized receipts retain individual assertions and actual reference results:
[committed baseline](evidence/companion-cases-20261115-base.json) and
[frozen maintenance source](evidence/companion-cases-20261115-latest.json).
Both recorded **zero unexpected fetch attempts**. The harness's four own tests
passed; that confirms the harness detects missing context and failure states,
not that the committed App passed all required cases.

The three required baseline failures have concrete counterexamples:

- **M08:** the notebook entry is stored, approved once and enabled for reading;
  the lexical search selects it, but the built-in App prompt omits its marker.
  The frozen maintenance source includes it.
- **M10:** both questions lexically select the same approved page. The baseline
  includes it for the first query and omits it for the second because recall
  suppresses a page already used in that conversation. The frozen source
  includes the page on both stateless requests.
- **N04:** a real folder event is already pending when its source is disabled.
  The baseline still starts one wording request and records the notice as
  `sent` during that disabled interval. This is a **required failure**, not an
  acceptable delayed send. The frozen source keeps it `pending`, makes no
  request while disabled, then delivers once after explicit re-enabling.

**M09 remains an exploratory gap in both sources.** The same approved Chinese
note reads “地铁卡编号：CASE_METRO_R7。”; lexical queries ask “地铁卡编号是什么？”
and “再告诉我地铁卡的编号。”. The synonymous probe asks
“地下铁路乘车凭证的代号？”, without shared CJK token pairs with that entry.
Its entry is stored,
approved and readable, but the synonymous query has no shared lexical terms;
the lexical search selects no page, so no notebook marker enters the prompt.
The receipts identify that retrieval stage separately from approval, permission
and prompt assembly. The earlier owner message is pushed out of the 6000-character
context with 25 fixed distractor turns, preventing an old raw quote from being
misreported as notebook recall. No synonym table, vector store, new UI or
production fix was added in this execution.

The frozen report's independently computed loaded-source hash is
`e080c8267fd13a88fb7c9a9121af9a44fd51828c8159ac5ca567bcb1e495c3d2`.
All **85 loaded source files** match the corresponding entries in the separate
[candidate identity manifest](evidence/candidate-20261115.json), whose full code
tree hash is `35cabe89d278abbafbd77157319e9356f662b3b3c9864daf4828dc1109f6e41e`.
That cross-reference does not replace the loaded-file algorithm or imply every
candidate code path was exercised. The complete private run reports and exact
commands/exit codes are retained in the local, ignored
`outputs/companion-cases-{base,latest}.json` and
`outputs/companion-cases-commands.json`.

The existing maintenance fixes were observed, not reapplied. This execution made
no product-source changes, launched no user App, used no real credentials or
model, and rebuilt or published no package. Real-model interpretation, long-term
memory quality and human notification acceptance remain outside these results.
