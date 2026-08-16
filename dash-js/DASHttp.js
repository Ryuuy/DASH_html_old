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
var SEGMENT_FETCH_TIMEOUT_MS = 3000;
var SEGMENT_RETRY_INITIAL_DELAY_MS = 500;
var SEGMENT_RETRY_MAX_DELAY_MS = 3000;

// 这个方法是将从服务器那里请求数据放到自定义的buffer里，而不是与播放器直接相关的buffer
// 与播放器直接相关的buffer无法被读取，因此一直监控其播放的进度，当少于2秒了，就赶紧补充一些
function _fetch_segment_for_buffer(presentation, url, video, range, buffer, retryDelay)
{
	//video.width = presentation.width;
	//video.height = presentation.height;

	retryDelay = retryDelay || SEGMENT_RETRY_INITIAL_DELAY_MS;

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
		buffer.push(data, 2);

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
	xhr.ontimeout = xhr.onerror = function()
	{
		console.log('DASH JS Client: segment fetch failed/timeout for ' + url + ', retry in ' + retryDelay + 'ms');

		var segContentTime = adaptation.currentRepresentation.curSegment * 2;
		mybps = endBitrateMeasurementByID(this.timeID, 0, true, segContentTime);
		myBandwidth.calcWeightedBandwidth(parseInt(mybps), this.timeID, true, segContentTime);

		var nextDelay = Math.min(retryDelay * 2, SEGMENT_RETRY_MAX_DELAY_MS);
		window.setTimeout(function () {
			_fetch_segment_for_buffer(presentation, url, video, range, buffer, nextDelay);
		}, retryDelay);
	};


	xhr.addEventListener("progress", rateInProgress);
    
    var loadedPrev = 0; // 每一次请求发出后，就把这个loadPrev置零
	function rateInProgress(e) {
        if (e.lengthComputable) {
           //var percentComplete = e.loaded / e.total * 100;
           //console.log("The timeStamp in the progress is " + e.timeStamp + "; and the has completed " + percentComplete + "%.");
             // ...
          } else {
         // Unable to compute progress information since the total size is unknown
         
         var loadedThisTime = e.loaded - loadedPrev;
         progressData[progressCnt] = loadedThisTime;
         progressTimeStamp[progressCnt] = new Date().getTime();
         //progressTimeStamp[progressCnt] = e.timeStamp;
         progressTimeID[progressCnt] = xhr.timeID;
         //console.log("The received data onProgress is " + loadedThisTime + " at timing of " + e.timeStamp);
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
