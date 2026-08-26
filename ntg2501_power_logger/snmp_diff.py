#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20260826 新增。Phase 1 的第二步：比较两份 snmp_discover.py walk 存下来的快照
（比如"没遮挡"和"遮挡"两种状态各存一份），把值变了的 OID 列出来——这些就是
候选的 Tx/Rx power OID（当然也会混进一些跟功率无关但同时在变的东西，比如
uptime、包计数器，需要人工再对照 Web 管理界面上显示的数字筛一遍）。

用法：
    python snmp_diff.py dumps/slave_baseline_20260826_190000.txt dumps/slave_blocked_20260826_190030.txt

也支持用 * 通配符/目录自动找最新的两个同前缀文件，偷懒可以：
    python snmp_diff.py --auto slave
"""

import argparse
import glob
import os
import re
import sys

# 20260826 新增：中文 Windows 控制台默认 GBK 编码，print() 这个文件里用到的
# 📶 会直接 UnicodeEncodeError 崩掉——见 snmp_common.py 里同样这段的详细说明
# （这个文件不 import snmp_common，所以在这里单独复制一份，不是重复劳动，
# 是这个脚本故意保持不依赖其它文件、可以单独复制到别处用）。
if sys.platform == "win32":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

DUMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dumps")

# net-snmp -On 输出的典型格式：
#   .1.3.6.1.4.1.X.Y.0 = INTEGER: -54
#   .1.3.6.1.4.1.X.Y.1 = STRING: "-54.0 dBm"
#   .1.3.6.1.4.1.X.Y.2 = Gauge32: 1234
LINE_RE = re.compile(r"^(\.?\S+)\s*=\s*(.*)$")

# 从值里尽量抠出一个数字（用来判断"这个 OID 看起来像数值型，值域跟功率读数
# (通常 -100~0 附近，或者乘了 10/100 缩放后的整数) 沾不沾边"），抠不出来就是 None。
NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")


def parse_dump(path: str) -> dict:
    """解析成 {oid: raw_value_string}。格式不对的行跳过，不报错中断——
    walk 输出偶尔会有多行的字符串值（比如证书内容），这种直接跳过，
    反正 Tx/Rx power 不会是这种类型。"""
    result = {}
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line.strip():
                continue
            m = LINE_RE.match(line)
            if not m:
                continue
            oid, value = m.group(1), m.group(2)
            result[oid] = value
    return result


def extract_number(value: str):
    m = NUMBER_RE.search(value)
    return float(m.group(0)) if m else None


def find_latest_pair(prefix: str):
    """在 dumps/ 里找同前缀（比如 "slave"）最新的两个快照文件，按修改时间排序。"""
    pattern = os.path.join(DUMP_DIR, f"{prefix}_*.txt")
    files = sorted(glob.glob(pattern), key=os.path.getmtime)
    if len(files) < 2:
        return None
    return files[-2], files[-1]


def diff(before_path: str, after_path: str):
    before = parse_dump(before_path)
    after = parse_dump(after_path)

    only_before = sorted(set(before) - set(after))
    only_after = sorted(set(after) - set(before))
    common = set(before) & set(after)
    changed = sorted(oid for oid in common if before[oid] != after[oid])
    unchanged_count = len(common) - len(changed)

    print(f"before: {before_path}  ({len(before)} 个 OID)")
    print(f"after:  {after_path}  ({len(after)} 个 OID)")
    print(f"共同 OID: {len(common)}，其中变化: {len(changed)}，不变: {unchanged_count}")

    if only_before:
        print(f"\n只在 before 出现（{len(only_before)} 个，通常是索引表行数变化，不太可能是 Tx/Rx power）:")
        for oid in only_before[:20]:
            print(f"  - {oid} = {before[oid]}")
        if len(only_before) > 20:
            print(f"  ...(还有 {len(only_before) - 20} 个)")

    if only_after:
        print(f"\n只在 after 出现（{len(only_after)} 个）:")
        for oid in only_after[:20]:
            print(f"  + {oid} = {after[oid]}")
        if len(only_after) > 20:
            print(f"  ...(还有 {len(only_after) - 20} 个)")

    print(f"\n值变化的 OID（{len(changed)} 个，这些是候选）:")
    if not changed:
        print("  （没有任何值变化——如果你确实在两次 walk 之间制造了遮挡，")
        print("   说明这台设备的这个私有子树里可能不含 Tx/Rx power，或者遮挡")
        print("   没有真的影响到链路/两次 walk 间隔太短设备状态还没更新完）")
    for oid in changed:
        b, a = before[oid], after[oid]
        bn, an = extract_number(b), extract_number(a)
        looks_numeric = bn is not None and an is not None
        delta = f"  Δ={an - bn:+.3g}" if looks_numeric else ""
        marker = "📶" if looks_numeric else "  "
        print(f"  {marker} {oid}")
        print(f"       before: {b}")
        print(f"       after:  {a}{delta}")

    print(f"\n下一步：对照两台设备 Web 管理界面 Main Monitor 上显示的 Tx/Rx power")
    print(f"数字，看哪个 📶 候选 OID 的变化量级/方向对得上，记下 OID 和缩放关系")
    print(f"（设备报的数字是不是要 *0.1 或者 *0.01 才是真实 dBm，参考 README.md）。")


def main():
    p = argparse.ArgumentParser(description="比较两份 SNMP walk 快照，找出变化的 OID")
    p.add_argument("before", nargs="?", help="之前的快照文件")
    p.add_argument("after", nargs="?", help="之后的快照文件")
    p.add_argument("--auto", metavar="PREFIX",
                   help="自动找 dumps/ 里 PREFIX_*.txt 最新的两个文件比较，"
                        "比如 --auto slave")
    args = p.parse_args()

    if args.auto:
        pair = find_latest_pair(args.auto)
        if pair is None:
            print(f"dumps/ 里没找到至少两个 {args.auto}_*.txt 文件")
            return 1
        before_path, after_path = pair
    elif args.before and args.after:
        before_path, after_path = args.before, args.after
    else:
        print("要么给 before/after 两个文件路径，要么用 --auto PREFIX")
        return 1

    diff(before_path, after_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
