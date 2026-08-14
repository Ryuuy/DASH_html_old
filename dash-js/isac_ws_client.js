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
var ISAC_WS_URL = "ws://192.168.1.50:8765/isac";

var isacWsReconnectDelay = 1000;
var ISAC_WS_MAX_RECONNECT_DELAY = 10000;

function connectISACWebSocket() {

	var ws = new WebSocket(ISAC_WS_URL);

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
		if (data && data.mode) {
			setISACMode(data.mode);
			var label = document.getElementById('isacModeLabel');
			if (label) label.innerText = isac.mode;
		}
	};

	ws.onclose = function () {
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
