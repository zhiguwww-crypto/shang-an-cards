#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成当天知识卡简报（对话推送用，数量读 data/settings.json）"""
import json, os, sys
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cards = json.load(open(f"{ROOT}/data/cards.json", encoding="utf-8"))
prog_path = f"{ROOT}/data/progress.json"
prog = json.load(open(prog_path, encoding="utf-8")) if os.path.exists(prog_path) else {}
prog = prog.get("cards", prog) if isinstance(prog, dict) else {}

SET = json.load(open(f"{ROOT}/data/settings.json", encoding="utf-8")) if os.path.exists(f"{ROOT}/data/settings.json") else {"newPerDay": 30, "revLimit": 200}

today = date.today().isoformat()

issued_path = f"{ROOT}/data/issued.json"
issued = json.load(open(issued_path, encoding="utf-8")) if os.path.exists(issued_path) else {"cursor": 0, "history": {}}
if today in issued["history"]:
    picked_ids = issued["history"][today]
    by_id = {c["id"]: c for c in cards}
    picked = [("今日", by_id[i]) for i in picked_ids if i in by_id]
    rev, news = [], []
else:
    due, fresh = [], []
    for c in cards:
        p = prog.get(c["id"])
        if not p:
            fresh.append(c)
        elif p.get("due") and p["due"] <= today:
            due.append(c)
    due.sort(key=lambda c: prog[c["id"]].get("due", ""))
    rev = due[: (SET["revLimit"] or len(due))]

    # 新卡：优先推进 cursor，跳过已推送过的
    seen_issued = {i for ids in issued["history"].values() for i in ids}
    cursor = issued.get("cursor", 0) % max(1, len(cards))
    ordered = cards[cursor:] + cards[:cursor]
    news = [c for c in ordered if c["id"] not in seen_issued][: SET["newPerDay"]]
    if not news:
        news = fresh[: SET["newPerDay"]]

    picked = [("复习", c) for c in rev] + [("新卡", c) for c in news]
    if not picked:
        picked = [("未学", c) for c in cards[:10]]

    picked_ids = [c["id"] for _, c in picked]
    issued["history"][today] = picked_ids
    if news:
        last = cards.index(news[-1])
        issued["cursor"] = (last + 1) % len(cards)
    json.dump(issued, open(issued_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

lines = [f"**{today} · 今日 {len(picked)} 张**", ""]
for i, (kind, c) in enumerate(picked, 1):
    back = c["back"]
    short = back if len(back) <= 46 else back[:46] + "…"
    tag = "" if kind in ("新卡","今日") else f"_{kind}_ "
    lines.append(f"{i:02d}. {tag}**{c['front']}** — {short}")

lines += ["", "---"]
lines.append(f"到期复习 {len(rev)} 张 · 新卡 {len(news)} 张 · 卡库共 {len(cards)} 张")
lines.append("答错会自动进入 1/2/4/7/15/30 天复习，连续答对 4 次才算掌握。")

out = "\n".join(lines)
print(out)
open(f"{ROOT}/outputs/今日简报.md", "w", encoding="utf-8").write(out)
