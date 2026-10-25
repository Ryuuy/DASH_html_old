/*
 * DASHttp.js
 *****************************************************************************
 * Copyright (C) 2012 - 2013 Alpen-Adria-Universit�t Klagenfurt
 *
 * Created on: Feb 13, 2012
 * Authors: Benjamin Rainer <benjamin.rainer@itec.aau.at>
 *          Stefan Lederer  <stefan.lederer@itec.aau.at>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published
 * by the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston MA 02110-1301, USA.
 *****************************************************************************/
 
 var _timeID = 0;   //执行的请求segment的次数标号，从init开始算，从0开始
 var _tmpvideo;
 var _cacheControl;

 var progressCnt = 0; //用于计数，onprogress被触发的次数
 var progressData = new Array();  //用于存放 loaded 数据
 var progressTimeStamp = new Array();
 var progressTimeID = new Array();

// ===== 20261016 新增：多分辨率（1080p/1440p/4K/8K）支持 =====
// 背景：以前 MPD 里所有档位分辨率一样，换码率只是换分片、init 只在开头塞一次；
// 一旦档位分辨率不同，必须在新分辨率的第一个分片前面先给 MSE 喂这个档位自己的 init。
// 做法：MPD 里出现 >1 种分辨率时 DASH_MULTIRES=true，之后每个分片下载完、推进环形 buffer 之前，
// 在分片字节前面拼上它所属档位的 init（只有几百字节~1 KB；MSE 允许 init+media 一起 append，
// 重复收到 init 也没问题）。这样不管 refill/恢复流程怎么回退、丢弃 buffer，每个槽位都是自包含的，
// 不需要记"上一个喂进 MSE 的是哪个分辨率"。
// 测速不受影响：吞吐是在拼接之前用 data.length 算的（见 onload）。
// 只有一种分辨率的 MPD（比如 bunny）DASH_MULTIRES=false，行为和以前完全一致。
var DASH_MULTIRES = false;
var dashInitCache = {};   // init 的完整 URL -> Uint8Array

function dashInitUrl(rep, mpd)
{
	var base = (rep.baseURL && rep.baseURL != false) ? rep.baseURL : (mpd ? mpd.baseURL : '');
	return base + rep.initializationSegment.src;
}

// 在 MPD 解析完后调用一次：判断是否多分辨率，并把每个档位的 init 预取到缓存里
function dashSetupMultiRes(mpd)
{
	var reps = mpd.period[0].group[0].representation;
	var sizes = {};
	reps.forEach(function (r) { sizes[parseInt(r.width) + "x" + parseInt(r.height)] = true; });
	DASH_MULTIRES = Object.keys(sizes).length > 1;
	console.log("DASH-JS: " + Object.keys(sizes).length + " distinct resolution(s) in MPD -> DASH_MULTIRES=" + DASH_MULTIRES);
	if (!DASH_MULTIRES) return;
	reps.forEach(function (r) {
		if (!r.hasInitialSegment) return;
		var url = dashInitUrl(r, mpd);
		if (dashInitCache[url]) return;
		var xhr = new XMLHttpRequest();
		xhr.open('GET', url, true);
		xhr.responseType = 'arraybuffer';
		xhr.onload = function () { if (xhr.status == 200) dashInitCache[url] = new Uint8Array(xhr.response); };
		xhr.send();
	});
}

// 拼接 init + 分片。缓存里没有就同步抓一次（只在预取没赶上时发生，init 很小）。
function dashPrependInit(rep, data)
{
	if (!DASH_MULTIRES || !rep || !rep.hasInitialSegment) return data;
	var url = dashInitUrl(rep, adaptation.mpd);
	var init = dashInitCache[url];
	if (!init) {
		var sx = new XMLHttpRequest();
		sx.open('GET', url, false);
		sx.overrideMimeType('text/plain; charset=x-user-defined');
		try { sx.send(); } catch (e) { console.log("DASH-JS: sync init fetch failed " + url); return data; }
		if (sx.status != 200) return data;
		var s = sx.responseText, u = new Uint8Array(s.length);
		for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
		dashInitCache[url] = init = u;
	}
	var out = new Uint8Array(init.length + data.length);
	out.set(init, 0);
	out.set(data, init.length);
	return out;
}

function DASHttp()
{
	
	
}


// this method is used by the mediaSourceBuffer to push segments in
// 这个方法是将buffer里的data推入到MSE API中的mediaSourceBuffer里，这与播放直接相关
// 这里presentation 和 video 并没有被用到
function _push_segment_to_media_source_api(buffer, data, presentation,video)
{
    console.log("DASH-JS client: appending data of length: " + data.length + " to the Media Source Buffer with id: "+ buffer.id);
    
    //这里是用了MediaSource.sourceBuffer.appendBuffer()这个内置函数来将data推入到MSE的真正mediaSourceBuffer里

    sourceBufferAppend(dashPlayer.MSE, buffer.id, data);	
    
    //sourceBufferAppend(dashPlayer.MSE, 1, data);
    //sourceBufferAppend(dashPlayer.MSE, 2, data);
}


// 这里只在opensource的时候执行一次，这里是抓取init的，这里抓取后不放入自定义的buffer，而是直接推入MSE里面
function _fetch_segment(presentation, url, video, range, buffer)
{
	console.log('DASH JS Client fetching segment: ' + url);
	var xhr = new XMLHttpRequest();
	xhr.timeID = _timeID;
	xhr.open('GET', url, true);
	xhr.setRequestHeader('Cache-Control', _cacheControl);
	if(range != null)  //这里的range并没有定义，只是一个预备接口，可能为以后按照规定byte量读取数据做准备
	{
		xhr.setRequestHeader('Range', 'bytes='+range);
		console.log('DASH JS Client fetching byte range: ' + range);
	}
    
	xhr.responseType = 'arraybuffer';
    
	//_tmpvideo = video;
	xhr.onload = function(e)
   		 {
        
     			    data = new Uint8Array(this.response);
     			    //data = this.response
     			    // 20260816：这个分片对应的视频内容时间点（秒），透传给下面的测速/选码率/画图，
     			    // 让第一张图的横坐标是真实内容时间轴（见 fplot_partial.js 里的说明）
     			    var segContentTime = presentation.curSegment * 2;
    			    mybps = endBitrateMeasurementByID(this.timeID,data.length, false, segContentTime);

    			    //这里的mybps是上一个segment的下载速度，用于计算一个推测的速度，然后来控制比特率的选择
    			    myBandwidth.calcWeightedBandwidth(parseInt(mybps),this.timeID, false, segContentTime);

    			    // 将来改动时，会改动switchRepresentation()里的判断标准以及将来的对策
    			    // 20260817：多传一个 mybps（这次实测吞吐），记进 dashTelemetry 用，不影响选码率判断
    			    adaptation.switchRepresentation(segContentTime, mybps);
    			    
			    _push_segment_to_media_source_api(buffer, data, presentation, video);
    			    
    			// curSegment大于或等于segmentList.segments-1就是相当于已经下载完所有的segment了   
			    if(presentation.curSegment >= presentation.segmentList.segments-1) video.webkitSourceEndOfStream(HTMLMediaElement.EOS_NO_ERROR);
        
   		 };
	
	beginBitrateMeasurementByID(this._timeID);
	_timeID++;
	xhr.send();
}


// 20260815 新增：_fetch_segment_for_buffer 的超时/重试参数。
// 这几个数字只是通用的"多久算卡住""重试间隔多快涨"网络重试参数，不是在猜遮挡恢复具体要多少秒——
// 不管链路实际卡了 3 秒还是 15 秒，下面的重试都会自己一直敲到通，不依赖这几个数字猜得准不准。
// 20261025：实测（无头 Chrome + 数据面探测，probe_runs/20261025_193213_page）发现链路恢复后第一个能到的请求，
// 第一字节要等约 2.6–3.0 s，再下 1–2 s 大分片，总共 >3 s，被 3 s 超时截断，再加上翻倍的重试间隔，
// 页面比数据面慢 6–13 s 才下到第一个分片。所以：超时 3000 -> 8000（XHR.timeout 是整个请求从 send 到收完的总时长，
// 不是"有数据就续命"）；重试间隔 500/1000/2000/3000 递增 -> 固定 200 ms（INITIAL=MAX 就不再翻倍）。
var SEGMENT_FETCH_TIMEOUT_MS = 8000;
var SEGMENT_RETRY_INITIAL_DELAY_MS = 200;
var SEGMENT_RETRY_MAX_DELAY_MS = 200;

// 这个方法是将从服务器那里请求数据放到自定义的buffer里，而不是与播放器直接相关的buffer
// 与播放器直接相关的buffer无法被读取，因此一直监控其播放的进度，当少于2秒了，就赶紧补充一些
function _fetch_segment_for_buffer(presentation, url, video, range, buffer, retryDelay, attempt)
{
	//video.width = presentation.width;
	//video.height = presentation.height;

	retryDelay = retryDelay || SEGMENT_RETRY_INITIAL_DELAY_MS;
	// 20261025：这是同一个分片的第几次尝试（1 = 第一次），连同每次请求的起止时间一起记进遥测（dashTelemetry.requests），
	// 以前失败/超时/重试完全没有记录，快照里只看得到最后成功的那次。
	attempt = attempt || 1;
	var reqStartWall = Date.now();

	// 20260826 新增：给下面 rateInProgress() 用的近似内容时间点——发起请求这一刻
	// curSegment 指向的就是这次要抓的分片，跟 onload 里 segContentTime 算法一致。
	// 只是"近似"：真实下载过程中内容时间不会变（一次请求对应一个 2 秒的分片），
	// 这里只是给细粒度网速图/导出的每个进度采样点一个可用的横坐标。
	var segContentTimeForProgress = adaptation.currentRepresentation.curSegment * 2;

    console.log('DASH JS Client fetching segment: ' + url);
	var xhr = new XMLHttpRequest();
	xhr.timeID = _timeID;
	xhr.timeout = SEGMENT_FETCH_TIMEOUT_MS;
	xhr.open('GET', url, true);
	xhr.setRequestHeader('Cache-Control', _cacheControl);
	if(range != null)
	{
		xhr.setRequestHeader('Range', 'bytes='+range);
		console.log('DASH JS Client fetching byte range: ' + range);
	}

	xhr.responseType = 'arraybuffer';
	xhr.buffer = buffer;
	//_tmpvideo = video;
	xhr.onload = function(e)
	{

		data = new Uint8Array(this.response);

		if (typeof dashTelemetry !== 'undefined') {   // 20261025：记这次请求成功
			dashTelemetry.recordRequest({ url: url, attempt: attempt, startWall: reqStartWall, endWall: Date.now(), state: 'ok',
				httpStatus: this.status, bytes: data.length, timeoutMs: SEGMENT_FETCH_TIMEOUT_MS,
				representationId: adaptation.representationID });
		}

		// 20260816：这个分片实际对应的视频内容时间点（秒）——curSegment 这时候还没 ++，
		// 正好指向"刚下载完的这个分片"。一路透传给带宽估计/选码率/画图，让第一张图的横坐标
		// 是真实内容时间轴，而不是"这是第几次调用"这种容易被重试次数打乱的下标
		// （见 fplot_partial.js / bandwidth.js / adaptationlogic.js 里的说明）。
		var segContentTime = adaptation.currentRepresentation.curSegment * 2;

		mybps = endBitrateMeasurementByID(this.timeID, data.length, false, segContentTime);
		myBandwidth.calcWeightedBandwidth(parseInt(mybps), this.timeID, false, segContentTime);

		// 20260815：改到成功了才前进，配合下面的失败重试——重试时绝不能推进序号，否则会跳过内容。
		// 注意：这里故意用 adaptation.currentRepresentation（当前"实时"指向哪个码率），而不是
		// 闭包捕获的 presentation（发起这次请求那一刻指向的码率对象）——因为这次请求在飞的过程中，
		// 可能有另一个并发请求的 onload 先跑完 switchRepresentation() 把 currentRepresentation
		// 切到了别的码率对象上；如果这里还去改旧的 presentation.curSegment，这个前进就会打在一个
		// 已经没人再用的"僵尸"码率对象上，实际在用的那个对象的 curSegment 永远不会前进，
		// 导致 refill 循环反复重新请求同一个分片、后面的内容永远抓不到（表现为播到那一秒就卡死）。
		// 只有页面刚打开、init 分片和第 1 个内容分片并发下载的这一小段时间会出现两个请求同时在飞，
		// 之后 refill 循环是严格一次一个，不会再有这个竞争。
		adaptation.currentRepresentation.curSegment++;

		// 20260816 修复：push 必须在 switchRepresentation() 之前——见下面的说明。
		// switchRepresentation() 在 isac.recovering 时可能触发 confirmRecovery()，
		// 它会直接改 overlayBuffer.buffer.last / fillState.seconds / curSegment，
		// 用来丢弃"还没抓到"的旧低清分片、把下一个要抓的位置往回倒。
		// 但如果这行 push 还留在 switchRepresentation() 之后，push 进去的 data
		// 是这次请求在飞的时候（confirmRecovery 还没跑）就已经下载好的字节，对应的是
		// "改动前"的那个位置；一旦 confirmRecovery 先把 buffer.last 往回倒了，
		// 这个 push 就会把这份旧位置的数据错写进一个刚被标记成"更早位置"的槽位里——
		// 环形缓冲区里这个槽位的字节内容（真实是很靠后的内容）和它的位置编号（被改成很靠前）对不上，
		// 播放到这个槽位时 MSE 收到的分片时间戳和期望的对不上，表现为过几秒（正好是安全垫的时长）
		// 之后视频直接卡死。把 push 挪到 switchRepresentation() 之前，就能保证这次 push
		// 落在的槽位，永远是"下载发起时"就已经确定、还没被 confirmRecovery 之后再改动过的位置，
		// confirmRecovery 的丢弃/回退只会影响这次 push 之后、还没发起的下一个请求，不会影响已经落盘的这一段。
		// 20261016：多分辨率 MPD 时，在分片前面拼上它所属档位（presentation = 发起请求时的档位）的 init。
		// 吞吐在上面已经用拼接前的 data.length 算完了，不受影响。
		buffer.push(dashPrependInit(presentation, data), 2);

		// 20260826 新增：在 switchRepresentation()（可能改 adaptation.representationID）之前，
		// 把"这个刚下载完、已经 push 进 buffer 的分片，是用哪个档位抓的"记下来，供第四张图
		// （fplot_BufferByRep.js）画"剩余 buffer 按码率堆叠"用。必须放在这一行，不能放调用之后——
		// 理由同 fplot_BufferByRep.js 文件头注释：这里的 adaptation.representationID 还没被这次
		// switchRepresentation() 重新赋值，对应的正是这个分片实际用的档位，不会有错位。
		if (typeof myFplotBufferRep !== 'undefined' && myFplotBufferRep) {
			myFplotBufferRep.recordFetchedSegment(segContentTime, segContentTime + 2, adaptation.representationID);
		}

		// 20260817：多传一个 mybps（这次实测吞吐），记进 dashTelemetry 用，不影响选码率判断
		adaptation.switchRepresentation(segContentTime, mybps);      // <--- mod this, if you wanna change the adaptation behavior ... (e. g., include buffer state, ...)
                                              //这里，adaptation里面有个属性是指向myBandwidth的，所以不需要另外传入参数

        	if(adaptation.currentRepresentation.curSegment >= presentation.segmentList.segments-1) buffer.streamEnded = true; //当下载完所有seg，streamEnd被置真

            // 这里触发refill，也就是再次执行这个fetch for buffer，会强行最快优先级一直fetch buffer到max
       		buffer.callback();

	};

	// 20260815 新增：请求超时或直接失败，都当作这次没抓到——退避一下重试同一个分片
	// （url/range 都没变，因为 curSegment 只在上面 onload 成功时才推进），不 push 数据、不触发 callback。
	// 顺手把这次失败也计入带宽测量（当一次 0bps 的采样），这样带宽估计如实反映"最近在挨饿"，
	// adaptationlogic.js 那边自然会继续选最低码率，不会在链路真恢复之前误判。
	// 20260816：给这两个调用都传"跳过第一张图 plot"的参数——重试不是一次真正完成的分片，
	// 不把它画进第一张图，避免同一个内容位置反复出现好几个 0bps 的点，图更干净
	// （现在横坐标已经改成用 xPos/真实内容时间点了，就算画出来也不会再错位，这里只是不想画）。
	// 顺手也算出 xPos 传下去，虽然目前跳过画图用不上，留着是为了以后如果想改成"画出来"更方便。
	xhr.ontimeout = xhr.onerror = function(ev)
	{
		console.log('DASH JS Client: segment fetch failed/timeout for ' + url + ', retry in ' + retryDelay + 'ms');
		if (typeof dashTelemetry !== 'undefined') {   // 20261025：记这次请求失败（timeout = 超时被取消，error = 网络错误）
			dashTelemetry.recordRequest({ url: url, attempt: attempt, startWall: reqStartWall, endWall: Date.now(),
				state: (ev && ev.type === 'timeout') ? 'timeout' : 'error', httpStatus: this.status, bytes: 0,
				timeoutMs: SEGMENT_FETCH_TIMEOUT_MS, nextRetryMs: retryDelay, representationId: adaptation.representationID });
		}

		var segContentTime = adaptation.currentRepresentation.curSegment * 2;
		mybps = endBitrateMeasurementByID(this.timeID, 0, true, segContentTime);
		myBandwidth.calcWeightedBandwidth(parseInt(mybps), this.timeID, true, segContentTime);

		var nextDelay = Math.min(retryDelay * 2, SEGMENT_RETRY_MAX_DELAY_MS);
		window.setTimeout(function () {
			_fetch_segment_for_buffer(presentation, url, video, range, buffer, nextDelay, attempt + 1);
		}, retryDelay);
	};


	xhr.addEventListener("progress", rateInProgress);

    var loadedPrev = 0; // 每一次请求发出后，就把这个loadPrev置零
    var prevTickWallClock = null; // 20260826 新增：上一次 progress 事件的墙钟时间，算 tick 间的瞬时速率用
	function rateInProgress(e) {
        if (e.lengthComputable) {
           //var percentComplete = e.loaded / e.total * 100;
           //console.log("The timeStamp in the progress is " + e.timeStamp + "; and the has completed " + percentComplete + "%.");
             // ...
          } else {
         // Unable to compute progress information since the total size is unknown
         // 20260826 注：server7.js 的响应没设 Content-Length（走 chunked），所以浏览器这边
         // e.lengthComputable 恒为 false，实际记录数据的就是这个分支——下面这份 progressData
         // 数组以前只喂给 create_logs.js 的原始文本导出，现在多了一个真正的用途：算出比
         // "一个分片一个平均值（2秒一个点）"细得多的瞬时网速采样，见下面对 myFplotNetSpeed 的调用

         var loadedThisTime = e.loaded - loadedPrev;
         var nowTick = new Date().getTime();
         progressData[progressCnt] = loadedThisTime;
         progressTimeStamp[progressCnt] = nowTick;
         //progressTimeStamp[progressCnt] = e.timeStamp;
         progressTimeID[progressCnt] = xhr.timeID;
         //console.log("The received data onProgress is " + loadedThisTime + " at timing of " + e.timeStamp);

         // 20260826 新增：算这一小段 tick 之间的瞬时 bps，喂给第五张图（细粒度网速）。
         // 第一个 tick 没有"上一个 tick"可比，跳过（等下一个 tick 才有有效区间）。
         if (prevTickWallClock !== null && loadedThisTime > 0) {
             var deltaMs = nowTick - prevTickWallClock;
             if (deltaMs > 0) {
                 var instBps = (loadedThisTime * 8 / deltaMs) * 1000;
                 if (typeof myFplotNetSpeed !== 'undefined' && myFplotNetSpeed) {
                     myFplotNetSpeed.recordFineSample(prevTickWallClock, nowTick, segContentTimeForProgress, instBps);
                 }
             }
         }
         prevTickWallClock = nowTick;

         loadedPrev = e.loaded;
         progressCnt++;

         }
    }
    
    
    
	
	beginBitrateMeasurementByID(this._timeID);
	_timeID++;
	xhr.send();
	
}



// 这里只在opensource的时候执行一次，这里是抓取init的，这里抓取后不放入自定义的buffer，而是直接推入MSE里面
// 在这第一次执行里，MSE自定义的addSourceBuffer被触发然后建立了一个新的buffer				
function _dashSourceOpen(buffer, presentation, video, mediaSource)
{
	// check the parsed mpd
	// fetch a representation and check whether selfinitialized or ...
		
	//video.width = presentation.width;
	//video.height = presentation.height;

	console.log("DASJ-JS: content type: " + presentation.mimeType + '; codecs="' + presentation.codecs + '"');
	addSourceBuffer(mediaSource, buffer.id, presentation.mimeType + '; codecs="' + presentation.codecs + '"');

	// 20261019：把 MediaSource 总时长固定为 MPD 总时长。否则 <video controls> 进度条总长 = 当前已 append 的末尾，
	// 每加一片就变，白条会先冲到一半再往回退。
	try {
		var totalDur = parsePT(dashInstance.mpdLoader.mpdparser.pmpd.mediaPresentationDuration);
		if (totalDur > 0 && mediaSource.readyState === 'open' && !(mediaSource.duration >= totalDur)) mediaSource.duration = totalDur;
	} catch (e) { console.log("set MediaSource.duration failed: " + e); }

	
	if(presentation.hasInitialSegment == false)
	{
        	baseURL = presentation.baseURL;
		_fetch_segment(presentation, (baseURL != 'undefined' ? presentation.baseURL : '') + adaptation._getNextChunkP(presentation, presentation.curSegment).src, video, adaptation._getNextChunk(presentation.curSegment).range, buffer);
	
		if(presentation.curSegment > 0 ) presentation.curSegment = 1;
		presentation.curSegment++;
				
	}else{
		baseURL = presentation.baseURL;
		_fetch_segment(presentation, (baseURL != 'undefined' ? presentation.baseURL : '') + adaptation.getInitialChunk(presentation).src, video, adaptation.getInitialChunk(presentation).range, buffer);
		//presentation.curSegment++;

	}
			
}


function _dashFetchSegmentBuffer(presentation, video, buffer)
{
	if(presentation.curSegment >= presentation.segmentList.segments-1) {
        return;
    }
    baseURL = presentation.baseURL;
	// 20260815：curSegment 不在这里前进了，改到 _fetch_segment_for_buffer 的 onload 成功时才前进
	// （见该函数内注释），这样失败重试时才能安全地重复调用同一个分片而不跳过内容。
	_fetch_segment_for_buffer(presentation, (baseURL != 'undefined' ? presentation.baseURL : '') + adaptation._getNextChunkP(presentation, presentation.curSegment).src, video, adaptation._getNextChunk(presentation.curSegment).range, buffer);

}


// 这个函数会在refill时触发
function _dashFetchSegmentAsynchron(buffer, callback)  // callback没有函数传入，也不会执行
{
	_dashFetchSegmentBuffer(adaptation.currentRepresentation, adaptation.mediaElement, buffer);
}
 


function initDASHttp(cacheControl, URL)
{
	_timeID = 0;
	_cacheControl = cacheControl;
	console.log("Can show the URL: " + URL)
	
}
