"""Explicit offline XLSX -> RawWorkbook converter for regression tests only.

Never imported by the running SIDAKSA server; never executes formulas or writes
back to the workbook. The output contains user data and must remain private.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
BUILTIN_FORMATS = {0: "General", 14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm"}

def column_index(address: str) -> int:
    match = re.fullmatch(r"([A-Z]+)[1-9][0-9]*", address)
    if not match:
        raise ValueError("Invalid worksheet cell address")
    number = 0
    for char in match.group(1):
        number = number * 26 + ord(char) - ord("A") + 1
    if number > 16384:
        raise ValueError("Worksheet column exceeds XLSX limits")
    return number - 1

def read_workbook(path: Path, spreadsheet_id: str) -> dict:
    payload = path.read_bytes()
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 2048 or sum(x.file_size for x in entries) > 64 * 1024 * 1024:
            raise ValueError("Workbook is too large for offline fixture conversion")
        names = set(archive.namelist())
        book = ET.fromstring(archive.read("xl/workbook.xml"))
        prop = book.find("m:workbookPr", NS)
        if prop is not None and prop.get("date1904") in ("1", "true"):
            raise ValueError("1904 date-system workbooks require explicit conversion before this fixture tool")
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels")) if r.get("TargetMode") != "External"}
        shared = []
        if "xl/sharedStrings.xml" in names:
            shared = ["".join(t.text or "" for t in si.findall(".//m:t", NS)) for si in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        formats = dict(BUILTIN_FORMATS)
        xfs = [0]
        if "xl/styles.xml" in names:
            styles = ET.fromstring(archive.read("xl/styles.xml"))
            formats.update({int(x.get("numFmtId")): x.get("formatCode", "General") for x in styles.findall("m:numFmts/m:numFmt", NS)})
            xfs = [int(x.get("numFmtId", "0")) for x in styles.findall("m:cellXfs/m:xf", NS)] or [0]
        sheets = []
        for sheet in book.findall("m:sheets/m:sheet", NS):
            target = rels.get(sheet.get(RID))
            if not target:
                raise ValueError("Worksheet relationship is missing")
            name = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
            if not name.startswith("xl/") or name not in names:
                raise ValueError("Worksheet relationship is outside the workbook")
            root = ET.fromstring(archive.read(name))
            rows = []
            for row in root.findall("m:sheetData/m:row", NS):
                cells = []
                for cell in row.findall("m:c", NS):
                    index = column_index(cell.get("r", ""))
                    while len(cells) <= index:
                        cells.append({"value": None})
                    value_node = cell.find("m:v", NS)
                    raw = value_node.text if value_node is not None and value_node.text is not None else ""
                    cell_type = cell.get("t", "n")
                    if cell_type == "s":
                        value = shared[int(raw)] if raw else ""
                    elif cell_type == "inlineStr":
                        value = "".join(t.text or "" for t in cell.findall(".//m:t", NS))
                    elif cell_type == "b":
                        value = raw == "1"
                    elif cell_type == "n" and raw:
                        try:
                            numeric = float(raw)
                            value = int(numeric) if numeric.is_integer() else numeric
                        except ValueError:
                            value = raw
                    else:
                        value = raw
                    style = int(cell.get("s", "0"))
                    format_id = xfs[style] if style < len(xfs) else 0
                    number_format = formats.get(format_id, "General")
                    result = {"value": value, "formatted": str(value) if value is not None else "", "numberFormat": number_format}
                    # Supply a precision-preserving display for numeric date fixtures.
                    # The numeric cache and original number format remain untouched.
                    if isinstance(value, (int, float)) and not isinstance(value, bool) and 20000 < value < 80000:
                        cleaned = re.sub(r'"[^\"]*"', "", number_format).lower()
                        if "y" in cleaned and "m" in cleaned:
                            date = dt.datetime(1899, 12, 30) + dt.timedelta(days=value)
                            result["formatted"] = date.strftime("%Y-%m-%d" if "d" in cleaned else "%Y-%m")
                    formula = cell.find("m:f", NS)
                    if formula is not None:
                        result["formula"] = formula.text or ""
                    cells[index] = result
                rows.append({"rowNumber": int(row.get("r", "0")), "cells": cells})
            sheets.append({"name": sheet.get("name", ""), "rows": rows})
    return {"source": "fixture", "spreadsheetId": spreadsheet_id, "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "fingerprint": hashlib.sha256(payload).hexdigest(), "locale": "id-ID", "sheets": sheets}

def main() -> int:
    parser = argparse.ArgumentParser(description="Convert an explicitly supplied XLSX into a PRIVATE offline test fixture, never a live fallback")
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--spreadsheet-id", default="1TrkKzadHZyMmc0ZfMe8CUic66s5-96XZ4vdBpsEuEes")
    args = parser.parse_args()
    try:
        data = read_workbook(args.workbook, args.spreadsheet_id)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        temporary.replace(args.output)
        print(json.dumps({"output": str(args.output), "source": "fixture", "sheetCount": len(data["sheets"]), "rowCounts": {x["name"]: len(x["rows"]) for x in data["sheets"]}}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, IndexError, zipfile.BadZipFile, ET.ParseError) as error:
        # Avoid printing workbook content, raw rows, or credentials on failure.
        print(json.dumps({"error": "Offline fixture conversion failed", "kind": type(error).__name__}), file=sys.stderr)
        return 1

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
