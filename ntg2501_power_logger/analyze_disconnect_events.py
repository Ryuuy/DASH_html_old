#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20260930 新增。分析 08-27 三组长实验（15:30/15:44/15:54 三次天线增益方向调整后
的遮挡实验）里 Slave Tx / Master Rx 的功率序列，抽出：
  1. 每组 Slave Tx 的静息基线（mode）、Master Rx 的静息基线（median）
  2. 每次"遮挡尝试"（Slave Tx 偏离基线 > THRESH dB，或 master_valid/slave_valid
     变 0）当作一个 episode
  3. 其中真正导致 master_valid==0（Master 管理接口连续超时，见
     ntg2501_http_logger.py 里 2026-08-27 加的注释）的算作一次"真断连"，
     用超时窗口的上下界估计断连持续时间
  4. 没有触发 master_valid==0 的算"瞬时扰动"（ATPC 兜住了）

断连持续时间的边界解释：
  ntg2501_http_logger.py 每次请求 timeout=2.0s，链路断时每次请求都要蹲满
  2.0s 才失败。所以：
    - lower = 最后一次失败请求"完成"时刻 − 第一次失败请求"发出"时刻
              （= 失败请求次数 × ~2.0s，是断连持续时间的下界）
    - upper = 断连后第一次成功请求的"完成"时刻 − 断连前最后一次成功请求的时刻
              （是下届的上界，因为真实断/复连时刻必然夹在这两个时间戳之间）
  跑下来 21/22 个 episode 都是 5 次连续失败，lower≈10.0s / upper≈11.1s，
  分布极窄——说明这不是随机的环境噪声，而是设备内部相对固定的重新同步耗时。

用法：/usr/bin/python3 analyze_disconnect_events.py    （纯离线分析，不 import uhd，
其实随便哪个 python3 解释器都行，这里统一用 /usr/bin/python3 只是习惯）
"""
import csv
import statistics
from collections import Counter

FILES = [
    ("A", "15:30:58", "logs/ntg2501_http_baseline_20260827_153058.csv"),
    ("B", "15:44:16", "logs/ntg2501_http_baseline_20260827_154416.csv"),
    ("C", "15:54:04", "logs/ntg2501_http_baseline_20260827_155404.csv"),
]
THRESH_DB = 1.0  # 静息态下噪声通常 <0.3dB，用 1.0dB 区分"扰动"和噪声


def to_float(x):
    try:
        return float(x)
    except Exception:
        return None


def load(path):
    with open(path) as fh:
        return list(csv.DictReader(fh))


def analyze_group(label, tstart, path):
    rows = load(path)
    t = [to_float(r["elapsed_s"]) for r in rows]
    stx = [to_float(r["slave_tx_dbm"]) for r in rows]
    mrx = [to_float(r["master_rx_dbm"]) for r in rows]
    mvalid = [r["master_valid"] == "1" for r in rows]
    svalid = [r["slave_valid"] == "1" for r in rows]
    qms = [to_float(r["query_ms"]) for r in rows]

    mrx_valid = [v for v, ok in zip(mrx, mvalid) if ok and v is not None]
    vals = [round(v, 1) for v, ok in zip(stx, svalid) if ok and v is not None]
    baseline_val, baseline_n = Counter(vals).most_common(1)[0]

    n = len(rows)
    states = []
    for i in range(n):
        if not mvalid[i] or not svalid[i] or stx[i] is None:
            states.append("down")
        elif abs(stx[i] - baseline_val) > THRESH_DB:
            states.append("excursion")
        else:
            states.append("ok")

    episodes = []
    i = 0
    while i < n:
        if states[i] != "ok":
            j = i
            saw_down = False
            max_dev = 0.0
            while j < n and states[j] != "ok":
                if states[j] == "down":
                    saw_down = True
                elif stx[j] is not None:
                    max_dev = max(max_dev, abs(stx[j] - baseline_val))
                j += 1
            episodes.append(dict(start=i, end=j - 1, saw_down=saw_down, max_dev=max_dev))
            i = j
        else:
            i += 1

    # 断连持续时间必须只用真正 state=='down' 的子区间算边界（不能用外层 episode
    # 的 start/end，那可能包含前面的 excursion 行——那些行是正常成功查询，
    # query_ms 只有 ~15ms，不是 2000ms 超时，混进去会把 lower/upper 算错）。
    disconnects = []
    i = 0
    while i < n:
        if states[i] == "down":
            j = i
            while j < n and states[j] == "down":
                j += 1
            first_fail, last_fail = i, j - 1
            last_good = first_fail - 1
            first_good_after = j if j < n else None
            first_fail_start = t[first_fail] - (qms[first_fail] or 2000.0) / 1000.0
            lower = t[last_fail] - first_fail_start
            upper = (t[first_good_after] - t[last_good]) if (last_good >= 0 and first_good_after is not None) else None
            disconnects.append(dict(lower=lower, upper=upper, n_fail_rows=last_fail - first_fail + 1))
            i = j
        else:
            i += 1

    excursions = [e for e in episodes if not e["saw_down"]]

    return dict(
        label=label, tstart=tstart, n=n,
        duration_s=t[-1] - t[0],
        master_rx_median=statistics.median(mrx_valid),
        master_rx_mean=statistics.mean(mrx_valid),
        slave_tx_baseline=baseline_val,
        baseline_frac=baseline_n / len(vals),
        n_attempts=len(episodes),
        n_disconnects=len(disconnects),
        disconnects=disconnects,
        n_excursions_only=len(excursions),
        excursion_durs=[t[e["end"]] - t[e["start"]] for e in excursions],
        excursion_devs=[e["max_dev"] for e in excursions],
    )


if __name__ == "__main__":
    results = [analyze_group(l, ts, p) for l, ts, p in FILES]
    for r in results:
        print(f"\n=== Group {r['label']} ({r['tstart']}) — {r['duration_s']:.0f}s, {r['n']} rows ===")
        print(f"  Master Rx baseline: median={r['master_rx_median']:.1f}dBm mean={r['master_rx_mean']:.1f}dBm")
        print(f"  Slave Tx baseline (mode): {r['slave_tx_baseline']:.1f}dBm ({100*r['baseline_frac']:.0f}% of samples)")
        print(f"  occlusion attempts: {r['n_attempts']}   true disconnects: {r['n_disconnects']} ({100*r['n_disconnects']/r['n_attempts']:.0f}%)")
        if r["disconnects"]:
            mids = [(d["lower"] + d["upper"]) / 2 for d in r["disconnects"] if d["upper"]]
            if mids:
                print(f"  disconnect duration (midpoint est.): mean={statistics.mean(mids):.2f}s range=[{min(mids):.2f},{max(mids):.2f}]s")
        if r["excursion_durs"]:
            print(f"  non-disconnect excursions: n={r['n_excursions_only']} dur_median={statistics.median(r['excursion_durs']):.2f}s dev_median={statistics.median(r['excursion_devs']):.1f}dB")

    all_mids = []
    all_lowers = []
    all_uppers = []
    n_censored = 0
    for r in results:
        for d in r["disconnects"]:
            if d["upper"] is None:
                n_censored += 1
                continue
            all_mids.append((d["lower"] + d["upper"]) / 2)
            all_lowers.append(d["lower"])
            all_uppers.append(d["upper"])
    print(f"\n=== ALL 3 GROUPS COMBINED: {len(all_mids)} measured disconnects ({n_censored} censored, excluded) ===")
    print(f"  lower bound:  mean={statistics.mean(all_lowers):.2f}s  min={min(all_lowers):.2f}s  max={max(all_lowers):.2f}s")
    print(f"  upper bound:  mean={statistics.mean(all_uppers):.2f}s  min={min(all_uppers):.2f}s  max={max(all_uppers):.2f}s")
    print(f"  midpoint:     mean={statistics.mean(all_mids):.2f}s  stdev={statistics.stdev(all_mids):.2f}s  min={min(all_mids):.2f}s  max={max(all_mids):.2f}s")
    total_attempts = sum(r["n_attempts"] for r in results)
    total_disc = sum(r["n_disconnects"] for r in results)
    print(f"\n  total attempts (3 groups) = {total_attempts}, total true disconnects = {total_disc} ({100*total_disc/total_attempts:.0f}%)")
