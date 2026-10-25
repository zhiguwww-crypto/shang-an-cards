#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫描常识卡正文，找出「含列举编号线索但当前 splitEnum 规则判为不分段」的样本。
   用于诊断规则覆盖盲区（与 templates/app.html 里的 JS 实现保持同构）。"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
CN = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}

def cn_num(s):
    if not s: return 0
    if len(s) == 1: return CN.get(s, 0)
    i = s.find('十')
    if i >= 0:
        a = CN.get(s[:i], 1) if s[:i] else 1
        b = CN.get(s[i+1:], 0) if s[i+1:] else 0
        return a*10 + b
    return 0

# 与 JS ENUM_RE 等价（Python re 需 \d 支持）
ENUM_RE = re.compile(
    r'(?:[（(]\s*(\d{1,2})\s*[）)])'
    r'|(?:([①-⑳]))'
    r'|(?:(\d{1,2})\s*[）)])'
    r'|(?:(\d{1,2})\s*[\.、](?=[^\s\d]))'
    r'|(?:([一二三四五六七八九十]{1,3})、)'
)

def split_enum(text):
    if not text or len(text) < 16: return None
    marks = []
    for m in ENUM_RE.finditer(text):
        n = 0
        if m.group(1) is not None: n = int(m.group(1))
        elif m.group(2) is not None: n = CIRCLED.index(m.group(2)) + 1
        elif m.group(3) is not None:
            p = text[m.start()-1] if m.start() > 0 else ''
            if p in '（(' or p.isdigit(): continue
            n = int(m.group(3))
        elif m.group(4) is not None:
            p = text[m.start()-1] if m.start() > 0 else ''
            if p == '第' or p.isdigit(): continue
            n = int(m.group(4))
        elif m.group(5) is not None: n = cn_num(m.group(5))
        if n > 0: marks.append((n, m.start(), m.end()))
    if len(marks) < 2: return None
    for i in range(1, len(marks)):
        if marks[i][0] <= marks[i-1][0]: return None
    items = []
    for i, (n, s, e) in enumerate(marks):
        to = marks[i+1][1] if i+1 < len(marks) else len(text)
        t = re.sub(r'[；;，,。\s]+$', '', text[e:to]).strip()
        if t: items.append((n, t))
    if len(items) < 2: return None
    if all(len(re.sub(r'[\s，,。；;、]', '', t)) < 4 for _, t in items): return None
    return items

def main():
    cards = json.load(open(f"{ROOT}/data/cards.json", encoding="utf-8"))
    know = [c for c in cards if c["type"] != "idiom"]
    ok, miss = [], []
    for c in know:
        seg = split_enum(c.get("back", ""))
        if seg: ok.append((c, seg))
        else:
            t = c.get("back", "")
            # 有编号线索但没分段
            hits = [m.group(0) for m in ENUM_RE.finditer(t)]
            if len(hits) >= 2: miss.append((c, hits))
    print(f"常识卡 {len(know)} 张；当前可分段 {len(ok)} 张；有编号线索但被丢弃 {len(miss)} 张")
    for c, hits in miss:
        print("\n---", c["cat"], "|", c["front"], "| 命中:", hits)
        print(c["back"][:300])

if __name__ == "__main__":
    main()
