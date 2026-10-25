#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""列举分段算法原型（与 templates/app.html 中的 JS 实现同构）。
   在真实卡片数据上验证覆盖率与「不丢原文」，确认后再移植到前端。"""
import json, os, re, sys
from collections import Counter

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

# 分组编号：1 (1)  2 （1）  3 ①  4 1）  5 1.  6 一、  7 （一）
MARK_RE = re.compile(
    r'(?:\(\s*(\d{1,2})\s*\)|（\s*(\d{1,2})\s*）)'
    r'|(?:([①-⑳]))'
    r'|(?:(\d{1,2})\s*[）)])'
    r'|(?:(\d{1,2})\s*[\.、](?=[^\s\d]))'
    r'|(?:([一二三四五六七八九十]{1,3})、)'
    r'|(?:[（(]\s*([一二三四五六七八九十]{1,3})\s*[）)])'
)

def find_marks(text):
    marks = []
    for m in MARK_RE.finditer(text):
        g = m.groups()
        prev = text[m.start()-1] if m.start() > 0 else ''
        if g[0] is not None:
            n, style, disp = int(g[0]), 'paren', str(int(g[0]))
        elif g[1] is not None:
            n, style, disp = int(g[1]), 'paren', str(int(g[1]))
        elif g[2] is not None:
            n, style, disp = CIRCLED.index(g[2]) + 1, 'circle', g[2]
        elif g[3] is not None:
            if prev in '（(' or prev.isdigit(): continue
            n, style, disp = int(g[3]), 'close', str(int(g[3]))
        elif g[4] is not None:
            if prev == '第' or prev.isdigit(): continue
            n, style, disp = int(g[4]), 'dot', str(int(g[4]))
        elif g[5] is not None:
            # 「一、」：前一个字符必须是标点/空白/行首，避免「统一、」「第一、」误判
            if prev and (prev.isalnum() or '一' <= prev <= '鿿'): continue
            n, style, disp = cn_num(g[5]), 'cn', g[5]
        elif g[6] is not None:
            n, style, disp = cn_num(g[6]), 'cnp', g[6]
        else:
            continue
        if n > 0:
            marks.append(dict(n=n, style=style, disp=disp, s=m.start(), e=m.end()))
    return marks

def build_groups(marks):
    """按「同编号样式 + 编号连续」切组；编号重启（5→1）自动另起一组。"""
    groups = []
    for mk in marks:
        if groups and groups[-1]['style'] == mk['style'] and mk['n'] == groups[-1]['last'] + 1:
            groups[-1]['items'].append(mk); groups[-1]['last'] = mk['n']
        else:
            groups.append(dict(style=mk['style'], items=[mk], last=mk['n']))
    return groups

def lead_like(s):
    s = s.strip()
    if not s or len(s) > 26: return False
    return s.endswith('：') or s.endswith('】') or len(s) <= 14

def split_enum(text):
    """返回 [{k:'p',text} | {k:'l',items:[{n,disp,text}]}]；无法分段时返回 None。"""
    if not text or len(text) < 16: return None
    marks = find_marks(text)
    if len(marks) < 2: return None
    groups = build_groups(marks)
    if not any(len(g['items']) >= 2 for g in groups): return None

    out, para, pos = [], [], 0
    for gi, g in enumerate(groups):
        first = g['items'][0]['s']
        para.append(text[pos:first])
        next_start = groups[gi+1]['items'][0]['s'] if gi+1 < len(groups) else len(text)
        if len(g['items']) < 2:
            para.append(text[first:next_start]); pos = next_start; continue

        items = []
        for k, mk in enumerate(g['items']):
            end = g['items'][k+1]['s'] if k+1 < len(g['items']) else next_start
            items.append(dict(n=mk['n'], disp=mk['disp'], text=text[mk['e']:end]))

        # 末条尾部：若以「。」收尾且后面跟一句短引导语，切出来交给下一段
        last = items[-1]
        tail = last['text']
        cut = tail.rfind('。')
        if cut >= 0 and lead_like(tail[cut+1:]):
            last['text'] = tail[:cut+1]
            consumed = len(last['text'])
        else:
            consumed = len(tail)

        for it in items:
            it['text'] = re.sub(r'[；;，,、\s]+$', '', it['text']).strip()
        if all(len(re.sub(r'[\s，,。；;、]', '', it['text'])) < 4 for it in items):
            para.append(text[first:next_start]); pos = next_start; continue

        ptxt = ''.join(para).strip()
        if ptxt: out.append(dict(k='p', text=ptxt))
        para = []
        out.append(dict(k='l', items=items))
        pos = g['items'][-1]['e'] + consumed
    ptxt = ''.join(para).strip()
    if ptxt: out.append(dict(k='p', text=ptxt))
    if not any(b['k'] == 'l' for b in out): return None
    return out

def main():
    cards = json.load(open(f"{ROOT}/data/cards.json", encoding="utf-8"))
    know = [c for c in cards if c['type'] != 'idiom']
    hit = [c for c in know if split_enum(c.get('back',''))]
    print(f"常识卡 {len(know)} 张 → 分段命中 {len(hit)} 张")
    bad = 0
    for c in know:
        seg = split_enum(c.get('back',''))
        if not seg: continue
        j = ''.join(b['text'] if b['k']=='p' else ''.join(it['text'] for it in b['items']) for b in seg)
        src = re.sub(r'[\s]', '', MARK_RE.sub('', c['back']))
        if len(re.sub(r'[\s]', '', j)) < len(src) * 0.9:
            bad += 1
            if bad <= 5: print('  ! 丢字', c['front'])
    print('可疑丢字卡：', bad)
    for k, v in Counter(c['cat'] for c in hit).most_common():
        print(f'  {k:12s} {v:5d}')

if __name__ == '__main__':
    main()
