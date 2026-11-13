# Standalone Messenger relay deployment template

This optional template is not deployed by Agent Arcade. It does not choose a hosting provider, open a desktop port, register a Meta application, subscribe a Page, log in to Facebook or send a message. Hosting, a domain, a CA-issued certificate and the relevant Meta permissions are the operator's responsibility. Use one relay process for one App/Page/owner binding.

The relay only needs a maintained Node.js version compatible with the project's minimum Node 22.13, plus these repository files in their relative layout:

- `scripts/messenger-relay.cjs`
- `src/bot/messenger-relay.cjs`
- `src/bot/messenger-transport.cjs`
- `LICENSE`

It uses built-in HTTP, crypto and SQLite; no `npm install` or desktop Electron runtime is needed for this separate server. SQLite data must live on a private local filesystem, outside the source tree and web root. Do not share the database between replicas or expose it as a downloadable file.

For an explicitly approved Linux deployment, create a dedicated unprivileged service account and private `/var/lib/agent-arcade-messenger` directory. Copy `relay.env.example` to `/etc/agent-arcade-messenger.env`, make it readable only by root/the service account and fill in the IDs and three separate secrets. The App secret comes from Meta; generate independent unpredictable verification and relay bearer secrets of at least 32 printable ASCII characters. The owner is a Page-scoped ID for this Page. Keep the Page access token only in the desktop vault.

Run the source entry explicitly after supplying those environment variables:

```text
node scripts/messenger-relay.cjs
```

The entry binds **127.0.0.1 only**, by default port 8787. It never binds a public interface or contacts Graph. `agent-arcade-messenger.service` illustrates a restricted systemd unit; review its Node path, account and directories before installing/enabling it. The nginx template illustrates TLS termination and fixed allowed routes. Replace the example hostname/certificate paths and validate the configuration with the installed nginx version before reload. Neither template has been deployed or TLS-validated in this project.

Configure the Meta webhook callback as `https://<your-host>/webhook`, with the private verify token. Configure the necessary Page message subscription in Meta's dashboard. Exact current App access/review and Page permissions remain prerequisites described in [Messenger](../../docs/MESSENGER.md). The desktop's relay origin is `https://<your-host>` with no path or query.

The relay authenticates raw webhook bytes with HMAC-SHA256 and separately authenticates desktop status/pull/ACK using the relay bearer token. It stores only the projected fixed-owner messages, not raw events or a Page send token. Five-minute logical delivery expiry is enforced on every read. While the entry runs, a 30-second maintenance tick removes expired payloads; a stopped process cannot perform deletion until next startup/activity. Acknowledged payloads are removed immediately. MID fingerprints survive 26 hours to reject replay. SQLite's logical deletion is not a promise of forensic erasure from filesystem snapshots or backups.

Do not enable request/body/header logging. The webhook verification query includes a secret, and access/error logs at an outer proxy or hosting provider may capture it. The example disables both nginx request and error logs for this server; add monitoring that records only safe availability codes, never raw URIs, headers or events. Review database backup, deletion, access control and hosting retention separately.

The handler limits requests to 256 KiB, five seconds per body and 16 in-flight reads. The entry additionally caps connections, headers and keep-alive duration. These bounds are not a substitute for a protected HTTPS deployment or rate limiting at its edge. Incoming content is plaintext inside the trusted relay, so it is not end-to-end encrypted between Meta and the desktop.

References: [nginx proxy directives](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [nginx request limits](https://nginx.org/en/docs/http/ngx_http_core_module.html), and [systemd execution restrictions](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html). These are operational examples; no provider or platform approval is implied.
