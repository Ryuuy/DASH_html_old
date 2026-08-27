# NTG-2501 功率记录 — 快速上手

细节看 README.md，这里只讲怎么跑。

## 一句话

Master 和 Slave 的 Web 管理界面背后有个 **不用登录** 的 XML 接口，
POST 一下就返回当前功率。**只查 Master 一台**（`192.168.1.201`）就够了——
它把 Slave 发射功率和 Master 接收功率一起报出来，同一次请求、同一时刻。

（SNMP 试过了，两台都没开，走不通。别去碰 `snmp_*.py` 和 `ntg2501_logger.py`。）

## 设备

| | IP |
|---|---|
| **Master** | `192.168.1.201` ← 只查这台 |
| Slave | `192.168.1.101` |
| 本机 | `192.168.1.50` (enp1s0) |

## 跑

```bash
cd /home/usrpb210/DASH/DASH_html_old-main/ntg2501_power_logger

# 1. 先确认连得上（打印当前值就退出）
python3 ntg2501_http_logger.py --once

# 2. 记录。10Hz，Ctrl+C 停。数据实时写盘，随时停都不丢
python3 ntg2501_http_logger.py --tag baseline

# 3. 遮挡实验：20Hz、5 分钟自动停
python3 ntg2501_http_logger.py --period 0.05 --duration 300 --tag blocked

# 4. 画图。不带参数 = 画 logs/ 里最新那份，PNG 存成同名
python3 plot_power.py
```

CSV 自动存到 `logs/ntg2501_http_<tag>_<时间>.csv`。

## 数据在哪

```
logs/ntg2501_http_soaktest_20260827_132900.csv   ← 已录的样例（LOS 畅通，60s @20Hz，1195 行）
logs/ntg2501_http_soaktest_20260827_132900.png    ← 上面那份画出来的图（跟 CSV 同名）
```

CSV 主要的列：`elapsed_s`（秒，从记录开始算）、`slave_tx_dbm`、`master_rx_dbm`、
`rx_up_cnr_db`、`up_mod`。想直接看：

```bash
head -3 logs/ntg2501_http_soaktest_20260827_132900.csv
```

## 三个坑

1. **别把 `--period` 调到 0.05 以下。** 满速轮询会把设备的 httpd 打到
   `Connection refused`（能自己恢复，但实验就白跑了）。脚本已经限死 20Hz。
2. **设备时钟没设**（一直报 `2000/01/01`）。时间轴用 CSV 里的
   `timestamp` / `elapsed_s`（本机时间），别用 `device_time`。
3. **读数是以 QPSK 为基准的。** 现在链路一直是 QPSK 所以不用管，
   但遮挡降速可能切到 16QAM（要 −2.6dB）或 64QAM（要 −3.7dB）。
   每行都存了 `up_mod`，事后能补算。

## 现在这张图长什么样

`logs/ntg2501_http_soaktest_20260827_132900.png`：LOS 全程畅通，所以两条线都是平的——
Slave Tx 死死钉在 **5.0 dBm**（ATPC 没被触发），
Master Rx 在 **−58.1 ~ −58.9 dBm** 之间小幅抖动，CNR 26~28 dB。
**这张图本身没有信息量，它只证明整条链路跑通了。**
真正要的是有人去挡一次 LOS 之后的那张图。

---

# 装什么（新人从这里开始）

这台机器上已经装好了，下面是从零开始的话要跑的。

```bash
# 1. Python 3（Ubuntu 自带，确认一下）
python3 --version

# 2. 画图要 matplotlib，记录本身只用标准库
pip3 install matplotlib
#    或者： pip3 install -r requirements.txt

# 3. 确认网络能通到两台设备
ping -c 2 192.168.1.201    # master
ping -c 2 192.168.1.101    # slave

# 4. 确认接口有响应（应该返回一段 <moniinf>...</moniinf> 的 XML）
curl -s -X POST -d "" http://192.168.1.201/xml_master_monitor.cgi
```

第 4 步的 `-d ""` 不能省——设备对没有 Content-Length 的 POST 直接回 411。

**不需要装 net-snmp。** README 里让你装是 SNMP 方案的遗留，那条路实测不通。

（`plot_power.py` 默认只存 PNG 不弹窗，所以没有图形界面也能跑，
不用管 `MPLBACKEND`。想弹窗看的话加 `--show`。）
