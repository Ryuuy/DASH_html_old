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
    			    mybps = endBitrateMeasurementByID(this.timeID,data.length);

    			    //这里的mybps是上一个segment的下载速度，用于计算一个推测的速度，然后来控制比特率的选择
    			    myBandwidth.calcWeightedBandwidth(parseInt(mybps),this.timeID);

    			    // 将来改动时，会改动switchRepresentation()里的判断标准以及将来的对策    			 
    			    adaptation.switchRepresentation();
    			    
			    _push_segment_to_media_source_api(buffer, data, presentation, video);
    			    
    			// curSegment大于或等于segmentList.segments-1就是相当于已经下载完所有的segment了   
			    if(presentation.curSegment >= presentation.segmentList.segments-1) video.webkitSourceEndOfStream(HTMLMediaElement.EOS_NO_ERROR);
        
   		 };
	
	beginBitrateMeasurementByID(this._timeID);
	_timeID++;
	xhr.send();
}


// 这个方法是将从服务器那里请求数据放到自定义的buffer里，而不是与播放器直接相关的buffer
// 与播放器直接相关的buffer无法被读取，因此一直监控其播放的进度，当少于2秒了，就赶紧补充一些
function _fetch_segment_for_buffer(presentation, url, video, range, buffer)
{
	//video.width = presentation.width;
	//video.height = presentation.height;
	
    console.log('DASH JS Client fetching segment: ' + url);
	var xhr = new XMLHttpRequest();
	xhr.timeID = _timeID;
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
		mybps = endBitrateMeasurementByID(this.timeID,data.length);
		myBandwidth.calcWeightedBandwidth(parseInt(mybps),this.timeID);
        
		adaptation.switchRepresentation();      // <--- mod this, if you wanna change the adaptation behavior ... (e. g., include buffer state, ...)
                                              //这里，adaptation里面有个属性是指向myBandwidth的，所以不需要另外传入参数
     		   // push the data into our buffer
       		buffer.push(data, 2);
        
        	if(presentation.curSegment >= presentation.segmentList.segments-1) buffer.streamEnded = true; //当下载完所有seg，streamEnd被置真
        
            // 这里触发refill，也就是再次执行这个fetch for buffer，会强行最快优先级一直fetch buffer到max
       		buffer.callback();
		
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
	_fetch_segment_for_buffer(presentation, (baseURL != 'undefined' ? presentation.baseURL : '') + adaptation._getNextChunkP(presentation, presentation.curSegment).src, video, adaptation._getNextChunk(presentation.curSegment).range, buffer);
	presentation.curSegment++;
	
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
