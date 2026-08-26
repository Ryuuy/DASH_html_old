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

## 现在的状态（写给未来的我 / 接手的人）

**还没在真机上跑过、还没验证过。** 这里在家里写的，手边没有 `192.168.0.x`
网络，SNMP OID、community、数值缩放约定全都未知——这些**必须**去实验室、
接上 NTG-2501 的管理网络之后，跑 Phase 1 才能拿到。

已经做的：
- 整套工具（发现 / 对比 / 测速 / 记录 / 画图）已经写完，逻辑上应该能跑，
  但一行都没有在真实 NTG-2501 上执行过，语法之外没有别的验证。
- 刻意选了 subprocess 调 Net-SNMP 命令行工具而不是 pysnmp 这个 Python 库——
  pysnmp 最近几年 API 大改过，没法在没有真实设备的情况下确认哪套调用方式
  在当前版本能跑，风险太大；命令行工具的接口二十多年没变过，可预测性高得多。
  代价见下面"轮询速率的真实上限"。

还没做的（下一个来处理这个文件夹的人，不管是我自己还是别的 Claude session，
优先做这些）：
1. 去实验室，跑 `snmp_discover.py probe` 确认两台设备到底支不支持 SNMP、
   community 是什么。**这一步之前的一切都是没验证过的猜测。**
2. 如果 SNMP 完全不通，按下面"如果 SNMP 走不通"那节切到 HTTP/CGI 或
   DevTools 抓包方案——那部分我只写了步骤，没写代码，因为不知道真实的
   endpoint 长什么样，瞎写了大概率是错的，不如等实测。
3. 找到真实 OID 之后，先用 `rate_probe.py` 摸一下这个值到底多久真正更新
   一次，再决定 `ntg2501_logger.py --period` 设多少合理。

## 目录结构

```
ntg2501_power_logger/
├── README.md              本文件
├── requirements.txt        只有画图需要 matplotlib，其它都是标准库
├── snmp_common.py           公共的 SNMP 子进程封装（内部用，不用直接跑）
├── snmp_discover.py         Phase 1：探测 community + 存私有 MIB 子树快照
├── snmp_diff.py             Phase 1：对比两份快照，找出变化的 OID
├── rate_probe.py            Phase E：估计某个 OID 的真实更新速率
├── ntg2501_logger.py        Phase 2：正式记录器，存 CSV
├── plot_power.py            画论文图（时间 x 轴，Slave Tx / Master Rx 两条线）
├── dumps/                  snmp_discover.py 存快照的地方（跑起来才会建）
└── logs/                   ntg2501_logger.py 存 CSV 的地方（跑起来才会建）
```

## 完整流程

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
- **Slave 和 Master 是两台独立设备，各自单独查询**：两次 SNMP 请求不是
  同一时刻发生的，`ntg2501_logger.py` 记了 `skew_ms`（两次请求发起时刻的
  差值）——**不要在论文里说这两路数据是完全同步的**，除非确认 skew 小到
  可以忽略（多小算可以忽略取决于你关心的现象的时间尺度，人体开始/结束
  遮挡通常是零点几秒量级，skew 若稳定在个位数 ms 应该没问题，具体自己判断）。
- 术语用 "transmit power / receive power [dBm]"，不要叫它 "energy"。

## 原始设计依据

`D:\DASH\DASH\isac_server\NTG2501_SNMP_Claude_Prompt.md`——这是 ChatGPT
给的任务说明，方法论（Phase 1 发现 + diff 找 OID、Phase 2 并发轮询记录、
SNMP->HTTP->HTML->Selenium 的优先级、时间同步的几个注意点）是合理的，
这份实现基本照着它的结构做，只是把"用 pysnmp"换成了"用命令行工具"
（原因见上面），以及把 Phase 1/2 拆成了几个独立可单独调试的脚本而不是
一个大脚本。
