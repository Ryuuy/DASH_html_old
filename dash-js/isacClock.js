/*
 * isacClock.js
 * 20261003 新增
 *
 * 把"浏览器的时钟"换算到"ISAC 那台 Ubuntu 机器的时钟"（下称 server time），让网页这边记的
 * 事件（点按钮、分片决策、播放采样……）和 ISAC 那边的瀑布图列、多普勒检测翻转放在同一条时间轴上。
 *
 * ## 怎么估计
 * isac_bridge.py 发给网页的每条消息都带 `ts`（Ubuntu 的 time.time()*1000，ms）：频谱列 25 条/秒，
 * 另外每秒一条 {"type":"clock"}（rt_main 没开时也有）。网页收到时记下自己的 Date.now()，
 *
 *     s_i = serverTs_i - browserRecv_i  =  (真实时钟差)  -  (这条消息的单向延迟_i)
 *
 * 单向延迟 >= 0，所以 **取窗口内 s_i 的最大值** = 延迟最小的那条消息，
 * 估计误差 = 最小单向延迟（有线局域网通常 < 1~2 ms，Wi-Fi 可能到几十 ms）。
 * 窗口 60 s：既能抹掉偶发抖动，也能跟上两台机器时钟的慢漂移。
 *
 * 不需要 ping/pong，所以 **不需要改 isac_server.py**。两台机器如果都开着 NTP，误差还会更小；
 * 如果浏览器和 Ubuntu 就是同一台机器，offset ≈ 0，估计出来的是消息自身的传输延迟（~1 ms）。
 *
 * ## 对外接口
 *   isacClock.observe(serverTsMs)      isac_ws_client.js 每收到一条带 ts 的消息就调一次
 *   isacClock.toServerMs(browserMs)    浏览器 Date.now() 值 -> server time（还没同步上返回 null）
 *   isacClock.nowServerMs()
 *   isacClock.info()                   {offsetMs, nSamples, jitterMs, windowSec, ready}，写进快照 meta
 *       offsetMs  = server - browser（即 serverMs = browserMs + offsetMs）
 *       jitterMs  = 窗口内 s_i 的 (max - median)，粗略反映网络抖动，不是精度
 */

var isacClock = (function () {

	var WINDOW_MS = 60000;
	var samples = [];       // {r: browserRecvMs, s: serverTs - browserRecv}
	var best = null;        // 当前窗口内 s 的最大值
	var bestAt = 0;         // 取到 best 的那条样本的 r，用来判断它有没有滑出窗口

	function recomputeBest() {
		best = null;
		for (var i = 0; i < samples.length; i++) {
			if (best === null || samples[i].s > best) { best = samples[i].s; bestAt = samples[i].r; }
		}
	}

	function observe(serverTsMs) {
		if (typeof serverTsMs !== 'number' || !isFinite(serverTsMs)) return;
		var r = Date.now();
		var s = serverTsMs - r;
		samples.push({ r: r, s: s });
		// 滑出窗口的丢掉；如果刚好把当前最大值丢了，才需要重算（O(n)，但很少发生）
		var cutoff = r - WINDOW_MS;
		var dropped = 0;
		while (dropped < samples.length && samples[dropped].r < cutoff) dropped++;
		if (dropped > 0) samples.splice(0, dropped);
		if (best === null || s >= best) { best = s; bestAt = r; }
		else if (bestAt < cutoff) recomputeBest();
	}

	function offsetMs() { return best; }

	function toServerMs(browserMs) {
		if (best === null) return null;
		return browserMs + best;
	}

	function nowServerMs() { return toServerMs(Date.now()); }

	function info() {
		var jitter = null;
		if (samples.length > 2) {
			var v = samples.map(function (x) { return x.s; }).sort(function (a, b) { return a - b; });
			jitter = best - v[Math.floor(v.length / 2)];
		}
		return {
			ready: best !== null,
			offsetMs: best,            // serverMs = browserMs + offsetMs
			nSamples: samples.length,
			jitterMs: jitter,
			windowSec: WINDOW_MS / 1000,
			method: "max over window of (server ts - browser receive time); error = min one-way delay"
		};
	}

	return {
		observe: observe,
		offsetMs: offsetMs,
		toServerMs: toServerMs,
		nowServerMs: nowServerMs,
		info: info
	};

})();

if (typeof window !== 'undefined') window.isacClock = isacClock;
