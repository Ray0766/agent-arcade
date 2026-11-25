"""Loopback fixture for the stock Bothouse management and Bridge contracts."""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from threading import Thread

from websockets.sync.server import serve

root = Path(sys.argv[1])
project = "fixture-bridge"
token = "synthetic-bridge-token"


class Management(BaseHTTPRequestHandler):
    def do_GET(self):
        data = {
            "/api/v1/roles": {"roles": [{"name": project, "display_name": "Bridge fixture"}]},
            f"/api/v1/projects/{project}/users": {"configured": False, "roles": {}},
        }.get(self.path)
        status = 401 if self.headers.get("Authorization") != "Bearer " + token else 404 if data is None else 200
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": status == 200, "data": data}).encode())

    def log_message(self, *_):
        pass


def bridge(ws):
    assert ws.request.path == "/bridge/ws"
    assert ws.request.headers["Authorization"] == "Bearer " + token
    register = json.loads(ws.recv(timeout=8))
    assert register["type"] == "register"
    assert "capabilities_snapshot_v1" in register["metadata"]["control_plane"]
    ws.send(json.dumps({"type": "register_ack", "ok": True}))
    ws.send(json.dumps({"type": "capabilities_snapshot", "v": 1, "projects": [{"project": project}]}))
    for frame in ws:
        message = json.loads(frame)
        assert message["type"] == "message" and message["project"] == project
        assert message["user_id"] == "arcade:fixture_reader" and message["direct"] is True
        with (root / "messages.jsonl").open("a", encoding="utf-8") as log:
            log.write(json.dumps(message) + "\n")
        ws.send(json.dumps({
            "type": "reply", "session_key": message["session_key"], "reply_ctx": message["reply_ctx"],
            "content": "Two names: Tide Readers and Shoreline Shelf.",
        }))


identity = root / "identity"
identity.mkdir()
(identity / "signing.pub").write_text("bothouse-ed25519 " + base64.b64encode(bytes(32)).decode(), encoding="ascii")
http = ThreadingHTTPServer(("127.0.0.1", 0), Management)
Thread(target=http.serve_forever, daemon=True).start()
with serve(bridge, "127.0.0.1", 0) as ws_server:
    descriptor = root / "friends.toml"
    descriptor.write_text(
        f"data_dir={json.dumps(root.as_posix())}\n[management]\nenabled=true\nport={http.server_port}\n"
        f"token='{token}'\n[bridge]\nenabled=true\nport={ws_server.socket.getsockname()[1]}\n"
        f"token='{token}'\n[friends]\ntext_projects=['{project}']\n", encoding="utf-8"
    )
    print(descriptor, flush=True)
    ws_server.serve_forever()
