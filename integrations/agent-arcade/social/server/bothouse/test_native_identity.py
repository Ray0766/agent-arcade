"""Stock role roster boundaries. A DSH-only roster entry is not a routable Bridge project."""
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

adapter = runpy.run_path(str(Path(__file__).with_name("instance.py")))

class NativeMemberTest(unittest.TestCase):
    def test_exact_registered_project_only(self):
        rows = [
            {"name":"tide","display_name":"shared","source":"bridge"},
            {"name":"other","display_name":"shared"},
            {"name":"dsh:tide","display_name":"shared","source":"dsh"},
            {"name":"external","source":"unknown"},
        ]
        def read(port, token, route):
            if route == "/api/v1/roles":
                return {"roles":rows}
            self.assertIn(route, ("/api/v1/projects/tide/users","/api/v1/projects/other/users"))
            return {"configured":False}

        run = adapter["run"]
        with tempfile.TemporaryDirectory() as tmp:
            config=Path(tmp)/"friends.toml"
            config.write_text("[management]\nenabled=true\ntoken='test'\n[friends]\ntext_projects=['tide']\n")
            with patch.dict(run.__globals__, {"read_json":read, "instance_id":lambda *_:"fixture"}):
                projects=run(config, {"action":"authority"})["projects"]
                self.assertEqual([(p["id"],p["selectable"]) for p in projects],[("tide",True),("other",False)])
                data=run(config, {"action":"list", "account":"alice"})
                self.assertEqual(data["directoryReason"],"not_shared")
                self.assertEqual(data["contacts"],[])
                rows[:] = rows[2:]
                self.assertEqual(run(config, {"action":"list","account":"alice"})["directoryReason"],"no_roles")

if __name__ == "__main__":
    unittest.main()
