#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20260826 新增。Phase 1：SNMP 发现——先确认两台 NTG-2501 到底支不支持 SNMP、
用哪个 community 能读，再把私有 MIB 子树整棵存下来，供人工/snmp_diff.py 比对，
找出哪个 OID 是 Slave 发射功率、哪个是 Master 接收功率。

用法（都在装好 Net-SNMP 命令行工具、人在实验室能连上 192.168.0.x 之后跑）：

    # 1. 先确认两台设备哪个 community 能用（默认试 public / public2 / public3）
    python snmp_discover.py probe

    # 2. 走一遍私有 MIB 子树，存成基线快照（LOS 畅通、没有遮挡的状态下跑）
    python snmp_discover.py walk --community public --tag baseline

    # 3. 找个人/障碍物挡住毫米波链路，链路稳定后（比如挡住 3~5 秒）再跑一次
    python snmp_discover.py walk --community public --tag blocked

    # 4. 对比两份快照，看哪些 OID 的值变了——大概率就是 Tx/Rx power
    python snmp_diff.py dumps\\slave_baseline_*.txt dumps\\slave_blocked_*.txt
    python snmp_diff.py dumps\\master_baseline_*.txt dumps\\master_blocked_*.txt

IP 默认取自 NTG2501_SNMP_Claude_Prompt.md 里给的地址（Slave 192.168.0.101 /
Master 192.168.0.201），可以用 --slave-ip / --master-ip 覆盖。
"""

import argparse
import datetime
import os
import sys

from snmp_common import require_tools, run_snmp_cmd

DEFAULT_SLAVE_IP = "192.168.0.101"
DEFAULT_MASTER_IP = "192.168.0.201"
DEFAULT_COMMUNITIES = ("public", "public2", "public3")

# 标准 SNMP system OID，不管什么设备只要支持 SNMP 基本都有，用来先验证
# "community 对不对、SNMP 通不通"，跟设备具体型号无关
SYSDESCR_OID = "1.3.6.1.2.1.1.1.0"
SYSOBJECTID_OID = "1.3.6.1.2.1.1.2.0"
SYSUPTIME_OID = "1.3.6.1.2.1.1.3.0"

# 私有 MIB 子树根——真正的 Tx/Rx power 大概率藏在这下面某个厂商自定义分支里
PRIVATE_TREE_OID = "1.3.6.1.4.1"

DUMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dumps")


def probe_communities(host: str, communities, timeout_sec: float = 2.0):
    """对一台设备依次试每个 community，返回第一个成功的（sysDescr 有正常
    返回、returncode==0）；都不行就返回 None。每个都打印结果，不只是打印
    "成功"的那个——方便人工确认"到底是 community 错了还是设备根本没开 SNMP"。
    """
    print(f"\n== 探测 {host} ==")
    working = None
    for c in communities:
        out, err, rc, ms = run_snmp_cmd(
            ["snmpget", "-v", "2c", "-c", c, "-On", host, SYSDESCR_OID],
            timeout_sec,
        )
        ok = rc == 0 and out.strip()
        status = "✅" if ok else "❌"
        detail = out.strip() if ok else (err.strip() or f"rc={rc}")
        print(f"  {status} community={c!r:12s} ({ms:6.1f}ms)  {detail[:100]}")
        if ok and working is None:
            working = c
    if working is None:
        print(f"  ⚠️ {host} 三个默认 community 都没通。可能：")
        print(f"     - 设备没开 SNMP（去 Web 管理界面确认 SNMP agent 是否启用）")
        print(f"     - community 不是默认值（去 Web 管理界面查实际配置的 community）")
        print(f"     - 网络不通（先 ping {host} 确认能连上）")
    return working


def cmd_probe(args):
    require_tools()
    communities = args.communities.split(",") if args.communities else DEFAULT_COMMUNITIES
    slave_c = probe_communities(args.slave_ip, communities, args.timeout)
    master_c = probe_communities(args.master_ip, communities, args.timeout)
    print("\n== 汇总 ==")
    print(f"  Slave  ({args.slave_ip}): {'community=' + slave_c if slave_c else '未找到可用 community'}")
    print(f"  Master ({args.master_ip}): {'community=' + master_c if master_c else '未找到可用 community'}")
    if slave_c and master_c:
        print(f"\n两边都通了，下一步跑：")
        print(f"  python snmp_discover.py walk --community {slave_c} --tag baseline")
    return 0 if (slave_c and master_c) else 1


def walk_one(host: str, community: str, tag: str, label: str, timeout_sec: float):
    """对一台设备做私有子树的 bulkwalk（比 walk 快很多），存文件。
    bulkwalk 不支持就退化用 walk（有些老固件/某些 agent 配置不认 GETBULK）。
    """
    os.makedirs(DUMP_DIR, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    outfile = os.path.join(DUMP_DIR, f"{label}_{tag}_{ts}.txt")

    print(f"\n== walk {label} ({host}) -> {outfile} ==")
    out, err, rc, ms = run_snmp_cmd(
        ["snmpbulkwalk", "-v", "2c", "-c", community, "-On", host, PRIVATE_TREE_OID],
        timeout_sec,
    )
    if rc != 0 or not out.strip():
        print(f"  snmpbulkwalk 失败（{err.strip() or ('rc=' + str(rc))}），退化用 snmpwalk...")
        out, err, rc, ms = run_snmp_cmd(
            ["snmpwalk", "-v", "2c", "-c", community, "-On", host, PRIVATE_TREE_OID],
            timeout_sec,
        )
    if rc != 0 or not out.strip():
        print(f"  ❌ 还是失败：{err.strip() or ('rc=' + str(rc))}")
        return None

    with open(outfile, "w", encoding="utf-8") as f:
        f.write(out)
    n_lines = out.count("\n")
    print(f"  ✅ 存了 {n_lines} 行，耗时 {ms:.0f}ms -> {outfile}")
    return outfile


def cmd_walk(args):
    require_tools()
    slave_file = walk_one(args.slave_ip, args.community, args.tag, "slave", args.timeout)
    master_file = walk_one(args.master_ip, args.community, args.tag, "master", args.timeout)
    print("\n== 完成 ==")
    if slave_file:
        print(f"  slave:  {slave_file}")
    if master_file:
        print(f"  master: {master_file}")
    print(f"\n有了至少两个不同状态（比如 baseline / blocked）的快照之后，用 snmp_diff.py 比对：")
    print(f"  python snmp_diff.py <before.txt> <after.txt>")
    return 0 if (slave_file and master_file) else 1


def cmd_sysinfo(args):
    """只读 sysDescr/sysObjectID/sysUpTime，不走整棵私有树——用来快速确认
    "SNMP 通、community 对"，比 walk 快得多，调试用。"""
    require_tools()
    for host, label in ((args.slave_ip, "Slave"), (args.master_ip, "Master")):
        print(f"\n== {label} ({host}) ==")
        for oid, name in ((SYSDESCR_OID, "sysDescr"), (SYSOBJECTID_OID, "sysObjectID"),
                          (SYSUPTIME_OID, "sysUpTime")):
            out, err, rc, ms = run_snmp_cmd(
                ["snmpget", "-v", "2c", "-c", args.community, "-On", host, oid],
                args.timeout,
            )
            if rc == 0 and out.strip():
                print(f"  {name:12s} ({ms:5.0f}ms): {out.strip()}")
            else:
                print(f"  {name:12s} ({ms:5.0f}ms): ❌ {err.strip() or ('rc=' + str(rc))}")
    return 0


def main():
    p = argparse.ArgumentParser(description="NTG-2501 SNMP 发现工具（Phase 1）")
    p.add_argument("--slave-ip", default=DEFAULT_SLAVE_IP)
    p.add_argument("--master-ip", default=DEFAULT_MASTER_IP)
    p.add_argument("--timeout", type=float, default=2.0, help="单次 SNMP 请求超时秒数")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_probe = sub.add_parser("probe", help="试哪个 community 能用（第一步跑这个）")
    p_probe.add_argument("--communities", default=None,
                         help=f"逗号分隔，默认 {','.join(DEFAULT_COMMUNITIES)}")
    p_probe.set_defaults(func=cmd_probe)

    p_walk = sub.add_parser("walk", help="走私有 MIB 子树，存快照")
    p_walk.add_argument("--community", required=True)
    p_walk.add_argument("--tag", required=True,
                        help="这次快照的标签，比如 baseline / blocked，会进文件名")
    p_walk.set_defaults(func=cmd_walk)

    p_sys = sub.add_parser("sysinfo", help="只读 system OID，快速确认连通性")
    p_sys.add_argument("--community", default="public")
    p_sys.set_defaults(func=cmd_sysinfo)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
