#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20260826 新增。Phase E：搞清楚三件容易被混为一谈的事（prompt 里明确要求分开）：

    1. host polling rate      —— 这个脚本试图多快问一次（--period）
    2. SNMP round-trip time   —— 每次问到答花了多久（含 Windows 开子进程的固定开销，
                                   这个方法测不出"纯网络 RTT"，见下面的诚实说明）
    3. actual device update rate —— 设备内部这个值本身多久真正变一次

只测第 1、2 件事很容易，第 3 件事的做法是：以固定周期猛问同一个 OID，
记下每次拿到的值，看"值真的变化"的时间戳之间隔了多久——如果设备内部
100Hz 更新，我们又刚好问得比它快，会看到大量连续重复值，重复值的平均
游程长度 * 实际问询间隔 ≈ 设备真实更新周期。

⚠️ 老实话：这个方法的时间分辨率上限是"host polling rate 能压多低"，而
polling rate 本身被 subprocess 开销限制（见 README.md）。如果 Windows 上
snmpget 子进程开销是 15ms，就算设备本身 1000Hz 更新，这个方法也只能测出
"至少 15ms 更新一次"，测不出更快的真实周期——这不是这个脚本的 bug，是
"用命令行工具当客户端"这个选择本身的物理上限，想突破就得换成常驻会话的
SNMP 库（比如验证过 API 之后的 pysnmp），不在这次范围内。

用法：
    python rate_probe.py --host 192.168.1.201 --oid <MASTER_RX_OID> --community public --period 0.05 --duration 10
"""

import argparse
import statistics
import sys
import time

from snmp_common import require_tools, snmpget_value


def probe(host: str, oid: str, community: str, period: float, duration: float,
          timeout: float):
    samples = []  # [(wall_time, raw_value_or_None, query_ms)]
    t_end = time.monotonic() + duration
    next_tick = time.monotonic()
    print(f"以目标周期 {period*1000:.0f}ms 轮询 {host} 的 {oid}，共 {duration:.0f}s...")
    while time.monotonic() < t_end:
        wall = time.time()
        raw, err, ms = snmpget_value(host, oid, community, timeout_sec=timeout)
        samples.append((wall, raw, ms))
        next_tick += period
        sleep_s = next_tick - time.monotonic()
        if sleep_s > 0:
            time.sleep(sleep_s)
        # sleep_s <= 0 说明上一次请求本身就比 period 慢，追不上目标节奏，
        # 不额外等待，立刻发下一次——这种情况会在结果里体现为
        # "实际达到的周期" 明显大于 "目标周期"
    return samples


def analyze(samples, target_period: float):
    n = len(samples)
    if n < 2:
        print("样本太少，分析不了")
        return

    # ---- 1. 实际达到的 host polling 间隔 ----
    gaps = [samples[i][0] - samples[i - 1][0] for i in range(1, n)]
    print(f"\n== host polling 间隔（目标 {target_period*1000:.0f}ms）==")
    print(f"  实际: mean={statistics.mean(gaps)*1000:.1f}ms  "
          f"p50={statistics.median(gaps)*1000:.1f}ms  "
          f"min={min(gaps)*1000:.1f}ms  max={max(gaps)*1000:.1f}ms")

    # ---- 2. SNMP 单次请求耗时（含 subprocess 开销）----
    query_ms = [s[2] for s in samples]
    print(f"\n== 单次 snmpget 耗时（含开子进程的固定开销）==")
    print(f"  mean={statistics.mean(query_ms):.1f}ms  "
          f"p50={statistics.median(query_ms):.1f}ms  "
          f"p99={sorted(query_ms)[int(len(query_ms)*0.99)]:.1f}ms  "
          f"max={max(query_ms):.1f}ms")
    if statistics.mean(query_ms) > target_period * 1000:
        print(f"  ⚠️ 平均单次请求耗时已经超过目标周期，实际达到的轮询速率会被这个卡住，")
        print(f"     不是 SNMP/网络的问题，是本机开子进程 + 网络往返本身就比目标周期慢。")

    # ---- 3. 值变化频率 -> 估计设备真实更新周期 ----
    valid = [(t, r) for t, r, _ in samples if r is not None]
    n_err = n - len(valid)
    if n_err:
        print(f"\n⚠️ {n_err}/{n} 次请求失败/超时（占 {n_err/n:.1%}），"
              f"分析只用剩下的 {len(valid)} 次有效样本")
    if len(valid) < 2:
        print("有效样本太少，测不出更新周期")
        return

    change_gaps = []
    run_start_t = valid[0][0]
    run_len = 1
    for i in range(1, len(valid)):
        if valid[i][1] != valid[i - 1][1]:
            change_gaps.append(valid[i][0] - run_start_t)
            run_start_t = valid[i][0]
            run_len = 1
        else:
            run_len += 1

    print(f"\n== 值变化间隔（估计设备真实更新周期的下限）==")
    if not change_gaps:
        print(f"  值在整个 {duration:.0f}s 观测窗口里从没变过——要么设备这段时间真的")
        print(f"  没变化（比如链路完全静止），要么这个 OID 本来就不怎么更新（换个真的")
        print(f"  在动的 OID 再测一次，比如故意手动挡一下链路制造变化）")
        return
    print(f"  观测到 {len(change_gaps)} 次值变化")
    print(f"  变化间隔: mean={statistics.mean(change_gaps)*1000:.1f}ms  "
          f"p50={statistics.median(change_gaps)*1000:.1f}ms  "
          f"min={min(change_gaps)*1000:.1f}ms")
    print(f"  -> 设备更新周期**至少**这么长（受 host polling 间隔限制，")
    print(f"     真实周期可能更短，测不出来，见文件头的说明）")


def main():
    p = argparse.ArgumentParser(description="估计 NTG-2501 某个 OID 的真实更新速率（Phase E）")
    p.add_argument("--host", required=True)
    p.add_argument("--oid", required=True)
    p.add_argument("--community", default="public")
    p.add_argument("--period", type=float, default=0.1,
                   help="目标轮询周期，秒。会依次建议你也试 0.05/0.02/0.01")
    p.add_argument("--duration", type=float, default=10.0, help="每次测试跑多少秒")
    p.add_argument("--timeout", type=float, default=1.0, help="单次 SNMP 请求超时秒数")
    args = p.parse_args()

    require_tools()
    samples = probe(args.host, args.oid, args.community, args.period,
                    args.duration, args.timeout)
    analyze(samples, args.period)

    print(f"\n建议接下来也用其它周期跑一遍对比（--period 0.05 / 0.02 / 0.01），")
    print(f"看“值变化间隔”是不是稳定在同一个数字附近——如果是，那大概率就是")
    print(f"设备真实的更新周期；如果一直跟着 --period 缩小而缩小，说明还没测到")
    print(f"设备的真实上限，host polling 仍然是瓶颈。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
