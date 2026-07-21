import re, subprocess, os, sys
from pathlib import Path

root = Path(r"e:\shangijan\NiuMa")
os.chdir(root)

def read_utf8(path):
    return Path(path).read_text(encoding="utf-8")

def git_show(path):
    r = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout.decode("utf-8", errors="replace")

# Match comment lines / blocks containing CJK
cjk = re.compile(r"[\u4e00-\u9fff]")
comment_line = re.compile(r"^\s*(/\*\*?|\*|//|<!--)")

def zh_comment_blocks(text):
    """Extract contiguous Chinese-bearing comment blocks (file-level and JSDoc)."""
    if not text:
        return []
    lines = text.splitlines()
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # start of block comment
        if "/*" in line and cjk.search(line):
            buf = [line]
            if "*/" not in line:
                i += 1
                while i < len(lines):
                    buf.append(lines[i])
                    if "*/" in lines[i]:
                        break
                    i += 1
            blob = "\n".join(buf)
            if cjk.search(blob):
                # summarize first meaningful line
                summary = next((l.strip().lstrip("*").strip() for l in buf if cjk.search(l)), "")
                blocks.append(summary[:120])
            i += 1
            continue
        if line.strip().startswith("//") and cjk.search(line):
            blocks.append(line.strip()[:120])
            i += 1
            continue
        if "<!--" in line and cjk.search(line):
            blocks.append(line.strip()[:120])
            i += 1
            continue
        # JSDoc-style /** ... */ single line already handled; multi without CJK on first:
        if line.strip().startswith("/**") and "*/" not in line:
            buf = [line]
            i += 1
            while i < len(lines):
                buf.append(lines[i])
                if "*/" in lines[i]:
                    break
                i += 1
            blob = "\n".join(buf)
            if cjk.search(blob):
                summary = next((l.strip().lstrip("*").strip() for l in buf if cjk.search(l)), "")
                blocks.append(summary[:120])
            i += 1
            continue
        i += 1
    return blocks

def set_diff(a, b):
    # fuzzy: normalize whitespace
    def norm(s):
        return re.sub(r"\s+", " ", s).strip()
    sa = {norm(x) for x in a}
    sb = {norm(x) for x in b}
    lost = sorted(sa - sb)
    gained = sorted(sb - sa)
    return lost, gained

tracked = [
  "web/src/modules/ops/conn-tree/registry.ts",
  "web/src/modules/ops/connection-form/types.ts",
  "web/src/modules/ops/connection-form/registry.ts",
  "web/src/modules/ops/connection-form/index.ts",
  "web/src/modules/ops/connection-nav/registry.ts",
  "web/src/modules/ops/connection-nav/types.ts",
  "web/src/modules/ops/composables/useConnectionProfiles.ts",
  "web/src/modules/ops/composables/useConnectionNavigation.ts",
  "web/src/modules/ops/composables/useConnTree.ts",
  "web/src/modules/ops/composables/useConnTreeChildren.ts",
  "web/src/modules/ops/components/OpsConnectionPanel.vue",
]

out = []
for p in tracked:
    head = git_show(p)
    curr = read_utf8(p)
    h = zh_comment_blocks(head or "")
    c = zh_comment_blocks(curr)
    lost, gained = set_diff(h, c)
    out.append(f"\n### {p}")
    out.append(f"HEAD blocks={len(h)} CURRENT blocks={len(c)} lost={len(lost)} gained={len(gained)}")
    if lost:
        out.append("LOST:")
        for x in lost:
            out.append(f"  - {x}")
    if gained and len(gained) <= 40:
        out.append("GAINED (sample/all):")
        for x in gained[:40]:
            out.append(f"  + {x}")
    elif gained:
        out.append(f"GAINED: {len(gained)} (omitting)")

# deleted builtin-adapters
head_ba = git_show("web/src/modules/ops/connection-form/builtin-adapters.ts")
out.append("\n### DELETED builtin-adapters.ts HEAD zh blocks")
for x in zh_comment_blocks(head_ba or ""):
    out.append(f"  - {x}")

# new adapters vs siblings
new_files = [
  "web/src/modules/ops/conn-kind-loaders.ts",
  "web/src/modules/ops/register-builtin-conn-kinds.ts",
  "web/src/modules/ops/connection-form/adapter-helpers.ts",
  "web/src/modules/ops/conn-tree/tab-sync.ts",
  "web/src/modules/redis/conn-tree-tab-sync.ts",
]
for kind in ["ssh","ftp","redis","mongodb","mysql","vastbase"]:
    new_files += [
      f"web/src/modules/{kind}/register-conn-form.ts",
      f"web/src/modules/{kind}/register-conn-kind.ts",
      f"web/src/modules/{kind}/connection-form-adapter.ts",
    ]

out.append("\n### NEW files comment richness")
for p in new_files:
    if not Path(p).exists():
        out.append(f"MISSING {p}")
        continue
    c = zh_comment_blocks(read_utf8(p))
    out.append(f"{p}: {len(c)} zh blocks")
    for x in c:
        out.append(f"  * {x}")

Path(r"e:\shangijan\NiuMa\_comment_audit.txt").write_text("\n".join(out), encoding="utf-8")
print("wrote _comment_audit.txt", len(out), "lines")