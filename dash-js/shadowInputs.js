/*
 * shadowInputs.js
 * 20260826 新增
 *
 * 另外两路独立的"要不要判定为遮挡(shadow)"输入源，跟 isac.js 现有那套（isac_ws_client.js
 * 收 ISAC 预测好的 mode 字符串，直接调 setISACMode()）是并列关系，不是替代：
 *
 *   feedDBFS(dBFSValue)        —— 输入 dBFS（相对满量程的分贝，越接近 0 信号越强，越负越弱）
 *   feedPowerShadow(powerValue) —— 输入功率计算出来的量，判断逻辑跟 ISAC 的"预测"思路不同，
 *                                   是直接对功率读数做阈值判断，不是预测式的
 *
 * 两路各自独立维护自己的阈值/历史，互不共享状态，方便以后接了真数据进来对比"这三种判断
 * 方式（ISAC 预测 / dBFS 阈值 / 功率阈值）谁更早、更准地判断出遮挡"——每次判断都会调
 * dashTelemetry.recordShadowJudgment() 记下 source/原始值/判断结果，画图/事后分析用。
 *
 * 默认不驱动播放（.enabled = false）：喂值进来只会记录判断结果，不会真的调 setISACMode()
 * 去改变码率/buffer 策略——现在接的还只是占位阈值，没有真实标定过，贸然让它直接控制播放
 * 会在真数据接进来之前就影响测试结果。等阈值调好、确认判断靠谱了，把对应的 .enabled 设成
 * true 就会开始真正驱动（多路同时 enabled 时，后调用的那次 setISACMode() 会覆盖前面的，
 * 调用方自己保证同一时间只开一路 enabled，这里不做互斥仲裁）。
 *
 * 用同一条 ISAC WebSocket 接入时（见 isac_ws_client.js），消息里带 dBFS/power 字段即可，
 * 不需要新开连接——isac_ws_client.js 里已经加了对应的转发。
 */

var dBFSShadowInput = {
	enabled: false,       // true 才会真的调 setISACMode()，见文件头说明
	threshold: -40,       // TODO：占位阈值，未标定。dBFS 低于这个值判定为进入 shadow
	hysteresis: 3,        // dB，回滞区间：已经在 shadow 里时，要涨回 threshold+hysteresis 以上才判定恢复 normal，防止阈值附近来回抖
	_lastJudgedShadow: false,
	history: [],           // {wallClock, dBFS, judgedShadow}
	maxKeep: 20000
};

var powerShadowInput = {
	enabled: false,        // true 才会真的调 setISACMode()，见文件头说明
	threshold: 0,          // TODO：占位阈值，未标定，单位取决于上游怎么算这个 power
	hysteresis: 0,          // TODO：同上，回滞量未标定
	_lastJudgedShadow: false,
	history: [],
	maxKeep: 20000
};

function _judgeWithHysteresis(state, value) {
	// 值越低越像 shadow（dBFS/功率都是这个方向）；已经判为 shadow 时用更高的门槛
	// （threshold + hysteresis）才判定恢复，避免在 threshold 附近来回跳
	var enterBound = state.threshold;
	var exitBound = state.threshold + state.hysteresis;
	var judgedShadow = state._lastJudgedShadow ? (value < exitBound) : (value < enterBound);
	state._lastJudgedShadow = judgedShadow;
	return judgedShadow;
}

function feedDBFS(dBFSValue, wallClock) {
	wallClock = wallClock || Date.now();
	var judgedShadow = _judgeWithHysteresis(dBFSShadowInput, dBFSValue);

	dBFSShadowInput.history.push({ wallClock: wallClock, dBFS: dBFSValue, judgedShadow: judgedShadow });
	if (dBFSShadowInput.history.length > dBFSShadowInput.maxKeep) dBFSShadowInput.history.shift();

	if (typeof dashTelemetry !== 'undefined') {
		dashTelemetry.recordShadowJudgment({
			source: "dBFS",
			rawValue: dBFSValue,
			judgedShadow: judgedShadow,
			thresholdUsed: dBFSShadowInput.threshold,
			wallClock: wallClock
		});
	}

	if (dBFSShadowInput.enabled) {
		setISACMode(judgedShadow ? "shadowing" : "normal");
	}
	return judgedShadow;
}

function feedPowerShadow(powerValue, wallClock) {
	wallClock = wallClock || Date.now();
	var judgedShadow = _judgeWithHysteresis(powerShadowInput, powerValue);

	powerShadowInput.history.push({ wallClock: wallClock, power: powerValue, judgedShadow: judgedShadow });
	if (powerShadowInput.history.length > powerShadowInput.maxKeep) powerShadowInput.history.shift();

	if (typeof dashTelemetry !== 'undefined') {
		dashTelemetry.recordShadowJudgment({
			source: "power",
			rawValue: powerValue,
			judgedShadow: judgedShadow,
			thresholdUsed: powerShadowInput.threshold,
			wallClock: wallClock
		});
	}

	if (powerShadowInput.enabled) {
		setISACMode(judgedShadow ? "shadowing" : "normal");
	}
	return judgedShadow;
}
