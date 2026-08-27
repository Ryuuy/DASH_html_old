# NTG-2501 实时功率记录器

## 核心需求（原话）

实时监听、保存 NTG-2501 毫米波链路的：
- **Slave 上行发射功率**（transmit power/level，dBm）
- **Master 接收功率**（receive power/level，dBm）

论文要用的图：横轴时间，纵轴两条线（Slave Tx / Master Rx），单位 dBm。
现在只能在网页管理界面上肉眼看这两个数字，没有自动同步记录下来的手段——
这个文件夹就是补这个手段的。

## 为什么要测这个（背景，跟怎么做无关，但决定了图要看什么）

用户在实验里发现：试图遮挡 LOS（视距）时，**上行 Slave 的发射功率会自动
增大**（ATPC 自动功率控制在补偿链路衰减），使得 **Master 接收端的功率
基本维持不变**。所以想验证的问题是：Master 接收功率到底能不能看出遮挡——
遮挡发生时它是提前有一个缓慢下降的过程，还是因为 ATPC 补偿到最后一刻才
突然断崖式下跌？这决定了"用接收功率做遮挡预警"这条路有没有意义。

（另外，这份 NTG-2501 数据是这台商用设备本身报出来的"官方"读数，被用来
跟同一个项目里另一路自己搭的 USRP 功率判断做对比——见 `D:\DASH\RealtimeISAC\`
和 `D:\DASH\DASH\isac_server\`，那边的动机原文是"NTG-2501 是真值但更新太慢，
不能因为它慢就说'用功率判断不行'，所以要另外用 USRP 自己设计一个更快的功率
判断方法"。这个文件夹跟那两个仓库**代码上完全独立**，不 import 任何东西，
只是数据最终会放在一起对比分析。）

## 现在的状态（20260827 实测更新）

**SNMP 那条路走不通，已经换成 HTTP，并且已经在真机上跑通验证过了。**
要记录数据，用 `ntg2501_http_logger.py`，不要用 `ntg2501_logger.py`。

### 实测环境

| | IP | 说明 |
|---|---|---|
| Master | `192.168.1.201` | Web 首页跳 `/main_mst_rt.cgi` 的那台 |
| Slave | `192.168.1.101` | Web 首页跳 `/main_slv_rt.cgi` 的那台 |
| 本机 | `192.168.1.50/24` (enp1s0) | 直连管理网 |

网段是 `192.168.1.x`，**不是**当初 prompt 里写的 `192.168.0.x`——脚本里的默认值
已经全部改过来了。

### SNMP：确认不可用

两台设备 × SNMP v1/v2c × 7 个 community（public / private / admin / manager /
netgear / ntg / public1）**全部超时**，一个字节都没回。ping 完全正常、
telnet(23) 和 HTTP(80) 都开着，所以不是网络问题，是这两台**根本没开 SNMP agent**。
（Web 界面里确实有 SNMP 设置页 `*_highsetup_Snmp.cgi`，也就是说功能存在但没启用。
如果哪天有人去 Web 里把它打开了，SNMP 那套脚本应该还能用，所以留着没删。）

### HTTP：走通了，而且比 SNMP 方案更好

设备是 **JRC 25GHz 小電力データ通信装置**（Web server 是 `CenteHTTPd/1.1`，
Software Ver. 0001.36）。「メインモニタ」页面背后就是一个干净的 XML 接口：

```
POST http://<host>/xml_master_monitor.cgi     # 空 body，但必须带 Content-Length
```

**不需要登录**——这个 CGI 不检查 session，直接 POST 就返回当前值：

```xml
<moniinf><status>
  <time>2000/01/01 01:19:43</time>
  <up_mod_val>QPSK</up_mod_val>
  <quality_tx_up_level> 5.0</quality_tx_up_level>      上り送信 = Slave 发射功率
  <quality_rx_up_level>-58.7</quality_rx_up_level>     上り受信 = Master 接收功率
  <quality_tx_down_level> 5.0</quality_tx_down_level>  下り送信 = Master 发射功率
  <quality_rx_down_level>-58.9</quality_rx_down_level> 下り受信 = Slave 接收功率
  <quality_rx_up_cnr>28.0</quality_rx_up_cnr>
  <quality_rx_down_cnr>27.0</quality_rx_down_cnr>
</status></moniinf>
```

（上り = slave→master 上行，下り = master→slave 下行。）

**关键：Master 一台就把四个方向的值全报出来了。** Slave 那台只填自己本地知道的
两个（自己的发射、自己的接收），另外两个是空字符串。所以只查 Master 一台就够，
而且——**论文最关心的 Slave Tx 和 Master Rx 来自同一次请求、同一份 XML，
两者天然同时刻，skew 恒为 0。** SNMP 方案里"两台分别查、时刻对不齐、要记 skew_ms
并且不敢说是同步采样"那个问题，在这条路上根本不存在，可以直接说是同步的。

### 实测性能

- 单次请求 **10~13ms**（中位 11.6ms）
- **20Hz 持续 60 秒：1195 行，0 错**，延迟全程稳定
- 接收功率在 20Hz 下**每次轮询都可能变**（20s 内变了 161 次，间隔中位 0.10s），
  说明设备内部更新至少有 10~20Hz——比原来担心的"Web 页面刷新率"快得多。
  顺带一提页面自己是 500ms 轮询一次（`slave_monitor.js` 里的 `setTimeout(...,500)`），
  **设备的更新速度比它的 Web 界面显示的快，肉眼看到的不是上限。**
- ⚠️ **不要不加节流地满速打。** 试过不 sleep 直接死循环请求，CenteHTTPd 直接
  `Connection refused`——它每个响应都是 `Connection: close`，socket 撑不住。
  停下来之后设备自己恢复了，不用重启，但实验跑到一半被打断就白跑了。
  `ntg2501_http_logger.py` 因此硬性限制最快 20Hz（`MIN_PERIOD = 0.05`），
  不要去改大这个限制，除非你愿意重跑实验。

### 怎么用

```bash
cd ntg2501_power_logger

# 看一眼当前值
python3 ntg2501_http_logger.py --once

# 正式记录：10Hz，Ctrl+C 停
python3 ntg2501_http_logger.py

# 20Hz、跑 5 分钟自动停、文件名带标签
python3 ntg2501_http_logger.py --period 0.05 --duration 300 --tag blocked

# 画图（CSV 列跟 SNMP 版兼容，plot_power.py 不用改）
python3 plot_power.py logs/ntg2501_http_blocked_*.csv --out fig_power.png
```

### 还没做的

1. **真正的遮挡实验还没做。** 上面所有测试都是 LOS 畅通状态下跑的，
   Slave Tx 全程稳在 `5.0 dBm` 一动不动、Master Rx 在 `-58.1 ~ -58.9 dBm`
   小幅抖动、CNR 26~28 dB。ATPC 到底怎么补偿、Master Rx 是缓降还是断崖，
   **必须有人真的去挡一次链路才知道**——工具这边已经准备好了。
2. 建议的做法：`--tag` 分段记录（baseline / blocked / recovery），或者干脆
   一路录下来、事后按时间切，反正 20Hz 一分钟才 1200 行。

## 目录结构

```
ntg2501_power_logger/
├── README.md              本文件
├── requirements.txt        只有画图需要 matplotlib，其它都是标准库
├── ntg2501_http_logger.py  ★ 实际在用的记录器（HTTP/XML，无需登录，实测跑通）
│
│   ↓ 以下 SNMP 那套实测不可用（设备没开 SNMP），留着以防哪天启用了
├── snmp_common.py           公共的 SNMP 子进程封装（内部用，不用直接跑）
├── snmp_discover.py         Phase 1：探测 community + 存私有 MIB 子树快照
├── snmp_diff.py             Phase 1：对比两份快照，找出变化的 OID
├── rate_probe.py            Phase E：估计某个 OID 的真实更新速率
├── ntg2501_logger.py        Phase 2：正式记录器，存 CSV
├── plot_power.py            画论文图（时间 x 轴，Slave Tx / Master Rx 两条线）
├── dumps/                  snmp_discover.py 存快照的地方（跑起来才会建）
└── logs/                   ntg2501_logger.py 存 CSV 的地方（跑起来才会建）
```

## 完整流程（SNMP 版，⚠️ 实测不可用）

> **下面这整节是 SNMP 方案的流程，实测两台设备都没开 SNMP agent，跑不通。**
> 保留是因为 Web 界面里 SNMP 设置页是存在的，哪天真去启用了这套还能用。
> **要记录数据请回到上面「怎么用」那节，用 `ntg2501_http_logger.py`。**

### 0. 装 Net-SNMP 命令行工具（只需装一次）

去 https://www.net-snmp.org/download.html 下 Windows 版装上，或者搜
"net-snmp windows binary unofficial" 用现成编译好的免安装版。装完新开一个
终端确认：

```
snmpget --version
```

能打出版本号就好了（`snmp_discover.py`/`ntg2501_logger.py` 启动时也会自动
检查，缺了会打印同样的指引再退出，不会跑到一半才发现）。

### 1. Phase 1 — 找 OID

```powershell
cd D:\DASH\DASH\ntg2501_power_logger

# 1a. 确认两台设备 SNMP 通不通、community 是什么
python snmp_discover.py probe

# 1b. LOS 畅通、链路稳定状态下，存一份基线快照
python snmp_discover.py walk --community public --tag baseline

# 1c. 手动挡住毫米波链路（挡稳 3~5 秒，让链路真的反应完），再存一份
python snmp_discover.py walk --community public --tag blocked

# 1d. 对比两份，找出变化的 OID（分别对 slave/master 各跑一次）
python snmp_diff.py --auto slave
python snmp_diff.py --auto master
```

`snmp_diff.py` 会列出所有值变化的 OID，标 📶 的是"看起来像数字"的候选。
**对照两台设备 Web 管理界面 Main Monitor 上显示的实际 Tx/Rx power 数字**，
确认候选 OID 的变化方向、量级对不对得上，同时确定缩放关系——设备可能
直接报 `-54`（就是 -54dBm），也可能报 `-540`（要 ×0.1）或者别的约定，
**不要凭感觉猜，一定要拿 Web 页面上的真实数字核对**。

### 2. Phase E — 摸清真实更新速率（可选但推荐）

```powershell
python rate_probe.py --host 192.168.0.201 --oid <MASTER_RX_OID> --community public --period 0.05 --duration 10
```

依次试 `--period 0.1 / 0.05 / 0.02 / 0.01`，看"值变化间隔"是不是收敛到
同一个数字——收敛了，那就是设备真实更新周期（或者接近）；一直跟着
`--period` 变小而变小，说明还没测到设备的真实上限，是 host 轮询速度在
拖后腿。

**这个方法测不出比"host 轮询间隔"更快的真实周期**——瓶颈是 Windows 上
每次 `snmpget` 都要开一个新子进程，见下面"轮询速率的真实上限"。

### 3. Phase 2 — 正式记录

```powershell
python ntg2501_logger.py `
    --slave-tx-oid 1.3.6.1.4.1.XXXX.Y.Z.0 `
    --master-rx-oid 1.3.6.1.4.1.XXXX.A.B.0 `
    --slave-scale 0.1 `
    --community public `
    --period 0.1
```

（`--slave-scale`/`--master-scale`/`--*-offset` 按 Phase 1 确定的缩放关系填，
默认 1.0/0.0 表示"设备报的数字就是 dBm，不用换算"。）

不传 `--slave-tx-oid`/`--master-rx-oid`（还是占位符）会直接拒绝启动——
故意的，见上面"现在的状态"那节。

跑起来之后就可以走开去做实验（走过链路制造遮挡），CSV 每一行写完立刻
`flush()`，Ctrl+C 随时能安全停，已经写的数据不会丢。

### 4. 画图

```powershell
python plot_power.py logs\ntg2501_power_20260826_190000.csv --out fig_power_vs_time.png
```

## 如果 SNMP 走不通

按优先级往下试（跟 `NTG2501_SNMP_Claude_Prompt.md` 里定的顺序一致）：

1. **SNMP**（这个文件夹默认做法）
2. **Main Monitor 页面背后直接用的 HTTP/CGI 接口**：
   - F12 打开 DevTools -> Network 面板
   - 登录 Web 管理界面，打开 Main Monitor
   - 找那个会周期性重复发出的请求（不是页面整体刷新，是局部更新数据的那个）
   - 右键 -> Copy as cURL，把这个存下来
   - 这一步之后可以把 cURL 内容交给我（或者接手的人），照着这个真实的
     请求写一个 Python 版本的轮询脚本——**不要在没看到真实请求之前编
     endpoint 名字**，猜的大概率是错的
3. **解析整个 HTML 页面**（如果数据是直接嵌在 HTML 里、没有单独的 XHR/fetch）
4. **Selenium 浏览器自动化**（最后手段，只有前三条都不行才用——慢、脆弱、
   吃资源，不适合无人值守长时间跑）

## 轮询速率的真实上限（诚实说明，别被数字唬到）

这套工具每次请求都要在 Windows 上开一个新的 `snmpget.exe` 子进程，
一次开销大概几到几十毫秒（具体多少用 `rate_probe.py` 实测，不同机器不一样）。
这意味着：

- `--period 0.1`（10Hz）大概率没问题
- `--period 0.05`（20Hz）多半也行，但子进程开销占比会比较明显
- `--period 0.02` / `--period 0.01`（50Hz/100Hz）**很可能达不到**——
  两次请求之间的间隔会被子进程开销卡住，实际达到的速率会明显低于要求的

`ntg2501_logger.py` 的 CSV 里存了 `slave_query_ms`/`master_query_ms`，
真实达到的速率是多少，跑完拿这两列的统计量看，不要相信 `--period` 参数
本身——参数只是"目标"，不是"承诺"。

如果实测发现设备真实更新周期比子进程开销还快（比如 rate_probe.py 显示
设备 5ms 更新一次，但子进程开销就要 15ms），想突破这个上限需要换成常驻
一个 SNMP 会话、不为每次请求开新进程的方案（比如验证过当前 API 的 pysnmp，
或者干脆用 UDP socket 手搓最基础的 SNMP GET/GETBULK 报文——都不在这次
范围内，先用现在这套把数据能不能测出规律搞清楚再说）。

## 论文用这份数据时的注意事项

这些是从原始需求整理下来、确认合理的，不是随手抄的：

- **ATPC（自动发射功率控制）**：Slave 的发射功率会自动补偿链路衰减，
  这正是这次实验想观察的现象本身，不是要排除的噪声——但意味着"Master
  接收功率基本不变"不能被解读成"没有遮挡"，可能只是补偿生效了。
- **量化 / 内部滤波**：设备报的数字可能经过内部平均/滤波，不是瞬时物理值，
  具体滤波方式未知（NTG-2501 内部实现，拿不到）。
- **Web 刷新率 ≠ 传感器更新率 ≠ 我们的轮询率**：三件事分开看，见
  `rate_probe.py` 的说明。
- **同步性：HTTP 方案下不是问题了。** Slave Tx 和 Master Rx 来自 Master 一台
  设备的同一次请求、同一份 XML，是同时刻的读数，`skew_ms` 恒为 0，
  **可以放心在论文里说这两路是同步采样的**。（这是 HTTP 方案相对原 SNMP
  方案的实质优势——SNMP 版要分别查两台设备，才有对不齐的顾虑。）
- **⚠️ 设备时钟没设，不要用它的时间戳。** 两台报的都是 `2000/01/01 01:xx:xx`，
  显然没同步过 NTP。CSV 里的 `device_time` 列只是存档参考，
  **论文用的时间轴一定要用 `timestamp` / `elapsed_s` 这两列（本机时间）**。
- **调制方式补正**：页面注记「送信レベルと受信レベルはQPSKを基準としたレベルです．
  16QAMのレベル = 表示値 － 2.6dB / 64QAMのレベル = 表示値 － 3.7dB」。
  也就是说读数是以 QPSK 为基准的，换调制方式要减常数。目前链路一直是 QPSK，
  补正量为 0，但**遮挡导致链路降速时调制方式可能会变**——CSV 每行都存了
  `up_mod`/`down_mod`，事后能补算；也可以加 `--apply-mod-correction` 让它当场减。
- 术语用 "transmit power / receive power [dBm]"，不要叫它 "energy"。

## 原始设计依据

`D:\DASH\DASH\isac_server\NTG2501_SNMP_Claude_Prompt.md`——这是 ChatGPT
给的任务说明，方法论（Phase 1 发现 + diff 找 OID、Phase 2 并发轮询记录、
SNMP->HTTP->HTML->Selenium 的优先级、时间同步的几个注意点）是合理的，
这份实现基本照着它的结构做，只是把"用 pysnmp"换成了"用命令行工具"
（原因见上面），以及把 Phase 1/2 拆成了几个独立可单独调试的脚本而不是
一个大脚本。
