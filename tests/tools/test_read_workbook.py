"""Regression tests for the explicit OFFLINE workbook fixture converter."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
TMP = ROOT / ".private" / "test-tmp"
TMP.mkdir(parents=True, exist_ok=True)

class WorkbookReaderTests(unittest.TestCase):
    def test_cli_extracts_cached_values_and_preserves_input(self):
        with tempfile.TemporaryDirectory(dir=TMP) as tmp:
            folder = Path(tmp)
            workbook = folder / "unit-fixture.xlsx"
            output = folder / "raw.json"
            with zipfile.ZipFile(workbook, "w") as z:
                z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data Kandidat" sheetId="1" r:id="rId1"/></sheets></workbook>')
                z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
                z.writestr("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>ID_Kandidat</t></si><si><t>Nama Peserta</t></si><si><t>UNIT_01</t></si><si><t>Peserta Uji</t></si></sst>')
                z.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="D2"><f>2000+24</f><v>2024</v></c></row></sheetData></worksheet>')
            before = hashlib.sha256(workbook.read_bytes()).hexdigest()
            result = subprocess.run([sys.executable, str(ROOT / "tools" / "read_workbook.py"), str(workbook), "--output", str(output)], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(data["source"], "fixture")
            self.assertEqual(data["sheets"][0]["name"], "Data Kandidat")
            self.assertEqual(data["sheets"][0]["rows"][1]["cells"][0]["value"], "UNIT_01")
            self.assertEqual(data["sheets"][0]["rows"][1]["cells"][3]["value"], 2024)
            self.assertEqual(data["sheets"][0]["rows"][1]["cells"][3]["formula"], "2000+24")
            self.assertEqual(before, hashlib.sha256(workbook.read_bytes()).hexdigest())

if __name__ == "__main__":
    unittest.main(verbosity=2)
