#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为每张卡生成挖空题：quiz.json = {cardId: {"t": "带 __0__ 占位符的文本", "a": ["答案"]}}

策略：按优先级收集可挖片段，保证每张卡至少 1 个空。
A 书名号 / 引号 / 年份 / 数量 / 顿号并列  → B 「」引用 → C “称为/即/是指”后的宾语
→ D 术语后缀（主义/制度/机关…）→ E 兜底：首个分句里最长的一段实词
"""
import json, re

ROOT = "/Users/zgwww/Workbuddy/编/职测知识卡"
cards = json.load(open(f"{ROOT}/data/cards.json", encoding="utf-8"))

PUNCT = r"，。；：、“”《》（）()【】「」\s"
STOP = set("的了和是在有为与及等这那就都也很不个上中下其之所以因为但是"
           "一二三四五六七八九十第年月日时分种些该此")

def overlaps(spans, s, e):
    for a, b in spans:
        if s < b and e > a: return True
    return False

def hit(pattern, text, spans, maxn, minlen=2, maxlen=18, max_per=3):
    """按正则收集，返回新增数量"""
    added = 0
    for m in re.finditer(pattern, text):
        if len(spans) >= maxn: break
        s, e = (m.span(1) if m.groups() else m.span())
        seg = m.group(1) if m.groups() else m.group(0)
        if not (minlen <= len(seg) <= maxlen): continue
        if overlaps(spans, s, e): continue
        spans.append((s, e)); added += 1
        if added >= max_per: break
    return added

MARK = re.compile(r"^\s*(?:[（(]?\d{1,2}[）).、]|[①②③④⑤⑥⑦⑧⑨⑩]|[一二三四五六七八九十]{1,3}[、.])\s*")

def trim_span(text, s0, e0):
    """去掉序号前缀，并避免把括号截断在半截"""
    seg = text[s0:e0]
    m = MARK.match(seg)
    if m and m.end() < len(seg) - 2:
        s0 += m.end()
        seg = text[s0:e0]
    # 括号不配对时，回退到左括号之前
    if seg.count("（") > seg.count("）"):
        k = seg.rfind("（")
        if k >= 4: e0 = s0 + k
    if seg.count("《") > seg.count("》"):
        k = seg.rfind("《")
        if k >= 4: e0 = s0 + k
    return s0, e0

def clauses(text):
    """按标点切分成短句，返回 (start,end) —— 用整句挖空，不会把词切成两半"""
    out, start = [], 0
    for m in re.finditer(r"[，。；：]", text):
        if m.start() > start: out.append((start, m.start()))
        start = m.end()
    if start < len(text): out.append((start, len(text)))
    return out

def collect(text, front, maxn=4):
    spans = []
    # A. 高置信度结构
    pats = [
        r"(《[^》]{2,22}》)",
        r"(“[^”]{2,22}”)",
        r"(\d{3,4}\s*年(?:\d{1,2}\s*月)?)",
        r"([（(]\d{3,4}\s*[-—~至]\s*\d{3,4}[)）])",
        r"(\d+(?:\.\d+)?\s*(?:%|万|亿|个|次|届|人|公里|千米|米|项|条|周年|天|小时))",
        r"([^、，。；：]{2,6}(?:、[^、，。；：]{2,6}){2,})(?=[，。；：]|$)",
    ]
    for p in pats:
        hit(p, text, spans, maxn)
    if spans: return sorted(spans)

    # B. 「」引用
    hit(r"(「[^」]{2,22}」)", text, spans, maxn)
    if spans: return sorted(spans)

    # C. “称为 / 即 / 是指”后面那一段（到标点为止，不会切词）
    for m in re.finditer(r"(?:称为|叫做|简称|又称|也称|即为|是指|指的是|即)([^" + PUNCT + r"]{2,16})", text):
        seg = m.group(1)
        if re.match(r"[使将便刻可位兴日时为]", seg[0]): continue
        spans.append((m.start(1), m.start(1) + len(seg)))
        if len(spans) >= 2: break
    if spans: return sorted(spans)

    # D. 含术语后缀的那一段短句，整段挖掉（比切词安全）
    suf_re = re.compile(r"主义|制度|思想|理论|机关|系统|原则|规律|法则|革命|战争|会议|条约|协定|政策|战略|精神|方针")
    for s0, e0 in clauses(text):
        seg = text[s0:e0].strip()
        if not (4 <= len(seg) <= 20): continue
        if not suf_re.search(seg): continue
        if seg == front: continue
        lead = len(text[s0:e0]) - len(text[s0:e0].lstrip())
        ts, te = trim_span(text, s0 + lead, s0 + lead + len(seg))
        if te - ts >= 4: spans.append((ts, te))
        if len(spans) >= 2: break
    if spans: return sorted(spans)

    # E. 兜底：第一段不太长的短句整段挖掉；太长则取句首 3-14 字
    for s0, e0 in clauses(text):
        seg = text[s0:e0].strip()
        if len(seg) < 3 or seg == front: continue
        lead = len(text[s0:e0]) - len(text[s0:e0].lstrip())
        ts, te = trim_span(text, s0 + lead, s0 + lead + (len(seg) if len(seg) <= 20 else 14))
        if te - ts >= 3: spans.append((ts, te))
        break
    return sorted(spans)

def build_text(text, spans):
    out, prev, ans = [], 0, []
    for i, (s, e) in enumerate(spans):
        out.append(text[prev:s])
        out.append(f"__{i}__")
        ans.append(text[s:e])
        prev = e
    out.append(text[prev:])
    return "".join(out), ans

quiz = {}
stat = {"idiom": 0, "knowledge": 0, "skip": 0}

for c in cards:
    cid, cat = c["id"], c["cat"]
    text, ans = "", []

    # 成语有独立的翻卡页，不参与填空；只给常识板块生成挖空
    if cat == "成语":
        stat["idiom"] += 1
        continue
    else:
        body = c["back"]
        n = 3 if len(body) < 90 else 4
        spans = collect(body, c["front"], n)
        if spans:
            text, ans = build_text(body, spans)

    if text and ans:
        quiz[cid] = {"t": text, "a": ans}
        stat["idiom" if cat == "成语" else "knowledge"] += 1
    else:
        stat["skip"] += 1

json.dump(quiz, open(f"{ROOT}/data/quiz.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print("生成挖空题", len(quiz), stat)
print("覆盖", f"{len(quiz)/len(cards):.1%}",
      "平均空数", round(sum(len(v["a"]) for v in quiz.values()) / max(1, len(quiz)), 2))

# 抽查兜底卡
import random
random.seed(9)
miss = [c for c in cards if c["id"] not in quiz]
print("仍无挖空", len(miss))
for c in miss[:8]:
    print("  ✗", c["front"][:20], "▸", c["back"][:60])
for k in random.sample(list(quiz), min(6, len(quiz))):
    v = quiz[k]
    print("\n—", v["t"][:110])
    print("  答案:", " / ".join(v["a"]))
