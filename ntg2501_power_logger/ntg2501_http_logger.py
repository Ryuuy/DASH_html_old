#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
20260827 新增。NTG-2501 功率记录器的 **HTTP 版**——实测确认走得通的那条路，
优先用这个，不要用 ntg2501_logger.py（SNMP 版，实测两台设备都没开 SNMP，
见 README「实测结果」那节）。

数据来源：设备 Web 管理界面「メインモニタ」页面背后的 XML 接口

    POST http://<host>/xml_master_monitor.cgi     (需要 Content-Length，空 body 即可)

**不需要登录**——这个 CGI 不检查 session，直接 POST 就返回当前值。返回：

    <moniinf><status>
      <time>2000/01/01 01:19:43</time>
      <up_mod_val>QPSK</up_mod_val>            上り(slave->master) 调制方式
      <down_mod_val>QPSK</down_mod_val>        下り(master->slave) 调制方式
      <quality_tx_up_level> 5.0</quality_tx_up_level>     上り送信 = Slave 发射功率
      <quality_rx_up_level>-58.7</quality_rx_up_level>    上り受信 = Master 接收功率
      <quality_tx_down_level> 5.0</quality_tx_down_level> 下り送信 = Master 发射功率
      <quality_rx_down_level>-58.9</quality_rx_down_level>下り受信 = Slave 接收功率
      <quality_rx_up_cnr>28.0</quality_rx_up_cnr>         上り CNR
      <quality_rx_down_cnr>27.0</quality_rx_down_cnr>     下り CNR
    </status></moniinf>

关键点：**Master 一台就把四个方向的值全报出来了**（Slave 那台只填自己本地知道
的两个，另外两个是空的）。所以默认只查 Master 一台——论文最关心的
Slave Tx / Master Rx 来自同一次请求、同一份 XML，**skew 恒为 0**，
SNMP 版里"两台设备分别查、时刻对不齐"的问题在这条路上根本不存在。

用法：
    # 看一眼当前值就退出
    python3 ntg2501_http_logger.py --once

    # 正式记录（默认 10Hz，Ctrl+C 停）
    python3 ntg2501_http_logger.py

    # 20Hz，跑 5 分钟自动停
    python3 ntg2501_http_logger.py --period 0.05 --duration 300

    # 顺便也查 Slave 那台做交叉验证（会多一倍请求量，别在高速率下开）
    python3 ntg2501_http_logger.py --also-slave

CSV 列跟 SNMP 版保持兼容（timestamp/elapsed_s/slave_tx_dbm/master_rx_dbm/
slave_valid/master_valid 都在），所以 plot_power.py 不用改就能直接画。
"""

import argparse
import csv
import datetime
import os
import re
import signal
import sys
import time
import urllib.error
import urllib.request

DEFAULT_MASTER_IP = "192.168.1.201"
DEFAULT_SLAVE_IP = "192.168.1.101"
MONITOR_CGI = "/xml_master_monitor.cgi"

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")

# 页面上的注记：「送信レベルと受信レベルはQPSKを基準としたレベルです．
# 16QAMのレベル = 表示値 － 2.6dB / 64QAMのレベル = 表示値 － 3.7dB」
# 也就是说设备报的数字是以 QPSK 为基准的，换了调制方式要减掉一个常数。
# 默认**不**自动改数（保持原始读数，论文里想怎么处理是后面的事），
# 但每一行都存了调制方式，随时能事后补上；--apply-mod-correction 可以让它当场减。
MOD_CORRECTION_DB = {"QPSK": 0.0, "16QAM": 2.6, "64QAM": 3.7}

# 实测（20260827，本机 192.168.1.50 直连 192.168.1.x 管理网）：
#   - 单次请求耗时 10~12ms（中位 11.6ms）
#   - 20Hz 持续轮询稳定，接收功率每次轮询都可能变（设备更新至少 10~20Hz）
#   - **不加节流地满速打（>50Hz）会让设备的 CenteHTTPd 直接 Connection refused**，
#     它每个响应都是 Connection: close，socket 很快耗尽。停下来之后能自己恢复，
#     不用重启设备，但实验中途被打断就白跑了。所以这里硬性限制最快 20Hz。
MIN_PERIOD = 0.05

FIELDS = (
    "time", "up_mod_val", "down_mod_val",
    "quality_tx_up_level", "quality_rx_up_level",
    "quality_tx_down_level", "quality_rx_down_level",
    "quality_rx_up_cnr", "quality_rx_down_cnr",
    "wireless_range_up", "wireless_range_down",
)

CSV_HEADER = [
    "timestamp", "elapsed_s",
    "slave_tx_dbm", "master_rx_dbm",          # 论文主线：上り送信 / 上り受信
    "master_tx_dbm", "slave_rx_dbm",          # 下り方向，一起存着，不要白不要
    "rx_up_cnr_db", "rx_down_cnr_db",
    "up_mod", "down_mod",
    "slave_tx_raw", "master_rx_raw",          # 未做调制补正的原始读数
    "mod_correction_db",                      # 这一行实际减掉了多少（默认 0）
    "query_ms", "skew_ms",                    # 只查 master 时 skew 恒为 0
    "device_time",                            # 设备自己报的时间，仅供参考，见 README
    "slave_valid", "master_valid",
]

_stop = False


def _on_sigint(signum, frame):
    global _stop
    _stop = True


def fetch_monitor(host: str, timeout: float):
    """POST 一次监视 XML，返回 (字段 dict, 耗时 ms, 错误信息 or None)。

    CenteHTTPd 对没有 Content-Length 的 POST 直接回 411，所以必须带空 body
    （urllib 传 data=b"" 会自动补 Content-Length: 0）。
    """
    url = f"http://{host}{MONITOR_CGI}"
    t0 = time.time()
    try:
        req = urllib.request.Request(url, data=b"", method="POST")
        body = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, ValueError) as e:
        return None, (time.time() - t0) * 1000.0, str(e)
    ms = (time.time() - t0) * 1000.0
    vals = {}
    for f in FIELDS:
        m = re.search(rf"<{f}>(.*?)</{f}>", body, re.S)
        vals[f] = m.group(1).strip() if m else ""
    return vals, ms, None


def as_float(s):
    """设备偶尔会报空串（那一侧的值它不知道），空串不是 0，要当缺失处理。"""
    if s is None or s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def fmt(v, nd=1):
    return f"{v:.{nd}f}" if v is not None else ""


def main():
    p = argparse.ArgumentParser(
        description="NTG-2501 功率记录器（HTTP/XML 版，实测可用）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--master-ip", default=DEFAULT_MASTER_IP)
    p.add_argument("--slave-ip", default=DEFAULT_SLAVE_IP)
    p.add_argument("--also-slave", action="store_true",
                   help="额外查 Slave 那台做交叉验证（请求量翻倍，高速率下别开）")
    p.add_argument("--period", type=float, default=0.1,
                   help=f"轮询间隔秒，默认 0.1（10Hz）。最快 {MIN_PERIOD}（20Hz），"
                        f"再快会把设备的 httpd 打到 Connection refused")
    p.add_argument("--duration", type=float, default=None,
                   help="跑多少秒后自动停，不传就一直跑到 Ctrl+C")
    p.add_argument("--timeout", type=float, default=2.0, help="单次 HTTP 超时秒数")
    p.add_argument("--out", default=None, help="CSV 路径，默认 logs/ntg2501_http_YYYYmmdd_HHMMSS.csv")
    p.add_argument("--tag", default=None, help="加进默认文件名里的标签，比如 --tag blocked")
    p.add_argument("--apply-mod-correction", action="store_true",
                   help="按调制方式当场把 16QAM/64QAM 的补正减掉（默认存原始读数）")
    p.add_argument("--once", action="store_true", help="打印一次当前值就退出，不写 CSV")
    args = p.parse_args()

    if args.once:
        for label, host in (("Master", args.master_ip), ("Slave ", args.slave_ip)):
            vals, ms, err = fetch_monitor(host, args.timeout)
            if err:
                print(f"{label} ({host}): ❌ {err}")
                continue
            print(f"{label} ({host}) {ms:5.1f}ms  "
                  f"上り送信(Slave Tx)={vals['quality_tx_up_level'] or '--':>6}  "
                  f"上り受信(Master Rx)={vals['quality_rx_up_level'] or '--':>6}  "
                  f"上りCNR={vals['quality_rx_up_cnr'] or '--':>5}  "
                  f"変調={vals['up_mod_val'] or '--'}  "
                  f"设备时间={vals['time']}")
        return 0

    period = max(args.period, MIN_PERIOD)
    if period != args.period:
        print(f"⚠️ --period {args.period} 太快了，已经夹到 {MIN_PERIOD}（20Hz）——"
              f"再快设备会拒连，见脚本头部注释")

    os.makedirs(LOG_DIR, exist_ok=True)
    if args.out:
        out_path = args.out
    else:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        tag = f"_{args.tag}" if args.tag else ""
        out_path = os.path.join(LOG_DIR, f"ntg2501_http{tag}_{ts}.csv")

    # 先探一次，别让人挡完了才发现根本没连上
    probe, probe_ms, probe_err = fetch_monitor(args.master_ip, args.timeout)
    if probe_err:
        print(f"❌ 连不上 Master {args.master_ip}：{probe_err}")
        print(f"   先确认：ping {args.master_ip} 通不通、本机是不是在同一网段")
        return 1
    if as_float(probe["quality_rx_up_level"]) is None:
        print(f"⚠️ Master {args.master_ip} 连上了，但 quality_rx_up_level 是空的。")
        print(f"   这一般说明查错了设备——Slave 那台只报自己本地的两个值。")
        print(f"   确认 --master-ip 指的确实是 Master（Web 首页会跳到 main_mst_rt.cgi 的那台）。")

    signal.signal(signal.SIGINT, _on_sigint)
    print(f"记录中 -> {out_path}")
    print(f"  Master {args.master_ip}（{probe_ms:.0f}ms 首次响应）"
          f"{'，同时查 Slave ' + args.slave_ip if args.also_slave else ''}"
          f"，间隔 {period}s（{1/period:.0f}Hz）"
          f"{'，' + str(args.duration) + 's 后自动停' if args.duration else ''}")
    print(f"  Ctrl+C 随时停，每行写完立刻 flush，已写的数据不会丢\n")

    t0_mono = time.monotonic()
    n = n_err = 0
    last_status = t0_mono

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADER)

        while not _stop:
            loop_t0 = time.monotonic()
            if args.duration is not None and loop_t0 - t0_mono >= args.duration:
                break

            m_t0 = time.time()
            vals, ms, err = fetch_monitor(args.master_ip, args.timeout)
            skew_ms = 0.0
            if args.also_slave:
                s_t0 = time.time()
                s_vals, s_ms, s_err = fetch_monitor(args.slave_ip, args.timeout)
                skew_ms = abs(s_t0 - m_t0) * 1000.0
                # Slave 只在 Master 没报出来的时候顶上（正常情况用不到，
                # 留着是为了 Master 单侧短暂丢值时不至于整行作废）
                if not err and not s_err:
                    for k in ("quality_tx_up_level", "quality_rx_down_level"):
                        if not vals.get(k) and s_vals.get(k):
                            vals[k] = s_vals[k]

            elapsed_s = time.monotonic() - t0_mono
            ts_iso = datetime.datetime.now().isoformat(timespec="milliseconds")

            if err:
                n_err += 1
                writer.writerow([ts_iso, f"{elapsed_s:.3f}"] + [""] * 12
                                + [f"{ms:.1f}", f"{skew_ms:.1f}", "", 0, 0])
                f.flush()
                n += 1
                print(f"  [{ts_iso}] ⚠️ {err}")
            else:
                up_mod = vals["up_mod_val"]
                down_mod = vals["down_mod_val"]
                corr = MOD_CORRECTION_DB.get(up_mod, 0.0) if args.apply_mod_correction else 0.0

                s_tx_raw = as_float(vals["quality_tx_up_level"])
                m_rx_raw = as_float(vals["quality_rx_up_level"])
                m_tx_raw = as_float(vals["quality_tx_down_level"])
                s_rx_raw = as_float(vals["quality_rx_down_level"])

                s_tx = s_tx_raw - corr if s_tx_raw is not None else None
                m_rx = m_rx_raw - corr if m_rx_raw is not None else None
                m_tx = m_tx_raw - corr if m_tx_raw is not None else None
                s_rx = s_rx_raw - corr if s_rx_raw is not None else None

                writer.writerow([
                    ts_iso, f"{elapsed_s:.3f}",
                    fmt(s_tx), fmt(m_rx), fmt(m_tx), fmt(s_rx),
                    vals["quality_rx_up_cnr"], vals["quality_rx_down_cnr"],
                    up_mod, down_mod,
                    fmt(s_tx_raw), fmt(m_rx_raw),
                    f"{corr:.1f}",
                    f"{ms:.1f}", f"{skew_ms:.1f}",
                    vals["time"],
                    int(s_tx is not None), int(m_rx is not None),
                ])
                f.flush()
                n += 1
                if s_tx is None or m_rx is None:
                    n_err += 1

                now_mono = time.monotonic()
                if now_mono - last_status >= 1.0:
                    print(f"[{elapsed_s:7.1f}s] n={n} err={n_err}  "
                          f"SlaveTx={fmt(s_tx) or 'NA':>6} dBm  "
                          f"MasterRx={fmt(m_rx) or 'NA':>6} dBm  "
                          f"CNR={vals['quality_rx_up_cnr'] or 'NA':>5} dB  "
                          f"{up_mod}  {ms:.0f}ms")
                    last_status = now_mono

            time.sleep(max(0.0, period - (time.monotonic() - loop_t0)))

    print(f"\n停了。共 {n} 行（其中 {n_err} 行有缺失/出错）-> {out_path}")
    print(f"画图：python3 plot_power.py {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
