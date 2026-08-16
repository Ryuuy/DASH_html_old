/*
 * telemetry.js
 * 20260817 新增
 *
 * 统一的"视频端遥测数据"出口。这几张图（第一张：估计带宽/选中码率/实测吞吐，
 * 第二张：buffer 占用，第三张：最终码率 + ISAC 状态）背后的原始数据都汇总到这里：
 *
 *   window.dashTelemetry.segments         每个分片的最终码率决策（含被 confirmRecovery
 *                                          废弃、从没真正播出来的旧决策，用 superseded 标记）
 *   window.dashTelemetry.isacEvents       isac 模式变化事件（normal/shadowing/recovering）
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
	var maxKeep = 20000;      // 防止长时间播放把内存占满，超过就丢最老的（先进先出），不影响已经推送出去的部分

	function trim(arr) {
		if (arr.length > maxKeep) arr.splice(0, arr.length - maxKeep);
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

		if (kind === "segment") { segments.push(record); trim(segments); }
		else if (kind === "isacEvent") { isacEvents.push(record); trim(isacEvents); }
		else if (kind === "playbackSample") { playbackSamples.push(record); trim(playbackSamples); }

		sendOverWs(record);
		return record;
	}

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
			segments: segments.slice(),
			isacEvents: isacEvents.slice(),
			playbackSamples: playbackSamples.slice()
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
		findPlayingSegment: findPlayingSegment,
		getSnapshot: getSnapshot,
		exportJSON: exportJSON,
		// 直接暴露数组引用，方便画图代码高频读取时不用每次都拷贝一份
		segments: segments,
		isacEvents: isacEvents,
		playbackSamples: playbackSamples
	};

})();

if (typeof window !== 'undefined') {
	window.dashTelemetry = dashTelemetry;
}
