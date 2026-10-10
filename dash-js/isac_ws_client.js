/*
 * isac_ws_client.js
 * 20260812 新增
 *
 * 连接 isac_server.py 开的 WebSocket 服务，把收到的 mode 转发给 isac.js 的 setISACMode()。
 * 依赖 isac.js（要先加载它），必须在 <script src="dash-js/isac.js"> 之后引入这个文件。
 *
 *   要点 3：断线自动 reconnect，退避时间失败一次翻倍（1s -> 2s -> 4s ... 封顶 10s），
 *           避免 server 还没起来 / 暂时不通的时候疯狂重连刷日志。
 *   要点 1（服务端已经做了，这里只是接住）：连接一建立，server 会主动推一次"当前" state，
 *           所以刷新页面 / 重连回来都能立刻同步，不用额外发消息去"问"。
 */

// 20260814 已切换：isac_server.py 跑在 Ubuntu 机器上，走有线网口 enp1s0（本地专线，非学校 WiFi）。
// 如果这台机器的本地网 IP 变了（比如网线换口/DHCP 重新分配），要同步改这里，
// 用 `ip -brief addr show` 查 enp1s0 对应的地址。
// 20261003：可以在网页地址后面加 ?isacws=ws://别的IP:8765/isac 临时覆盖，换 IP 时不用改这个文件
// （页面文件如果放在另一台机器上的 node server 里，也就不用重新部署）。
var ISAC_WS_URL = (function () {
	try {
		var q = new URLSearchParams(window.location.search).get("isacws");
		if (q) return q;
	} catch (e) {}
	return "ws://192.168.1.50:8765/isac";
})();

var isacWsReconnectDelay = 1000;
var ISAC_WS_MAX_RECONNECT_DELAY = 10000;

function connectISACWebSocket() {

	var ws = new WebSocket(ISAC_WS_URL);
	// 20260817 新增：暴露成全局，方便 telemetry.js 复用这同一条连接，把视频端的遥测数据
	// （分片码率决策 / isac 状态事件 / 播放采样）往回推给 isac_server.py，
	// 不用另外再开一条连接。连接断开时清掉，telemetry.js 那边发送前会检查 readyState，
	// 连接不通就本地照常记录、不推送，不会报错。
	window.isacWs = ws;

	ws.onopen = function () {
		console.log("ISAC WS: connected to " + ISAC_WS_URL);
		isacWsReconnectDelay = 1000; // 连上了就把退避时间重置，下次断线还是从 1s 开始重试
	};

	ws.onmessage = function (event) {
		var data;
		try {
			data = JSON.parse(event.data);
		} catch (e) {
			console.log("ISAC WS: 收到无法解析的消息 " + event.data);
			return;
		}
		// 20261003：每条带 server 时间戳的消息都喂给时钟估计器（isacClock.js），不需要 ping/pong。
		// mode 消息的 ts 是秒（isac_server.py 的 time.time()），其余是毫秒。
		if (typeof isacClock !== 'undefined') {
			if (typeof data.ts === 'number') isacClock.observe(data.type ? data.ts : data.ts * 1000);
			else if (typeof data.wallClock === 'number') isacClock.observe(data.wallClock);
		}

		// 20261003 新增的几种消息（isac_bridge.py 通过 isac_server 的广播通道发的；旧 server 不认识也没关系）
		if (data && data.type === "doppler_spec") {
			if (typeof dopplerView !== 'undefined') dopplerView.feed(data);
			return;
		}
		if (data && data.type === "doppler_meta") {
			if (typeof dopplerView !== 'undefined') dopplerView.setMeta(data.meta);
			return;
		}
		if (data && data.type === "doppler_event") {
			// ISAC 那边判决翻转的精确时刻（rt_main 判决时的 Ubuntu 时间），不管 ISAC 接口开没开都记
			if (typeof dashTelemetry !== 'undefined') {
				dashTelemetry.recordDopplerDetection({
					state: data.state, serverTs: data.ts, ridge: data.ridge, E: data.E,
					recvWallClock: Date.now()
				});
			}
			return;
		}
		if (data && data.type === "clock") return;

		if (data && data.mode) {
			setISACMode(data.mode, "isac");   // 旧字符串 "shadowing" 在 setISACMode 里会被当成 doppler_detected
			if (typeof updateISACLabels === 'function') updateISACLabels();
		}

		// 20260826 新增：同一条连接上，如果消息带了 dBFS 或 power 字段，转发给
		// shadowInputs.js 里两路独立的阈值判断（见该文件说明）。跟上面的 data.mode
		// 不互斥——一条消息理论上可以同时带 mode（ISAC 自己的预测结论）和
		// dBFS/power（供另外两路各自独立判断用的原始读数）。
		if (data && typeof data.dBFS === 'number' && typeof feedDBFS === 'function') {
			feedDBFS(data.dBFS, data.wallClock);
		}
		if (data && typeof data.power === 'number' && typeof feedPowerShadow === 'function') {
			feedPowerShadow(data.power, data.wallClock);
		}
	};

	ws.onclose = function () {
		if (window.isacWs === ws) window.isacWs = null; // 20260817 新增：断开了就清掉，telemetry.js 靠这个判断"现在能不能推"
		console.log("ISAC WS: 连接断开，" + isacWsReconnectDelay + "ms 后重连");
		setTimeout(connectISACWebSocket, isacWsReconnectDelay);
		isacWsReconnectDelay = Math.min(isacWsReconnectDelay * 2, ISAC_WS_MAX_RECONNECT_DELAY);
	};

	ws.onerror = function () {
		// 不在这里重连，交给 onerror 之后必然触发的 onclose 统一处理，
		// 否则 onerror + onclose 各发起一次重连，会同时开出两条连接。
		ws.close();
	};
}

connectISACWebSocket();
