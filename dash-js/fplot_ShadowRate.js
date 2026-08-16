/*
 * fplot_ShadowRate.js
 * 20260817 新增
 *
 * 第三张图：解决第一张图（fplot_partial.js）蓝线看不清的问题——那张图上，
 * 只要 ISAC shadowing 一开一关，confirmRecovery() 就会丢弃一段还没播过的低清分片、
 * 改抓同一段内容的高清版本，同一个内容时间点上就会有"旧的低清决策"和"新的高清决策"
 * 两个点叠在一起，从图上完全看不出"最终到底播的是哪个"。
 *
 * 这张图只画 dashTelemetry.segments 里 superseded=false 的记录——也就是"最终真正会被
 * 播放的那个决策"，不会再有叠线问题。横轴是视频内容时间点（跟第一张图一致），
 * 纵轴是选中的标称码率（Kbps）。图的上方多了一条状态带，用颜色分段表示当时
 * isac 处于 normal / shadowing / recovering（待确认恢复）中的哪个状态——
 * 直接对着看就知道"这一段码率是在链路正常/预警/等确认哪个状态下决定的"。
 *
 * 数据不是靠 observer 推过来的，而是每次 plot() 时直接去读 dashTelemetry 的当前内容——
 * 这样这张图和 telemetry.js 之间只有"读数据"这一个依赖方向，不需要额外接一套 observer。
 * 刷新由 dash.js 的 updatePlaybackTime()（每 0.1s 一次）驱动，见该文件。
 */

function fPlotShadow(_canvas, width, height)
{
	this.canvas = _canvas;
	this.width = width;
	this.height = height;
	this.graphwidth = width - 80;
	this.bandHeight = 24; // 顶部 ISAC 状态带的高度（像素）
}

fPlotShadow.prototype.plot = function ()
{
	var canvas = this.canvas;
	canvas.setTransform(1, 0, 0, 1, 0, 0);
	canvas.clearRect(0, 0, this.width, this.height);

	if (typeof dashTelemetry === 'undefined') return;

	var segments = dashTelemetry.segments.filter(function (s) { return !s.superseded; });
	var isacEvents = dashTelemetry.isacEvents;
	var playbackSamples = dashTelemetry.playbackSamples;

	var currentTime = 0;
	if (playbackSamples.length > 0) {
		currentTime = playbackSamples[playbackSamples.length - 1].contentTime || 0;
	}

	// ---- 横轴范围：取"当前播放时间"和"已知分片里最靠后的内容时间点"里较大的那个 ----
	var maxContentTime = currentTime;
	for (var i = 0; i < segments.length; i++) {
		if (typeof segments[i].contentEnd === 'number' && segments[i].contentEnd > maxContentTime) {
			maxContentTime = segments[i].contentEnd;
		}
	}
	var xCut = 15; // 横轴大致分成这么多格
	var steppingX = 2, maxX = 2 * xCut;
	for (var k = 1; k > 0; k++) {
		if (k * 2 * xCut > maxContentTime) { steppingX = 2 * k; maxX = 2 * k * xCut; break; }
	}

	// ---- 纵轴范围：按已知分片里最大的标称码率定，留 15% 余量 ----
	var maxY = 300; // kbps，兜底最小值，避免刚打开页面时图缩得太夸张
	for (var j = 0; j < segments.length; j++) {
		if (typeof segments[j].bandwidthNominal !== 'number') continue;
		var kbps = segments[j].bandwidthNominal / 1024;
		if (kbps > maxY) maxY = kbps;
	}
	maxY = maxY * 1.15;

	var leftMargin = 50;
	var bandTop = 8;
	var plotTop = bandTop + this.bandHeight + 26;
	var plotBottom = this.height - 90;
	var plotHeight = plotBottom - plotTop;
	if (plotHeight < 10) plotHeight = 10; // 兜底，避免 canvas 太矮时算出负数

	// ==== 1. 顶部 ISAC 状态带：normal 灰 / shadowing 橙 / recovering(待确认恢复) 黄 ====
	// isacEvents 记的是"事件发生时的 wall-clock 时刻"，不是内容时间点——这里通过
	// playbackSamples（同样按 wall-clock 记录了当时播到内容时间点几秒）近似换算过去。
	function contentTimeAtWallClock(wallClock) {
		if (playbackSamples.length === 0) return 0;
		for (var idx = playbackSamples.length - 1; idx >= 0; idx--) {
			if (playbackSamples[idx].wallClock <= wallClock) return playbackSamples[idx].contentTime;
		}
		return playbackSamples[0].contentTime;
	}

	var bandColors = {
		normal: "rgba(170,170,170,0.65)",
		shadowing: "rgba(255,140,0,0.85)",
		recovering: "rgba(255,215,0,0.85)"
	};

	canvas.strokeStyle = "rgba(0,0,0,0.6)";
	canvas.lineWidth = 0.8;
	canvas.strokeRect(leftMargin, bandTop, this.graphwidth, this.bandHeight);

	var lastX = leftMargin, lastColor = bandColors.normal;
	for (var e = 0; e < isacEvents.length; e++) {
		var ev = isacEvents[e];
		var evContentTime = contentTimeAtWallClock(ev.wallClock);
		var evX = leftMargin + (evContentTime / maxX) * this.graphwidth;
		if (evX > lastX) {
			canvas.fillStyle = lastColor;
			canvas.fillRect(lastX, bandTop, evX - lastX, this.bandHeight);
		}
		lastX = evX;
		lastColor = ev.recovering ? bandColors.recovering : (bandColors[ev.toMode] || bandColors.normal);
	}
	var curBandX = leftMargin + (currentTime / maxX) * this.graphwidth;
	if (curBandX > lastX) {
		canvas.fillStyle = lastColor;
		canvas.fillRect(lastX, bandTop, curBandX - lastX, this.bandHeight);
	}

	canvas.fillStyle = 'rgba(0,0,0,0.9)';
	canvas.font = '11px sans-serif';
	canvas.textBaseline = 'middle';
	canvas.fillText("ISAC state", 2, bandTop + this.bandHeight / 2);

	canvas.textBaseline = 'top';
	canvas.font = '11px sans-serif';
	canvas.fillStyle = 'rgba(120,120,120,1)';
	canvas.fillText("gray=normal", leftMargin, bandTop + this.bandHeight + 3);
	canvas.fillStyle = 'rgba(230,120,0,1)';
	canvas.fillText("orange=shadowing", leftMargin + 90, bandTop + this.bandHeight + 3);
	canvas.fillStyle = 'rgba(200,170,0,1)';
	canvas.fillText("yellow=recovering(待确认)", leftMargin + 220, bandTop + this.bandHeight + 3);

	// ==== 2. 主图：最终选中码率的阶梯线（蓝），只用 superseded=false 的记录 ====
	canvas.strokeStyle = "rgba(0,0,0,0.7)";
	canvas.lineWidth = 0.8;
	canvas.strokeRect(leftMargin, plotTop, this.graphwidth, plotHeight);

	canvas.save();
	canvas.translate(leftMargin, plotBottom);
	canvas.scale(1, -1); // y 轴朝上，跟第一/第二张图的画法保持一致

	canvas.strokeStyle = "rgba(0,0,255,1)";
	canvas.setLineDash([]);
	canvas.beginPath();
	var moved = false;
	for (var s = 0; s < segments.length; s++) {
		var seg = segments[s];
		if (typeof seg.contentStart !== 'number' || typeof seg.contentEnd !== 'number' || typeof seg.bandwidthNominal !== 'number') continue;
		var xStart = (seg.contentStart / maxX) * this.graphwidth;
		var xEnd = (seg.contentEnd / maxX) * this.graphwidth;
		var yVal = ((seg.bandwidthNominal / 1024) / maxY) * plotHeight;
		if (!moved) { canvas.moveTo(xStart, yVal); moved = true; }
		canvas.lineTo(xStart, yVal);
		canvas.lineTo(xEnd, yVal);
	}
	canvas.stroke();
	canvas.closePath();

	// 当前播放位置竖线（黑）
	canvas.strokeStyle = "rgba(0,0,0,1)";
	canvas.beginPath();
	var barX = (currentTime / maxX) * this.graphwidth;
	canvas.moveTo(barX, 0);
	canvas.lineTo(barX, plotHeight);
	canvas.stroke();
	canvas.closePath();

	canvas.restore();

	// ==== 3. 坐标轴刻度和文字 ====
	canvas.fillStyle = 'rgba(0,0,0,1)';
	canvas.font = '10px sans-serif';
	canvas.textBaseline = 'top';
	for (var n = 0; n <= maxX / steppingX; n++) {
		var tx = leftMargin + ((n * steppingX) / maxX) * this.graphwidth;
		canvas.fillText(n * steppingX, tx - 8, plotBottom + 5);
	}

	canvas.font = '13px sans-serif';
	canvas.fillStyle = 'rgba(0,0,0,1)';
	canvas.fillText("Content Time (Sec)", this.width - 150, plotBottom + 22);
	canvas.fillStyle = '#0000ff';
	canvas.fillText("Final Selected Bitrate (Kbps)", leftMargin, plotBottom + 22);
};
