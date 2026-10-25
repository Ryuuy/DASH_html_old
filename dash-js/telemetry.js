/*
 * telemetry.js
 * 20260817 新增
 *
 * 统一的"视频端遥测数据"出口。这几张图（第一张：估计带宽/选中码率/实测吞吐，
 * 第二张：buffer 占用，第三张：最终码率 + ISAC 状态）背后的原始数据都汇总到这里：
 *
 *   window.dashTelemetry.segments         每个分片的最终码率决策（含被 confirmRecovery
 *                                          废弃、从没真正播出来的旧决策，用 superseded 标记）
 *   window.dashTelemetry.isacEvents       isac 模式变化事件（normal/doppler_detected/recovering）——
 *                                          这是"实际生效的模式"，ISAC 接口关掉时它一直是 normal
 *   window.dashTelemetry.dopplerDetections 20261003：ISAC 那边的多普勒检测翻转（不管接口开没开都记，
 *                                          serverTs 是 rt_main 判决那一刻的 Ubuntu 时间）
 *   window.dashTelemetry.isacInterfaceEvents 20261003：网页上 "ISAC interface" 按钮的开/关事件
 *   window.dashTelemetry.playbackSamples  周期性采样：当前播到哪、buffer 占用、isac 状态
 *
 * 用途：
 *   1. 页面里随时可以 dashTelemetry.getSnapshot() / dashTelemetry.exportJSON() 拿到完整快照
 *      （也可以在浏览器 console 里直接敲这两个方法看）
 *   2. 如果 isac 那条 WebSocket 连着（见 isac_ws_client.js，它把连接对象存在
 *      window.isacWs），这里每条新记录都会实时用同一条连接推回 isac_server.py，
 *      让"另一个 Python 算法程序"能拿到（见 isac_server.py 的 get_video_telemetry()），
 *      方便和 ISAC 自己采的 channel 数据用同一个时钟（wall-clock, Date.now() / time.time()）对齐。
 *      WS 没连上也没关系，本地记录照常累积，只是暂时推不出去。
 *
 * 原则：宁可多记一个字段，不要少记——这批数据是要用来支撑论文分析的，
 * 后续要用哪个字段现在不一定能预判全，所以每条记录尽量把当下能拿到的相关信息都带上。
 */

var dashTelemetry = (function () {

	var segments = [];        // 每个分片的最终码率决策记录
	var isacEvents = [];      // isac 模式变化事件
	var playbackSamples = []; // 周期性播放状态采样
	// 20260826 新增：三路"要不要判定为 shadow"的原始判断记录——source 区分是哪一路
	// （'isac_prediction' / 'dBFS' / 'power'，见 dash-js/shadowInputs.js），不是互相替代关系，
	// 只是各自独立地把"这一刻的原始值 + 判出来的结果"记下来，供论文里比较三种方法谁更早/更准。
	var shadowJudgments = [];
	// 20261003 新增：多普勒检测翻转（原始检测，跟接口开关无关）；ISAC 接口开关事件。
	var dopplerDetections = [];
	var isacInterfaceEvents = [];
	// 20261003：视频播放/暂停/结束事件（见 dopplerView.js），后处理时用来排除暂停的时间段
	var videoStateEvents = [];
	// 20261025 新增：
	//  requests   页面每一次分片请求（含失败/超时/重试）：startWall/endWall(浏览器 Date.now)、state(ok|timeout|error)、
	//             httpStatus、bytes、attempt、timeoutMs、nextRetryMs……（见 DASHttp.js；以前失败重试完全没有记录）
	//  ntgStates  NTG 网页那六个状态（装置/無線/認証/監視信号/イーサ 自局·対向局），由 isac_bridge.py 的 link_monitor 经 ISAC ws 推来
	//  dataplane  Ubuntu 到视频 server 的 ping 通不通（状态翻转 + 5 s 心跳），同上
	// ntgStates / dataplane 只存本地、不回推给 isac_server（它们本来就是从 bridge 来的，bridge 自己也写了 csv）。
	var requests = [];
	var ntgStates = [];
	var dataplane = [];
	var maxKeep = 20000;      // 防止长时间播放把内存占满，超过就丢最老的（先进先出），不影响已经推送出去的部分
	// 20261003：playbackSamples 每 0.1 s 一条，20000 条只够 33 分钟，半小时多一点的实验开头就被挤掉了，
	// 单独放宽到 60000（100 分钟，约 20 MB）。shadowJudgments（dBFS/power 各 50 条/秒）仍是 20000 条
	// ≈ 3 分钟，那是原有行为，没动。
	var maxKeepPlayback = 60000;

	function trim(arr) {
		var cap = (arr === playbackSamples) ? maxKeepPlayback : maxKeep;
		if (arr.length > cap) arr.splice(0, arr.length - cap);
	}

	function nowWall() { return Date.now(); }

	function sendOverWs(record) {
		try {
			if (typeof window !== 'undefined' && window.isacWs && window.isacWs.readyState === 1 /* WebSocket.OPEN */) {
				window.isacWs.send(JSON.stringify(record));
			}
		} catch (e) {
			// 发送失败（比如连接刚好在这一瞬间断了）不影响本地记录，静默忽略，下一条正常发
		}
	}

	function pushAndSend(kind, record) {
		record.type = "video_telemetry"; // isac_server.py 靠这个字段区分"这是视频端推来的遥测"，不是别的消息
		record.kind = kind;              // "segment" | "isacEvent" | "playbackSample"
		record.wallClock = record.wallClock || nowWall();
		// 20261003：每条记录都带一个 server time 估计（Ubuntu 时钟，ms），见 isacClock.js。
		// wallClock 仍是浏览器自己的 Date.now()，两个都留着，事后可以重新对齐。
		if (typeof isacClock !== 'undefined' && record.serverTsEst === undefined) {
			var se = isacClock.toServerMs(record.wallClock);
			if (se !== null) record.serverTsEst = se;
		}

		if (kind === "segment") { segments.push(record); trim(segments); }
		else if (kind === "isacEvent") { isacEvents.push(record); trim(isacEvents); }
		else if (kind === "playbackSample") { playbackSamples.push(record); trim(playbackSamples); }
		else if (kind === "shadowJudgment") { shadowJudgments.push(record); trim(shadowJudgments); }
		else if (kind === "dopplerDetection") { dopplerDetections.push(record); trim(dopplerDetections); }
		else if (kind === "isacInterface") { isacInterfaceEvents.push(record); trim(isacInterfaceEvents); }
		else if (kind === "videoState") { videoStateEvents.push(record); trim(videoStateEvents); }
		else if (kind === "request") { requests.push(record); trim(requests); }
		else if (kind === "ntgState") { ntgStates.push(record); trim(ntgStates); return record; }   // 只存本地，不回推
		else if (kind === "dataplane") { dataplane.push(record); trim(dataplane); return record; }  // 只存本地，不回推

		sendOverWs(record);
		return record;
	}

	// 20261025 新增：页面的一次分片请求结果。见 DASHttp.js 的 onload / ontimeout / onerror。
	// rec: {url, attempt, startWall, endWall, state:'ok'|'timeout'|'error', httpStatus, bytes, timeoutMs, nextRetryMs, representationId}
	function recordRequest(rec) { return pushAndSend("request", rec); }
	// 20261025 新增：bridge 推来的 NTG 六状态 / 数据面（见 isac_ws_client.js）。rec 里的 ts 是 Ubuntu 时钟（ms）。
	function recordNtgState(rec) { return pushAndSend("ntgState", rec); }
	function recordDataplane(rec) { return pushAndSend("dataplane", rec); }

	// 一个分片的最终码率决策。见 adaptationlogic.js 的 switchRepresentation() 调用处。
	// rec 期望包含：contentStart, contentEnd, representationId, bandwidthNominal,
	//              estimatedBps, actualThroughputBps, isacMode, isacRecovering
	function recordSegmentDecision(rec) {
		rec.superseded = false;
		return pushAndSend("segment", rec);
	}

	// confirmRecovery() 丢弃一段还没播过的旧低清分片、改抓高清时调用（见 isac.js）。
	// 把内容时间范围落在 [contentStart, contentEnd) 里、还没被标记过的分片记录标成
	// superseded: true——"最终选中码率"这张图只画 superseded=false 的记录，这些
	// 半路被废弃的旧决策就不会再叠在图上让人看不清；但记录本身留着不删，
	// 论文里如果想分析"算法一开始决定了什么、后来又改了什么"，原始数据还在。
	function markSuperseded(contentStart, contentEnd) {
		for (var i = segments.length - 1; i >= 0; i--) {
			var s = segments[i];
			if (!s.superseded && typeof s.contentStart === 'number' &&
				s.contentStart >= contentStart && s.contentStart < contentEnd) {
				s.superseded = true;
			}
		}
	}

	// isac 模式变化事件。见 isac.js 的 setISACMode() / confirmRecovery() 调用处。
	// rec 期望包含：fromMode, toMode, recovering, confirmed（confirmRecovery 触发的才是 true）
	function recordIsacEvent(rec) {
		return pushAndSend("isacEvent", rec);
	}

	// 周期性播放状态采样。见 dash.js 的 updatePlaybackTime() 调用处。
	// rec 期望包含：contentTime, isacMode, isacRecovering, playingRepresentationId,
	//              playingBandwidth, bufferFillSeconds, bufferTargetSeconds
	function recordPlaybackSample(rec) {
		return pushAndSend("playbackSample", rec);
	}

	// 20260826 新增：见 dash-js/shadowInputs.js 的 feedDBFS() / feedPowerShadow()。
	// rec 期望包含：source ('isac_prediction' | 'dBFS' | 'power'), rawValue, judgedShadow,
	//              thresholdUsed
	function recordShadowJudgment(rec) {
		return pushAndSend("shadowJudgment", rec);
	}

	// 20261003 新增：ISAC 那边多普勒检测翻转。rec: {state:'doppler_detected'|'normal',
	// serverTs(rt_main 判决时刻, Ubuntu ms), ridge, E, recvWallClock(浏览器收到的 Date.now())}
	function recordDopplerDetection(rec) {
		return pushAndSend("dopplerDetection", rec);
	}

	// 20261003 新增：网页上 ISAC interface 按钮。rec: {enabled:bool, reason:'init'|'button'}
	// 通过同一条 ws 推回 isac_server，server 收到时会盖上自己的 server_recv_ts——那个是权威时间。
	function recordIsacInterface(rec) {
		return pushAndSend("isacInterface", rec);
	}

	// 20261003 新增：视频状态。rec: {state:'playing'|'paused'|'ended', contentTime}
	function recordVideoState(rec) {
		return pushAndSend("videoState", rec);
	}

	// 给"最终播放码率"这张图用：在给定的内容时间点，找最后一条没被废弃、
	// 且覆盖这个时间点的分片决策记录（"最后一条"是因为同一段内容如果被重新决策过，
	// 数组里可能有旧的 superseded 记录排在前面，新记录排在后面）
	function findPlayingSegment(contentTime) {
		for (var i = segments.length - 1; i >= 0; i--) {
			var s = segments[i];
			if (!s.superseded && typeof s.contentStart === 'number' && typeof s.contentEnd === 'number' &&
				contentTime >= s.contentStart && contentTime < s.contentEnd) {
				return s;
			}
		}
		return null;
	}

	function getSnapshot() {
		return {
			generatedAt: nowWall(),
			testEpochWallClock: (typeof window !== 'undefined') ? window.__dashTestEpoch : undefined,
			segments: segments.slice(),
			isacEvents: isacEvents.slice(),
			shadowJudgments: shadowJudgments.slice(),
			dopplerDetections: dopplerDetections.slice(),
			isacInterfaceEvents: isacInterfaceEvents.slice(),
			videoStateEvents: videoStateEvents.slice(),
			playbackSamples: playbackSamples.slice(),
			requests: requests.slice(),      // 20261025
			ntgStates: ntgStates.slice(),    // 20261025
			dataplane: dataplane.slice()     // 20261025
		};
	}

	// 手动导出成 JSON 字符串，方便在浏览器 console 里直接复制，或者配合"Export Telemetry"按钮看
	function exportJSON() {
		return JSON.stringify(getSnapshot());
	}

	return {
		recordSegmentDecision: recordSegmentDecision,
		markSuperseded: markSuperseded,
		recordIsacEvent: recordIsacEvent,
		recordPlaybackSample: recordPlaybackSample,
		recordShadowJudgment: recordShadowJudgment,
		recordDopplerDetection: recordDopplerDetection,
		recordIsacInterface: recordIsacInterface,
		recordVideoState: recordVideoState,
		recordRequest: recordRequest,
		recordNtgState: recordNtgState,
		recordDataplane: recordDataplane,
		findPlayingSegment: findPlayingSegment,
		getSnapshot: getSnapshot,
		exportJSON: exportJSON,
		// 直接暴露数组引用，方便画图代码高频读取时不用每次都拷贝一份
		segments: segments,
		isacEvents: isacEvents,
		shadowJudgments: shadowJudgments,
		dopplerDetections: dopplerDetections,
		isacInterfaceEvents: isacInterfaceEvents,
		videoStateEvents: videoStateEvents,
		playbackSamples: playbackSamples,
		requests: requests,
		ntgStates: ntgStates,
		dataplane: dataplane
	};

})();

if (typeof window !== 'undefined') {
	window.dashTelemetry = dashTelemetry;
}
