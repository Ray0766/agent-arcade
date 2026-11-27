"""Controlled world publisher for the Friends worker/permission pipe test."""
import json


def origin(value):
    return value


def publish(config, selected, permitted, world, token):
    # The real publisher requests a fresh directory for each snapshot.
    permitted()
    ids = sorted(permitted())
    state = json.loads(config.read_text(encoding="utf-8"))
    rows = [{"id": number, "activity": state["activity"]} for number in ids]
    if state.get("empty_snapshot"):
        rows = []
    with config.with_suffix(".jsonl").open("a", encoding="utf-8") as samples:
        samples.write(json.dumps(rows) + "\n")
    return {"residents": rows}
