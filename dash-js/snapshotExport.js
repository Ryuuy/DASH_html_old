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
			exportedAtWallClock: Date.now(),
			testEpochWallClock: (typeof window !== 'undefined') ? window.__dashTestEpoch : undefined,
			formatDoc: "snapshots_FORMAT.md"
		},
		telemetry: (typeof dashTelemetry !== 'undefined') ? dashTelemetry.getSnapshot() : null,
		bufferByRep: (typeof myFplotBufferRep !== 'undefined' && myFplotBufferRep) ? {
			repLadder: myFplotBufferRep.repLadder,
			history: myFplotBufferRep.history
		} : null,
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
	var text = JSON.stringify(snapshot, null, 2);
	console.log("Snapshot: " + text.length + " bytes, segments=" +
		(snapshot.telemetry ? snapshot.telemetry.segments.length : 0) +
		", bufferHistory=" + (snapshot.bufferByRep ? snapshot.bufferByRep.history.length : 0) +
		", netSpeedFineSamples=" + (snapshot.netSpeed ? snapshot.netSpeed.fineSamples.length : 0));

	var filename = "dashSnapshot_" + _timestampForFilename() + ".json";

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
