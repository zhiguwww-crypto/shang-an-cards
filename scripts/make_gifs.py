#!/usr/bin/env python3
"""界面速览素材重建：以内容为中心重新裁剪 + 统一 4:3 网格化"""
from PIL import Image
import os

S = '/Users/zgwww/Workbuddy/编/上岸常识刷刷刷/docs/shots'
G = os.path.join(S, 'grid')
os.makedirs(G, exist_ok=True)

RATIO = 4 / 3
# 背景色取自截图角落（宣纸底色）
_ref = Image.open(os.path.join(S, 'know-memo.png')).convert('RGB')
BG = _ref.getpixel((6, 6))


def to43(im):
    """居中补边到 4:3"""
    w, h = im.size
    if w / h < RATIO:
        nw = round(h * RATIO)
        canvas = Image.new('RGB', (nw, h), BG)
        canvas.paste(im, ((nw - w) // 2, 0))
    else:
        nh = round(w / RATIO)
        canvas = Image.new('RGB', (w, nh), BG)
        canvas.paste(im, (0, (nh - h) // 2))
    return canvas


def center_crop(im, cx, cy, w, h):
    x0 = max(0, cx - w // 2)
    y0 = max(0, cy - h // 2)
    return im.crop((x0, y0, min(im.width, x0 + w), min(im.height, y0 + h)))


def build_gif(frames, cx, cy, w, h, durations, out):
    imgs = []
    for f in frames:
        im = center_crop(Image.open(os.path.join(S, 'frames', f)).convert('RGB'), cx, cy, w, h)
        im = to43(im)
        imgs.append(im)
    pal = [im.quantize(colors=128, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG) for im in imgs]
    path = os.path.join(G, out)
    pal[0].save(path, save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True)
    print(out, os.path.getsize(path) // 1024, 'KB', pal[0].size)


def build_png(src, out):
    im = Image.open(os.path.join(S, src)).convert('RGB')
    im = to43(im)
    im.save(os.path.join(G, out), optimize=True)
    print(out, os.path.getsize(os.path.join(G, out)) // 1024, 'KB')


# --- GIF：全部以内容为中心重裁 ---
# 翻卡：舞台居中，静止卡片中心 (640, 450)
build_gif([f'flip_{i}.png' for i in range(7)], cx=640, cy=450, w=620, h=620,
          durations=[220, 220, 220, 220, 220, 220, 1100], out='demo-flip.gif')
# 填空：题卡中心 x=640（页面内容居中）
build_gif([f'fill_{i}.png' for i in range(4)], cx=640, cy=365, w=830, h=660,
          durations=[900, 750, 750, 1300], out='demo-fill.gif')
# 礼花：祝福卡中心约 (470, 430)
build_gif([f'fw_{i}.png' for i in range(8)], cx=475, cy=430, w=760, h=640,
          durations=[300] * 7 + [500], out='demo-fireworks.gif')

# --- PNG：统一 4:3 ---
for src, out in [('know-memo.png', 'know-memo.png'), ('know-fill.png', 'know-fill.png'),
                 ('quiz.png', 'quiz.png'), ('stats.png', 'stats.png'),
                 ('library.png', 'library.png')]:
    build_png(src, out)
