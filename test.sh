#!/bin/bash
# 一键自检：构建自检页 → 无头 Chrome 执行 → 解析结果
# 用法：./test.sh          全部通过返回 0，有 FAIL 返回 1
set -uo pipefail
cd "$(dirname "$0")"

NODE=/Users/zgwww/.workbuddy/binaries/node/versions/22.22.2-6/bin/node
PY=/Users/zgwww/.workbuddy/binaries/python/envs/default/bin/python
[ -x "$NODE" ] || NODE=$(command -v node)
[ -x "$PY" ] || PY=$(command -v python3)

CHROME=""
for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
         "/Applications/Chromium.app/Contents/MacOS/Chromium" \
         "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
  [ -x "$c" ] && CHROME="$c" && break
done
if [ -z "$CHROME" ]; then
  echo "找不到 Chrome / Chromium / Edge，无法运行自检" >&2
  exit 2
fi

"$NODE" scripts/selftest.js || exit 2

TMP=$(mktemp -t selftest)
trap 'rm -f "$TMP"' EXIT

"$CHROME" --headless=new --no-sandbox --disable-gpu \
  --window-size=900,900 --virtual-time-budget=15000 \
  --dump-dom "file://$PWD/outputs/selftest.html" > "$TMP" 2>/dev/null

"$PY" - "$TMP" <<'PYEOF'
import sys, re
html = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
m = re.search(r'<pre id="testlog">([\s\S]*?)</pre>', html)
if not m:
    print("✗ 没拿到测试输出（页面可能加载失败）")
    sys.exit(2)
lines = [l for l in m.group(1).split("\n") if l.strip()]
passed = sum(1 for l in lines if l.startswith("PASS"))
failed = [l for l in lines if l.startswith(("FAIL", "EXC"))]
for l in failed:
    print(l)
print(f"\n{'✓ 全部通过' if not failed else '✗ 有失败项'}  {passed} passed / {len(failed)} failed / {len(lines)} 项")
sys.exit(1 if failed else 0)
PYEOF
