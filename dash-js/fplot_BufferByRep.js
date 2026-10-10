/*
 * fplot_BufferByRep.js
 * 20260826 新增
 *
 * 第四张图：当前时刻"还没播过"的 buffer 里，按码率档位分开的堆积面积图。
 *
 * 背景：第一张图（fplot_partial.js）的蓝线（Representation Rate）身兼两职——既画瞬时
 * 决策，横坐标又是会被 isac.js 的 confirmRecovery() 故意倒回的 curSegment*2，
 * 关掉 doppler_detected 时旧线不会消失，看起来像串线（根因见 confirmRecovery() 里的注释）。
 * 这张图专门只做一件事：告诉你"现在手里囤的这些秒数的 buffer，分别是哪个码率抓的"，
 * 不跟任何决策指针共用同一个可能倒退的横坐标——历史点一旦记录下来就不再改动。
 *
 * 数据来源刻意不复用 dashTelemetry.segments：那边的 recordSegmentDecision() 里，
 * representationId 记的其实是"这次决策之后、下一个分片将采用的档位"，而 contentStart
 * 用的却是"刚下载完这个分片"的内容时间——两者错开一个分片（2秒），在真正切换码率的
 * 那一刻会把标签打错。这张图改成直接在 DASHttp.js 里、_fetch_segment_for_buffer 的
 * onload 里、switchRepresentation() 被调用之前 记录"这个分片是用哪个 representationID
 * 抓的"（那个时间点上 adaptation.representationID 还没被这次调用重新赋值，肯定是对的），
 * 从根上避免同样的错位，也符合"一个值只服务一个目的"这条你自己提的准则。
 *
 * 用法：
 *   recordFetchedSegment(contentStart, contentEnd, representationId)
 *       —— 每次一个分片真正下载完、push 进 buffer 时调用一次（DASHttp.js）
 *   markDiscarded(rangeStart, rangeEnd)
 *       —— confirmRecovery() 丢弃一段还没播出来的旧低清分片时调用（isac.js），
 *          让这些从没真正进过播放器的分片不再计入"剩余 buffer"
 *   plot(currentContentTime)
 *       —— 每 0.1s 由 dash.js 的 updatePlaybackTime() 调一次
 */

function fPlotBufferByRep(_canvas, width, height, repLadder)
{
	this.canvas = _canvas;
	this.width = width;
	this.height = height;
	this.graphwidth = width - 80;

	// repLadder：调用方传入，要求已经按 bandwidth 从高到低排好序——
	// repLadder[0] 是最高码率（堆叠在最下面），repLadder[repLadder.length-1] 是最低码率（堆在最上面）。
	this.repLadder = repLadder || [];
	this.rankById = {};
	for (var i = 0; i < this.repLadder.length; i++) {
		this.rankById[this.repLadder[i].id] = i;
	}

	this.segments = [];   // {contentStart, contentEnd, representationId, discarded}
	this.history = [];    // {t, byRank: [seconds...]}，rank 顺序同 repLadder
	this.lastSampledT = -1;
	this.maxKeep = 20000; // 防止长时间播放把内存占满，同 telemetry.js 的做法
}

fPlotBufferByRep.prototype.recordFetchedSegment = function (contentStart, contentEnd, representationId)
{
	this.segments.push({
		contentStart: contentStart,
		contentEnd: contentEnd,
		representationId: representationId,
		discarded: false
	});
	if (this.segments.length > this.maxKeep) this.segments.shift();
};

fPlotBufferByRep.prototype.markDiscarded = function (rangeStart, rangeEnd)
{
	for (var i = this.segments.length - 1; i >= 0; i--) {
		var s = this.segments[i];
		if (!s.discarded && s.contentStart >= rangeStart && s.contentStart < rangeEnd) {
			s.discarded = true;
		}
	}
};

// 算出"现在这一刻"，每个档位还剩多少秒没播——已经播过的部分（contentEnd <= currentTime）
// 和整段都在 currentTime 之前的自然被排除；跨在 currentTime 上的分片只算还没播的那一截。
fPlotBufferByRep.prototype._snapshot = function (currentTime)
{
	var seconds = new Array(this.repLadder.length);
	for (var r = 0; r < seconds.length; r++) seconds[r] = 0;

	for (var i = 0; i < this.segments.length; i++) {
		var s = this.segments[i];
		if (s.discarded) continue;
		if (s.contentEnd <= currentTime) continue;

		var rank = this.rankById[s.representationId];
		if (rank === undefined) continue;

		var clippedStart = Math.max(s.contentStart, currentTime);
		var len = s.contentEnd - clippedStart;
		if (len > 0) seconds[rank] += len;
	}

	return seconds;
};

fPlotBufferByRep.prototype.plot = function (currentContentTime)
{
	if (typeof currentContentTime !== 'number') return;

	// 采样节流：内容时间没有明显前进（比如暂停/还没开始播）就不重复记点，
	// 避免 history 里堆一堆完全一样的水平点
	if (this.history.length === 0 || currentContentTime > this.lastSampledT + 0.05) {
		this.history.push({ t: currentContentTime, byRank: this._snapshot(currentContentTime) });
		this.lastSampledT = currentContentTime;
		if (this.history.length > this.maxKeep) this.history.shift();
	}

	this._draw(currentContentTime);
};

fPlotBufferByRep.prototype._colorForRank = function (rank, total)
{
	// rank 0（最高码率，堆叠最下面）用暖色，往上码率越低、色相往冷色转，
	// 这样"最下面一层是不是最高码率"一眼就能对上颜色规律
	var hue = total > 1 ? Math.round((rank / (total - 1)) * 260) : 0;
	return "hsla(" + hue + ",70%,50%,0.85)";
};

fPlotBufferByRep.prototype._draw = function (currentContentTime)
{
	var canvas = this.canvas;
	canvas.setTransform(1, 0, 0, 1, 0, 0);
	canvas.clearRect(0, 0, this.width, this.height);

	var leftMargin = 50;
	var plotTop = 10;
	var plotBottom = this.height - 90;
	var plotHeight = plotBottom - plotTop;
	if (plotHeight < 10) plotHeight = 10;

	// ---- 横轴范围：跟第三张图（fplot_ShadowRate.js）同样的取整刻度算法 ----
	var xCut = 15;
	var steppingX = 2, maxX = 2 * xCut;
	for (var k = 1; k > 0; k++) {
		if (k * 2 * xCut > currentContentTime) { steppingX = 2 * k; maxX = 2 * k * xCut; break; }
	}

	// ---- 纵轴范围：按 history 里出现过的最大堆叠总秒数定，留 15% 余量 ----
	var maxY = 10; // 兜底最小值
	for (var i = 0; i < this.history.length; i++) {
		var total = 0;
		var br = this.history[i].byRank;
		for (var r = 0; r < br.length; r++) total += br[r];
		if (total > maxY) maxY = total;
	}
	maxY = maxY * 1.15;

	canvas.strokeStyle = "rgba(0,0,0,0.7)";
	canvas.lineWidth = 0.8;
	canvas.strokeRect(leftMargin, plotTop, this.graphwidth, plotHeight);

	if (this.history.length > 1 && this.repLadder.length > 0) {
		canvas.save();
		canvas.translate(leftMargin, plotBottom);
		canvas.scale(1, -1); // y 轴朝上，跟其它图的画法保持一致

		// 逐层画堆叠面积：每一层的下边界是前面所有层的累加高度，上边界是再加上这一层的高度
		var n = this.history.length;
		var cumPrev = new Array(n).fill(0);
		for (var rank = 0; rank < this.repLadder.length; rank++) {
			var cumCur = new Array(n);
			canvas.beginPath();
			for (var p = 0; p < n; p++) {
				var x = (this.history[p].t / maxX) * this.graphwidth;
				var yBottom = (cumPrev[p] / maxY) * plotHeight;
				if (p === 0) canvas.moveTo(x, yBottom); else canvas.lineTo(x, yBottom);
			}
			for (var p2 = n - 1; p2 >= 0; p2--) {
				cumCur[p2] = cumPrev[p2] + this.history[p2].byRank[rank];
				var x2 = (this.history[p2].t / maxX) * this.graphwidth;
				var yTop = (cumCur[p2] / maxY) * plotHeight;
				canvas.lineTo(x2, yTop);
			}
			canvas.closePath();
			canvas.fillStyle = this._colorForRank(rank, this.repLadder.length);
			canvas.fill();

			cumPrev = cumCur;
		}

		// 当前时间竖线
		canvas.strokeStyle = "rgba(0,0,0,1)";
		canvas.beginPath();
		var barX = (currentContentTime / maxX) * this.graphwidth;
		canvas.moveTo(barX, 0);
		canvas.lineTo(barX, plotHeight);
		canvas.stroke();
		canvas.closePath();

		canvas.restore();
	}

	// ---- 坐标轴刻度 ----
	canvas.fillStyle = 'rgba(0,0,0,1)';
	canvas.font = '10px sans-serif';
	canvas.textBaseline = 'top';
	for (var xn = 0; xn <= maxX / steppingX; xn++) {
		var tx = leftMargin + ((xn * steppingX) / maxX) * this.graphwidth;
		canvas.fillText(xn * steppingX, tx - 8, plotBottom + 5);
	}
	var maxYdraw = maxY, yUnit = "(Sec)";
	for (var yn = 0; yn < 6; yn++) {
		var ty = plotBottom - ((yn / 5) * plotHeight);
		canvas.fillText((maxYdraw * yn / 5).toFixed(1), 12, ty - 4);
	}

	canvas.font = '13px sans-serif';
	canvas.fillStyle = 'rgba(0,0,0,1)';
	canvas.fillText("Content Time (Sec)", this.width - 150, plotBottom + 22);
	canvas.fillText("Buffered " + yUnit + " by representation (highest bitrate = bottom layer)", leftMargin, plotBottom + 40);

	// ---- 图例：每个档位一个色块 + 标称码率 ----
	var legendX = leftMargin;
	var legendY = plotBottom + 58;
	canvas.font = '11px sans-serif';
	for (var li = 0; li < this.repLadder.length; li++) {
		var label = Math.round(this.repLadder[li].bandwidth / 1024) + "k";
		var boxColor = this._colorForRank(li, this.repLadder.length);
		if (legendX + 46 > this.width - 10) { legendX = leftMargin; legendY += 14; }
		canvas.fillStyle = boxColor;
		canvas.fillRect(legendX, legendY, 10, 10);
		canvas.fillStyle = 'rgba(0,0,0,1)';
		canvas.fillText(label, legendX + 13, legendY);
		legendX += 46;
	}
};
