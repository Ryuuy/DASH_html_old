/*
 * sessionAutoSave.js
 * 20260827 新增
 *
 * 每次刷新网页，自动在服务器（server7.js）本地新建一个按时间命名的 session
 * 文件夹，定期把这次测试的数据整份覆盖写进去——不用像 snapshotExport.js
 * 那样每次手动点按钮才存一份；这份是"开着就一直在记，忘了点导出也不会丢"。
 *
 * 落地位置：D:\DASH\DASH\sessions\<sessionId>\ 下面几个 json 文件——这个目录
 * 在 DASH 这个 git 仓库里面，想要哪次实验的数据进版本库，直接
 * `git add sessions/<那个时间戳文件夹>` 就行，不用像 snapshots/ 那样先从
 * Chrome 默认下载目录里手动搬过来（那是浏览器下载的产物，落在系统目录，
 * 不在仓库里）。
 *
 * 跟 snapshotExport.js 的关系：数据来源完全一样（都是读 dashTelemetry /
 * myFplotBufferRep / myFplotNetSpeed），只是这边是"自动、周期性、写服务器
 * 本地磁盘"，那边是"手动点一下、浏览器下载一份 JSON"——两条路互不冲突，
 * 都留着，各自服务不同场景。
 *
 * 存了什么（对应用户要的"面积图/网速/多普勒shadow/dBFS和power shadow"）：
 *   buffer_by_rep.json          图四：repLadder + 堆叠历史
 *   net_speed.json              图五：粗+细粒度网速采样 + 导出用的 trace
 *   doppler_shadow_events.json  isac.mode 变化历史（present 判决驱动的，
 *                                也包含手动按钮触发的）
 *   power_dbfs_judgments.json   dBFS（上行/reference channel）+ power（下行/
 *                                sensing channel）两路各自的原始读数和判断结果，
 *                                source 字段区分，见 shadowInputs.js
 *   meta.json                   sessionId、时间锚点，供事后跟 server7/isac_server
 *                                日志对齐
 *
 * 只有 dashTelemetry/myFplotBufferRep/myFplotNetSpeed 存在时才会存有意义的
 * 数据——页面刚打开、DASH_MPD_loaded() 还没跑完那一小段时间，存的是空壳，
 * 不是 bug，等播放器初始化完，下一次定时保存自然就有数据了。
 */

var SESSION_SAVE_INTERVAL_MS = 2000; // 每 2 秒整份重写一次，不是追加

var _dashSessionId = null;

function _timestampForSessionId() {
	var d = new Date();
	function pad(n) { return (n < 10 ? "0" : "") + n; }
	return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "_" +
		pad(d.getHours()) + "-" + pad(d.getMinutes()) + "-" + pad(d.getSeconds());
}

function _postSessionFile(filename, data) {
	if (!_dashSessionId) return;
	// fetch 失败（服务器还没起来/网络抖动）静默忽略——这是"顺便存一份"，
	// 不该因为一次保存失败打断播放主流程，跟"isac ws 没连上也照常本地记录"
	// 那条容错哲学一致
	fetch("/api/session/save", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ sessionId: _dashSessionId, filename: filename, data: data })
	}).catch(function (e) {
		console.log("sessionAutoSave: 保存 " + filename + " 失败（server7.js 没起来？）: " + e);
	});
}

function saveSessionSnapshotNow() {
	if (!_dashSessionId) return;

	if (typeof myFplotBufferRep !== 'undefined' && myFplotBufferRep) {
		_postSessionFile("buffer_by_rep.json", {
			repLadder: myFplotBufferRep.repLadder,
			history: myFplotBufferRep.history
		});
	}
	if (typeof myFplotNetSpeed !== 'undefined' && myFplotNetSpeed) {
		_postSessionFile("net_speed.json", {
			coarseSamples: myFplotNetSpeed.samples,
			fineSamples: myFplotNetSpeed.fineSamples,
			exportedTrace: myFplotNetSpeed.exportTraceArray()
		});
	}
	if (typeof dashTelemetry !== 'undefined') {
		_postSessionFile("doppler_shadow_events.json", dashTelemetry.isacEvents);
		_postSessionFile("power_dbfs_judgments.json", dashTelemetry.shadowJudgments);
	}
	_postSessionFile("meta.json", {
		sessionId: _dashSessionId,
		testEpochWallClock: (typeof window !== 'undefined') ? window.__dashTestEpoch : undefined,
		lastSavedAtWallClock: Date.now()
	});
}

function startSessionAutoSave() {
	_dashSessionId = _timestampForSessionId();
	console.log("sessionAutoSave: session=" + _dashSessionId + "，每 " +
		(SESSION_SAVE_INTERVAL_MS / 1000) + "s 存一次到 sessions/" + _dashSessionId + "/");
	// 立刻先存一次 meta.json，哪怕紧接着就关掉页面，文件夹和这次测试的
	// 起始时间锚点也已经落盘了
	_postSessionFile("meta.json", {
		sessionId: _dashSessionId,
		testEpochWallClock: (typeof window !== 'undefined') ? window.__dashTestEpoch : undefined,
		startedAtWallClock: Date.now()
	});
	setInterval(saveSessionSnapshotNow, SESSION_SAVE_INTERVAL_MS);
}

startSessionAutoSave();
