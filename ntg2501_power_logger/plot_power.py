#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20260826 新增。把 ntg2501_logger.py 存的 CSV 画成论文要的图：
横轴时间（秒，从记录开始算），纵轴两条线——Slave 发射功率 / Master 接收功率，
单位 dBm。

用法：
    python plot_power.py logs/ntg2501_power_20260826_190000.csv
    python plot_power.py logs/ntg2501_power_20260826_190000.csv --out fig1.png
"""

import argparse
import csv
import sys

import matplotlib.pyplot as plt


def load(path: str):
    t, slave, master = [], [], []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            elapsed = float(row["elapsed_s"])
            t.append(elapsed)
            slave.append(float(row["slave_tx_dbm"]) if row["slave_valid"] == "1" and row["slave_tx_dbm"] else None)
            master.append(float(row["master_rx_dbm"]) if row["master_valid"] == "1" and row["master_rx_dbm"] else None)
    return t, slave, master


def main():
    p = argparse.ArgumentParser(description="画 NTG-2501 Slave Tx / Master Rx 功率-时间图")
    p.add_argument("csv_path")
    p.add_argument("--out", default=None, help="保存路径，不传就只弹窗显示")
    p.add_argument("--title", default="NTG-2501 Link Power vs. Time")
    args = p.parse_args()

    t, slave, master = load(args.csv_path)
    if not t:
        print("CSV 里没有数据行")
        return 1

    n_slave_valid = sum(1 for v in slave if v is not None)
    n_master_valid = sum(1 for v in master if v is not None)
    print(f"{len(t)} 行，slave 有效 {n_slave_valid}，master 有效 {n_master_valid}")

    fig, ax = plt.subplots(figsize=(10, 5))
    # None 值会被 matplotlib 当成 gap 断开，不连过去——缺失的采样不该用直线
    # 假装"两点之间也是这个趋势"，这对论文图是重要的诚实性
    ax.plot(t, slave, label="Slave Tx Power (uplink)", color="#d62728", linewidth=1.2)
    ax.plot(t, master, label="Master Rx Power", color="#1f77b4", linewidth=1.2)
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Power (dBm)")
    ax.set_title(args.title)
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()

    if args.out:
        fig.savefig(args.out, dpi=150)
        print(f"已保存: {args.out}")
    else:
        plt.show()
    return 0


if __name__ == "__main__":
    sys.exit(main())
