import subprocess
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

class ProjectConfigTests(unittest.TestCase):
    def test_playwright_launches_local_chrome(self):
        result = subprocess.run(["node", "--import", "tsx", str(ROOT / "tests/tools/browser_config.mjs")], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_vite_denies_private_files_over_http(self):
        result = subprocess.run(["node", "--import", "tsx", str(ROOT / "tests/tools/vite_boundaries.mjs")], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_vite_alias_is_a_native_absolute_path(self):
        code = "import config from './vite.config.ts'; import path from 'node:path'; import assert from 'node:assert/strict'; assert.equal(config.resolve.alias['@'], path.resolve('web'));"
        result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "--eval", code], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)

if __name__ == "__main__":
    unittest.main(verbosity=2)
