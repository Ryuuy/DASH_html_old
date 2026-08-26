# snapshots/ 里 JSON 快照文件的数据结构

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
