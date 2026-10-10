/*
 * dopplerView.js
 * 20261003 新增
 *
 * 网页上的第六张图：实时多普勒瀑布图（跟 RealtimeISAC 的 matplotlib 窗口同款），数据来自
 * isac_bridge.py 通过 WebSocket 推过来的 {"type":"doppler_spec"} 消息（约 25 列/秒）：
 *
 *   {"type":"doppler_spec", "ts": <server ms>, "db": <base64 uint8[256]>,
 *    "ridge": <Hz>, "hit": 0|1, "v": 0|1, "E": <int>}
 *
 *   db     256 个多普勒 bin（fftshift 后，-500..+496 Hz，步长 3.9 Hz）的功率(dB)，线性量化成 uint8：
 *          dB = dbMin + q * (dbMax - dbMin) / 255，dbMin/dbMax 来自 {"type":"doppler_meta"}（默认 -90/+50）
 *   ridge  DC 脊宽(Hz)；hit = 这一步脊宽是否超过阈值（逐步、不去抖）；
 *   v      判决 "doppler detected"（去抖/累积之后）；E = 判决用的证据量
 *   ts     这一列所在时刻（Ubuntu 时钟，ms）= 它 200 ms 分析窗的**末端**，窗口中心约在 ts-100 ms。
 *
 * 图上画的东西（全英文，要进论文）：
 *   顶部两条带：ISAC interface 开(绿)/关(灰)；Doppler verdict（红=检测到）
 *   频谱图：红色虚线 = 判决变为 doppler detected，黑色虚线 = 恢复 normal（带白描边）
 *   下方曲线：DC 脊宽 + 阈值线 + 判决阴影
 *
 * 全部历史（最多 MAXCOLS 列 ≈ 60 分钟）保留在内存里，snapshotExport.js 会通过
 * dopplerView.exportSpectrogram() 把它打包进快照 JSON；格式见 snapshots_FORMAT.md。
 * 时间轴一律用 server time（ts），不用浏览器时间——这样两条数据流之间的偏移不会混进图里。
 */

var dopplerView = (function () {

	var NF = 256;
	var MAXCOLS = 90000;          // 25 列/秒 * 3600 s = 60 分钟（约 23 MB 内存；快照 JSON 里 base64 后约 31 MB）
	var TRIM_CHUNK = 1000;
	var WINDOW_SEC = 30;

	var cols = [];                // Uint8Array(256) 每列
	var tS = [];                  // server time ms
	var ridge = [], hit = [], verdict = [], score = [];
	var meta = { ridge_thresh_hz: 90, db_min: -90, db_max: 50, col_rate_hz: 25 };
	var lastRecvBrowser = 0;

	// 视频暂停时冻结显示（数据照常收、照常存；只是图不再往前滚），见 attachVideo()
	var videoEl = null, hasPlayed = false, frozenEnd = null;

	var canvas = null, ctx = null;
	var off = null, offCtx = null;
	var lutLo = 40, lutHi = 160, lut = null, lutDirty = true, lastRangeAt = 0;

	// ---------- 数据入口 ----------
	function b64ToU8(b64) {
		var bin = atob(b64);
		var u = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
		return u;
	}

	function feed(msg) {
		if (!msg || typeof msg.db !== 'string' || typeof msg.ts !== 'number') return;
		var u;
		try { u = b64ToU8(msg.db); } catch (e) { return; }
		if (u.length !== NF) return;
		cols.push(u); tS.push(msg.ts);
		ridge.push(typeof msg.ridge === 'number' ? msg.ridge : NaN);
		hit.push(msg.hit ? 1 : 0); verdict.push(msg.v ? 1 : 0);
		score.push(typeof msg.E === 'number' ? msg.E : 0);
		lastRecvBrowser = Date.now();
		if (cols.length > MAXCOLS + TRIM_CHUNK) {
			cols.splice(0, TRIM_CHUNK); tS.splice(0, TRIM_CHUNK); ridge.splice(0, TRIM_CHUNK);
			hit.splice(0, TRIM_CHUNK); verdict.splice(0, TRIM_CHUNK); score.splice(0, TRIM_CHUNK);
		}
	}

	function setMeta(m) {
		if (!m) return;
		for (var k in m) meta[k] = m[k];
	}

	// ---------- 颜色表（经典 jet，跟 matplotlib 的 jet 几乎一致）----------
	function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
	function jet(x) {
		return [
			Math.round(255 * clamp01(1.5 - Math.abs(4 * x - 3))),
			Math.round(255 * clamp01(1.5 - Math.abs(4 * x - 2))),
			Math.round(255 * clamp01(1.5 - Math.abs(4 * x - 1)))
		];
	}
	function buildLut() {
		lut = new Uint8Array(256 * 3);
		for (var q = 0; q < 256; q++) {
			var x = clamp01((q - lutLo) / Math.max(1, lutHi - lutLo));
			var c = jet(x);
			lut[q * 3] = c[0]; lut[q * 3 + 1] = c[1]; lut[q * 3 + 2] = c[2];
		}
		lutDirty = false;
	}

	// 每 3 s 按可见窗口里的分位数调一次色标（5%..99%+余量），变化小于 3 个量化级(≈1.6 dB)不动
	function adaptRange(i0, i1) {
		var now = Date.now();
		if (now - lastRangeAt < 3000 || i1 - i0 < 8) return;
		lastRangeAt = now;
		var vals = [];
		for (var i = i0; i < i1; i += 7) {
			var c = cols[i];
			for (var f = 0; f < NF; f += 3) vals.push(c[f]);
		}
		vals.sort(function (a, b) { return a - b; });
		var lo = vals[Math.floor(vals.length * 0.05)];
		var hi = Math.min(255, vals[Math.floor(vals.length * 0.99)] + 4);
		if (Math.abs(lo - lutLo) > 3 || Math.abs(hi - lutHi) > 3) { lutLo = lo; lutHi = hi; lutDirty = true; }
	}

	function lowerBound(arr, x) {      // 第一个 >= x 的下标
		var lo = 0, hi = arr.length;
		while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
		return lo;
	}

	// ISAC interface 事件 -> [{t(server ms), enabled}]，按时间排序
	function interfaceTimeline() {
		var ev = (typeof dashTelemetry !== 'undefined') ? dashTelemetry.isacInterfaceEvents : [];
		var out = [];
		for (var i = 0; i < ev.length; i++) {
			var t = ev[i].serverTsEst;
			if (typeof t !== 'number' && typeof isacClock !== 'undefined') t = isacClock.toServerMs(ev[i].wallClock);
			if (typeof t !== 'number') t = ev[i].wallClock;      // 还没同步上时钟：同机时两者本来就差不多
			out.push({ t: t, enabled: !!ev[i].enabled });
		}
		out.sort(function (a, b) { return a.t - b.t; });
		return out;
	}

	// ---------- 绘图 ----------
	function attachVideo() {
		videoEl = document.querySelector('video');
		if (!videoEl) return;
		function rec(state) {
			if (typeof dashTelemetry !== 'undefined') {
				dashTelemetry.recordVideoState({ state: state, contentTime: videoEl.currentTime });
			}
		}
		videoEl.addEventListener('playing', function () { hasPlayed = true; frozenEnd = null; rec('playing'); });
		videoEl.addEventListener('pause', function () { if (!videoEl.ended) rec('paused'); });
		videoEl.addEventListener('ended', function () { rec('ended'); });
	}

	function init(canvasId) {
		var el = document.getElementById(canvasId);
		if (!el) return;
		attachVideo();
		canvas = el; ctx = el.getContext('2d');
		off = document.createElement('canvas');
		offCtx = off.getContext('2d');
		setInterval(draw, 100);
	}

	function halo(ctx2, x, y0, y1, color, dash) {
		ctx2.save();
		ctx2.setLineDash(dash);
		ctx2.strokeStyle = 'rgba(255,255,255,0.95)'; ctx2.lineWidth = 3.2;
		ctx2.beginPath(); ctx2.moveTo(x, y0); ctx2.lineTo(x, y1); ctx2.stroke();
		ctx2.strokeStyle = color; ctx2.lineWidth = 1.5;
		ctx2.beginPath(); ctx2.moveTo(x, y0); ctx2.lineTo(x, y1); ctx2.stroke();
		ctx2.restore();
	}

	function draw() {
		if (!ctx) return;
		var Wc = canvas.width, Hc = canvas.height;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, Wc, Hc);
		ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, Wc, Hc);

		var L = 70, R = 14;                   // 左右边距
		var plotW = Wc - L - R;
		var yTitle = 4;
		var yIf = 26, hIf = 10;               // ISAC interface 带
		var yVd = yIf + hIf + 3, hVd = 10;    // verdict 带
		var yS = yVd + hVd + 8;               // 频谱图
		var hRidge = 90;
		var yAxis = Hc - 26;                  // 底部刻度文字
		var yR = yAxis - hRidge - 4;          // 脊宽曲线
		var hS = yR - yS - 10;

		// textAlign/textBaseline 在 canvas 上跨帧保留（setTransform 不重置它们），每帧开头必须显式设回
		ctx.textAlign = 'left';
		ctx.fillStyle = '#000'; ctx.font = 'bold 13px sans-serif'; ctx.textBaseline = 'top';
		ctx.fillText('Real-time Doppler spectrogram (cross-channel, server time)', L, yTitle);

		var n = cols.length;
		var ageMs = Date.now() - lastRecvBrowser;
		if (n < 2) {
			ctx.fillStyle = '#888'; ctx.font = '13px sans-serif';
			ctx.fillText('waiting for ISAC data (isac_bridge.py + rt_main.py --isac) ...', L, yS + 20);
			return;
		}

		// 视频播放过之后又被暂停：把图的右端钉在暂停那一刻的最新一列，不再往前滚
		var vPaused = !!(videoEl && hasPlayed && (videoEl.paused || videoEl.ended));
		if (vPaused && frozenEnd === null) frozenEnd = tS[n - 1];
		if (!vPaused) frozenEnd = null;
		var tEnd = (frozenEnd !== null) ? frozenEnd : tS[n - 1], tStart = tEnd - WINDOW_SEC * 1000;
		// 冻结时后面的绘制（折线、翻转虚线、状态文字、色标自适应）也只能看到冻结时刻以前的列，
		// 否则后到的数据会从右边缘/文字里"漏"出来，图像还在变
		if (frozenEnd !== null) {
			var nVisible = lowerBound(tS, frozenEnd + 0.5);
			if (nVisible < n) n = nVisible;
		}
		var i0 = lowerBound(tS, tStart);
		var span = WINDOW_SEC * 1000;
		function xOf(t) { return L + ((t - tStart) / span) * plotW; }

		// ---- 频谱：按像素列找最近的数据列，所以掉列/断流会留下空白而不是被拉伸 ----
		adaptRange(i0, n);
		if (lutDirty || !lut) buildLut();
		if (off.width !== plotW || off.height !== NF) { off.width = plotW; off.height = NF; }
		var img = offCtx.createImageData(plotW, NF);
		var d = img.data, ptr = i0;
		for (var x = 0; x < plotW; x++) {
			var tx = tStart + ((x + 0.5) / plotW) * span;
			while (ptr + 1 < n && tS[ptr + 1] <= tx) ptr++;
			var ok = tS[ptr] <= tx && (tx - tS[ptr]) < 150;
			if (!ok) {                             // 无数据：深灰
				for (var y0 = 0; y0 < NF; y0++) { var o0 = (y0 * plotW + x) * 4; d[o0] = 16; d[o0 + 1] = 16; d[o0 + 2] = 24; d[o0 + 3] = 255; }
				continue;
			}
			var c = cols[ptr];
			for (var f = 0; f < NF; f++) {
				var row = NF - 1 - f;              // 频率向上增大
				var o = (row * plotW + x) * 4, q3 = c[f] * 3;
				d[o] = lut[q3]; d[o + 1] = lut[q3 + 1]; d[o + 2] = lut[q3 + 2]; d[o + 3] = 255;
			}
		}
		offCtx.putImageData(img, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(off, 0, 0, plotW, NF, L, yS, plotW, hS);
		ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8; ctx.strokeRect(L, yS, plotW, hS);

		// DC 保护带虚线（±dc_guard）
		var guard = meta.dc_guard_hz || 20;
		ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.7;
		[guard, -guard].forEach(function (fz) {
			var yy = yS + hS * (1 - (fz + 500) / 1000);
			ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + plotW, yy); ctx.stroke();
		});
		ctx.restore();

		// ---- 判决翻转：红虚线 = 进入 doppler detected，黑虚线 = 恢复 normal ----
		for (var i = Math.max(i0, 1); i < n; i++) {
			if (verdict[i] !== verdict[i - 1]) {
				var xv = xOf(tS[i]);
				var isOn = verdict[i] === 1;
				halo(ctx, xv, yS, yS + hS, isOn ? '#e00000' : '#000', [6, 4]);
				halo(ctx, xv, yR, yR + hRidge, isOn ? '#e00000' : '#000', [6, 4]);
			}
		}

		// ---- Doppler verdict 带 ----
		ctx.fillStyle = '#f2f2f2'; ctx.fillRect(L, yVd, plotW, hVd);
		ctx.fillStyle = 'rgba(214,38,40,0.95)';
		var runStart = -1;
		for (var j = i0; j <= n; j++) {
			var on = j < n && verdict[j] === 1;
			if (on && runStart < 0) runStart = j;
			if (!on && runStart >= 0) {
				var xa = xOf(tS[runStart]), xb = xOf(tS[Math.min(j, n - 1)]);
				ctx.fillRect(xa, yVd, Math.max(1, xb - xa), hVd);
				runStart = -1;
			}
		}
		ctx.strokeStyle = '#000'; ctx.lineWidth = 0.6; ctx.strokeRect(L, yVd, plotW, hVd);

		// ---- ISAC interface 带 ----
		ctx.fillStyle = '#f2f2f2'; ctx.fillRect(L, yIf, plotW, hIf);
		var tl = interfaceTimeline();
		var state = true, tPrev = tStart;               // 第一条事件之前按"开"处理
		var segs = [];
		for (var e = 0; e < tl.length; e++) {
			if (tl[e].t <= tStart) { state = tl[e].enabled; continue; }
			segs.push({ a: tPrev, b: Math.min(tl[e].t, tEnd), on: state });
			tPrev = tl[e].t; state = tl[e].enabled;
		}
		segs.push({ a: tPrev, b: tEnd, on: state });
		segs.forEach(function (sg) {
			if (sg.b <= sg.a) return;
			ctx.fillStyle = sg.on ? 'rgba(40,167,69,0.9)' : 'rgba(150,150,150,0.8)';
			ctx.fillRect(xOf(sg.a), yIf, xOf(sg.b) - xOf(sg.a), hIf);
		});
		ctx.strokeStyle = '#000'; ctx.lineWidth = 0.6; ctx.strokeRect(L, yIf, plotW, hIf);

		// ---- 脊宽曲线 ----
		ctx.fillStyle = '#fff'; ctx.fillRect(L, yR, plotW, hRidge);
		ctx.fillStyle = 'rgba(214,38,40,0.16)';
		runStart = -1;
		for (var k = i0; k <= n; k++) {
			var on2 = k < n && verdict[k] === 1;
			if (on2 && runStart < 0) runStart = k;
			if (!on2 && runStart >= 0) {
				var xa2 = xOf(tS[runStart]), xb2 = xOf(tS[Math.min(k, n - 1)]);
				ctx.fillRect(xa2, yR, Math.max(1, xb2 - xa2), hRidge);
				runStart = -1;
			}
		}
		var RMAX = 200;
		ctx.strokeStyle = '#4c3a8f'; ctx.lineWidth = 1;
		ctx.beginPath();
		var started = false;
		for (var m = i0; m < n; m++) {
			if (!isFinite(ridge[m])) continue;
			var xr = xOf(tS[m]), yr = yR + hRidge * (1 - Math.min(ridge[m], RMAX) / RMAX);
			if (!started) { ctx.moveTo(xr, yr); started = true; } else ctx.lineTo(xr, yr);
		}
		ctx.stroke();
		var thr = meta.ridge_thresh_hz;
		ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = '#000'; ctx.lineWidth = 0.9;
		var yt = yR + hRidge * (1 - thr / RMAX);
		ctx.beginPath(); ctx.moveTo(L, yt); ctx.lineTo(L + plotW, yt); ctx.stroke(); ctx.restore();
		ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8; ctx.strokeRect(L, yR, plotW, hRidge);

		// ---- 刻度和文字 ----
		ctx.fillStyle = '#000'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
		ctx.textAlign = 'right';
		ctx.fillText('ISAC interface', L - 4, yIf + hIf / 2);
		ctx.fillText('Verdict', L - 4, yVd + hVd / 2);
		[-400, -200, 0, 200, 400].forEach(function (fz) {
			var yy = yS + hS * (1 - (fz + 500) / 1000);
			ctx.fillText(String(fz), L - 4, yy);
		});
		ctx.save(); ctx.translate(14, yS + hS / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
		ctx.fillText('Doppler frequency (Hz)', 0, 0); ctx.restore();
		[0, 50, 100, 150, 200].forEach(function (r) {
			ctx.fillText(String(r), L - 4, yR + hRidge * (1 - r / RMAX));
		});
		ctx.save(); ctx.translate(14, yR + hRidge / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
		ctx.fillText('DC ridge (Hz)', 0, 0); ctx.restore();
		ctx.textAlign = 'center'; ctx.textBaseline = 'top';
		for (var s = 0; s <= WINDOW_SEC; s += 5) {
			var xs = L + (s / WINDOW_SEC) * plotW;
			ctx.fillText(String(s - WINDOW_SEC), xs, yAxis + 2);
		}
		ctx.textAlign = 'right'; ctx.fillText('Time (s, 0 = latest column)', L + plotW, yAxis + 13);

		// 图例：深色底 + 带白描边的红/黑短虚线样例（红黑线直接叠在 jet 上看不清，所以样例也带描边）
		ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(L + 3, yS + 3, 262, 16);
		function sample(x, color) {
			ctx.save(); ctx.setLineDash([5, 3]);
			ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3.2;
			ctx.beginPath(); ctx.moveTo(x, yS + 11); ctx.lineTo(x + 22, yS + 11); ctx.stroke();
			ctx.strokeStyle = color; ctx.lineWidth = 1.5;
			ctx.beginPath(); ctx.moveTo(x, yS + 11); ctx.lineTo(x + 22, yS + 11); ctx.stroke();
			ctx.restore();
		}
		sample(L + 8, '#e00000'); sample(L + 138, '#000');
		ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
		ctx.fillText('Doppler detected', L + 34, yS + 11);
		ctx.fillText('back to normal', L + 164, yS + 11);

		// 状态文字
		var det = verdict[n - 1] === 1;
		if (vPaused) {
			ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(L + plotW / 2 - 175, yS + hS - 30, 350, 22);
			ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.fillText('VIDEO PAUSED - display frozen (ISAC data still recorded)', L + plotW / 2, yS + hS - 19);
		}
		ctx.font = 'bold 11px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
		ctx.fillStyle = det ? '#ff7070' : '#ffffff';
		var info = (det ? 'DOPPLER DETECTED' : 'NORMAL') + '  ridge ' + (isFinite(ridge[n - 1]) ? ridge[n - 1].toFixed(0) : '-') + ' Hz  E ' + score[n - 1];
		ctx.fillText(info, L + plotW - 6, yS + 3);
		if (!vPaused && ageMs > 2000) {
			ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(L + plotW / 2 - 110, yS + hS / 2 - 12, 220, 24);
			ctx.fillStyle = '#ffb347'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
			ctx.fillText('no ISAC data for ' + (ageMs / 1000).toFixed(0) + ' s', L + plotW / 2, yS + hS / 2);
		}
	}

	// ---------- 导出（给 snapshotExport.js）----------
	function u8ToB64(u8) {
		var CH = 0x8000, parts = [];
		for (var i = 0; i < u8.length; i += CH) parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + CH)));
		return btoa(parts.join(''));
	}

	function exportSpectrogram() {
		var n = cols.length;
		var flat = new Uint8Array(n * NF);
		for (var i = 0; i < n; i++) flat.set(cols[i], i * NF);
		var freqs = [];
		for (var f = 0; f < NF; f++) freqs.push((f - NF / 2) * (1000.0 / NF));   // fftshift 后：-500 .. +496.09 Hz
		return {
			doc: "dbQ_base64 = base64 of uint8[nColumns*nBins], row-major (one column of 256 Doppler bins after another). " +
				"dB = dbMin + q*(dbMax-dbMin)/255. tServerMs = Ubuntu time (ms) of the END of each column's 200 ms window.",
			nColumns: n, nBins: NF,
			freqsHz: freqs,
			dbMin: meta.db_min, dbMax: meta.db_max,
			tServerMs: tS.slice(), ridgeHz: ridge.slice(), rawHit: hit.slice(),
			verdict: verdict.slice(), score: score.slice(),
			rtMeta: JSON.parse(JSON.stringify(meta)),
			dbQ_base64: u8ToB64(flat)
		};
	}

	function count() { return cols.length; }

	if (typeof window !== 'undefined') {
		window.addEventListener('load', function () { init('graph6'); });
	}

	return { feed: feed, setMeta: setMeta, exportSpectrogram: exportSpectrogram, count: count, draw: draw, init: init,
		_data: function () { return { tS: tS, verdict: verdict, ridge: ridge }; } };

})();

if (typeof window !== 'undefined') window.dopplerView = dopplerView;
