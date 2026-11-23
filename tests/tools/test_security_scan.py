"""Tests use deliberately fictitious secrets; never user credentials."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
TMP = ROOT / ".private" / "test-tmp"
TMP.mkdir(parents=True, exist_ok=True)

class SecurityScanTests(unittest.TestCase):
    def run_scan(self, content):
        with tempfile.TemporaryDirectory(dir=TMP) as tmp:
            folder = Path(tmp)
            (folder / "app.js").write_text(content, encoding="utf-8")
            return subprocess.run(["node", str(ROOT / "tools" / "security-scan.mjs"), str(folder)], capture_output=True, text=True, encoding="utf-8")

    def test_accepts_safe_public_bundle(self):
        result = self.run_scan('const publicKey = "sb_publishable_UNIT_NOT_REAL_1234567890";')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["findingCount"], 0)

    def test_rejects_credential_material_without_echoing_it(self):
        import base64
        payload = base64.urlsafe_b64encode(json.dumps({"role": "service_role"}).encode()).decode().rstrip("=")
        tokens = [
            "-----BEGIN PRIVATE KEY-----\\nFICTITIOUS_UNIT_DATA\\n-----END PRIVATE KEY-----",
            "sb_secret_UNIT_NOT_REAL_1234567890",
            "eyJhbGciOiJIUzI1NiJ9." + payload + ".FICTITIOUS_NOT_A_SIGNATURE",
        ]
        for token in tokens:
            with self.subTest(kind=token[:12]):
                result = self.run_scan("const fixture = " + json.dumps(token) + ";")
                self.assertEqual(result.returncode, 1, result.stdout)
                report = json.loads(result.stdout)
                self.assertGreater(report["findingCount"], 0)
                self.assertNotIn(token, result.stdout)

if __name__ == "__main__":
    unittest.main(verbosity=2)
