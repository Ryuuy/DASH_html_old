#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20260826 新增。Phase 2：实时记录 NTG-2501 Slave 发射功率 + Master 接收功率，
存 CSV，供论文画图用（配 plot_power.py）。

跑之前必须先做完 Phase 1（snmp_discover.py + snmp_diff.py），拿到真实的
SLAVE_TX_OID / MASTER_RX_OID，以及必要的缩放关系（--slave-scale 等），
不然这里会直接拒绝启动——宁可现在就拒绝，也不要无人值守跑一整场实验、
回来发现存的全是没意义的数字（对应 README.md 里"不确定就别猜"这条原则）。

用法（OID 找到之后）：

    python ntg2501_logger.py ^
        --slave-tx-oid 1.3.6.1.4.1.XXXX.Y.Z.0 ^
        --master-rx-oid 1.3.6.1.4.1.XXXX.A.B.0 ^
        --community public ^
        --period 0.1

Ctrl+C 随时安全退出，已经写的行都在磁盘上（每行写完立刻 flush）。
"""

import argparse
import csv
import datetime
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from snmp_common import require_tools, snmpget_value, parse_scaled_float

DEFAULT_SLAVE_IP = "192.168.0.101"
DEFAULT_MASTER_IP = "192.168.0.201"

# 20260826：故意留成明显的占位符，不猜真实 OID——找到之前这两个值必须
# 通过 --slave-tx-oid / --master-rx-oid 显式传入，见 main() 里的检查。
SLAVE_TX_OID = "TO_BE_DISCOVERED"
MASTER_RX_OID = "TO_BE_DISCOVERED"

CSV_HEADER = [
    "timestamp", "elapsed_s",
    "slave_tx_dbm", "master_rx_dbm",
    "slave_tx_raw", "master_rx_raw",
    "slave_query_ms", "master_query_ms",
    "skew_ms",          # 两次请求"发起时刻"之间差了多久，越小说明越接近同步采样
    "slave_valid", "master_valid",
]


def query_one(host, oid, community, scale, offset, timeout):
    raw, err, ms = snmpget_value(host, oid, community, timeout_sec=timeout)
    if raw is None:
        return None, None, err, ms
    val = parse_scaled_float(raw, scale, offset)
    return val, raw, (None if val is not None else f"无法解析为数字: {raw!r}"), ms


def run(args):
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    print(f"输出文件: {args.out}")
    print(f"Slave  {args.slave_ip}  TX OID={args.slave_tx_oid}  "
          f"scale={args.slave_scale} offset={args.slave_offset}")
    print(f"Master {args.master_ip}  RX OID={args.master_rx_oid}  "
          f"scale={args.master_scale} offset={args.master_offset}")
    print(f"周期={args.period}s  community={args.community}  超时={args.timeout}s")
    print("Ctrl+C 停止（已写的数据不会丢）...\n")

    t0_mono = time.monotonic()
    n = 0
    n_err = 0
    last_status = 0.0

    with open(args.out, "w", newline="", encoding="utf-8") as f, \
         ThreadPoolExecutor(max_workers=2) as pool:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADER)
        f.flush()

        try:
            next_tick = time.monotonic()
            while True:
                cycle_wall = time.time()
                slave_t0 = time.monotonic()
                fut_slave = pool.submit(
                    query_one, args.slave_ip, args.slave_tx_oid, args.community,
                    args.slave_scale, args.slave_offset, args.timeout)
                master_t0 = time.monotonic()
                fut_master = pool.submit(
                    query_one, args.master_ip, args.master_rx_oid, args.community,
                    args.master_scale, args.master_offset, args.timeout)

                s_val, s_raw, s_err, s_ms = fut_slave.result()
                m_val, m_raw, m_err, m_ms = fut_master.result()

                skew_ms = abs(master_t0 - slave_t0) * 1000.0
                elapsed_s = time.monotonic() - t0_mono
                ts = datetime.datetime.now().isoformat(timespec="milliseconds")

                writer.writerow([
                    ts, f"{elapsed_s:.3f}",
                    f"{s_val:.3f}" if s_val is not None else "",
                    f"{m_val:.3f}" if m_val is not None else "",
                    s_raw or "", m_raw or "",
                    f"{s_ms:.1f}", f"{m_ms:.1f}",
                    f"{skew_ms:.1f}",
                    int(s_val is not None), int(m_val is not None),
                ])
                f.flush()
                n += 1
                if s_val is None or m_val is None:
                    n_err += 1
                    if s_err:
                        print(f"  [{ts}] ⚠️ slave: {s_err}")
                    if m_err:
                        print(f"  [{ts}] ⚠️ master: {m_err}")

                now_mono = time.monotonic()
                if now_mono - last_status >= 1.0:
                    print(f"[{elapsed_s:7.1f}s] n={n} err={n_err} "
                          f"slave={s_val if s_val is not None else 'NA':>8} dBm  "
                          f"master={m_val if m_val is not None else 'NA':>8} dBm  "
                          f"skew={skew_ms:.0f}ms  "
                          f"query(slave/master)={s_ms:.0f}/{m_ms:.0f}ms")
                    last_status = now_mono

                next_tick += args.period
                sleep_s = next_tick - time.monotonic()
                if sleep_s > 0:
                    time.sleep(sleep_s)
        except KeyboardInterrupt:
            print(f"\n收到 Ctrl+C，停止。共记录 {n} 行（{n_err} 行有缺失值）。")
            print(f"文件已保存: {args.out}")

    return 0


def main():
    p = argparse.ArgumentParser(description="NTG-2501 实时功率记录器（Phase 2）")
    p.add_argument("--slave-ip", default=DEFAULT_SLAVE_IP)
    p.add_argument("--master-ip", default=DEFAULT_MASTER_IP)
    p.add_argument("--community", default="public")
    p.add_argument("--slave-tx-oid", default=SLAVE_TX_OID,
                   help="Phase 1 找到的 Slave 发射功率 OID（必须显式传，不能留占位符）")
    p.add_argument("--master-rx-oid", default=MASTER_RX_OID,
                   help="Phase 1 找到的 Master 接收功率 OID（必须显式传，不能留占位符）")
    p.add_argument("--slave-scale", type=float, default=1.0,
                   help="raw_value * scale + offset = 真实 dBm（Phase 1 对照 Web 界面读数确定）")
    p.add_argument("--slave-offset", type=float, default=0.0)
    p.add_argument("--master-scale", type=float, default=1.0)
    p.add_argument("--master-offset", type=float, default=0.0)
    p.add_argument("--period", type=float, default=0.1, help="目标采样周期，秒")
    p.add_argument("--timeout", type=float, default=1.0, help="单次 SNMP 请求超时秒数")
    p.add_argument("--out", default=None,
                   help="输出 CSV 路径，不传就自动生成 ntg2501_power_<时间戳>.csv")
    args = p.parse_args()

    if args.slave_tx_oid == "TO_BE_DISCOVERED" or args.master_rx_oid == "TO_BE_DISCOVERED":
        print("❌ 还没配置真实的 OID。先跑完 Phase 1（snmp_discover.py + snmp_diff.py），")
        print("   拿到真实 OID 之后用 --slave-tx-oid / --master-rx-oid 传进来。")
        print("   （故意拒绝启动，不用占位符瞎跑——见 README.md）")
        return 1

    require_tools()

    if args.out is None:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        args.out = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "logs", f"ntg2501_power_{ts}.csv")

    return run(args)


if __name__ == "__main__":
    sys.exit(main())
