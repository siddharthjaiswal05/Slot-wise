"""Convert the course-schedule workbook into web/data/courses.json.

Uses only the standard library: the workbook's stylesheet trips up openpyxl,
and the cell data is all we need anyway.

    python3 scripts/build_data.py [path/to/schedule.xlsx]
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "data" / "courses.json"

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# Header -> column letter in the sheet. The three Time/Venue pairs are
# lecture, tutorial and practical (lab), in that order. Instructor name and
# email columns (G, H) are deliberately not read: the published data omits them.
COLS = {
    "branch": "B", "name": "C", "prereq": "D", "slot": "E", "credits": "F",
    "lec": "I", "tut": "K", "prc": "M",
}
KINDS = {"lec": "Lec", "tut": "Tut", "prc": "Prc"}

DAY_RE = re.compile(r"Th|M|T|W|F|Sa|S")
SEG_RE = re.compile(r"^([A-Za-z]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$")
NAME_RE = re.compile(r"^(.*)\(([A-Z]+\d+[A-Z]*)\)\s*(?:/\s*(\w+))?\s*$")
CREDITS_RE = re.compile(r"^([\d-]+)\((\d+)\)$")


def find_workbook():
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    books = sorted(ROOT.glob("*.xlsx"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not books:
        sys.exit("No .xlsx found in " + str(ROOT))
    return books[0]


def read_rows(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(M + "si"):
            shared.append("".join(t.text or "" for t in si.iter(M + "t")))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    first = wb.find(M + "sheets")[0]
    target = rels[first.get(R + "id")].lstrip("/")
    if not target.startswith("xl/"):
        target = "xl/" + target
    sheet = ET.fromstring(z.read(target))
    for row in sheet.iter(M + "row"):
        cells = {}
        for c in row.findall(M + "c"):
            col = re.sub(r"\d", "", c.get("r"))
            v, typ = c.find(M + "v"), c.get("t")
            if typ == "s" and v is not None:
                val = shared[int(v.text)]
            elif typ == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(M + "t"))
            else:
                val = v.text if v is not None else ""
            cells[col] = (val or "").strip()
        yield cells


def parse_times(text, kind):
    sessions = []
    for seg in filter(None, (s.strip() for s in text.split(","))):
        m = SEG_RE.match(seg)
        if not m:
            print(f"  warning: unparsed time {seg!r}", file=sys.stderr)
            continue
        days, h1, m1, h2, m2 = m.groups()
        start, end = int(h1) * 60 + int(m1), int(h2) * 60 + int(m2)
        for day in DAY_RE.findall(days):
            sessions.append({"kind": kind, "day": day, "start": start, "end": end})
    return sessions


def parse_slot(text):
    """'DE-1 DE,PRF,OE,Minor / REGULAR' -> ('DE-1', ['DE','PRF','OE','Minor'], 'REGULAR')."""
    head, _, half = text.rpartition(" /")
    if not head:
        head, half = text, ""
    parts = head.split()
    # 'ESO/SO,OE' is one type list where ESO/SO are a single category.
    types = parts[-1].replace("ESO/SO", "ESO").split(",") if parts else []
    slot = " ".join(parts[:-1]).replace("SLOT- Blank", "").strip()
    if slot == "SLOT-" or slot == "Blank":
        slot = ""
    types = [t for t in types if t and t != "Blank"]
    return slot, types, (half.strip() or "REGULAR")


def main():
    path = find_workbook()
    print(f"Reading {path.name}")
    rows = list(read_rows(path))
    courses = []
    for cells in rows[1:]:
        g = lambda k: cells.get(COLS[k], "")
        m = NAME_RE.match(g("name"))
        if not m:
            print(f"  warning: skipped row, no course code in {g('name')!r}", file=sys.stderr)
            continue
        title, code, section = m.group(1).strip(), m.group(2), m.group(3) or ""
        cm = CREDITS_RE.match(g("credits"))
        slot, types, half = parse_slot(g("slot"))
        sessions = []
        for key, kind in KINDS.items():
            sessions += parse_times(g(key), kind)
        prereq = re.sub(r"\s+", " ", g("prereq").strip("() ")).strip()
        courses.append({
            "id": code + (f"/{section}" if section else ""),
            "code": code,
            "section": section,
            "title": re.sub(r"\s+", " ", title),
            "branch": g("branch"),
            "credits": int(cm.group(2)) if cm else 0,
            "ltp": cm.group(1) if cm else g("credits"),
            "slot": slot,
            "types": types,
            "half": half,
            "prereq": prereq,
            "sessions": sessions,
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": path.name, "courses": courses}, separators=(",", ":")))
    timed = sum(1 for c in courses if c["sessions"])
    print(f"Wrote {len(courses)} courses ({timed} with class times) -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
