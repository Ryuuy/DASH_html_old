#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20260826 新增，20260827 改成默认画最新的一份。
把记录器存的 CSV 画成论文要的图：横轴时间（秒，从记录开始算），
纵轴两条线——Slave 发射功率 / Master 接收功率，单位 dBm。

用法：
    python3 plot_power.py                    # 画 logs/ 里最新的那份，PNG 存成同名
    python3 plot_power.py logs/xxx.csv       # 指定某一份
    python3 plot_power.py --show             # 顺便弹窗显示（有图形界面时）
    python3 plot_power.py --out fig1.png     # 自己指定输出名

不带参数时：挑 logs/ 里改动时间最新的 CSV，输出 PNG 跟它同名同目录
（logs/ntg2501_http_blocked_20260827_140000.csv
   -> logs/ntg2501_http_blocked_20260827_140000.png），
所以每次记录完直接敲 `python3 plot_power.py` 就行，不用去抄文件名，
也不会互相覆盖。
"""

import argparse
import csv
import glob
import os
import sys

import matplotlib

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")


def newest_csv():
    """logs/ 里改动时间最新的 CSV。没有就返回 None。"""
    files = glob.glob(os.path.join(LOG_DIR, "*.csv"))
    return max(files, key=os.path.getmtime) if files else None


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
    p.add_argument("csv_path", nargs="*",
                   help="CSV 路径，不传就自动用 logs/ 里最新的那份")
    p.add_argument("--out", default=None,
                   help="输出 PNG 路径，不传就跟 CSV 同名同目录")
    p.add_argument("--show", action="store_true", help="额外弹窗显示（需要图形界面）")
    p.add_argument("--title", default=None,
                   help="图标题，不传就用 CSV 文件名")
    args = p.parse_args()

    # 传了多个（比如 shell 把 logs/*.csv 展开了）就取其中最新的一个，
    # 免得直接报错让人一头雾水
    if len(args.csv_path) > 1:
        csv_path = max(args.csv_path, key=os.path.getmtime)
        print(f"给了 {len(args.csv_path)} 个文件，用其中最新的：{csv_path}")
    elif len(args.csv_path) == 1:
        csv_path = args.csv_path[0]
    else:
        csv_path = newest_csv()
        if csv_path is None:
            print(f"❌ {LOG_DIR} 里没有 CSV。先跑一次记录：")
            print(f"   python3 ntg2501_http_logger.py --duration 30 --tag test")
            return 1
        print(f"用最新的一份：{csv_path}")

    if not os.path.exists(csv_path):
        print(f"❌ 找不到 {csv_path}")
        return 1

    # 没要弹窗就用 Agg，这样在没有图形界面的机器上也不会报错
    if not args.show:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    stem = os.path.splitext(csv_path)[0]
    out_path = args.out or (stem + ".png")
    title = args.title or f"NTG-2501 Link Power — {os.path.basename(stem)}"

    t, slave, master = load(csv_path)
    if not t:
        print("CSV 里没有数据行")
        return 1

    n_slave_valid = sum(1 for v in slave if v is not None)
    n_master_valid = sum(1 for v in master if v is not None)
    print(f"{len(t)} 行，{t[-1]:.1f}s，slave 有效 {n_slave_valid}，master 有效 {n_master_valid}")

    fig, ax = plt.subplots(figsize=(10, 5))
    # None 值会被 matplotlib 当成 gap 断开，不连过去——缺失的采样不该用直线
    # 假装"两点之间也是这个趋势"，这对论文图是重要的诚实性
    ax.plot(t, slave, label="Slave Tx Power (uplink)", color="#d62728", linewidth=1.2)
    ax.plot(t, master, label="Master Rx Power", color="#1f77b4", linewidth=1.2)
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Power (dBm)")
    ax.set_title(title)
    ax.grid(True, alpha=0.3)
    ax.legend()
    fig.tight_layout()

    fig.savefig(out_path, dpi=150)
    print(f"已保存: {out_path}")
    if args.show:
        plt.show()
    return 0


if __name__ == "__main__":
    sys.exit(main())
