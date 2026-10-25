#!/usr/bin/env python3
"""把截图帧合成 README 用 GIF（裁剪 + 缩放 + 调色板压缩）"""
from PIL import Image
import os

SHOTS = '/Users/zgwww/Workbuddy/编/上岸常识刷刷刷/docs/shots'

def load(n):
    return Image.open(os.path.join(SHOTS, 'frames', n)).convert('RGB')

def build(frames, crop, width, durations, out):
    imgs = []
    for f in frames:
        im = load(f).crop(crop)
        h = round(im.height * width / im.width)
        im = im.resize((width, h), Image.LANCZOS)
        imgs.append(im)
    # 转自适应调色板 GIF
    pal = [im.quantize(colors=128, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG) for im in imgs]
    path = os.path.join(SHOTS, out)
    pal[0].save(path, save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True)
    print(out, os.path.getsize(path) // 1024, 'KB', pal[0].size)

# 1) 成语翻卡：卡片区域
build([f'flip_{i}.png' for i in range(7)],
      crop=(330, 100, 750, 640), width=400,
      durations=[220, 220, 220, 220, 220, 220, 1100],
      out='demo-flip.gif')

# 2) 填空揭示：题卡区域
build([f'fill_{i}.png' for i in range(4)],
      crop=(225, 45, 855, 680), width=560,
      durations=[900, 750, 750, 1300],
      out='demo-fill.gif')

# 3) 礼花庆祝：中景
build([f'fw_{i}.png' for i in range(8)],
      crop=(150, 20, 830, 650), width=560,
      durations=[300] * 7 + [500],
      out='demo-fireworks.gif')
