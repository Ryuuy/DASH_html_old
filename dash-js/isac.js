/*
 * isac.js
 * 20260812 新增
 *
 * ISAC 模式管理：预留给未来接入真实 25GHz passive ISAC 感知数据的统一入口。
 *
 * 目前只有两种模式：
 *   normal    —— 正常模式，buffer/码率按现有逻辑走（bandwidth.js 的实测加权平均 + adaptationlogic.js 按带宽选码率）
 *   shadowing —— ISAC 预测到即将发生遮挡（信号中断）时进入此模式：
 *                飞速拉大 buffer 上限、强制码率打到最低，让 refill 循环尽可能多、
 *                尽可能快地把低码率分片抢到本地 buffer 里（遮挡前的窗口很短，要抢时间）
 *
 * 以后加新模式，只需要在 profile 里加一项，并在需要的地方判断 isac.mode 即可，
 * 不需要改这个文件之外的核心播放/请求逻辑。
 *
 * 真正接入 ISAC 硬件时，只需要在收到感知结果的地方调用 setISACMode(...)，
 * 现在先用 dashtest_2sDASH_1080p-public-access.html 里的两个按钮手动模拟触发，
 * 用来验证 buffer/码率联动是否符合预期。
 */

var isac = {

	mode: "normal",

	// 各模式下的 buffer 目标（单位：秒）。critical 是触发 refill 的下限，max 是上限。
	// normal 先沿用现有的 4/4，shadowing 的具体数值以后可以再调（数值越大，能抗的遮挡时长越长，
	// 但代价是要更长的时间才能攒够，以及内存占用更大）
	profile: {
		normal:    { critical: 4,  max: 4  },
		shadowing: { critical: 30, max: 30 }
	},

	segLength: 2  // 需要和 mpd 里 <SegmentList duration="2"> 保持一致

};

// 唯一的对外入口：切换 ISAC 模式。以后接真实 ISAC 数据源时，就是在这里传入解析出来的模式。
function setISACMode(mode) {

	if (isac.profile[mode] == null) {
		console.log("ISAC: unknown mode requested: " + mode);
		return;
	}

	if (isac.mode === mode) return; // 模式没变化，不重复处理

	console.log("ISAC: switching mode " + isac.mode + " -> " + mode + " at " + new Date().getTime());
	isac.mode = mode;

	applyISACBufferProfile();
}

function applyISACBufferProfile() {

	if (typeof overlayBuffer === 'undefined' || !overlayBuffer) return; // buffer 还没建好，等下次调用

	var target = isac.profile[isac.mode];

	overlayBuffer.bufferSize.maxseconds = target.max;
	overlayBuffer.criticalState.seconds = target.critical;
	overlayBuffer.upperLimit = target.max;
	overlayBuffer.lowerLimit = target.critical;

	// 20260812 已停用：这里原本运行时调大 buffer.size，但环形缓冲区是靠
	// "序号 % buffer.size" 来算存取哪个槽位的，size 在 first/last 计数器已经跑起来之后
	// 被改变，会导致新旧序号算出来的槽位对不上，get() 读到从没写过的槽位返回 undefined，
	// 播放器直接卡死（报错 Cannot read properties of undefined (reading 'length')）。
	// 现在改成启动时在 initISACBufferCapacity() 里一次性把容量开到所有模式的最大值，
	// 运行时只改 bufferSize.maxseconds 这种纯计数比较，不再动 buffer.size。
	/*
	var neededSlots = Math.ceil(target.max / isac.segLength);
	if (neededSlots > overlayBuffer.buffer.size) {
		overlayBuffer.buffer.size = neededSlots;
	}
	*/

	// 主动唤醒一次 refill 循环：如果之前已经灌满、处于休眠状态（doRefill==false），
	// 这一下能让它立刻开始往新的（更大的）buffer 目标继续灌数据；
	// 如果 refill 循环本来就在跑，这行调用是空操作，不影响，因为 refill() 每次都会读最新的 bufferSize.maxseconds
	overlayBuffer.signalRefill();
}

// 20260812 新增：在 overlayBuffer 刚创建、还没有任何分片被存取过的时候调用一次，
// 把环形缓冲区的物理槽位数一次性开到"所有 ISAC 模式里最大的那个"，
// 这样以后切换模式只改 bufferSize.maxseconds（逻辑上限），不用再碰 buffer.size（物理容量），
// 从根本上避免上面 applyISACBufferProfile() 里说的取模错位问题。
function initISACBufferCapacity() {

	if (typeof overlayBuffer === 'undefined' || !overlayBuffer) return;

	var maxSlotsNeeded = 0;
	for (var key in isac.profile) {
		var slots = Math.ceil(isac.profile[key].max / isac.segLength);
		if (slots > maxSlotsNeeded) maxSlotsNeeded = slots;
	}
	overlayBuffer.buffer.size = maxSlotsNeeded;
}
