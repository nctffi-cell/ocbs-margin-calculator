"""Merge pl1.json (PL1 data) into stocks.json — add cap, limit, class, nganh."""
import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

stocks = json.load(open(r"f:\OCBS\Rtt, margin\webapp\stocks.json", encoding="utf-8"))
pl1 = json.load(open(r"f:\OCBS\Rtt, margin\webapp\pl1.json", encoding="utf-8"))

added = updated = only_pl1 = 0
for sym, info in pl1.items():
    if sym in stocks["stocks"]:
        s = stocks["stocks"][sym]
        s["cap"] = info["cap"]                  # giá chặn (đ) hoặc None
        s["limit"] = info["limit"]              # hạn mức 1 mã (đ)
        s["class"] = info["class"]              # A/B/C/D/E
        s["nganh"] = info["nganh"]
        s["r"] = info["r"]                      # ưu tiên r từ PL1
        s["evalRatio"] = info["evalRatio"]
        updated += 1
    else:
        only_pl1 += 1
        # Add new stock (no exch info — leave blank)
        stocks["stocks"][sym] = {
            "name": info["name"],
            "exch": "",
            "r": info["r"],
            "ts": info["evalRatio"],
            "cap": info["cap"],
            "limit": info["limit"],
            "class": info["class"],
            "nganh": info["nganh"],
        }
        added += 1

# Stocks in PDF but not in PL1: leave their existing fields (no cap/limit)
not_in_pl1 = sum(1 for s in stocks["stocks"] if s not in pl1)

stocks["count"] = len(stocks["stocks"])
from datetime import datetime
stocks["updated"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

with open(r"f:\OCBS\Rtt, margin\webapp\stocks.json", "w", encoding="utf-8") as f:
    json.dump(stocks, f, ensure_ascii=False, indent=2)
with open(r"f:\OCBS\Rtt, margin\webapp\docs\stocks.json", "w", encoding="utf-8") as f:
    json.dump(stocks, f, ensure_ascii=False, indent=2)

print(f"Updated: {updated}, Added new: {added}")
print(f"In stocks but not PL1: {not_in_pl1}")
print(f"Total: {stocks['count']}")
