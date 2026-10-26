#!/usr/bin/env python3
"""
小工具（小红书 minitool）离线包构建：
dist/index.html → 校验/适配（CSP 外置脚本、去行内事件残留、inset 展开、
flex-gap 基线兜底、grid-gap 双写、裁掉容器内不可达的网页专属分支）→ dist-minitool/ → zip
规范依据：.skill/minitool-zip-builder/references/*
"""
import re, os, sys, shutil, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'dist', 'index.html')
OUT = os.path.join(ROOT, 'dist-minitool')
ZIP = os.path.join(ROOT, 'shangan-minitool.zip')

html = open(SRC, encoding='utf-8').read()

# ---------- 0. 剔除云同步（容器不联网：登录/同步模块整体移除） ----------
html, n_sync = re.subn(r'<!--MT-SYNC-UI-START-->[\s\S]*?<!--MT-SYNC-UI-END-->', '', html)
print(f'  剔除云同步区块: {n_sync} 个')

# ---------- 1. 提取内联 <script> 块 ----------
blocks = re.findall(r'<script>(.*?)</script>', html, re.S)
assert len(blocks) == 3, f'预期 3 个内联脚本，实际 {len(blocks)}'
names = ['core.js', 'data.js', 'app.js']
for i, b in enumerate(blocks):
    html = html.replace('<script>' + blocks[i] + '</script>',
                        f'<script src="./assets/{names[i]}"></script>', 1)

# ---------- 2. app.js 前置：flex-gap 行为检测（规范要求布局实测，不能只检测语法） ----------
gap_detect = '''/* —— Flex gap 行为检测（Chrome 61 不支持 flex 容器 gap，仅语法检测不可靠） —— */
(function(){
  var flex=document.createElement('div');
  flex.style.position='absolute';flex.style.visibility='hidden';
  flex.style.display='flex';flex.style.flexDirection='column';flex.style.rowGap='1px';
  flex.appendChild(document.createElement('div'));
  flex.appendChild(document.createElement('div'));
  document.body.appendChild(flex);
  var ok=flex.scrollHeight===1;
  flex.parentNode.removeChild(flex);
  if(ok)document.documentElement.classList.remove('no-flex-gap');
})();
'''
app_js = gap_detect + blocks[2]

# ---------- 3. 容器内不可达的网页专属分支裁剪（精确文本替换，避免被禁 API 残留） ----------
web_share = re.compile(r"if\(!this\.inMiniTool\(\)\)\{[\s\S]*?\}catch\(e\)\{\}\n    \}\n")
app_js, n1 = web_share.subn('', app_js)
web_copy = re.compile(r"if\(!this\.inMiniTool\(\)&&navigator\.clipboard&&navigator\.clipboard\.writeText\)\{[\s\S]*?\}else this\.showTextModal\('纠错记录',txt\);")
app_js, n2 = web_copy.subn("this.showTextModal('纠错记录',txt);", app_js)
print(f'  裁剪网页分支: shareOut={n1} copyFixes={n2}')
assert n1 == 1 and n2 == 1, '网页分支裁剪未命中'

# ---------- 2b. 容器顶栏避让（仅 minitool 包注入，web 产物不受影响） ----------
# 小红书容器会在页面顶部叠作者头像/转发浮层，压住应用顶栏；
# 检测 window.xhs 后加 html.mt-shell，顶栏下移 56px 并左右让位 58px。
shell_css = '''
/* —— 小工具容器：顶部作者头像/转发浮层避让（js 检测 window.xhs 后加 mt-shell） —— */
html.mt-shell header{
  padding-top:56px;padding-left:58px;padding-right:58px;
  padding-top:calc(56px + env(safe-area-inset-top,0px));
}'''
shell_js = '''/* —— 小红书小工具容器检测：标记 mt-shell，顶栏为作者头像/转发浮层让位 —— */
(function(){
  var d=document.documentElement;
  function mark(){ if(window.xhs&&window.xhs.miniTool){ d.classList.add('mt-shell'); return true; } return false; }
  if(mark())return;
  var n=0;
  var timer=setInterval(function(){ n++; if(mark()||n>20){ clearInterval(timer); } },300);
})();
'''

style_m = re.search(r'<style>(.*?)</style>', html, re.S)
html = html.replace(style_m.group(1), style_m.group(1) + '\n' + shell_css, 1)
core_js = shell_js + blocks[0]

# ---------- 4. CSS 适配 ----------
style_m = re.search(r'<style>(.*?)</style>', html, re.S)
css = style_m.group(1)

def expand_inset(m):
    vals = m.group(1).strip()
    parts = vals.split()
    if len(parts) == 1: t = r = b = l = parts[0]
    elif len(parts) == 2: t = b = parts[0]; r = l = parts[1]
    elif len(parts) == 3: t = parts[0]; r = l = parts[1]; b = parts[2]
    else: t, r, b, l = parts
    return f'top:{t};right:{r};bottom:{b};left:{l};inset:{vals};'

css_phys = re.sub(r'(?<![-\w])inset\s*:\s*([^;}]+);', expand_inset, css)

compat = ['/* —— Chrome 61 基线兜底（构建期生成）：inset 展开 / flex-gap margin / grid-gap —— */']

# grid gap → grid-gap 双写
def grid_gap(m):
    body = m.group(0)
    if re.search(r'display\s*:\s*grid', body):
        body = re.sub(r'(?<![-\w])gap\s*:\s*([^;}]+)', lambda g: f'grid-gap:{g.group(1)};gap:{g.group(1)}', body)
    return body
css_phys = re.sub(r'[^{}]+\{[^{}]*\}', grid_gap, css_phys)

# flex gap → .no-flex-gap 下用 margin 兜底
def walk(text, prefix_sel=''):
    out = []
    i = 0
    while i < len(text):
        b = text.find('{', i)
        if b < 0: break
        head = text[i:b].strip()
        if head.startswith('@media') or head.startswith('@supports'):
            depth, k = 0, b
            while k < len(text):
                if text[k] == '{': depth += 1
                elif text[k] == '}':
                    depth -= 1
                    if depth == 0: break
                k += 1
            out.append(walk(text[b+1:k], prefix_sel))
            i = k + 1
            continue
        e = text.find('}', b)
        if e < 0: break
        body = text[b+1:e]
        if not head.startswith('@'):
            if re.search(r'display\s*:\s*(inline-)?flex', body) and re.search(r'(?<![-\w])gap\s*:', body):
                g = re.search(r'(?<![-\w])gap\s*:\s*([^;}]+)', body).group(1).strip()
                vals = g.split()
                col = bool(re.search(r'flex-direction\s*:\s*column', body))
                mg = vals[0] if col else (vals[1] if len(vals) > 1 else vals[0])
                prop = 'margin-top' if col else 'margin-left'
                for sel in head.split(','):
                    sel = sel.strip()
                    if sel.startswith('@') or not sel: continue
                    compat.append(f'.no-flex-gap {sel} > * + *{{{prop}:{mg}}}')
        i = e + 1
    return '\n'.join(x for x in out if x)

walk(css_phys)

# ---------- 5. 组装 index.html ----------
compat_css = '\n'.join(compat)
html = html.replace(style_m.group(1), css_phys + '\n' + compat_css, 1)
html = html.replace('<html lang="zh-CN">', '<html lang="zh-CN" class="no-flex-gap">', 1)

# ---------- 6. 落盘 ----------
if os.path.exists(OUT): shutil.rmtree(OUT)
os.makedirs(os.path.join(OUT, 'assets'))
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(html)
for n, js in zip(names, [core_js, blocks[1], app_js]):
    open(os.path.join(OUT, 'assets', n), 'w', encoding='utf-8').write(js)

# ---------- 7. 终检 ----------
final = html + app_js + core_js + blocks[1]
bans = {
    '内联<script>': len(re.findall(r'<script>(?!\s*</)', html)),
    'onclick=': len(re.findall(r'onclick=', final)),
    'javascript:': len(re.findall(r'javascript:', final)),
    'eval(' : len(re.findall(r'\beval\(', final)),
    'new Function': len(re.findall(r'new Function', final)),
    'fetch(': len(re.findall(r'\bfetch\(', final)),
    'XMLHttpRequest': len(re.findall(r'XMLHttpRequest', final)),
    'navigator.clipboard': len(re.findall(r'navigator\.clipboard', final)),
    'execCommand': len(re.findall(r'execCommand', final)),
    '.download=': len(re.findall(r'\.download=', final)),
    'window.open(': len(re.findall(r'window\.open\(', final)),
    'serviceWorker': len(re.findall(r'serviceWorker', final)),
    '可选链?.': len(re.findall(r'\?\.[A-Za-z_(]', final)),
    '??': len(re.findall(r'\?\?', final)),
    'iframe': len(re.findall(r'<iframe', final)),
}
bad = {k: v for k, v in bans.items() if v}
for k, v in bans.items(): print(f'  {k}: {v}')
if bad:
    print('✗ 违规残留:', bad); sys.exit(1)

# ---------- 8. zip ----------
if os.path.exists(ZIP): os.remove(ZIP)
subprocess.run(['zip', '-qr', ZIP, '.', '-x', '*.DS_Store'], cwd=OUT, check=True)
zsize = os.path.getsize(ZIP)
print(f'✓ dist-minitool/ 就绪；zip {zsize//1024} KB → {ZIP}')
