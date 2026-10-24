#!/bin/bash
# 一键重建：常识切卡 → 合并 → 挖空 → 渲染 → 同步发布目录
set -e
cd "$(dirname "$0")"

PY=/Users/zgwww/.workbuddy/binaries/python/envs/default/bin/python
[ -x "$PY" ] || PY=$(command -v python3)

$PY scripts/build_knowledge.py
$PY scripts/build_supplement.py
$PY scripts/build_all.py
$PY scripts/gen_quiz.py
$PY scripts/render.py

# 同步到发布目录，避免「本地已更新、线上还是旧版」
mkdir -p dist
cp index.html dist/
echo "已同步 dist/index.html（$(du -h dist/index.html | cut -f1)）"
