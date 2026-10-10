# snapshots/ 里 JSON 快照文件的数据结构

> **2026-10-03 起快照是 format v2**（`meta.formatVersion: 2`）：新增多普勒瀑布图、ISAC 接口开关事件、
> 浏览器→ISAC 时钟换算。**v2 只是在 v1 上加字段，v1 的字段和含义都没变**——老的读取脚本照常能用。
> 新字段、Ubuntu 侧的 `isac_*.npz`、时间对齐方法、出图脚本见本文最后的
> “**20261003 新增（format v2）**”一节。ISAC 模式 `shadowing` 已改名 `doppler_detected`，见同一节。


来源：`dashtest_2sDASH_1080p-public-access.html` 页面上的
**"Save Full Snapshot"** 按钮（`dash-js/snapshotExport.js`）。

文件名格式：`dashSnapshot_YYYY-MM-DD_HH-MM-SS.json`（本地时间，导出按钮点击的那一刻）。

**浏览器下载的文件不会自动出现在 `snapshots/` 目录里** ——JS 没有权限直接写本地任意路径，
点按钮触发的是标准的"另存为下载"，文件默认落在 Chrome 的下载目录（一般是
`C:\Users\<user>\Downloads`）。下载完之后手动挪进 `snapshots/`，或者去 Chrome 设置把默认
下载目录直接指到这个文件夹。

## 顶层结构

```
{
  "meta": {
    "exportedAtWallClock": 1787...,      // 点导出按钮那一刻，Date.now()，单位 ms
    "testEpochWallClock": 1787...,       // 整个测试的时间零点，见下面"时间基准"
    "formatDoc": "snapshots_FORMAT.md"
  },
  "telemetry": { ... },     // 见下
  "bufferByRep": { ... },   // 见下，对应网页第四张图
  "netSpeed": { ... }       // 见下，对应网页第五张图
}
```

## 时间基准：怎么跟 server7.js 对齐

`meta.testEpochWallClock` 取自 `dash-js/dashPlayerVars.js` 第一行执行到的那一刻
（`<head>` 里第一个加载的 script，页面生命周期能拿到 `Date.now()` 的最早时机）。同一台
机器上，这个值和 server7.js 控制台打印的
`"Request Received for: /  at: <ts>"`（收到 HTML 请求的时刻）应该只差几到几十毫秒。

`netSpeed.exportedTrace.epochWallClock` 是网速采样第一个点的墙钟时间，对应 server7.js
里 `segStartTime`（收到第一个 `.m4s` 请求的时刻）。

要做"同一批网络事件、人工 sweep 一个 delay"的复现实验时：拿这两个时间戳和 server7.js
控制台日志（"The first segment request comes at ... from HTML request"）对一遍，就能确定
这次导出的网速数据在 server7 自己的时间轴上对应哪一段，sweep 的 delay 加在哪个点上是
清楚的。

## telemetry（原始定义见 `dash-js/telemetry.js` 的 `getSnapshot()`）

```
telemetry.segments[]         // 每个分片的最终码率决策
  { contentStart, contentEnd,      // 内容时间点（秒），[start, end) 是这个分片覆盖的范围
    representationId,               // mpd 里 representation 数组的下标
    bandwidthNominal,               // 选中档位的标称码率（bps）
    estimatedBps, actualThroughputBps,
    isacMode, isacRecovering,
    superseded,                     // true = 被 confirmRecovery() 丢弃、没真正播出来过
    wallClock }

telemetry.isacEvents[]       // isac.mode 变化事件
  { fromMode, toMode, recovering, confirmed, wallClock,
    discardedSegments }            // 仅 confirmed:true 的记录才有意义

telemetry.shadowJudgments[]  // 20260826 新增：dBFS / power 两路独立判断（见 shadowInputs.js）
  { source,        // 'dBFS' | 'power'（未来接 ISAC 自己的预测式判断可以统一记成 'isac_prediction'）
    rawValue,       // 原始读数
    judgedShadow,   // 这次判断是否进入 shadow
    thresholdUsed,
    wallClock }

telemetry.playbackSamples[]  // 每 0.1s 一条的播放状态快照
  { contentTime, isacMode, isacRecovering,
    playingRepresentationId, playingBandwidth,
    bufferFillSeconds, bufferTargetSeconds, wallClock }
```

## bufferByRep（对应网页第四张图，剩余 buffer 按码率堆叠）

```
bufferByRep.repLadder[]   // 按 bandwidth 从高到低排序，index 就是"堆叠层数"，
                           // index 0 = 最高码率 = 堆叠图最下面那层
  { id,          // representationId，跟 telemetry.segments[].representationId 对应
    bandwidth }  // 标称码率（bps）

bufferByRep.history[]     // 每 0.1s（内容时间有前进时）一个采样点
  { t,           // 内容时间点（秒）
    byRank: [seconds, seconds, ...] }  // 长度等于 repLadder.length，
                                        // byRank[i] = repLadder[i] 那个档位在这一刻还剩多少秒没播
```

画堆叠面积图：对每个历史点 `t`，纵轴从 0 开始，依次往上叠 `byRank[0]`（最高码率）、
`byRank[1]`、……——跟网页上画的完全一样。

## netSpeed（对应网页第五张图，实测网速）

```
netSpeed.coarseSamples[]  // 一个分片（2秒）一个点，来自 rate_measurement.js 的
                            // endBitrateMeasurementByID()——字节数/下载耗时
  { contentStart, contentEnd, wallClock, bps }

netSpeed.fineSamples[]    // 20260826 新增：一个 xhr progress tick 一个点，
                            // 来自 DASHttp.js 的 rateInProgress()，比 coarseSamples 细得多
                            // （具体多细取决于浏览器实际触发 progress 事件的频率）
  { wallClockStart, wallClockEnd,   // 这个 tick 的起止墙钟时间
    approxContentTime,               // 这个 tick 所属分片的内容起始时间（同一分片内所有 tick 相同）
    bps }                            // (loadedThisTime*8) / (wallClockEnd-wallClockStart) * 1000

netSpeed.exportedTrace    // 已经按 bucketMs 重采样好的、可以直接喂给 server7.js 复现的版本
  { trace: [bps, bps, ...],  // 每个元素是一格（bucketMs 毫秒）的目标 bps
    bucketMs,                 // 这批 trace 的采样间隔，单位 ms；replay 时 server7.js 的
                               // TRACE_SAMPLE_INTERVAL_MS 要设成一样的值
    source,                    // "fineSamples(progress-tick)" 或 "coarseSamples(per-segment)"
    epochWallClock }           // trace[0] 对应的墙钟时间，见上面"时间基准"
```

`netSpeed.exportedTrace` 就是 `dash-js/fplot_NetSpeed.js` 的 `exportTraceArray()` 默认参数
跑出来的结果（细粒度数据存在时 bucketMs=200，否则退化成 1000）。想要别的粒度，
在浏览器 console 里直接调 `myFplotNetSpeed.exportTraceArray(自定义的bucketMs)`，
或者用页面上单独的 "Export Network Trace" 按钮（同一份逻辑，只是单独导出这一块、
直接存成能被 server7.js `require()` 的 `.js` 格式，而不是这份大 JSON 里的一个字段）。

## Python 读取示例（画论文图用）

```python
import json

with open("snapshots/dashSnapshot_2026-08-26_17-40-00.json") as f:
    snap = json.load(f)

segments = snap["telemetry"]["segments"]
isac_events = snap["telemetry"]["isacEvents"]

buffer_hist = snap["bufferByRep"]["history"]
rep_ladder = snap["bufferByRep"]["repLadder"]  # index 0 = 最高码率

net_trace = snap["netSpeed"]["exportedTrace"]["trace"]
bucket_ms = snap["netSpeed"]["exportedTrace"]["bucketMs"]

# 堆叠面积图（matplotlib）
import matplotlib.pyplot as plt
t = [p["t"] for p in buffer_hist]
layers = [[p["byRank"][i] for p in buffer_hist] for i in range(len(rep_ladder))]
labels = [f'{r["bandwidth"]//1024}k' for r in rep_ladder]
plt.stackplot(t, *layers, labels=labels)
plt.legend()
plt.xlabel("Content Time (s)")
plt.ylabel("Buffered (s)")
```


---

# 20261003 新增（format v2）

## 0. 改了什么，一句话版

| | |
|---|---|
| 改名 | ISAC 模式 `shadowing` → **`doppler_detected`**（"ISAC 看到多普勒了"）。网页仍接受旧字符串 `shadowing`，当作 `doppler_detected` |
| 新图 | 网页第六张图：实时多普勒瀑布图 + 判决红/黑虚线 + ISAC interface 带（`dash-js/dopplerView.js`） |
| 新按钮 | **`ISAC interface: ON/OFF`**。ON=播放逻辑听 ISAC；OFF=完全不考虑 ISAC（纯 ABR 基线），检测照常显示和记录 |
| 新数据 | 瀑布图数据、多普勒检测翻转、接口开关事件；每条记录带 server 时间估计 |
| 统一时钟 | 所有事件都能换算到 **server time**（跑 rt_main / isac_bridge 的 Ubuntu 机器的时钟） |
| 两份文件 | 浏览器：`dashSnapshot_*.json`（v2）；Ubuntu：`isac_logs/isac_*.npz`（权威、完整，浏览器关了也在记） |

**哪些东西不需要更新**：见第 7 节。

## 1. 时间基准：怎么保证 DASH 和 ISAC 共用一个时钟

**server time** = 运行 `rt_main.py` 和 `isac_bridge.py` 的那台 Ubuntu 机器的 `time.time()*1000`
（毫秒，Unix 纪元）。ISAC 这边所有时间戳（瀑布图每一列、检测翻转、server 收到网页消息的时刻）都是它。

网页怎么对上这个时钟（`dash-js/isacClock.js`，不需要 ping/pong，也不需要改 server）：
`isac_bridge.py` 发给网页的每条消息都带 server 时间戳 `ts`（瀑布图 25 条/秒，另有每秒一条
`{"type":"clock"}`）。网页收到时记下自己的 `Date.now()`：

    s_i = serverTs_i - browserRecv_i = (真实时钟差) - (这条消息的单向延迟_i)

单向延迟 ≥ 0，所以取最近 60 s 内 `s_i` 的**最大值**（= 延迟最小的那条消息）作为偏移估计：
**误差 = 最小单向延迟**，不是平均延迟。实测/模拟：

| 场景 | 偏移估计误差 |
|---|---|
| 同一台机器，真机 headless Chrome 端到端 | 页面估计 vs Ubuntu 实收：±0.5 ms；`jitterMs`≈1 ms |
| 模拟：服务器快 5 s，有线（延迟 0.5~3.5 ms） | −0.5 ms |
| 模拟：Wi-Fi 式大抖动（延迟 3~43 ms） | −3.0 ms |
| 模拟：时钟慢漂移 20 ppm，跑 5 分钟 | −1.1 ms |

（负号 = 估计值偏小一个最小延迟，即网页事件在 server time 上显得早了这么多。）对比：瀑布图列间隔 40 ms。
两台机器如果都开 NTP，上面是**网络估计误差之外**还要加的两台机器本身的时钟误差，没开 NTP 的话
`offsetMs` 本身会很大（比如几秒）——这正是要做这个换算的原因，换算不依赖 NTP。

**一条记录里可能有三种时间字段，用哪个：**

| 字段 | 含义 | 什么时候用 |
|---|---|---|
| `wallClock` | 浏览器的 `Date.now()`（ms） | 原始值，永远在。换算：`serverMs = wallClock + meta.clock.offsetMs` |
| `serverTsEst` | 记录产生那一刻页面按**当时**的偏移估计换算的 server 时间 | 页面刚打开时偏移还没收敛（前几秒误差可达几 ms），事后分析优先用上面那个 |
| `server_recv_ts`（仅 Ubuntu 文件里的 `video_telemetry_json`，单位**秒**） | isac_server 收到这条消息的 server 时间 | 对**浏览器→server 方向**的事件（按钮）这是权威时间，含 ws 传输延迟 ≤ 1 ms 量级 |

`analysis/session_tools.py` 默认用 `wallClock + 最终偏移`；传了 Ubuntu 文件时，接口开关事件用
`iface_server_recv_ms`（权威）。

**瀑布图一列的时间含义**：`ts` = 这一列 200 ms 分析窗的**末端**（窗中心 ≈ `ts − 100 ms`），再加
约 20~60 ms 的采集/USB 延迟（没有修正）。拿它跟"真人动作"的真值比时要考虑这 0.1~0.16 s。
检测翻转事件 `det_t_ms` / `dopplerDetections[].serverTs` 是 rt_main 做出判决那一刻。

## 2. ISAC interface 开关的语义

`isac.js` 里三个量（页面上能看到）：

| 量 | 含义 |
|---|---|
| `isac.detected` | ISAC 报告的**原始**状态（`normal` / `doppler_detected`），不管接口开没开都跟着变 |
| `isac.interfaceEnabled` | 按钮状态。true=接口开 |
| `isac.mode` | **实际生效**的模式 = `interfaceEnabled ? detected : "normal"`。adaptationlogic / 码率 / buffer / 所有图读的都是它 |

所以接口 OFF 时：播放逻辑完全是 normal（纯 ABR 基线），但瀑布图、判决虚线、`dopplerDetections`
照常记录——可以直接比较"同一段检测，开和不开 ISAC 接口，码率/buffer 各怎么走"。

每次点按钮：① 记一条 `isacInterface` 事件（带 `enabled`、`reason:"button"`、当时的 `detected`），
② 通过 WebSocket 推回 isac_server（它盖 `server_recv_ts`，bridge 落进 Ubuntu 文件），③ 再套用模式
（所以时间线上"开关"一定排在它引起的"模式变化"前面）。页面加载完记一条 `reason:"init"` 的初始状态
（接口默认 ON），所以每个文件开头都有起始状态。

## 3. 快照 JSON v2 新增/变化的字段

```
meta.formatVersion                  2
meta.clock                          {ready, offsetMs, nSamples, jitterMs, windowSec, method}
                                      offsetMs: serverMs = browserMs + offsetMs  （最终、最收敛的那个）
                                      jitterMs: 窗口内样本 (max - median)，粗略反映网络抖动
meta.isacInterfaceEnabledAtExport   导出那一刻接口是开还是关
meta.isacWsUrl                      这次连的 ISAC WebSocket 地址

telemetry.videoStateEvents[]        视频播放状态事件 { state: "playing"|"paused"|"ended", contentTime, wallClock, serverTsEst }
                                    （20261003 晚新增；后处理时用它排除暂停的时间段。Ubuntu 文件的 video_telemetry_json 里同样有 kind=="videoState"）
telemetry.isacInterfaceEvents[]     接口开关事件
  { enabled: bool, reason: "init"|"button", detected: "normal"|"doppler_detected",
    wallClock, serverTsEst, type:"video_telemetry", kind:"isacInterface" }
telemetry.dopplerDetections[]       ISAC 那边的多普勒检测翻转（不管接口开没开都记）
  { state: "doppler_detected"|"normal", serverTs(ms, rt_main 判决时刻, server time),
    ridge(Hz), E(判决证据量), recvWallClock(浏览器收到的 Date.now()), wallClock, serverTsEst }
telemetry.isacEvents[]              （原有）实际生效的模式变化；新增字段：
  detected, interfaceEnabled, source("isac"|"manual"|"dBFS"|"power")
telemetry.segments[] / playbackSamples[]   （原有）每条新增：
  isacInterface: bool   这一刻接口开关
  dopplerState: str     这一刻 ISAC 原始检测状态（isacMode 是"实际生效的"，接口关时恒为 normal）
  serverTsEst           （所有记录都有）

spectrogram                         网页第六张图的全部数据（server time 轴）
  nColumns, nBins(=256)
  freqsHz[256]                      每个 bin 的多普勒频率（fftshift：-500 … +496.09 Hz，步长 3.906 Hz）
  dbMin, dbMax                      量化范围（默认 -90 / +50 dB）
  tServerMs[nColumns]               每列的 server 时间（ms），见上面“一列的时间含义”
  ridgeHz[nColumns]                 DC 脊宽
  rawHit[nColumns]                  0/1：脊宽 ≥ 阈值（逐步，不去抖）
  verdict[nColumns]                 0/1：判决 doppler_detected
  score[nColumns]                   判决证据量 E
  rtMeta                            rt_main 的判据参数（阈值、累积窗口等，随 doppler_meta 消息来）
  dbQ_base64                        uint8[nColumns*256] 的 base64，行优先（一列接一列）
                                    dB = dbMin + q*(dbMax-dbMin)/255
```

快照文件不再 pretty-print（瀑布图让它很大：30 分钟约 45000 列 ≈ 15 MB base64）。

## 4. Ubuntu 侧文件 `RealtimeISAC/isac_logs/isac_YYYYmmdd_HHMMSS_p001.npz`（format v2，20261003 晚更新）

由 `isac_bridge.py` 写（每 20 s 自动保存 + 退出时保存，原子替换）。**一个文件，里面把几类数据分成不同的键**。文件名带分段号 `_p001`：默认每 2 小时才开新的一段（`--rotate-min` 可调，0=不分段），所以一次普通实验就是一个文件；超长实验会有 `_p002` …，读的时候 `load_isac_log("isac_*_p*.npz")` 自动拼起来（每段开头那条 score=-2 的事件是从上一段携带过来的初始状态，拼接时会去掉）：

```
format_version                    int
meta_json                         JSON 字符串：start_ms/start_iso/host/时钟说明/rt_meta(判据参数)/bridge 参数/各计数
--- 瀑布图 waterfall（每列一行，约 25 Hz）---
wf_t_ms         float64 [T]       server time，该列 200 ms 窗的末端
wf_db_q         uint8   [T,256]   量化 dB，dB = wf_db_min + q*(wf_db_max-wf_db_min)/255
wf_freqs_hz     float32 [256]
wf_db_min, wf_db_max
wf_ridge_hz     float32 [T]
wf_raw_hit      uint8   [T]
wf_verdict      uint8   [T]       1 = doppler_detected
wf_score        int32   [T]
--- 多普勒检测事件 detection（只记翻转）---
det_t_ms        float64 [N]       判决翻转时刻（rt_main 的钟，= server time）
det_state       uint8   [N]       1 = doppler_detected，0 = normal
det_ridge_hz    float32 [N]
det_score       int32   [N]       -1 表示 bridge 因 rt_main 超时没发判决而强制回落（合成的翻转）
--- ISAC 接口开关事件 interface（来自网页按钮）---
iface_server_recv_ms        float64 [M]   isac_server 收到的 server 时间（权威）
iface_client_ms             float64 [M]   按下时浏览器的 Date.now()
iface_client_est_server_ms  float64 [M]   页面自己换算的 server 时间
iface_enabled               uint8   [M]   1 = ON，0 = OFF
--- 参考通道/下行功率（v2 新增，rt_main 每 20 ms 一条，约 50 Hz，server 时间）---
dbfs_t_ms        float64 [K]
dbfs_mean        float32 [K]   两路 RX 的瞬时 dBFS 平均
dbfs_ch0         float32 [K]   ch0 = reference channel 的 dBFS
dbfs_ch1         float32 [K]   ch1 = sensing channel 的 dBFS
dlpower_t_ms     float64 [L]   下行（Master 方向）功率，sensing channel，仅 TDD 锁定时才有
dlpower_dbfs     float32 [L]
--- 网页遥测原始记录 ---
video_telemetry_json        JSON 字符串：网页推回来的记录（分片决策 segment、播放采样 playbackSample、
                            isacEvent、isacInterface、dopplerDetection），每条带 server_recv_ts（server
                            时间，**秒**）。**不含 kind=="shadowJudgment"**（dBFS/power 每条消息一条的
                            判断记录，约 130 条/秒、阈值是占位值；原始 dBFS/power 值在上面的 dbfs_*/dlpower_*）。
```
**v2 的重要修正**：v1 的这一项是每 20 s 从 isac_server 的内存（只留最近 50000 条）重写整个文件，而
shadowJudgment 占了约 130 条/秒，所以 6~7 分钟就把别的记录挤掉，**v1 文件里的网页遥测只覆盖最后几分钟**
（实测 13 分钟的运行只剩最后 5.8 分钟，早先的接口开关事件也丢了）。v2 由 bridge 每秒增量收集、不依赖那份内存，
`meta.telemetry_gaps` 记录"来不及收集、被挤掉"的次数（正常为 0）。**用 v1 文件时，网页侧数据请以浏览器快照为准。**
瀑布图、检测事件、接口事件（iface_*）在 v1 和 v2 里都是完整的。

浏览器侧：瀑布图保留最近 60 分钟，播放采样保留最近 100 分钟（`shadowJudgments`，即 dBFS/power 两路判断，
是原有行为：只留最近 20000 条≈3 分钟）。半小时的实验都在范围内。

## 5. 怎么读

```python
import sys; sys.path.insert(0, "analysis")          # DASH_html_old-main/analysis/session_tools.py
from session_tools import load_snapshot, load_isac_log

snap = load_snapshot("snapshots/dashSnapshot_2026-10-03_16-30-00.json")   # 浏览器导出（v2）
log  = load_isac_log("../RealtimeISAC/isac_logs/isac_20261003_163000.npz")  # Ubuntu 文件（可选）

# 全部是 numpy，时间都是 server time (ms)
snap.spec.t_ms, snap.spec.db            # [T], [T,256] float32 dB
snap.spec.ridge_hz, snap.spec.verdict
snap.iface.t_ms, snap.iface.enabled     # 接口开关事件（wallClock + 最终偏移）
snap.det.t_ms,   snap.det.state         # 多普勒检测翻转
snap.segments.server_ms, snap.segments.bitrate_bps, snap.segments.interface, snap.segments.superseded
snap.playback.server_ms, snap.playback.buffer_s, snap.playback.playing_bps, snap.playback.isac_mode
snap.buffer.server_ms, snap.buffer.by_rank   # 堆叠 buffer；x 原本是内容时间，已经用播放采样换算成 server 时间
snap.net.server_ms, snap.net.bps
snap.clock_offset_ms                    # serverMs = browserMs + 这个

log.wf_t_ms, log.wf_db, log.wf_verdict  # Ubuntu 文件里的同一份瀑布图（完整）
log.iface_t_ms, log.iface_enabled       # 接口开关，server 收到的时间（权威）
log.video_telemetry                     # list[dict]，每条有 server_recv_ts（秒）
```

不用 `session_tools.py` 直接读也行：快照是普通 JSON；`np.load(path)` 就能读 npz（`meta_json`、
`video_telemetry_json` 是字符串，`json.loads(str(d["meta_json"]))`）。

典型分析：**接口开 vs 关的对照**——用 `snap.iface` 把时间轴切成 ON/OFF 段，再对
`snap.segments`（`interface` 字段每条都带）或 `snap.playback` 按段统计码率、buffer 掉空次数等。

## 6. 怎么出图（论文用）

```bash
cd DASH_html_old-main/analysis
python3 plot_session.py ../snapshots/dashSnapshot_2026-10-03_16-30-00.json \
        --isac-log ../../RealtimeISAC/isac_logs/isac_20261003_163000.npz \
        --window 5 60 --out fig_session
```

生成 `fig_session.pdf`（矢量，字体已嵌入）和 `fig_session.png`（300 dpi）。宽度默认 7.16 in（IEEE 双栏），
`--width` 可改。五个面板共用一条 server time 横轴（相对第一列的秒数）：

(a) 多普勒瀑布图 + **红色虚线=变为 doppler detected，黑色虚线=恢复 normal**；
(b) DC 脊宽、阈值线、判决阴影；
(c) ISAC interface ON(绿)/OFF(灰)，以及实际生效模式（橙=doppler_detected，黄=recovering）；
(d) 实际播放码率 + 实测网速；
(e) buffer 按码率堆叠（最高码率在最下面）。

给了 `--isac-log` 时瀑布图和接口开关事件取自 Ubuntu 文件（完整、权威）；不给就全部取自快照。
想只画某一部分或改版式：`plot_session.py` 里每个面板是独立的一段代码，`session_tools.py` 负责读数据。

## 7. 要更新哪些东西（“server 端”需不需要升级）

**不需要升级：**

| | 为什么 |
|---|---|
| `server7.js`（node，网页+视频服务） | 它的 default 分支会按路径直接读目录下的任意文件，新增的 `dash-js/*.js` 自动能被取到；**没有新增任何 server7 端点或文件名**（它的 `/api/session/save` 文件名白名单是固定的，我没动，新信息塞进了已有的 `meta.json`）。老版本 server7.js 一样能用 |
| `isac_server.py`（Ubuntu，WebSocket） | **没有修改**。新消息走它已有的 `_broadcast_payload` 广播；网页新记录走它已有的 `video_telemetry` 日志（它自己盖 `server_recv_ts`）；它对不认识的消息类型是忽略。`push_result` 接受任意字符串，所以发 `doppler_detected` 没问题 |

**需要做的只有“把文件放到位”（不是升级服务软件）：**

* 网页文件（`dashtest_2sDASH_1080p-public-access.html` 和 `dash-js/` 下改动/新增的：`isac.js`、
  `isac_ws_client.js`、`telemetry.js`、`adaptationlogic.js`、`dash.js`、`shadowInputs.js`、
  `fplot_ShadowRate.js`、`snapshotExport.js`、`sessionAutoSave.js`，新增 `isacClock.js`、`dopplerView.js`）
  拷到 node 服务器那个目录里。如果网页和视频在另一台机器（比如 Windows 的 `node server7.js`），
  就拷到那台机器的项目目录。**拷贝一次即可，不用重启 Ubuntu 这边的任何东西。**
* Ubuntu 这边：`RealtimeISAC/` 里改动的 `isac_bridge.py`、`isac_session_log.py`（新）、
  `realtime/rt_main.py`、`realtime/rt_publish.py` 等（同一台机器，已经在位）。
* ISAC WebSocket 地址：`isac_ws_client.js` 里默认 `ws://192.168.1.50:8765/isac`。换了 IP 不用改文件，
  网页地址后面加 `?isacws=ws://新IP:8765/isac` 即可。

**向后兼容：**

* 新网页 + 旧 bridge（发 `shadowing`）：能用，`shadowing` 被当成 `doppler_detected`。
* 新网页 + 旧版 isac_server.py（没有 `get_video_telemetry` / `_broadcast_payload`）：网页照常工作，
  但 bridge 无法广播瀑布图（会在启动时警告），Ubuntu 文件里 `iface_*` 为空——浏览器快照里仍有全部接口事件。
* 旧网页（还没拷新文件）+ 新 bridge：旧网页忽略新的消息类型，但不认识 `doppler_detected`；
  这种情况下启动 bridge 时加 `--legacy-mode-name`，它就继续推旧字符串 `shadowing`（新网页也认）。
  网页文件更新完之后去掉这个开关即可。旧网页当然没有瀑布图、接口按钮，也不会记录新数据。

## 8. 怎么启动

```bash
# 终端 1：网页 + 视频服务（node）
cd DASH_html_old-main && node server7.js                     # http://<IP>:8080/

# 终端 2：ISAC 桥接 + WebSocket 服务（miniconda 的 python3，不是 /usr/bin/python3）
cd RealtimeISAC && python3 isac_bridge.py                    # 自动写 isac_logs/isac_*.npz，Ctrl+C 时保存

# 终端 3：检测（/usr/bin/python3）
cd RealtimeISAC/realtime && /usr/bin/python3 rt_main.py --duration 3600 --isac [--live --live-fmax 500]
```

浏览器打开页面后：看到第六张图在滚动；点 `ISAC interface` 按钮切换；做完实验点
**Save Full Snapshot** 下载 JSON，同时 Ubuntu 的 npz 在 `RealtimeISAC/isac_logs/`。


## 9. 20261003 晚：自动保存模式 + 页面版面

### 自动保存（`sessionAutoSave.js`，推到 server7.js 的 `sessions/<时间>/`）

网址参数选模式：

| 网址 | 行为 |
|---|---|
| `…:8080/` （默认，light） | 只推小文件 `meta.json` / `doppler_shadow_events.json` / `power_dbfs_judgments.json`，每 10 s 一次。**不推** `buffer_by_rep.json`、`net_speed.json` |
| `…:8080/?autosave=full` | 原来的行为：5 个文件全推，每 2 s 一次 |
| `…:8080/?autosave=off` | 完全不自动保存（链路实验时推荐） |

为什么：每次都是把**整份**数据推给 server 覆盖写，数据又随时间一直变长。实测（headless Chrome，ISAC 数据在流）
每 2 秒一轮的上行流量：0.5 分钟 0.65 → 1 分钟 2.1 → 2 分钟 4.9 → 3 分钟 7.7 → 4 分钟 10.5 Mbit/s（每分钟涨
约 2.8），9~10 分钟就会占满 NTG-2501 的 26 Mbps。浏览器和 server7.js 不在同一台电脑时，这些数据要穿过正在被
测的无线链路。**两个被省掉的文件的数据在别处都有**：手动 `Save Full Snapshot`（含 bufferByRep、netSpeed），
以及 Ubuntu 的 `isac_logs/*.npz`（含网页推回去的 playback/segment 遥测）。

多普勒瀑布图本身**不**走自动保存（只在 Ubuntu 的 npz 和手动快照里），它的 WebSocket 流量只有约 9 KB/s
（瀑布图 6 + dBFS 1.2 + power 1.2 + 其它 ≈ 0.07 Mbit/s），对链路可以忽略。

### 页面版面

两列，每列 = 视频宽度（1920）的一半（960）：

```
左列                                  右列
ISAC state + ISAC interface (graph3)  多普勒瀑布图 (graph6)
剩余 buffer 按码率堆叠面积图 (graph4)  Final Selected Bitrate (graph7，原来是 graph3 的下半部分)
实测网速 (graph5)
------------------------------------------------------------
原来的第一张图 (graph)                 原来的第二张图 (graph2)
```
canvas 的 id 没变，JS 按 id 画图；换位置只要在 html 里把对应 `<canvas>` 剪切到别的 `<div>`。
`fplot_ShadowRate.js` 的 `fPlotShadow` 新增第 4 个参数 `mode`：`"bands"`（只画上面两条带）/
`"bitrate"`（只画 Final Selected Bitrate）/ `"both"`（原样，默认）。


## 10. 数据清单：保存了什么、在哪找

| # | 位置 | 谁写的 | 什么时候写 | 内容 |
|---|---|---|---|---|
| 1 | **Ubuntu** `~/sdr_workspace/RealtimeISAC/isac_logs/isac_<日期_时间>_p001.npz` | `isac_bridge.py` | 每 20 s 自动 + 退出时（Ctrl+C / kill 都会保存） | **多普勒瀑布图**（25 列/s，uint8 量化的 256 个多普勒 bin）+ 脊宽/逐步命中/判决；**检测翻转事件**；**ISAC 接口 ON/OFF 事件**（server 实收时间，权威）；**dBFS（ch0/ch1，~50 Hz）和下行 power**；**网页遥测**（分片决策、10 Hz 播放采样、模式变化、检测记录、接口事件）；meta（判据阈值、采样参数等） |
| 2 | **浏览器所在电脑的下载目录**（Chrome 默认 Downloads）`dashSnapshot_<日期_时间>.json` | 页面按钮 **Save Full Snapshot** | **手动点一下才有** | 页面上所有图的数据：堆叠 buffer 历史、实测网速（粗+细）、分片决策、播放采样、接口事件、检测事件、**多普勒瀑布图（最近 60 分钟）**、时钟偏移 |
| 3 | **node 服务器那台电脑** `DASH_html_old-main/sessions/<时间>/` | 页面自动保存 → `server7.js` | 默认每 10 s（`?autosave=off` 关掉） | light 模式只有：`meta.json`（含接口事件、检测事件、时钟）、`doppler_shadow_events.json`、`power_dbfs_judgments.json`。**没有**瀑布图、buffer 堆叠、网速（`?autosave=full` 才有后两个，但会占链路，不推荐） |
| 4 | Ubuntu `RealtimeISAC/debug/iq_*.npz` | `rt_iqdump.py` | 只有你手动采集时 | 原始 IQ，不属于这套流程 |
| 5 | `DASH_html_old-main/ntg2501_power_logger/logs/*.csv` | NTG-2501 的记录工具 | 只有你运行那个工具时 | 接收电平、CNR、调制方式（**没有**入力/出力レート） |

**后处理首选 #1 + #2**：#1 完整、浏览器关了也在记；#2 带有页面上的图所需的全部数据。两者都用同一个 server 时间，
`analysis/session_tools.py` 的 `load_isac_log()` / `load_snapshot()` 直接读，`plot_session.py` 出图。
**多普勒瀑布图在 #1 和 #2 里都有**（#1 完整，#2 是浏览器收到的最近 60 分钟）；不在 #3 里。

### 掉线时会怎样

* **ISAC 的 WebSocket 断了**（网络抖动 / 浏览器切到别的网络 / bridge 重启）：页面自动重连（1 s、2 s、4 s … 最多 10 s 间隔），
  瀑布图上会出现"no ISAC data for N s"，那段时间浏览器没有瀑布图数据（空白，不是拉伸）。**Ubuntu 的 #1 不受影响**，
  rt_main → bridge 是同一台机器的 UDP，不经过网页；断线期间的检测事件和瀑布图照常写进 #1。
* **被测的无线链路被遮挡/断开**：视频分片会超时重试；ISAC 的 WebSocket 如果走的是**同一条无线链路**，也会一起断。
  所以建议**让浏览器跑在这台 Ubuntu 上**（WebSocket 是本机回环，不经过被测链路），视频才是唯一穿过链路的流量。
* **rt_main 停了 / 崩了**：bridge 6 秒收不到判决就把模式回落到 normal（宁可漏报也不挂假状态），
  文件里这个翻转的 `det_score = -1`。
* **bridge 停了**：Ctrl+C 或 kill 都会先保存最后一个文件再退出；强杀（kill -9 / 断电）最多丢最近 20 秒。


## 11. 保存、刷新、暂停（常见问题）

* **怎么保存**：① Ubuntu 的 `isac_logs/*.npz` **自动**写（`rt_main` + `isac_bridge` 在跑就一直写，和网页开不开、视频播不播无关）；
  ② 网页上的图数据要点 **Save Full Snapshot**（文件进浏览器的下载目录）；③ node 那台电脑的 `sessions/` 是自动的备份（默认只有小文件）。
* **刷新/关闭网页不会保存，反而清空网页内存里的数据**（Ubuntu 的 npz 不受影响，继续写）；刷新后 ISAC 接口开关回到 ON。
  所以刷新前先点 Save Full Snapshot。20261003 晚加了防误刷新：上次保存之后又攒了 >50 个播放采样（≈5 秒）时，
  刷新/关闭页面前浏览器会先弹确认框（文字是浏览器自带的，不能自定义）。
* **多普勒什么时候产生数据**：只要 `rt_main` 在跑就是 25 列/s（+ dBFS/power 各 ~50/s），**不会因为视频暂停而停**。
  想让它不再产生，就停掉 `rt_main`（终端 Ctrl+C）；想让 Ubuntu 也不再记录，再停 `isac_bridge`。
* **暂停视频时**：瀑布图的**显示**会冻结（右上角出现 "VIDEO PAUSED - display frozen"），但数据仍在后台收集、
  仍写进 npz 和快照；视频的 播放/暂停/结束 都会记成 `videoState` 事件。恢复播放后图继续滚动。
  推给网页的流量只有约 0.07 Mbit/s，所以没有做成"暂停就停止发送"。


---

# 20261009 新增（Ubuntu 侧 format v3）：NTG-2501 同步记录 + 打点 + 总览图

一句话：现在跑 `python3 isac_bridge.py` 时，**NTG-2501 的链路数据自动同步记录**到同一个目录、同一个时间戳，
退出时自动出一张 `overview_<stamp>.png`（多普勒瀑布 + ch0/ch1 功率 + 脊宽 + NTG 全部量）。网页和 server 端**没有改动**。

## 12. 一次实验产生的文件（都在 `RealtimeISAC/isac_logs/`，同一个 `<stamp>`）

```
isac_<stamp>_p001.npz     ISAC 记录（format v3：比 v2 多 marker_t_ms / marker_label，其余键不变）
ntg_<stamp>.csv           NTG-2501 链路记录（见下），10 Hz（--ntg-period 0.05 可到 20 Hz）
ntg_<stamp>.log           NTG logger 的终端输出（连不上时看这个）
overview_<stamp>.png      总览图（退出时自动画；也可手动 python3 analysis/isac_overview.py isac_logs/isac_<stamp>）
```
开关：`--no-ntg`（不起 NTG logger）、`--no-overview`（不画图）、`--ntg-master-ip`、`--ntg-period`。
**打点**：在跑 bridge 的终端里直接按回车（可先输入标签，如 `cross_mid_fast`），时刻同时写进
npz（`marker_t_ms`/`marker_label`，server 时间）和 NTG CSV 的 `marker` 列。

## 13. NTG CSV 列（前 18 列是 20260827 起就有的，新增的追加在行尾）

```
timestamp, elapsed_s                  本机 ISO 时间 / 记录开始后的秒
slave_tx_dbm, master_rx_dbm           上行：Slave 发射 / Master 接收
master_tx_dbm, slave_rx_dbm           下行：Master 发射 / Slave 接收
rx_up_cnr_db, rx_down_cnr_db          上/下行 CNR
up_mod, down_mod                      调制方式（QPSK/16QAM/64QAM）
slave_tx_raw, master_rx_raw, mod_correction_db, query_ms, skew_ms, device_time, slave_valid, master_valid
--- 20261009 新增 ---
unix_time            本机 time.time()（秒）；= ISAC 记录的 server time/1000，用它对齐
wireless_range_up/down   無線伝送速度 [Mbps]：自适应调制后的 PHY 容量
input_rate_up/down       入力レート [Mbps]：送进设备有线口的流量（offered）
output_rate_up/down      出力レート [Mbps]：设备交出有线口的流量（实际送达）
pathloss_up_db/down_db   等效路径损耗 = Tx − Rx（ATPC 会把 Rx 压平，看这个更有信息）
marker                   回车打点，格式 标签@unix_time，多个用 ; 连接
```
注意：Master 超时（链路被挡住时设备 HTTP 也会卡）的行，数值列为空、unix_time 仍在；读的时候当缺失（NaN）。
调制补正：默认存原始读数，`mod_correction_db` 恒为 0。

## 14. 怎么读

```python
from session_tools import load_isac_log, load_ntg_csv
log = load_isac_log("isac_<stamp>_p*.npz")      # log.marker_t_ms / log.marker_label 是新增的
ntg = load_ntg_csv("ntg_<stamp>.csv")           # ntg.t_ms 与 log.wf_t_ms 同一个时钟（server time，毫秒）
```
