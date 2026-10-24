#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建上岸常识卡片库：成语 + 常识"""
import re, json, glob, os, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW  = f"{ROOT}/raw"

# ---------- 文字清洗 ----------
RADICAL_MAP = {
    "⺠":"民","⾃":"自","⽂":"文","⼈":"人","⼝":"口","⻄":"西","⿎":"鼓","⻰":"龙",
    "⼤":"大","⼰":"己","⿊":"黑","⻛":"风","⻓":"长","⼜":"又","⾼":"高","⼭":"山",
    "⼟":"土","⽬":"目","⼩":"小","⾔":"言","⾈":"舟","⽔":"水","⼿":"手","⾁":"肉",
    "⽕":"火","⽩":"白","⽉":"月","⻢":"马","⾯":"面","⼴":"广","⻔":"门","⻅":"见",
    "⻋":"车","⻘":"青","⻝":"食","⻦":"鸟","⻥":"鱼","⻩":"黄","⻚":"页","⻉":"贝",
    "⻖":"阝","⻗":"雨","⻜":"飞","⻣":"骨","⻤":"鬼","⻨":"麦","⻬":"齐","⻭":"齿",
    "⻱":"龟","⻑":"长","⻒":"長","⻧":"卤","⻪":"黾",
}
def norm_text(s: str) -> str:
    """只做部首兼容字修正，保留中文全角标点（不能用 NFKC，会把，；：压成半角）"""
    if not s: return ""
    s = "".join(RADICAL_MAP.get(c, c) for c in s)
    s = s.replace("\u00a0", " ")
    s = re.sub(r"[ \t]+", "", s)
    return s.strip()

def clean_body(s: str) -> str:
    s = norm_text(s)
    s = re.sub(r"(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])", "", s)
    # 截掉随堂练习
    s = re.split(r"牛刀小试|随堂练习|真题演练|【例\d*】|例题", s)[0]
    # 修复 PDF 换行导致的“吞下一条”：句末后紧跟编号+汉字
    s = re.sub(r"(?<=[。；])\s*\d{1,2}[.、]\s*(?=[\u4e00-\u9fa5]{2})", "", s, count=1)
    return s

def cut_sentences(text: str, limit: int) -> str:
    """截断到 limit 字，尽量落在句号/分号处"""
    if len(text) <= limit: return text
    seg = text[:limit]
    for p in ["。", "；", "，"]:
        i = seg.rfind(p)
        if i > limit * 0.6:
            return seg[:i+1]
    return seg

# ---------- 常识资料切卡 ----------
H_SHORT = [
    re.compile(r"^（([一二三四五六七八九十]+)）\s*(.{2,24})$"),
    re.compile(r"^\(([一二三四五六七八九十]+)\)\s*(.{2,24})$"),
    re.compile(r"^([一二三四五六七八九十]{1,3})、\s*(.{2,24})$"),
    re.compile(r"^(\d{1,3})[.、]\s*(.{2,24})$"),
    re.compile(r"^([①-⑳])\s*(.{2,24})$"),
]
H_INLINE = [
    re.compile(r"^(\d{1,3})[.、]\s*(.{2,40})[：:]\s*(.+)$"),
    re.compile(r"^([一二三四五六七八九十]{1,3})、\s*(.{2,40})[：:]\s*(.+)$"),
]

def is_head(t):
    if t.endswith(("。", "；", "：", ":")): return None
    for p in H_SHORT:
        m = p.match(t)
        if m: return m.group(2).strip()
    return None

def load_lines(path):
    s = open(path, encoding="utf-8").read()
    s = re.sub(r"===== \[PAGE \d+\] =====", "\n", s)
    out = []
    for l in s.split("\n"):
        t = l.strip()
        if not t: continue
        if re.fullmatch(r"\d{1,3}", t): continue
        out.append(t)
    return out

SEC_RE = re.compile(r"^第[一二三四五六七八九十]+节\s*(.{2,22})$")
CHAP_RE = re.compile(r"^第[一二三四五六七八九十]+章\s*(.{2,26})$")
GENERIC = {"原理", "方法论", "方法", "含义", "特征", "作用", "概念", "内容", "意义", "性质",
           "特点", "分类", "表现", "要求", "地位", "评价", "标志", "影响", "基本概述", "概述",
           "提出过程", "形成过程", "主要内容", "具体内容", "基本内容", "重要内容", "总体要求",
           "指导思想", "基本原则", "主要目标", "重点任务", "主题报告", "生产阶段", "具体措施"}

def slice_cards(lines):
    cards, cur, section = [], None, ""
    for t in lines:
        sm = SEC_RE.match(t)
        if sm:
            if cur: cards.append(cur); cur = None
            section = re.sub(r"\s+", "", sm.group(1))
            continue
        if CHAP_RE.match(t):
            if cur: cards.append(cur); cur = None
            section = ""
            continue
        hit = None
        for p in H_INLINE:
            m = p.match(t)
            if m and len(m.group(3)) > 8:
                hit = m; break
        if hit:
            if cur: cards.append(cur); cur = None
            title = hit.group(2).strip()
            cards.append({"title": title, "body": [hit.group(3)], "inline": True})
            continue
        h = is_head(t)
        if h:
            if cur: cards.append(cur)
            if len(h) <= 3 or h in GENERIC:
                if section: h = section + "·" + h
            cur = {"title": h, "body": [], "inline": False}
        else:
            if cur is None: cur = {"title": "", "body": [], "inline": False}
            cur["body"].append(t)
    if cur: cards.append(cur)

    # 合并孤儿：无标题段 → 并入上一张卡
    merged = []
    for c in cards:
        c["body"] = clean_body("".join(c["body"]))
        if not c["title"] and merged:
            merged[-1]["body"] += c["body"]
            continue
        merged.append(c)
    return merged

# 表格碎片 / 噪音判定
BLACK_TITLES = {"北朝：北魏（平城-洛阳）、东魏（邺城"}
BAD_TITLE = re.compile(r"^(概述|方向|都城特点|都城变迁原因|附注|目录|习俗|简介|特点|分类)$")
def is_junk(c):
    t, b = c["title"], c["body"]
    if not t or not b: return True
    if t in BLACK_TITLES: return True
    if len(t) > 22: return True                     # 标题过长＝正文碎片
    if t.count("的") >= 2: return True
    if t.endswith(("的", "了", "是", "和", "与", "在", "为", "把", "被", "有")): return True
    if BAD_TITLE.match(t) and len(b) < 60: return True
    if len(b) < 18: return True
    if b[-1] not in "。！？”’）)": return True        # 正文必须完整收尾
    if re.search(r"[。；]\s*\d{1,2}[.、]\s*\d", b): return True   # 残留编号
    # 正文是标题的续行（被 PDF 断行切断）
    if b[0] in "）)、，。；：”》:：": return True
    # 表格碎片：标题或正文数字过密
    if len(re.findall(r"\d", t)) >= 3: return True
    if len(b) > 0 and len(re.findall(r"\d", b)) / len(b) > 0.16 and b.count("。") <= 1: return True
    if re.search(r"\d{1,2}\.\d{4}年", b): return True            # 20.1917年
    # 年份表格碎片：大量短数字串
    if len(re.findall(r"\d{3,4}", b)) >= 3 and len(re.findall(r"[，。]", b)) <= 1: return True
    if re.match(r"^(约)?前?\d{2,4}", t): return True
    if "�" in t or "�" in b: return True
    if re.search(r";\d{1,2}[\u4e00-\u9fa5]", b): return True   # 仍吞了编号，丢弃
    # 题目混入：选项、答案
    if re.search(r"[ABCD]\s*[.、]", b) or "本题选" in b or "答案是" in b or "（）" in b: return True
    # 泛标题且没能补上节名 → 信息太少
    if t in GENERIC: return True
    return False

FILE_CFG = {
    "人文历史常识考点":              ("人文历史", 150),
    "传统文化":                    ("传统文化", 260),
    "哲学、法律、行政管理常识专项":      ("哲学行管", 220),
    "地理常识":                    ("地理", 220),
    "少数民族常识合集":              ("少数民族", 400),
    "常识_污染考点":                ("环保污染", 260),
    "常识积累：中国历代五十五名贤相良将":  ("贤相良将", 260),
    "常识积累：中国历代帝王":           ("历代帝王", 260),
    "常识积累：喜事古称":             ("喜事古称", 200),
    "成语典故汇总":                 ("成语典故", 300),
    "文学常识篇--中国古代历史、人文":     ("文学常识", 240),
    "文学常识篇--古今中外文学名家、作家作品":("文学常识", 240),
    "法律常识":                    ("法律", 240),
    "科技常识":                    ("科技", 240),
    "经济常识":                    ("经济", 300),
    "政治理论_理论精讲讲义":        ("政治理论", 280),
    "政治理论_专项训练讲义":        ("政治理论", 300),
}

def clean_src(name):
    """统一来源名称的分隔符，便于展示"""
    s = name.replace("__", "·").replace("--", "·").replace("_", "·")
    return s.strip("·")

def build_knowledge():
    all_cards = []
    stats = {}
    for f in sorted(glob.glob(f"{RAW}/cs/*.txt")):
        key = os.path.basename(f)[:-4]
        cfg = next(((k, v) for k, v in FILE_CFG.items() if k in key), None)
        if not cfg:
            print("skip", key); continue
        fkey, (cat, limit) = cfg
        cards = slice_cards(load_lines(f))
        kept = []
        for c in cards:
            if is_junk(c): continue
            title = clean_body(c["title"])[:26]
            title = re.sub(r"^[、·，,。;；:：\-—\s]+", "", title)
            title = re.sub(r"[、·，,。;；:：\-\s]+$", "", title)
            body = cut_sentences(c["body"], limit)
            if len(body) < 12: continue
            kept.append({"type": "knowledge", "front": title, "back": body,
                         "cat": cat, "src": clean_src(fkey)})
        stats[fkey] = (len(cards), len(kept))
        all_cards += kept
    return all_cards, stats

if __name__ == "__main__":
    ks, st = build_knowledge()
    print("\n=== 常识切卡统计 ===")
    tot_raw = tot_keep = 0
    for k, (a, b) in st.items():
        print(f"{k:38s} 原{a:4d} → 留{b:4d}")
        tot_raw += a; tot_keep += b
    print(f"{'合计':38s} 原{tot_raw:4d} → 留{tot_keep:4d}")

    # 去重（同标题同内容）
    seen, uniq = set(), []
    for c in ks:
        key = c["front"] + "|" + c["back"][:30]
        if key in seen: continue
        seen.add(key); uniq.append(c)
    print("去重后", len(uniq))

    json.dump(uniq, open(f"{ROOT}/data/knowledge.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    # 抽查
    print("\n=== 抽查 ===")
    import random
    random.seed(7)
    for c in random.sample(uniq, min(20, len(uniq))):
        print(f"[{c['cat']}] {c['front']} :: {c['back'][:70]}")
