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

// 20261003：自动保存的三种模式，用网址参数选： ?autosave=off | light（默认）| full
//
// 为什么要改：每次保存都是把"整份数据"推给 server7.js 覆盖写，数据又随运行时间一直变长
// （buffer_by_rep / net_speed 每 0.1 s 一个点、不设上限）。实测（headless Chrome，多普勒+dBFS/power
// 数据都在流）：每 2 秒推一轮，上行流量 0.65 → 2.1 → 4.9 → 7.7 → 10.5 Mbit/s（0.5 / 1 / 2 / 3 / 4 分钟），
// 每分钟涨约 2.8 Mbit/s，9~10 分钟就会占满 NTG-2501 的 26 Mbps。浏览器和 server7.js 不在同一台电脑时，
// 这些数据要穿过正在被测的无线链路，把视频的请求/ACK 挤在后面（排队），表现就是网页越跑越卡、
// 分片 3 s 超时重试、最后播放器停住。链路本身是被测对象，不能让自己的保存流量占用它。
//   off    完全不自动保存（实验时推荐；数据靠 Ubuntu 的 isac_logs/*.npz + 手动 Save Full Snapshot）
//   light  （默认）只推小文件：meta.json / doppler_shadow_events.json / power_dbfs_judgments.json，
//          每 10 s 一次；不推 buffer_by_rep.json 和 net_speed.json（这两个手动快照里都有）
//   full   原来的行为：5 个文件全推，每 2 s 一次
var AUTOSAVE_MODE = (function () {
	try {
		var m = new URLSearchParams(window.location.search).get("autosave");
		if (m === "off" || m === "light" || m === "full") return m;
	} catch (e) {}
	return "light";
})();
var SESSION_SAVE_INTERVAL_MS = (AUTOSAVE_MODE === "full") ? 2000 : 10000; // 每次整份重写，不是追加

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

	if (AUTOSAVE_MODE === "full" && typeof myFplotBufferRep !== 'undefined' && myFplotBufferRep) {
		_postSessionFile("buffer_by_rep.json", {
			repLadder: myFplotBufferRep.repLadder,
			history: myFplotBufferRep.history
		});
	}
	if (AUTOSAVE_MODE === "full" && typeof myFplotNetSpeed !== 'undefined' && myFplotNetSpeed) {
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
		lastSavedAtWallClock: Date.now(),
		// 20261003：server7.js 的文件名白名单是固定的（旧版本 server 也一样），所以新信息塞进
		// 已有的 meta.json，不新增文件名，也就不需要更新 server7.js。瀑布图太大，不在这里存
		// （在 Ubuntu 的 isac_logs/*.npz 和手动 Save Full Snapshot 里）。
		clock: (typeof isacClock !== 'undefined') ? isacClock.info() : null,
		isacInterfaceEvents: (typeof dashTelemetry !== 'undefined') ? dashTelemetry.isacInterfaceEvents : [],
		dopplerDetections: (typeof dashTelemetry !== 'undefined') ? dashTelemetry.dopplerDetections : []
	});
}

function startSessionAutoSave() {
	if (AUTOSAVE_MODE === "off") {
		console.log("sessionAutoSave: OFF（网址带 ?autosave=off）——不往 server7.js 推任何数据");
		return;
	}
	_dashSessionId = _timestampForSessionId();
	console.log("sessionAutoSave: mode=" + AUTOSAVE_MODE + " session=" + _dashSessionId + "，每 " +
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
