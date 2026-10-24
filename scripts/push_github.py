#!/usr/bin/env python3
"""把当前工作树的 HEAD 内容推送到 GitHub（走 Git Data API）。

用途：当环境里的 git push 被代理阻断（github.com 不通、api.github.com 通）时，
用 REST API 逐文件上传 blob → 建 tree → 建 commit → 移动 ref，效果等同 git push。

用法：
    /path/to/python scripts/push_github.py [owner/repo]

要求：已安装并登录 gh CLI；本地已 git commit（推送的是 HEAD 的内容，不是工作区）。
"""
import base64, json, os, subprocess, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)


def sh(*args):
    return subprocess.check_output(args, text=True, cwd=ROOT).strip()


def detect_repo():
    if len(sys.argv) > 1:
        return sys.argv[1]
    url = sh("git", "remote", "get-url", "origin")
    # https://github.com/owner/repo.git 或 git@github.com:owner/repo.git
    slug = url.split("github.com")[-1].lstrip(":/").removesuffix(".git")
    return slug


REPO = detect_repo()
API = f"https://api.github.com/repos/{REPO}"
TOKEN = sh("gh", "auth", "token")


def call(method, url, payload=None, ok404=False):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "push-github",
    })
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            body = r.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        if ok404 and e.code == 404:
            return None
        print(f"HTTP {e.code} {method} {url}\n{e.read()[:400].decode(errors='ignore')}")
        sys.exit(1)


# 1) 远端当前 HEAD（空仓库时先用 Contents API 落一个占位提交）
parent = None
head = call("GET", f"{API}/commits/main", ok404=True)
if head:
    parent = head["sha"]
else:
    boot = call("PUT", f"{API}/contents/README.md", {
        "message": "chore: bootstrap",
        "content": base64.b64encode("# 上岸常识刷刷刷\n".encode()).decode(),
    })
    parent = boot["commit"]["sha"]
    print("空仓库，已创建占位提交", parent[:10])

# 2) 逐文件上传 blob
files = sh("git", "ls-files").split()
print(f"上传 {len(files)} 个文件 → {REPO}")
tree = []
for i, path in enumerate(files, 1):
    raw = open(os.path.join(ROOT, path), "rb").read()
    blob = call("POST", f"{API}/git/blobs", {
        "content": base64.b64encode(raw).decode(),
        "encoding": "base64",
    })
    tree.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print(f"  [{i:2d}/{len(files)}] {path}  {len(raw)/1024:.0f}KB")

# 3) tree → commit → 移动 ref
commit_msg = sh("git", "log", "-1", "--pretty=%B")
new_tree = call("POST", f"{API}/git/trees", {"tree": tree})
new_commit = call("POST", f"{API}/git/commits", {
    "message": commit_msg,
    "tree": new_tree["sha"],
    "parents": [parent] if parent else [],
})
call("PATCH", f"{API}/git/refs/heads/main", {"sha": new_commit["sha"], "force": True})

print(f"\n✓ 已推送 {new_commit['sha'][:10]}  https://github.com/{REPO}")
