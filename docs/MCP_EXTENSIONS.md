# Local result inspection: MCP Apps and Tasks

This experimental feature uses the existing, pinned `@modelcontextprotocol/sdk` **1.32.2**. It adds no model calls, account requirement, HTTP listener or dependencies. It does not expose the WeChat execution broker as an MCP task server.

## What is implemented

- `inspect_text` accepts explicitly supplied text and computes its UTF-8 byte count, line count and SHA-256. The response contains a bounded literal preview and JSON-formatting availability. The check concerns **the supplied text**, not the correctness of an agent's work.
- Real MCP initialization advertises `tasks.list`, `tasks.cancel` and task-augmented `tools/call`. The tool declares `execution.taskSupport: required`; clients without Tasks must not call it as a normal tool. `tasks/get`, `tasks/list`, `tasks/result` and `tasks/cancel` go through the SDK protocol handlers.
- The tool's `_meta.ui.resourceUri` points to `ui://agent-arcade/text-inspection`. `resources/read` returns a bundled `text/html;profile=mcp-app` resource. It implements the **2026-01-26** Apps handshake, receives tool results, and switches between literal text and formatted JSON.
- The desktop uses a linked SDK client/server transport inside the main process. The same server can run over actual stdio for compatible MCP hosts: `node src/mcp/server.cjs`. No account or application configuration is silently changed.

## Bounds and cancellation

Inputs are at most 65,536 JavaScript string code units / 262,144 UTF-8 bytes. Labels are at most 100 code units. Previews contain at most 32,768 code units; the hash always covers the complete supplied text. Truncated JSON cannot be formatted from the partial preview.

Each server connection owns at most 24 tasks. The default retention is 60 seconds from creation; requested TTLs are clamped to 1–300 seconds. Pagination returns at most eight records. Expiry applies while working and after completion, without resetting the deadline. Cross-session lookup is rejected. State is memory-only: restarting or closing this local inspection service drops its tasks and results. This is an experimental inspection implementation, **not restart-durable agent orchestration**. It never automatically replays work.

Hashing yields between 1 KiB chunks. Cancellation aborts that worker and prevents a later completed state. It cannot stop Claude, terminate a shell command, undo a write, or cancel a WeChat task. `completed` means the text inspection produced a result. It is not a general task-success signal.

## Host boundary

The bundled viewer has no external resources or connections, permissions, executable result HTML, or tool-call proxy. User text is assigned with `textContent`; even an HTML file remains literal text. JSON formatting failure leaves the original preview readable.

The app sends `ui/initialize`; the host responds with protocol version `2026-01-26`, its info and capabilities. The app then sends `ui/notifications/initialized`. Only then may the host send `ui/notifications/tool-result` with the full MCP `CallToolResult` in `params`. Both sides must check `event.source`. `ping` and `ui/resource-teardown` are also handled.

For the desktop's restricted built-in preview, use `sandbox="allow-scripts"` and **do not add `allow-same-origin`**. The exact bundled inline script hash is exported as `APP_SCRIPT_HASH`; parent and child CSP must both permit only that script, and prohibit network/frame/object/form destinations. Hashing normalizes source newlines to LF, so Windows checkout endings do not change the resource. Arbitrary remote MCP App HTML must not enter this preview path. This limited desktop viewer does **not** claim full generic MCP Apps host compliance; the official web-host specification requires a separate-origin sandbox proxy and further host policy handling.

MCP Apps do not add native buttons to WeChat. The result viewer is a desktop feature; messaging platforms retain their own UI and capability limits.

## Verification

`node --test test/mcp-extensions.test.cjs` exercises a real SDK linked transport and a separately spawned Node stdio server. Checks cover capabilities, discovery/resource MIME/metadata, task creation/get/list/result, cancellation during actual chunked work, immutable terminal states, task/session isolation, resource bounds, original TTL expiry, full-text hash despite truncated preview, and hostile text / malformed JSON in the bundled app protocol. The UI host and packaged application's visual checks are recorded separately in [VALIDATION.md](VALIDATION.md).

The mature baseline remains ordinary plain-text results and the existing dispatcher. This implementation adds inspectable bytes/hash plus an interactive local view and a standard poll/result/cancel interface. It has not demonstrated better agent task accuracy, comparative usability, resource savings, or interoperability with every external host. No actual Claude task has been converted to an MCP Task.

## Sources and decisions

Reviewed **2026-11-04**:

- [Official MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview): UI resource/tool association and host-dependent rendering.
- [Apps 2026-01-26 specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx): handshake, resource MIME, postMessage, CSP and sandbox requirements. The resource protocol is implemented directly rather than adding the optional Apps SDK.
- [MCP Tasks 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks): experimental capability negotiation, task support, polling, deferred results, cancellation and bounded lifetime. Protocol completion remains separate from verifying domain outcomes.
- Installed SDK `experimental/tasks` interfaces and handlers, version 1.32.2: reused for wire behavior. The project supplies a small bounded store because the SDK's demonstration store is unbounded and restarts retention at completion; this implementation retains the creation-based deadline.
