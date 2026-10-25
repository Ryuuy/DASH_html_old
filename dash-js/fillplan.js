/*
 * fillplan.js
 * 20261025 新增
 *
 * "提前 t 秒补缓冲"：ISAC 预报 t 秒后人会挡住 LOS（遮挡期间下不动东西）时，用这 t 秒把本地缓冲补到
 * 能扛过遮挡的目标（默认 12 s），并在这 t 秒里选"补得满的前提下画质最高"的码率。
 *
 * ## 打开方式（默认关，和以前的行为完全一样）
 *   网址加 ?fill=1
 *   可选：?filltarget=12   遮挡期要扛的缓冲目标（秒）
 *         ?fillt=1.4       预报提前量 t 的默认值（秒），真正的 t 由下面的接口给
 *         ?fillhis=30      "网速惯性"均值窗口（秒）
 *         ?fillsafety=0.8  吞吐安全系数（只信这么多比例的均值网速）
 *
 * ## 逻辑（每次下完一个分片、要选下一个分片码率时算一次，见 adaptationlogic.js）
 *   B     = 当前缓冲（秒）= 覆盖缓冲(overlayBuffer) + 已进 MSE 还没播的部分
 *   t     = 距离预计遮挡开始还剩多少秒（见下面 t 的接口；随时间递减）
 *   T     = 目标缓冲（默认 12 s）
 *   R     = 长窗口均值网速 × 安全系数（getThroughputBps()，最近 fillhis 秒内各分片按下载时长加权）
 *
 *   t 秒里播放器照常消耗 t 秒缓冲，所以遮挡开始时缓冲 = B - t + (t*R/b)，b 是选的码率。要求 >= T：
 *       need = T - B + t                (净需要补的视频秒数；<=0 说明缓冲本来就够，不干预，走原来的 ABR)
 *       b <= R*t / need
 *   另外一个分片（2 s 视频 = 2b 比特）要在 t 内下完才有意义：b <= R*t / segLength
 *   在 mpd 里取 <= min(上面两个) 的最高档；一档都不够就取最低档（尽力而为）。t 用完(<=0)直接最低档。
 *
 * ## ★ t 的接口（今天的瓶颈：t 怎么定）——这是唯一需要接上的地方 ★
 *   setISACLeadTime(sec, source)   把"此刻起还有 sec 秒遮挡开始"告诉播放器。随时可调，每次调用都以调用时刻为起点重新计时。
 *   fillPlan.leadTimeProvider = function () { return 秒数或 null; }   更高级：每次决策时现问一次（返回 null = 用默认值）
 *   WebSocket：isac_ws_client.js 收到 {"type":"lead_time","t":秒} 或者 mode 消息里带 "lead_t":秒 都会调用上面的 setISACLeadTime
 *   没人给 t 时用默认值 fillt（1.4 s），从进入 doppler_detected 那一刻起算。
 *
 * ## 开启后和旧逻辑的区别
 *   - doppler_detected 不再强制最低码率、也不用 30 s 的大缓冲目标，改成按上面的公式选码率
 *   - 离开 doppler_detected 后不走"恢复确认+丢弃旧缓冲"（confirmRecovery），因为补进来的缓冲是要留着的
 */

var fillPlan = (function () {

	function qnum(name, def, lo, hi) {
		try {
			var v = parseFloat(new URLSearchParams(window.location.search).get(name));
			if (isFinite(v) && v >= lo && v <= hi) return v;
		} catch (e) {}
		return def;
	}

	var enabled = false;
	try { enabled = new URLSearchParams(window.location.search).get('fill') === '1'; } catch (e) {}

	var st = {
		enabled: enabled,
		targetSec: qnum('filltarget', 12, 2, 60),
		defaultLeadSec: qnum('fillt', 1.4, 0, 30),
		hisSec: qnum('fillhis', 30, 2, 300),
		safety: qnum('fillsafety', 0.8, 0.1, 1.5),
		segLength: 2,

		leadSec: null,          // 最近一次被设置的 t
		leadSetMs: 0,           // 那一刻的时间（ms）
		leadSource: 'default',
		leadTimeProvider: null, // 可选：function () { return 秒 | null }

		last: null,             // 最近一次决策的细节（记进遥测）
		alertStartMs: null
	};
	st.leadSec = st.defaultLeadSec;

	// ---- t 的接口 ----
	// 此刻起还有 sec 秒遮挡开始。
	st.setLeadTime = function (sec, source) {
		if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return;
		st.leadSec = sec;
		st.leadSetMs = Date.now();
		st.leadSource = source || 'api';
	};

	// 距离预计遮挡开始还剩多少秒（随时间递减，可能 <= 0）
	st.remainingLeadSec = function () {
		var now = Date.now();
		if (typeof st.leadTimeProvider === 'function') {
			var p = st.leadTimeProvider();
			if (typeof p === 'number' && isFinite(p)) return p;
		}
		return st.leadSec - (now - st.leadSetMs) / 1000;
	};

	// 模式切换钩子（isac.js 的 _applyISACMode 调用）
	st.onModeChange = function (prev, mode) {
		var now = Date.now();
		if (mode === 'doppler_detected' && prev !== 'doppler_detected') {
			st.alertStartMs = now;
			// 如果这次警报没有同时带来 t（500 ms 内没有人调过 setLeadTime），就用默认值，从现在起算
			if (now - st.leadSetMs > 500) {
				st.leadSec = st.defaultLeadSec;
				st.leadSetMs = now;
				st.leadSource = 'default';
			}
		} else if (mode !== 'doppler_detected') {
			st.alertStartMs = null;
		}
	};

	// ---- 缓冲（秒）----
	st.bufferAheadSec = function () {
		var b = 0;
		try { if (typeof overlayBuffer !== 'undefined' && overlayBuffer) b += overlayBuffer.fillState.seconds; } catch (e) {}
		try {
			var v = dashInstance.videoTag, ct = v.currentTime, r = v.buffered;
			for (var i = 0; i < r.length; i++) {
				if (ct >= r.start(i) - 0.05 && ct <= r.end(i)) { b += Math.max(0, r.end(i) - ct); break; }
			}
		} catch (e) {}
		return b;
	};

	// ---- 长窗口均值网速（bps）：最近 hisSec 秒内每个分片的实测吞吐，按下载时长加权 ----
	st.getThroughputBps = function () {
		try {
			var now = Date.now(), num = 0, den = 0;
			var arr = (typeof myBandwidth !== 'undefined' && myBandwidth) ? myBandwidth.bpsArray : null;
			if (arr && typeof __id !== 'undefined' && typeof __idEnd !== 'undefined') {
				for (var i = __idEnd.length - 1; i >= 0; i--) {
					if (__idEnd[i] === undefined || __id[i] === undefined || arr[i] === undefined) continue;
					if (__idEnd[i] < now - st.hisSec * 1000) break;
					var d = __idEnd[i] - __id[i];
					if (!(d > 0) || !isFinite(arr[i])) continue;
					num += arr[i] * d; den += d;
				}
			}
			if (den > 0) return num / den;
			if (typeof myBandwidth !== 'undefined' && myBandwidth) return myBandwidth.getBps();
		} catch (e) {}
		return 0;
	};

	// ---- 核心：返回应该选的 representation 下标，或者 null（= 不干预，走原来的 ABR）----
	// reps 是 mpd.period[0].group[0].representation 数组。
	st.chooseRepresentation = function (reps, lowestId) {
		if (!st.enabled || typeof isac === 'undefined' || isac.mode !== 'doppler_detected') { st.last = null; return null; }

		var t = st.remainingLeadSec(), B = st.bufferAheadSec(), T = st.targetSec;
		var Rraw = st.getThroughputBps(), R = Rraw * st.safety;
		var need = T - B + t;
		var info = { t: +t.toFixed(3), B: +B.toFixed(2), T: T, Rraw: Math.round(Rraw), R: Math.round(R), need: +need.toFixed(2), src: st.leadSource };

		var pick = lowestId, why;
		if (need <= 0) {
			info.why = 'buffer enough'; st.last = info; return null;       // 缓冲已够，不干预
		} else if (t <= 0) {
			why = 't expired -> lowest';
		} else {
			var bmax = Math.min(R * t / need, R * t / st.segLength);
			info.bmax = Math.round(bmax);
			var bestBw = -1;
			for (var i = 0; i < reps.length; i++) {
				var bw = parseInt(reps[i].bandwidth);
				if (bw <= bmax && bw > bestBw) { bestBw = bw; pick = i; }
			}
			why = bestBw < 0 ? 'no rep fits -> lowest' : 'highest rep <= bmax';
		}
		info.why = why; info.pick = pick; info.pickBw = parseInt(reps[pick].bandwidth);
		st.last = info;
		console.log('FILLPLAN ' + JSON.stringify(info));
		return pick;
	};

	// 警报期间缓冲目标：够大即可（refill 循环"缓冲 < 目标才继续下"），码率由 chooseRepresentation 控制
	st.alertBufferSec = function (normalMax) {
		return Math.max(normalMax, st.targetSec + 10);
	};

	return st;
})();

function setISACLeadTime(sec, source) { fillPlan.setLeadTime(sec, source); }

// 开启后，把 doppler_detected 的 buffer 目标改成 alertBufferSec（要在 initISACBufferCapacity() 之前执行，
// 这个文件在 isac.js 之后加载、dash.js 创建 buffer 之前，所以放在这里就行）
if (fillPlan.enabled && typeof isac !== 'undefined') {
	var _cap = fillPlan.alertBufferSec(isac.profile.normal.max);
	isac.profile.doppler_detected = { critical: _cap, max: _cap };
	console.log('FILLPLAN enabled: target=' + fillPlan.targetSec + 's default t=' + fillPlan.defaultLeadSec +
		's his=' + fillPlan.hisSec + 's safety=' + fillPlan.safety + ' alert buffer cap=' + _cap + 's');
}
