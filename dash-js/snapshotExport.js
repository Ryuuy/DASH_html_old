/*
 * snapshotExport.js
 * 20260826 新增
 *
 * 把"这一次测试"的三块数据——ISAC 状态时间线（含新的 dBFS/power 两路判断，见
 * shadowInputs.js）、剩余 buffer 按码率堆叠的历史（图四）、实测网速（图五，粗+细粒度）——
 * 打包成一份 JSON，存成一个文件名里带时间的本地文件，供以后画论文图/离线分析用。
 *
 * 数据结构的说明专门写在项目根目录的 snapshots_FORMAT.md 里（跟实际存快照文件的
 * snapshots/ 目录分开放，改字段时两边都要记得同步）。
 *
 * 注意：浏览器 JS 没有权限直接把文件写到某个固定的本地路径，downloadFullSnapshot()
 * 触发的是标准的"另存为下载"，文件会落到 Chrome 的默认下载目录（一般是 Downloads），
 * 不会自动出现在 D:\DASH\DASH\snapshots\ 里——下载完之后手动挪过去，或者去 Chrome
 * 设置里把默认下载目录直接指到那个文件夹。
 */

function buildFullSnapshot()
{
	var snapshot = {
		meta: {
			formatVersion: 2,                       // 20261003：加了 clock / spectrogram / 接口开关事件，见 snapshots_FORMAT.md
			exportedAtWallClock: Date.now(),
			testEpochWallClock: (typeof window !== 'undefined') ? window.__dashTestEpoch : undefined,
			// 浏览器时钟 -> ISAC(Ubuntu) 时钟：serverMs = browserMs + clock.offsetMs。所有带 wallClock 的
			// 记录都可以用它换算；新记录同时带 serverTsEst（导出时刻之前的估计）
			clock: (typeof isacClock !== 'undefined') ? isacClock.info() : null,
			isacInterfaceEnabledAtExport: (typeof isac !== 'undefined') ? isac.interfaceEnabled : undefined,
			isacWsUrl: (typeof ISAC_WS_URL !== 'undefined') ? ISAC_WS_URL : undefined,
			formatDoc: "snapshots_FORMAT.md"
		},
		telemetry: (typeof dashTelemetry !== 'undefined') ? dashTelemetry.getSnapshot() : null,
		// 20261003：多普勒瀑布图（网页第六张图）的全部数据，时间轴是 server time
		spectrogram: (typeof dopplerView !== 'undefined') ? dopplerView.exportSpectrogram() : null,
		bufferByRep: (typeof myFplotBufferRep !== 'undefined' && myFplotBufferRep) ? {
			repLadder: myFplotBufferRep.repLadder,
			history: myFplotBufferRep.history
		} : null,
		// 20261009：NTG-2501 样本（無線伝送速度/受信·送信レベル/CNR/入出力レート，上下行都有），见 fplot_Ntg.js
		ntg: (typeof ntgView !== 'undefined') ? ntgView.exportSamples() : null,
		netSpeed: (typeof myFplotNetSpeed !== 'undefined' && myFplotNetSpeed) ? {
			coarseSamples: myFplotNetSpeed.samples,
			fineSamples: myFplotNetSpeed.fineSamples,
			// 默认粒度导出一份现成的 trace，省得每次都要手动调 exportTraceArray()；
			// 原始的 coarse/fineSamples 也都在上面，需要别的粒度可以自己重新桶
			exportedTrace: myFplotNetSpeed.exportTraceArray()
		} : null
	};
	return snapshot;
}

function _timestampForFilename()
{
	var d = new Date();
	function pad(n) { return (n < 10 ? "0" : "") + n; }
	return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "_" +
		pad(d.getHours()) + "-" + pad(d.getMinutes()) + "-" + pad(d.getSeconds());
}

function downloadFullSnapshot()
{
	var snapshot = buildFullSnapshot();
	// 20261003：不再 pretty-print（瀑布图 base64 + 几万个数字，缩进会让文件大一倍多）
	var text = JSON.stringify(snapshot);
	console.log("Snapshot: " + text.length + " bytes, segments=" +
		(snapshot.telemetry ? snapshot.telemetry.segments.length : 0) +
		", bufferHistory=" + (snapshot.bufferByRep ? snapshot.bufferByRep.history.length : 0) +
		", netSpeedFineSamples=" + (snapshot.netSpeed ? snapshot.netSpeed.fineSamples.length : 0) +
		", spectrogramColumns=" + (snapshot.spectrogram ? snapshot.spectrogram.nColumns : 0) +
		", interfaceEvents=" + (snapshot.telemetry ? snapshot.telemetry.isacInterfaceEvents.length : 0));

	var filename = "dashSnapshot_" + _timestampForFilename() + ".json";

	// 防误刷新用：记下这次保存时已有多少播放采样（见文件末尾的 beforeunload）
	window.__snapshotSavedAt = Date.now();
	window.__snapshotSavedSamples = (typeof dashTelemetry !== 'undefined') ? dashTelemetry.playbackSamples.length : 0;

	var blob = new Blob([text], { type: "application/json" });
	var url = URL.createObjectURL(blob);
	var a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}


// 20261003：刷新/关闭页面会清空网页内存里的数据（Ubuntu 的 isac_logs/*.npz 不受影响，但页面上的图数据只在这里）。
// 如果上次 Save Full Snapshot 之后又攒了 >50 个播放采样（≈5 秒），关页面/刷新前让浏览器弹确认框。
// 浏览器只允许弹它自己的通用文字（"要离开此网站吗？"），不能自定义，也不能在这里自动下载文件。
if (typeof window !== 'undefined') {
	window.addEventListener('beforeunload', function (e) {
		if (typeof dashTelemetry === 'undefined') return;
		var now = dashTelemetry.playbackSamples.length;
		var saved = window.__snapshotSavedSamples || 0;
		if (now - saved > 50) {
			e.preventDefault();
			e.returnValue = '';
		}
	});
}
