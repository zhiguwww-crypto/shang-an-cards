#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 cards.json 注入模板，生成可双击打开的 index.html"""
import json, os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cards = json.load(open(f"{ROOT}/data/cards.json", encoding="utf-8"))
tpl = open(f"{ROOT}/templates/app.html", encoding="utf-8").read()

# 订单号优先的前端字段顺序，用数组代替对象省掉重复键名
order = ["成语·手册", "成语·真题补充"]
cnt = Counter(c["cat"] for c in cards)
cats = [c for c in order if c in cnt] + [k for k, _ in cnt.most_common() if k not in order]
cat_idx = {c: i for i, c in enumerate(cats)}

slim = []
for c in cards:
    row = [c["id"], cat_idx[c["cat"]], c["front"], c["back"],
           c.get("py", ""), c.get("pyi", ""), c.get("pyn", ""),
           c.get("example", ""), c.get("src", "")]
    while len(row) > 4 and row[-1] == "":   # 去掉行尾空字段
        row.pop()
    slim.append(row)

payload = json.dumps(slim, ensure_ascii=False, separators=(",", ":"))
catjson = json.dumps(cats, ensure_ascii=False)

quiz_path = f"{ROOT}/data/quiz.json"
quiz = json.load(open(quiz_path, encoding="utf-8")) if os.path.exists(quiz_path) else {}
quizjson = json.dumps(quiz, ensure_ascii=False, separators=(",", ":"))

sync_path = f"{ROOT}/templates/sync.js"
sync_js = open(sync_path, encoding="utf-8").read() if os.path.exists(sync_path) else ""

html = (tpl.replace("__CARDS__", payload)
           .replace("__CATS__", catjson)
           .replace("__QUIZ__", quizjson)
           .replace("__SYNC__", sync_js))
out = f"{ROOT}/index.html"
open(out, "w", encoding="utf-8").write(html)
print("生成", out, f"{os.path.getsize(out)/1024/1024:.2f} MB", "卡片", len(slim),
      "分类", len(cats), "挖空", len(quiz))
