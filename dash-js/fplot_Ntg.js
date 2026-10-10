/*
 * fplot_Ntg.js
 * 20261009 新增
 *
 * 第 8/9/10 张图：NTG-2501 无线设备自己报的链路状态（跟 ntg2501_http_logger.py 同一个 xml_master_monitor.cgi 接口，
 * 一份 XML 里四个方向的值都有）。数据由 server7.js 后台轮询 Master(192.168.1.201)，网页每 500ms 取增量
 * （GET /api/ntg?since=...），所以浏览器不用跟 NTG 在同一网段，只要能连 server7.js。
 *
 *   graph8   無線伝送速度 [Mbps]：上り/下り，自适应调制后的 PHY 容量（QPSK=26）
 *   graph9   192.168.1.101(Slave) 的 受信レベル + 受信CNR，192.168.1.201(Master) 的 送信レベル
 *            —— 即下り(Master->Slave)方向。左轴 dBm（受信/送信 level + 虚线 Rx-CNR），右轴 CNR dB
 *   graph10  入力レート / 出力レート [Mbps]：上り/下り 四条线
 *
 * 横轴 = 距离本次页面加载(window.__dashTestEpoch)的秒数，用浏览器时钟；NTG 样本的时间戳是 server7.js 的
 * 时钟，用每次 /api/ntg 响应里的 now 估一个偏移（跟 server 同机时偏移≈0）换算。
 * 样本原始数据随 Save Full Snapshot 一起导出（snapshotExport.js 的 ntg 字段），server7.js 另外自己
 * 持续写 ntg2501_power_logger/logs/ntg_server7_*.csv。
 */

var ntgView = (function () {
	var samples = [];          // 原样保存 server 样本，另加 t = 距离 testEpoch 的秒数
	var lastTs = 0;
	var offsetMs = 0;          // browser = server + offsetMs
	var status = { enabled: true, error: null, lastOkBrowserMs: 0, masterIp: '192.168.1.201' };
	var epoch = (typeof window !== 'undefined' && window.__dashTestEpoch) ? window.__dashTestEpoch : Date.now();
	var KEEP = 40000;
	var epoch0;

	var COL = {
		up: '#1f77b4', down: '#d95f02', rx: '#1b9e77', tx: '#7570b3', cnr: '#e7298a', floor: '#888888',
		inUp: '#1f77b4', inDown: '#6baed6', outUp: '#d95f02', outDown: '#fdae6b'
	};

	// 20261009 修：之前 poll 每 500 ms 无条件发一次，断联/视频吞满链路时 /api/ntg 响应会拖过 500 ms，
	// 多个请求同时在飞，同一批样本被重复追加、顺序也乱（实测 3472 条里只有 985 个不同时间戳、70 次时间倒退），
	// 折线就在时间上来回折返 —— 这就是"上下来回跳"的主因。现在：同一时刻只允许一个请求在飞 + 按 ts 去重/保序。
	var inflight = false;
	function poll() {
		if (inflight) return;
		inflight = true;
		var t0 = Date.now();
		fetch('/api/ntg?since=' + lastTs, { cache: 'no-store' })
			.then(function (r) { return r.json(); })
			.then(function (j) {
				var t1 = Date.now();
				// 只有往返够快才用来估时钟偏移（慢响应的 (t0+t1)/2 不可信）
				if (t1 - t0 < 800) offsetMs = (t0 + t1) / 2 - j.now;
				status.enabled = j.enabled; status.error = j.error; status.masterIp = j.masterIp;
				for (var i = 0; i < j.samples.length; i++) {
					var s = j.samples[i];
					if (s.ts <= lastTs) continue;            // 已经有了（重复/乱序）
					s.t = (s.ts + offsetMs - epoch) / 1000;
					samples.push(s);
					lastTs = s.ts;
				}
				if (samples.length > KEEP) samples.splice(0, samples.length - KEEP);
				if (j.samples.length) status.lastOkBrowserMs = t1;
			})
			.catch(function (e) { status.error = 'server7.js 没响应: ' + e; })
			.then(function () { inflight = false; });
	}

	// ---- 20261009 改：防止"上下来回跳"（NTG 断联/恢复期间图本身在抖，不是只有数据在抖）----
	//  1) 横轴改成滑动窗口（默认最近 120 s，?ntgwin=秒 可改，0=全部），之前是整段历史、每次范围变大整张图重新压缩
	//  2) 纵轴固定量程（無線伝送速度 0-30、dBm -100~10、CNR 0-40），速率/功率图的量程"只涨不缩"并取整，
	//     不再随可见数据的 min/max 每帧变（断联时 Rx/CNR 没值，之前量程会瞬间缩放/放大）
	//  3) 断联期间（Master 不报 Rx/Tx/CNR，或样本间隔 >1.5 s）画红色底带，折线在这些段断开而不是乱连
	//  4) 入出力レート 做 1 s 滑动平均（原始值只有 0.1 Mbps 一档，在 0/0.1 之间来回跳），原始样本照常保存
	var WIN_SEC = (function () {
		try { var v = parseFloat(new URLSearchParams(window.location.search).get('ntgwin')); if (!isNaN(v) && v >= 0) return v; } catch (e) {}
		return 120;
	})();
	var ratchet = {};   // canvasId+axis -> [lo, hi]

	function niceStep(range, n) {
		var raw = range / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
		return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
	}

	function seriesPoints(sr, t0, t1) {
		var out = [];
		if (sr.points) {
			var P = sr.points();
			for (var j = 0; j < P.length; j++) if (P[j].t >= t0 - 1 && P[j].t <= t1 + 1) out.push(P[j]);
			return out;
		}
		for (var i = 0; i < samples.length; i++) {
			var s = samples[i];
			if (s.t < t0 - 1 || s.t > t1 + 1) continue;
			out.push({ t: s.t, v: sr.fn ? sr.fn(s) : s[sr.key] });
		}
		if (sr.smooth) {   // 滑动平均，窗口 sr.smooth 秒
			var res = [], lo = 0, sum = 0, cnt = 0;
			for (var k = 0; k < out.length; k++) {
				if (out[k].v !== null && out[k].v !== undefined) { sum += out[k].v; cnt++; }
				while (out[lo].t < out[k].t - sr.smooth) {
					if (out[lo].v !== null && out[lo].v !== undefined) { sum -= out[lo].v; cnt--; }
					lo++;
				}
				res.push({ t: out[k].t, v: (out[k].v === null || out[k].v === undefined || !cnt) ? null : sum / cnt });
			}
			return res;
		}
		return out;
	}

	// 断联段 [t_start, t_end]：rx_down 为空的连续样本，或相邻样本间隔 > 1.5 s
	function outageBands(t0, t1) {
		var bands = [], start = null, prev = null;
		for (var i = 0; i < samples.length; i++) {
			var s = samples[i];
			if (s.t < t0 - 30) { prev = s; continue; }
			var isNull = (s.rx_down === null || s.rx_down === undefined);
			if (prev && s.t - prev.t > 1.5 && start === null) bands.push([prev.t, s.t]);
			if (isNull && start === null) start = s.t;
			if (!isNull && start !== null) { bands.push([start, s.t]); start = null; }
			prev = s;
		}
		if (start !== null && prev) bands.push([start, Math.max(prev.t, start)]);
		bands.sort(function (a, b) { return a[0] - b[0]; });   // 合并重叠段，避免半透明叠成深红
		var merged = [];
		bands.forEach(function (bd) {
			if (merged.length && bd[0] <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], bd[1]);
			else merged.push([bd[0], bd[1]]);
		});
		return merged;
	}

	function pickRange(key, fixed, vals, ratchetOn) {
		if (fixed) return fixed;
		var lo = Infinity, hi = -Infinity;
		vals.forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; });
		var r = ratchet[key];
		if (lo !== Infinity) {
			var step = niceStep(Math.max(hi - lo, 1), 4);
			var nlo = (lo >= -1e-6 ? 0 : Math.floor((lo - step * 0.2) / step) * step), nhi = Math.ceil((hi + step * 0.2) / step) * step;
			if (!r) r = ratchet[key] = [nlo, nhi];
			else { if (nlo < r[0]) r[0] = nlo; if (nhi > r[1]) r[1] = nhi; }
		}
		return r || [0, 1];
	}

	// series: [{key|fn|points, color, dash, axis:'L'|'R', label, smooth}]
	// opts: {title, unitL, unitR, fixL, fixR, minL, step}
	function draw(canvasId, series, opts) {
		var cv = document.getElementById(canvasId);
		if (!cv) return;
		var ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, W, H);

		var left = 50, right = opts.unitR ? 50 : 20, top = 24, bottom = 80;
		var pw = W - left - right, ph = H - top - bottom;

		var tNow = 0;
		if (samples.length) tNow = samples[samples.length - 1].t;
		if (opts.tNow) tNow = Math.max(tNow, opts.tNow());
		var tMin, tMax;
		if (WIN_SEC > 0) { tMax = Math.max(WIN_SEC, Math.ceil(tNow / 5) * 5); tMin = tMax - WIN_SEC; }
		else { tMin = 0; tMax = Math.max(30, Math.ceil(tNow / 10) * 10); }
		var tStep = niceStep(tMax - tMin, 8);

		var pts = series.map(function (sr) { return seriesPoints(sr, tMin, tMax); });
		var vals = { L: [], R: [] };
		series.forEach(function (sr, i) {
			pts[i].forEach(function (p) { if (p.v !== null && p.v !== undefined && !isNaN(p.v)) vals[sr.axis].push(p.v); });
		});
		var yL = pickRange(canvasId + 'L', opts.fixL, vals.L), yR = opts.unitR ? pickRange(canvasId + 'R', opts.fixR, vals.R) : null;
		if (opts.minL !== undefined && !opts.fixL) yL = [Math.min(opts.minL, yL[0]), yL[1]];

		function X(t) { return left + ((t - tMin) / (tMax - tMin)) * pw; }
		function Y(v, ax) { var r = ax === 'R' ? yR : yL; return top + ph - ((v - r[0]) / (r[1] - r[0])) * ph; }

		// 断联底带（先画，在网格和折线下面）
		var bands = outageBands(tMin, tMax);
		ctx.fillStyle = 'rgba(220,40,40,0.13)';
		bands.forEach(function (bd) {
			var x0 = Math.max(left, X(bd[0])), x1 = Math.min(left + pw, X(bd[1]));
			if (x1 > x0) ctx.fillRect(x0, top, x1 - x0, ph);
		});

		ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 0.8;
		ctx.strokeRect(left, top, pw, ph);
		ctx.font = '10px sans-serif'; ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
		for (var t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) ctx.fillText(Math.round(t), X(t) - 8, top + ph + 5);
		var ls = niceStep(yL[1] - yL[0], 5);
		ctx.strokeStyle = 'rgba(0,0,0,0.1)';
		for (var yv = Math.ceil(yL[0] / ls) * ls; yv <= yL[1] + 1e-9; yv += ls) {
			ctx.beginPath(); ctx.moveTo(left, Y(yv, 'L')); ctx.lineTo(left + pw, Y(yv, 'L')); ctx.stroke();
			ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
			ctx.fillText(+yv.toFixed(2), 6, Y(yv, 'L'));
		}
		if (yR) {
			var rs = niceStep(yR[1] - yR[0], 5);
			ctx.fillStyle = COL.cnr;
			for (var rv = Math.ceil(yR[0] / rs) * rs; rv <= yR[1] + 1e-9; rv += rs) {
				ctx.fillText(+rv.toFixed(2), left + pw + 6, Y(rv, 'R'));
			}
		}

		ctx.save();
		ctx.beginPath(); ctx.rect(left, top, pw, ph); ctx.clip();
		series.forEach(function (sr, si) {
			ctx.strokeStyle = sr.color; ctx.lineWidth = sr.width || 1.5;
			ctx.setLineDash(sr.dash || []);
			ctx.beginPath();
			var pen = false, prevY = 0, P = pts[si];
			for (var i = 0; i < P.length; i++) {
				var v = P[i].v;
				if (v === null || v === undefined || isNaN(v)) { pen = false; continue; }
				var x = X(P[i].t), y = Y(Math.max(yL[0], Math.min(sr.axis === 'R' ? yR[1] : yL[1], v)), sr.axis);
				if (!pen) { ctx.moveTo(x, y); pen = true; }
				else { if (opts.step) ctx.lineTo(x, prevY); ctx.lineTo(x, y); }
				prevY = y;
			}
			ctx.stroke();
		});
		ctx.restore();
		ctx.setLineDash([]);

		ctx.textBaseline = 'top'; ctx.font = '13px sans-serif';
		ctx.fillStyle = '#000';
		ctx.fillText(opts.title, left, 4);
		ctx.font = '11px sans-serif';
		ctx.fillText(opts.unitL, 6, 6);
		ctx.textAlign = 'center'; ctx.fillText('Time since page load (s)' + (WIN_SEC > 0 ? ', last ' + WIN_SEC + ' s' : '') +
			(bands.length ? '   [red band = NTG link down / no data]' : ''), left + pw / 2, top + ph + 18); ctx.textAlign = 'left';
		var lx = left, ly = top + ph + 38;
		series.forEach(function (sr) {
			var lw = ctx.measureText(sr.label).width;
			if (lx + 32 + lw > W - 10 && lx > left) { lx = left; ly += 15; }
			ctx.strokeStyle = sr.color; ctx.lineWidth = 2; ctx.setLineDash(sr.dash || []);
			ctx.beginPath(); ctx.moveTo(lx, ly + 6); ctx.lineTo(lx + 22, ly + 6); ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = '#000'; ctx.fillText(sr.label, lx + 26, ly);
			lx += 32 + lw + 12;
		});
		if (yR) { ctx.fillStyle = COL.cnr; ctx.fillText(opts.unitR, W - right + 4, 6); }

		if (opts.needNtg !== false) {
			var age = Date.now() - status.lastOkBrowserMs;
			if (!samples.length || age > 3000) {
				ctx.fillStyle = 'rgba(200,0,0,0.9)'; ctx.font = '12px sans-serif';
				ctx.fillText('NO NTG DATA' + (status.error ? ' — ' + status.error : '') +
					(status.enabled === false ? ' (server7.js NTG_ENABLE=0)' : ' (Master ' + status.masterIp + ')'), left + 10, top + 6);
			}
		}
	}

	// reference / sensing channel 的功率（shadowInputs.js 里攒的历史，wallClock 是 Ubuntu 时钟）
	function shadowPoints(input, field) {
		var off = 0;
		try { var ci = isacClock.info(); if (ci && ci.ready) off = ci.offsetMs; } catch (e) {}
		return function () {
			var H = input.history, out = [];
			// 历史最多 2 万点，画图每 0.5 s 一次：只取窗口内、并按 ~0.1 s 抽稀，够用了
			var lastT = -1e9;
			for (var i = 0; i < H.length; i++) {
				var t = (H[i].wallClock + off - epoch) / 1000;
				if (t - lastT < 0.1) continue;
				lastT = t;
				out.push({ t: t, v: H[i][field] });
			}
			return out;
		};
	}
	function shadowTNow() {
		var h1 = dBFSShadowInput.history, h2 = powerShadowInput.history, off = 0, m = 0;
		try { var ci = isacClock.info(); if (ci && ci.ready) off = ci.offsetMs; } catch (e) {}
		if (h1.length) m = Math.max(m, (h1[h1.length - 1].wallClock + off - epoch) / 1000);
		if (h2.length) m = Math.max(m, (h2[h2.length - 1].wallClock + off - epoch) / 1000);
		return m;
	}

	function plot() {
		draw('graph8', [
			{ key: 'wr_up', color: COL.up, label: '上り(Slave→Master) 無線伝送速度', axis: 'L' },
			{ key: 'wr_down', color: COL.down, dash: [6, 3], label: '下り(Master→Slave) 無線伝送速度', axis: 'L' }
		], { title: '無線伝送速度 [Mbps]  (NTG-2501 PHY capacity)', unitL: 'Mbps', fixL: [0, 30], step: true });

		draw('graph9', [
			{ key: 'rx_down', color: COL.rx, label: '受信レベル 192.168.1.101 [dBm]', axis: 'L', width: 2 },
			{ key: 'tx_down', color: COL.tx, label: '送信レベル 192.168.1.201 [dBm]', axis: 'L', width: 2 },
			{ fn: function (s) { return (s.rx_down !== null && s.cnr_down !== null) ? s.rx_down - s.cnr_down : null; },
			  color: COL.floor, dash: [2, 3], label: '受信レベル−CNR (=noise floor 推定) [dBm]', axis: 'L', width: 1.2 },
			{ key: 'cnr_down', color: COL.cnr, label: '受信CNR 192.168.1.101 [dB] (右軸)', axis: 'R', width: 1.5 }
		], { title: 'Down link (201→101): 受信レベル / 送信レベル / 受信CNR', unitL: 'dBm', unitR: 'dB', fixL: [-100, 10], fixR: [0, 40] });

		draw('graph10', [
			{ key: 'in_up', color: COL.inUp, label: '入力 上り', axis: 'L', smooth: 1 },
			{ key: 'in_down', color: COL.inDown, label: '入力 下り', axis: 'L', smooth: 1 },
			{ key: 'out_up', color: COL.outUp, dash: [6, 3], label: '出力 上り', axis: 'L', smooth: 1 },
			{ key: 'out_down', color: COL.outDown, dash: [6, 3], label: '出力 下り', axis: 'L', smooth: 1 }
		], { title: '入力レート / 出力レート [Mbps]  (1 s moving average)', unitL: 'Mbps', minL: 0 });

		if (typeof dBFSShadowInput !== 'undefined' && typeof powerShadowInput !== 'undefined') {
			draw('graph11', [
				{ points: shadowPoints(dBFSShadowInput, 'dBFS'), color: '#2166ac', label: 'reference channel (上行) dBFS', axis: 'L' },
				{ points: shadowPoints(powerShadowInput, 'power'), color: '#b2182b', label: 'sensing channel (下行) power [dBFS]', axis: 'L' }
			], { title: 'USRP IQ energy: reference vs sensing channel [dBFS]', unitL: 'dBFS', tNow: shadowTNow, needNtg: false });
		}
	}

	function exportSamples() {
		return { masterIp: status.masterIp, offsetMs: offsetMs, testEpochWallClock: epoch, samples: samples };
	}

	if (typeof window !== 'undefined') {
		setInterval(poll, 500);
		setInterval(plot, 500);
		window.addEventListener('load', function () { poll(); plot(); });
	}
	return { plot: plot, poll: poll, exportSamples: exportSamples, samples: samples, seriesPoints: seriesPoints };
})();
if (typeof window !== 'undefined') window.ntgView = ntgView;
