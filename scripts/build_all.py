#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""合并全部卡片 → cards.json / cards.csv / cards.md"""
import json, csv, re, os
try:
    from pypinyin import pinyin, Style
except ImportError:
    pinyin = None

def to_initials(word):
    """成语拼音首字母，用于快捷搜索"""
    if not pinyin: return ""
    try:
        return "".join(x[0][0] for x in pinyin(word, style=Style.NORMAL))
    except Exception:
        return ""

def to_plain(word):
    """无声调全拼，便于不打声调的输入"""
    if not pinyin: return ""
    try:
        return "".join(x[0] for x in pinyin(word, style=Style.NORMAL))
    except Exception:
        return ""

def to_pinyin(word):
    """成语注音，逐字空格分隔"""
    if not pinyin: return ""
    try:
        return " ".join(x[0] for x in pinyin(word, style=Style.TONE))
    except Exception:
        return ""

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = f"{ROOT}/data"

def load(p):
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}

def load_list(p):
    d = load(p)
    return d if isinstance(d, list) else []

OVERRIDES = load(f"{DATA}/overrides.json")

def main():
    idioms = load_list(f"{DATA}/idioms_manual.json")
    know = load_list(f"{DATA}/knowledge.json")
    supp = load_list(f"{DATA}/supplement.json")

    # 人工校正：按原 front 匹配，可改 front / back
    fixed = 0
    for item in know + supp:
        ov = OVERRIDES.get(item.get("front", ""))
        if not ov: continue
        if "front" in ov: item["front"] = ov["front"]
        if "back" in ov: item["back"] = ov["back"]
        fixed += 1
    if fixed: print("人工校正", fixed, "张")

    # 成语去重：同一词条只保留释义最完整的一条（手册内部有重复条目）
    merged = {}
    for it in idioms:
        w = it["word"]
        if w not in merged or len(it["def"]) > len(merged[w]["def"]):
            merged[w] = it
    idioms = sorted(merged.values(), key=lambda x: x["no"])

    supp_idioms, seen_supp = [], set()
    for it in supp:
        if it["type"] != "idiom": continue
        if it["front"] in merged or it["front"] in seen_supp: continue
        seen_supp.add(it["front"]); supp_idioms.append(it)

    cards = []
    n = 0
    for it in idioms:
        n += 1
        cards.append({
            "id": f"i{n:04d}",
            "type": "idiom",
            "front": it["word"],
            "back": it["def"],
            "example": it.get("ex", ""),
            "cat": "成语",
            "no": it["no"],
            "py": to_pinyin(it["word"]),
            "pyi": to_initials(it["word"]),
            "pyn": to_plain(it["word"]),
            "src": "教材·成语积累",
        })
    for it in supp_idioms:
        n += 1
        cards.append({
            "id": f"i{n:04d}", "type": "idiom", "front": it["front"],
            "back": it["back"], "example": "", "cat": "成语",
            "no": n, "py": to_pinyin(it["front"]), "src": "真题解析补充",
        })

    k = 0
    seen = set()
    for it in know + [x for x in supp if x["type"] == "knowledge"]:
        key = it["front"]
        if key in seen: continue
        seen.add(key)
        k += 1
        cards.append({
            "id": f"k{k:04d}", "type": "knowledge", "front": it["front"],
            "back": it["back"], "cat": it.get("cat", "常识"),
            "src": it.get("src", ""), "no": k,
        })

    json.dump(cards, open(f"{DATA}/cards.json", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))

    # CSV（Excel / Anki 通用）
    with open(f"{ROOT}/outputs/cards.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ID", "类型", "正面", "拼音", "背面", "例句", "分类", "来源"])
        for c in cards:
            w.writerow([c["id"], "成语" if c["type"] == "idiom" else "常识",
                        c["front"], c.get("py", ""), c["back"], c.get("example", ""), c["cat"], c["src"]])

    # Markdown（Obsidian）
    lines = ["---", "title: 上岸常识刷刷刷·卡片库", f"总卡片: {len(cards)}", "---", ""]
    cur = None
    for c in cards:
        cat = "成语" if c["type"] == "idiom" else c["cat"]
        if cat != cur:
            cur = cat
            lines += ["", f"## {cat}", ""]
        py = f"（{c['py']}）" if c.get("py") else ""
        lines.append(f"- **{c['front']}**{py}：{c['back']}")
    open(f"{ROOT}/outputs/卡片库.md", "w", encoding="utf-8").write("\n".join(lines))

    from collections import Counter
    tc = Counter("成语" if c["type"] == "idiom" else c["cat"] for c in cards)
    print("总卡片", len(cards))
    for k2, v in tc.most_common():
        print(f"  {k2:12s} {v:5d}")
    size = os.path.getsize(f"{DATA}/cards.json") / 1024
    print(f"cards.json {size:.0f} KB")

if __name__ == "__main__":
    main()
