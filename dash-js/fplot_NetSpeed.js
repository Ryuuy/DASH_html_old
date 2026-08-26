/*
 * fplot_NetSpeed.js
 * 20260826 新增
 *
 * 第五张图：真实网速。数据就是每个分片下载完时算出来的 downloadBps
 *（字节数/耗时，rate_measurement.js 的 endBitrateMeasurementByID 里算的那个值，
 * 也就是第一张图绿线"Actual Throughput"背后那份数据）——浏览器 JS 拿不到操作系统/网卡
 * 层面的吞吐量，逐分片测下载耗时是标准做法，navigator.connection.downlink 这类 API
 * 精度粗、量化严重，不适合拿来做论文数据。
 *
 * 这里单独开一份记录（不读 myFplot.f[3]），原因同 fplot_BufferByRep.js 里说的那条准则——
 * 这份数据的目的很单一：攒下来供导出、复现用，不想跟"图一要不要画这个点"的显示逻辑绑在一起。
 *
 * 用法：
 *   recordSample(contentStart, contentEnd, wallClock, bps) —— rate_measurement.js 里，
 *       真正下载成功（不是超时重试）时调用一次；一个分片（2秒）一个点，粗粒度
 *   recordFineSample(tickStartWallClock, tickEndWallClock, approxContentTime, bps) ——
 *       DASHttp.js 的 rateInProgress() 里，每个 xhr progress 事件之间调一次；
 *       同一个分片下载期间通常会有好几个 tick，比 recordSample 细得多——具体多细取决于
 *       浏览器实际触发 progress 事件的频率（跟网络状况、chunk 大小有关，不是固定值）
 *   plot() —— 每 0.1s 由 dash.js 的 updatePlaybackTime() 调一次
 *   exportTraceArray(bucketMs) —— 按 bucketMs 一格重采样成 bps 数组（默认 200ms，
 *       优先用 recordFineSample 攒的细粒度数据；没有的话退化到 recordSample 的粗粒度数据）。
 *       格式对齐 throughputTrace/thruputTraceFerry.js 里 `var trace = [...]`，可以直接存成
 *       新的 trace 文件，配合 server7.js 的 THROTTLE_ENABLED=true + TRACE_SAMPLE_INTERVAL_MS
 *       复现这次测到的真实网速（见 server7.js 里 TRACE_SAMPLE_INTERVAL_MS 的说明——
 *       用比 1000ms 更细的 bucketMs 导出时，server7.js 那个常量要改成一样的值才能对上）
 *   downloadTraceFile(filename, bucketMs) —— 把上面的数组存成一个 .js 文件触发浏览器下载
 */

function fPlotNetSpeed(_canvas, width, height)
{
	this.canvas = _canvas;
	this.width = width;
	this.height = height;
	this.graphwidth = width - 80;

	this.samples = [];     // {contentStart, contentEnd, wallClock, bps} —— 粗粒度，一分片一点
	this.fineSamples = []; // {wallClockStart, wallClockEnd, approxContentTime, bps} —— 细粒度，一个 progress tick 一点
	this.maxKeep = 20000;
}

fPlotNetSpeed.prototype.recordSample = function (contentStart, contentEnd, wallClock, bps)
{
	this.samples.push({
		contentStart: contentStart,
		contentEnd: contentEnd,
		wallClock: wallClock,
		bps: bps
	});
	if (this.samples.length > this.maxKeep) this.samples.shift();
};

fPlotNetSpeed.prototype.recordFineSample = function (wallClockStart, wallClockEnd, approxContentTime, bps)
{
	this.fineSamples.push({
		wallClockStart: wallClockStart,
		wallClockEnd: wallClockEnd,
		approxContentTime: approxContentTime,
		bps: bps
	});
	if (this.fineSamples.length > this.maxKeep) this.fineSamples.shift();
};

fPlotNetSpeed.prototype.plot = function ()
{
	var canvas = this.canvas;
	canvas.setTransform(1, 0, 0, 1, 0, 0);
	canvas.clearRect(0, 0, this.width, this.height);

	var leftMargin = 50;
	var plotTop = 10;
	var plotBottom = this.height - 60;
	var plotHeight = plotBottom - plotTop;
	if (plotHeight < 10) plotHeight = 10;

	var maxContentTime = 0;
	var maxBps = 1000; // 兜底最小值（bps），避免刚开始几个样本时纵轴缩得太夸张
	for (var i = 0; i < this.samples.length; i++) {
		if (this.samples[i].contentEnd > maxContentTime) maxContentTime = this.samples[i].contentEnd;
		if (this.samples[i].bps > maxBps) maxBps = this.samples[i].bps;
	}
	for (var fi = 0; fi < this.fineSamples.length; fi++) {
		if (this.fineSamples[fi].approxContentTime > maxContentTime) maxContentTime = this.fineSamples[fi].approxContentTime;
		if (this.fineSamples[fi].bps > maxBps) maxBps = this.fineSamples[fi].bps;
	}
	maxBps = maxBps * 1.15;

	var xCut = 15;
	var steppingX = 2, maxX = 2 * xCut;
	for (var k = 1; k > 0; k++) {
		if (k * 2 * xCut > maxContentTime) { steppingX = 2 * k; maxX = 2 * k * xCut; break; }
	}

	canvas.strokeStyle = "rgba(0,0,0,0.7)";
	canvas.lineWidth = 0.8;
	canvas.strokeRect(leftMargin, plotTop, this.graphwidth, plotHeight);

	var unit = "(bps)";
	var yDivisor = 1;
	if (maxBps > 10 * 1024 * 1024) { unit = "(Mbps)"; yDivisor = 1024 * 1024; }
	else if (maxBps > 10 * 1024) { unit = "(Kbps)"; yDivisor = 1024; }

	canvas.save();
	canvas.translate(leftMargin, plotBottom);
	canvas.scale(1, -1);

	canvas.strokeStyle = "rgba(230,80,0,1)";
	canvas.fillStyle = "rgba(230,80,0,0.25)";
	canvas.setLineDash([]);
	for (var s = 0; s < this.samples.length; s++) {
		var seg = this.samples[s];
		var xStart = (seg.contentStart / maxX) * this.graphwidth;
		var xEnd = (seg.contentEnd / maxX) * this.graphwidth;
		var yVal = (seg.bps / maxBps) * plotHeight;

		canvas.beginPath();
		canvas.moveTo(xStart, 0);
		canvas.lineTo(xStart, yVal);
		canvas.lineTo(xEnd, yVal);
		canvas.lineTo(xEnd, 0);
		canvas.closePath();
		canvas.fill();
		canvas.stroke();
	}

	// 细粒度样本（xhr progress tick）叠一条细黑线在上面，能直观看出比橙色分片方块细多少格——
	// 一个分片方块里如果只有一两个黑点，说明这次浏览器 progress 事件触发得不够密，
	// 细粒度导出实际上跟粗粒度差不多，不是代码没生效。
	// 同一个分片（2秒）内的好几个 tick，approxContentTime 是同一个值（下载期间内容时间不变），
	// 这里按"同一分片内第几个 tick"把它们在 [contentStart, contentStart+2) 里等距摊开画，
	// 纯粹是为了这条线看着连续、方便肉眼判断密度——真正导出用的时间戳仍然是原始 wall clock，
	// 不受这个摊开影响。
	if (this.fineSamples.length > 0) {
		var tickCountByStart = {};
		var tickIndexByStart = {};
		for (var ci = 0; ci < this.fineSamples.length; ci++) {
			var key = this.fineSamples[ci].approxContentTime;
			tickCountByStart[key] = (tickCountByStart[key] || 0) + 1;
		}

		canvas.strokeStyle = "rgba(0,0,0,0.85)";
		canvas.setLineDash([]);
		canvas.beginPath();
		var moved = false;
		for (var fs2 = 0; fs2 < this.fineSamples.length; fs2++) {
			var fsmp = this.fineSamples[fs2];
			var key2 = fsmp.approxContentTime;
			var idx = tickIndexByStart[key2] || 0;
			tickIndexByStart[key2] = idx + 1;
			var spreadX = key2 + (idx / tickCountByStart[key2]) * 2;

			var fx = (spreadX / maxX) * this.graphwidth;
			var fy = (fsmp.bps / maxBps) * plotHeight;
			if (!moved) { canvas.moveTo(fx, fy); moved = true; }
			else canvas.lineTo(fx, fy);
		}
		canvas.stroke();
	}

	canvas.restore();

	canvas.fillStyle = 'rgba(0,0,0,1)';
	canvas.font = '10px sans-serif';
	canvas.textBaseline = 'top';
	for (var xn = 0; xn <= maxX / steppingX; xn++) {
		var tx = leftMargin + ((xn * steppingX) / maxX) * this.graphwidth;
		canvas.fillText(xn * steppingX, tx - 8, plotBottom + 5);
	}
	for (var yn = 0; yn < 6; yn++) {
		var ty = plotBottom - ((yn / 5) * plotHeight);
		canvas.fillText(((maxBps * yn / 5) / yDivisor).toFixed(1), 8, ty - 4);
	}

	canvas.font = '13px sans-serif';
	canvas.fillText("Content Time (Sec)", this.width - 150, plotBottom + 22);
	canvas.fillStyle = "rgba(230,80,0,1)";
	canvas.fillText("Real Measured Network Speed " + unit + " (orange=per-segment avg, black=per-progress-tick)", leftMargin, plotBottom + 22);
};

// 按 bucketMs 一格（wall clock，不是内容时间——跟 server7.js 的 dataResponse() 用同一种
// 时间基准，见该文件 TRACE_SAMPLE_INTERVAL_MS 的说明，两边才能真正对上）重采样成 bps 数组。
// 优先用 recordFineSample() 攒的细粒度数据；一次都没记到（比如 progress 事件真的没触发过）
// 就退化用 recordSample() 的粗粒度数据。没有任何样本覆盖到的格子就沿用前一格的值兜底，
// 避免 trace 里出现 undefined/0 把 server7.js 的限速逻辑带偏（0 bps 会让它算出的
// delayInterval 除零）。
// 返回 {trace, bucketMs, source, epochWallClock}——epochWallClock 是这批采样第一个点的
// 墙钟时间，约等于 server7.js 里 segStartTime（同机器上，网络往返 + 排队通常只差几毫秒），
// 供以后做 delay sweep 复现实验时对齐两边时钟用。
fPlotNetSpeed.prototype.exportTraceArray = function (bucketMs)
{
	var useFine = this.fineSamples.length > 0;
	var src = useFine ? this.fineSamples : this.samples;
	if (src.length === 0) return { trace: [], bucketMs: bucketMs || 1000, source: "none", epochWallClock: null };

	if (!bucketMs) bucketMs = useFine ? 200 : 1000; // 没细粒度数据时，粗粒度本来就是 2 秒一个点，桶太细没意义，退回 1 秒一档

	var epoch = useFine ? this.fineSamples[0].wallClockStart : this.samples[0].wallClock;
	var maxWallClock = epoch;
	for (var i = 0; i < src.length; i++) {
		var endT = useFine ? src[i].wallClockEnd : src[i].wallClock;
		if (endT > maxWallClock) maxWallClock = endT;
	}

	var totalBuckets = Math.max(1, Math.ceil((maxWallClock - epoch) / bucketMs));
	var trace = new Array(totalBuckets);

	for (var b = 0; b < totalBuckets; b++) {
		var bucketWallClock = epoch + b * bucketMs;
		var covering = null;
		for (var j = src.length - 1; j >= 0; j--) {
			var s = src[j];
			// 粗粒度样本没有单独记录"这次下载什么时候开始"，只有结束时间，
			// 用"结束时间往前推 2 秒（分片时长）"近似当作开始时间
			var startT = useFine ? s.wallClockStart : (s.wallClock - 2000);
			var endT2 = useFine ? s.wallClockEnd : s.wallClock;
			if (bucketWallClock >= startT && bucketWallClock < endT2) { covering = s; break; }
		}
		if (covering) {
			trace[b] = Math.round(covering.bps);
		} else {
			trace[b] = b > 0 ? trace[b - 1] : 0;
		}
	}

	return { trace: trace, bucketMs: bucketMs, source: useFine ? "fineSamples(progress-tick)" : "coarseSamples(per-segment)", epochWallClock: epoch };
};

fPlotNetSpeed.prototype.exportTraceJSText = function (bucketMs)
{
	var result = this.exportTraceArray(bucketMs);
	var lines = result.trace.map(function (v) { return v + "\t,"; });
	return "// 20260826 由 dashtest_2sDASH_1080p-public-access.html 的 \"Export Network Trace\" 按钮导出\n" +
		"// 实测网速，每格 " + result.bucketMs + "ms，单位 bps，数据来源：" + result.source + "\n" +
		"// 复现时，把 server7.js 里的 TRACE_SAMPLE_INTERVAL_MS 改成跟下面 traceIntervalMs 一样的值，\n" +
		"// 才能让 server7.js 按跟这次实测同样的时间粒度回放\n" +
		"var traceIntervalMs = " + result.bucketMs + ";\n" +
		"var traceEpochWallClock = " + result.epochWallClock + "; // 供跟 __dashTestEpoch / server7 日志时间戳对齐用，见 snapshots_FORMAT.md\n" +
		"var trace = [\n" + lines.join("\n") + "\n];\n\n" +
		// server7.js 是靠 require('./throughputTrace/xxx.js') 拿这个数组的，require() 只认
		// module.exports——没有这一行的话，server7.js 拿到的会是个空对象 {}，不报错但完全不限速
		// （thruputTraceFerry.js 末尾也是这么导出的，照抄格式）
		"module.exports = trace;\n";
};

// 触发浏览器把导出的 trace 文本存成本地文件，存下来以后拷到 throughputTrace/ 目录，
// 改 server7.js 里的 require 路径、TRACE_SAMPLE_INTERVAL_MS、打开 THROTTLE_ENABLED，
// 就能拿这次测到的真实网速复现
fPlotNetSpeed.prototype.downloadTraceFile = function (filename, bucketMs)
{
	var text = this.exportTraceJSText(bucketMs);
	console.log(text); // 顺手打到 console，方便直接复制，不想下载文件也能用

	var blob = new Blob([text], { type: "application/javascript" });
	var url = URL.createObjectURL(blob);
	var a = document.createElement("a");
	a.href = url;
	a.download = filename || ("netSpeedTrace_" + Date.now() + ".js");
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
};
