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

	// 20260815 新增：shadowing 结束、mode 刚变回 normal 时先置 true，表示"ISAC 说风险解除了，
	// 但链路是不是真的已经恢复还没被证实"。真正的证实由 adaptationlogic.js 里选码率时触发
	// （见 confirmRecovery() 的注释），不是 mode 一变 normal 就直接信。
	recovering: false,

	// 各模式下的 buffer 目标（单位：秒）。critical 是触发 refill 的下限，max 是上限。
	// normal 先沿用现有的 4/4，shadowing 的具体数值以后可以再调（数值越大，能抗的遮挡时长越长，
	// 但代价是要更长的时间才能攒够，以及内存占用更大）
	profile: {
		normal:    { critical: 4,  max: 4  },
		shadowing: { critical: 30, max: 30 }
	},

	segLength: 2,  // 需要和 mpd 里 <SegmentList duration="2"> 保持一致

	// 20260816 新增：recovering 期间临时用多短的历史窗口重算带宽（单位：秒，见 bandwidth.js 的
	// calcWeightedBandwidth——它用过去 hisSize 秒内每个分片的真实下载耗时做加权平均）。
	// dash.js 里正常给的是 10 秒；shadowing 刚结束时这 10 秒窗口大半还是遮挡期/低速期的旧样本，
	// 要好几个真实分片才能把旧样本稀释掉，白白拖慢"判断出链路真的恢复了"的时机。
	// recovering 期间临时缩到这个值，让新分片的真实测速几乎立刻主导预测值；
	// confirmRecovery() 确认后会调回原来的窗口（避免正常播放时对网络抖动太敏感、画质来回跳）。
	recoveryHisSize: 2,

	// 保存进入 recovering 前 myBandwidth 原本的窗口参数，供恢复确认后调回来
	_savedHisSize: null,
	_savedPredSize: null

};

// 20260816 新增：recovering 开始时把带宽预测窗口缩短，只保存一次原始值，
// 防止重复调用把"已经缩短过的窗口"当成原始值存下来。
function shrinkBandwidthWindowForRecovery() {
	if (typeof myBandwidth === 'undefined' || !myBandwidth) return;
	if (isac._savedHisSize !== null) return; // 已经存过了，不重复存
	isac._savedHisSize = myBandwidth.hisSize;
	isac._savedPredSize = myBandwidth.predSize;
	myBandwidth.adjustWeights(isac.recoveryHisSize, myBandwidth.predSize);
}

// 20260816 新增：把带宽预测窗口调回 recovering 之前的样子
function restoreBandwidthWindow() {
	if (typeof myBandwidth === 'undefined' || !myBandwidth) return;
	if (isac._savedHisSize === null) return; // 没缩短过，不用管
	myBandwidth.adjustWeights(isac._savedHisSize, isac._savedPredSize);
	isac._savedHisSize = null;
	isac._savedPredSize = null;
}

// 唯一的对外入口：切换 ISAC 模式。以后接真实 ISAC 数据源时，就是在这里传入解析出来的模式。
function setISACMode(mode) {

	if (isac.profile[mode] == null) {
		console.log("ISAC: unknown mode requested: " + mode);
		return;
	}

	if (isac.mode === mode) return; // 模式没变化，不重复处理

	console.log("ISAC: switching mode " + isac.mode + " -> " + mode + " at " + new Date().getTime());

	// 20260815 新增：离开 shadowing 时，先只标记"待确认恢复"，不在这里清空已经囤好的低清缓冲——
	// 万一这次预测有误、链路其实还没真通，囤好的低清分片还能继续顶着不卡顿。
	// 真正清空旧缓冲、去抢高清分片的动作在 confirmRecovery() 里，由实测带宽真的选出
	// 更高码率时才触发（见 adaptationlogic.js）。
	var enteringRecovery = (isac.mode === "shadowing" && mode === "normal");
	var previousMode = isac.mode;

	isac.mode = mode;
	// 一旦不是"这次转场"，就把 recovering 清掉——防止上一轮恢复还没被 confirmRecovery()
	// 确认，ISAC 又立刻重新报了一次 shadowing 时，残留的 true 把下面 applyISACBufferProfile()
	// 挡住，导致新一轮 shadowing 该立刻放大的 buffer 目标迟迟不生效。
	isac.recovering = enteringRecovery;

	// 20260817 新增：把这次模式切换记进遥测（见 telemetry.js），供第三张图的状态带
	// 和外部（ISAC 那边）按 wall-clock 时间对齐分析用。
	if (typeof dashTelemetry !== 'undefined') {
		dashTelemetry.recordIsacEvent({
			fromMode: previousMode,
			toMode: mode,
			recovering: isac.recovering,
			confirmed: false // 这里只是 ISAC 一侧发的模式切换信号，不代表"确认恢复"，confirmRecovery() 那次会传 true
		});
	}

	if (enteringRecovery) {
		shrinkBandwidthWindowForRecovery();
	} else {
		// 覆盖"上一轮恢复还没确认、又立刻进新一轮 shadowing"这种边界情况，
		// 别让缩短过的窗口一直卡着不还原
		restoreBandwidthWindow();
	}

	// 20260816 修复：recovering 期间（待确认恢复）先不要在这里收缩 buffer 目标。
	// 原因：overlayBuffer 这时候往往已经攒了接近 shadowing 目标（30s）的低清数据，
	// mediaSourceBuffer.js 的 refill() 是"fillState < bufferSize.maxseconds 才发起下一个分片请求"——
	// 如果这里立刻把 maxseconds 砍到 normal 的 4s，fillState(~30) 远大于新目标，refill 会判定
	// "buffer 已经够了"直接停摆（doRefill=false），不再发起任何新请求。没有新请求，
	// DASHttp.js 的 onload 就不会再触发，switchRepresentation() 也就没机会再被调用，
	// confirmRecovery() 永远等不到检查带宽的机会——只能等这些旧数据被真实播放耗尽、
	// fillState 自然掉回 4s 以下才恢复探测，等同于必须把整个 shadowing buffer 播完，
	// 这正是实测里"要等 30s buffer 播完才能回高清"的原因。
	// 所以：recovering 期间维持 shadowing 的 30s 目标不变，让 refill 循环按原节奏继续发
	// 真实分片请求（此时已经不再强制最低码率，选码率交还给真实带宽判断了）——每个新请求
	// 完成都会调用一次 switchRepresentation()，也就持续在"敲门"探测带宽有没有真的恢复。
	// 真正把目标收回 4s，挪到 confirmRecovery() 确认恢复之后再做（见该函数）。
	if (!isac.recovering) {
		applyISACBufferProfile();
	}
}

// 20260815 新增：由 adaptationlogic.js 在"按实测带宽真的选出了比最低码率更高的档位"时调用——
// 这才是确认链路已经恢复的时刻，不是 ISAC 的 normal 信号，也不是靠猜的等待时长。
// 这时候把 overlayBuffer 里还没被送进 MSE（也就是用户还没看到）的旧低清分片直接扔掉一部分，
// 并把"下一个该抓的分片编号"往回倒相应的段数，让它去抓同样的内容、但这次是高清版本。
// 内容顺序完全不受影响，因为被扔掉的分片本来就还没播过。
function confirmRecovery() {

	if (!isac.recovering) return;
	isac.recovering = false;

	// 确认恢复了，带宽预测窗口也该调回正常大小，不然正常播放期间会一直对网络抖动过于敏感
	restoreBandwidthWindow();

	if (typeof overlayBuffer === 'undefined' || !overlayBuffer) return;
	if (typeof adaptation === 'undefined' || !adaptation) return;

	// 留一点 normal 模式的 critical 秒数当安全垫，不清空到 0，
	// 防止万一这次判断超前了一点，手头一点缓冲都不剩就又要等新分片下载
	var keepSeconds = isac.profile.normal.critical;
	var discardSeconds = overlayBuffer.fillState.seconds - keepSeconds;
	var discardSegments = Math.floor(discardSeconds / isac.segLength);

	if (discardSegments > 0) {
		// 20260817：discard 前先记下这段将要被扔掉的内容时间范围，供下面标记 superseded 用。
		var discardRangeEnd = adaptation.currentRepresentation.curSegment * isac.segLength; // 丢弃前，"已经抓到哪"的内容时间点

		// 环形缓冲区里 first=最快要播的、last=最新囤的（还没播过的）那一头，
		// 只回退 last、把 fillState 相应减少，扔掉的是"最新囤的、离现在最远"的那些低清分片，
		// 离当前播放最近的一小段（keepSeconds）留着当安全垫不动
		overlayBuffer.buffer.last -= discardSegments;
		overlayBuffer.fillState.seconds -= discardSegments * isac.segLength;

		adaptation.currentRepresentation.curSegment -= discardSegments;
		if (adaptation.currentRepresentation.curSegment < 0) adaptation.currentRepresentation.curSegment = 0;

		console.log("ISAC: confirmed recovery, discarded " + discardSegments + " stale segment(s), curSegment rewound to " + adaptation.currentRepresentation.curSegment);

		// 20260817 新增：把刚被丢弃、还没真正播出来的那段决策标成 superseded（见 telemetry.js），
		// 这样第一张/第三张图画"最终码率"时会自动跳过它们，不会再叠在一起看不清。
		if (typeof dashTelemetry !== 'undefined') {
			var discardRangeStart = adaptation.currentRepresentation.curSegment * isac.segLength; // 丢弃后，rewind 到的位置
			dashTelemetry.markSuperseded(discardRangeStart, discardRangeEnd);
		}
	}

	// 20260817 新增：把"确认恢复"这个时刻也记进遥测，confirmed:true 是和 setISACMode() 里
	// 单纯的模式切换信号区分开的关键字段——只有这条才代表"实测带宽真的证明链路通了"。
	if (typeof dashTelemetry !== 'undefined') {
		dashTelemetry.recordIsacEvent({
			fromMode: "shadowing",
			toMode: "normal",
			recovering: false,
			confirmed: true,
			discardedSegments: discardSegments > 0 ? discardSegments : 0
		});
	}

	// 20260816 新增：确认恢复之后才真正把 buffer 目标收回 normal 的 4s（原因见 setISACMode() 里的说明）。
	// 不管这次有没有可丢弃的旧分片都要做——否则 buffer 目标会一直停留在 shadowing 的 30s 不收缩。
	// applyISACBufferProfile() 内部会调用 overlayBuffer.signalRefill()，不用再额外调一次。
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
