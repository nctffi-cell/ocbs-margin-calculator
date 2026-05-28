"""Parse Phụ lục 1 → JSON. UTF-16 export has one cell per line."""
import re, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

src = open(r"C:\Users\ThanhNg\Downloads\ocbs_pl1_u.txt", encoding="utf-16").read()
lines = [ln.strip() for ln in src.split("\n")]
# Filter empty
lines = [ln for ln in lines if ln]

# Find first STT=1 followed by uppercase symbol
start = None
for i in range(len(lines) - 1):
    if lines[i] == "1" and re.fullmatch(r"[A-Z][A-Z0-9]{2,4}", lines[i+1]):
        start = i
        break
if start is None: raise SystemExit("Start not found")
print(f"Start at line {start}: {lines[start]} {lines[start+1]}")

NOTES = {"Thêm mới", "Nâng hạng", "Giảm hạng"}
RESULT = {}
i = start
expected_stt = 1
while i < len(lines):
    # Expect STT
    if not re.fullmatch(r"\d{1,3}", lines[i]):
        i += 1
        continue
    stt = int(lines[i])
    if stt != expected_stt:
        # Maybe we drifted; stop if STT jumps unreasonably
        if stt > 320 or stt < expected_stt - 2:
            break
    # Look ahead: sym, name, industry, class, r, gtd, gc, h_vcsh, h_tc, h_ad [, note]
    try:
        sym = lines[i+1]
        name = lines[i+2]
        nganh = lines[i+3]
        cls = lines[i+4]
        r_pct = lines[i+5]
        gtd_pct = lines[i+6]
        gc = lines[i+7]
        h_vcsh = lines[i+8]
        h_tc = lines[i+9]
        h_ad = lines[i+10]
    except IndexError:
        break
    if not re.fullmatch(r"[A-Z][A-Z0-9]{2,4}", sym): i += 1; continue
    if cls not in "ABCDE": i += 1; continue
    consumed = 11
    note = ""
    if i + 11 < len(lines) and lines[i+11] in NOTES:
        note = lines[i+11]
        consumed = 12
    cap = None if gc == "-" else int(gc.replace(",", ""))
    RESULT[sym] = {
        "stt": stt,
        "name": name,
        "nganh": nganh,
        "class": cls,
        "r": int(r_pct) / 100.0,
        "evalRatio": int(gtd_pct) / 100.0,
        "cap": cap,
        "loanPctVCSH": int(h_vcsh),
        "limitStd": (int(h_tc) * 1_000_000_000) if h_tc != "-" else None,
        "limit": (int(h_ad) * 1_000_000_000) if h_ad != "-" else None,
        "note": note,
    }
    expected_stt = stt + 1
    i += consumed

print(f"Parsed: {len(RESULT)} stocks")
from collections import Counter
print("Class dist:", dict(Counter(v["class"] for v in RESULT.values())))
print("With cap:", sum(1 for v in RESULT.values() if v["cap"] is not None))

out = r"f:\OCBS\Rtt, margin\webapp\pl1.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(RESULT, f, ensure_ascii=False, indent=2)
print(f"Wrote {out}")

for k in ["ACB","CII","DIG","GEE","AAA","CRC","ABT","VHM","VPL","SLS"]:
    if k in RESULT:
        v = RESULT[k]
        print(f"  {k}: {v['class']} r={v['r']:.0%} cap={v['cap']} lim={v['limit']/1e9:.0f}tỷ — {v['name']} ({v['nganh']})")
