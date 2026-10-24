#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 cards.json 注入模板，生成可双击打开的 index.html"""
import json, os
from collections import Counter

ROOT = "/Users/zgwww/Workbuddy/编/职测知识卡"
cards = json.load(open(f"{ROOT}/data/cards.json", encoding="utf-8"))
tpl = open(f"{ROOT}/templates/app.html", encoding="utf-8").read()

# 瘦身：只保留前端需要的字段
slim = [{"id": c["id"], "front": c["front"], "back": c["back"],
         "example": c.get("example", ""), "cat": c["cat"],
         "py": c.get("py", ""), "pyi": c.get("pyi", ""), "pyn": c.get("pyn", ""), "src": c.get("src", "")}
        for c in cards]

order = ["成语·手册", "成语·真题补充"]
cnt = Counter(c["cat"] for c in cards)
cats = [c for c in order if c in cnt] + [k for k, _ in cnt.most_common() if k not in order]

payload = json.dumps(slim, ensure_ascii=False, separators=(",", ":"))
catjson = json.dumps(cats, ensure_ascii=False)

quiz_path = f"{ROOT}/data/quiz.json"
quiz = json.load(open(quiz_path, encoding="utf-8")) if os.path.exists(quiz_path) else {}
quizjson = json.dumps(quiz, ensure_ascii=False, separators=(",", ":"))

html = (tpl.replace("__CARDS__", payload)
           .replace("__CATS__", catjson)
           .replace("__QUIZ__", quizjson))
out = f"{ROOT}/index.html"
open(out, "w", encoding="utf-8").write(html)
print("生成", out, f"{os.path.getsize(out)/1024/1024:.2f} MB", "卡片", len(slim),
      "分类", len(cats), "挖空", len(quiz))
