/*
 * mediaSourceBuffer.js
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
var _mediaSourceBuffer;



function mediaSourceBuffer(id)
{
	this._eventHandlers = new Object();
	this._eventHandlers.cnt = 0;
	this._eventHandlers.handlers = new Array();
    this.mediaElementBuffered = 0;   //这里是MSE 这里面的直接与播放相关的buffer所包含的以缓冲的时间长度，
                                     //不是自定义的与服务器交流的buffer 
   	this.lastTime = 0;
    //this.fill = false; //这个参数没有被用到
    this.doRefill = false;
	this.id = id;
}


function init_mediaSourceBuffer(bufferId, criticalLevel,buffersize, playStartLimit, mediaAPI, videoElement, playbackTimePlot)
{
	
	mediaSourceBuffer.prototype = new baseBuffer();
	
	mediaSourceBuffer.prototype.addEventHandler = function (fn)  //显示当前fillState的状态
	{
		// handlers will get the fillstate ...
		
		this._eventHandlers.handlers[this._eventHandlers.cnt] = new Object();
		this._eventHandlers.handlers[this._eventHandlers.cnt].fn = fn;
		this._eventHandlers.cnt++;
	}
	
	
	mediaSourceBuffer.prototype.callEventHandlers = function ()
	{
		
		for(i=0;i<this._eventHandlers.cnt; i++) 
		{
			this._eventHandlers.handlers[i].fn(this.getFillLevel(),this.fillState.seconds, this.bufferSize.maxseconds);
        }
	}
	
	mediaSourceBuffer.prototype.bufferStateListener = function(object){
		
		
        object.mediaElementBuffered -= dashPlayer.videoTag.currentTime - object.lastTime;  //时刻监视着MSE里面的缓冲时长
                                                                                            //不能直接访问，所以作减法
        
        //这里判断是否真的MSE播放已经发生卡顿，当MSE发生卡顿且bufferState为0，才判定为真的卡顿
        if (object.mediaElementBuffered == object.mediaElementBufferedLastTime){

        	object.mediaElementBufferedUnderRun = true;
        }else{
        	object.mediaElementBufferedUnderRun = false;
        }

        this.notify();                                                                                  
        //这里才是真正的视频卡顿，MSE对象中的buffer枯竭的话，强行记录枯竭的时刻并在buffer图里画出
        /*
        if(object.mediaElementBuffered < 0.1){

        	myFplot2.update(0,1);
        	console.log("Buffer underrun in MSE element occured")
        	
        }
        */
        //这里是慢慢地每两秒两秒地把buffer里的东西吐到MSE API的真正buffer里
        //并非是去掉，这里的drain当然吐出来一些，buffer里东西就少一些
        if(object.mediaElementBuffered < 2) {
           
            rc = object.drain("seconds",2);
            
            if (rc == -1)
            {
                // signal that we are done!
                
                dashPlayer.videoTag.webkitSourceEndOfStream(HTMLMediaElement.EOS_NO_ERROR);
                return;
            }
            
            if (rc != 0)
            {
                //将buffer里的数据推入到MSE API中
                _push_segment_to_media_source_api(_mediaSourceBuffer, rc);		// the new MediaAPI allows to have more than one source buffer for the separate decoding chains (really nice) so we may support resolution switching in the future
                this.mediaElementBuffered += 2;

            }
            
            
            
            
        } 

        object.mediaElementBufferedLastTime = object.mediaElementBuffered;
        object.lastTime = dashPlayer.videoTag.currentTime;
      
        //每100ms就监视一次buffer的量，与myplot playbackTime update那里类似，
        //当判断出mediaElementBuffered小于2s了，就触发重新注入新buffer，这里只是一个标记，没有存真的buffer
        window.setTimeout(function () {_mediaSourceBuffer.bufferStateListener(_mediaSourceBuffer);},100);
			
	}
    
    // this is the callback method, called by the AJAX xmlhttp call
   	mediaSourceBuffer.prototype.callback = function(){
        
        	window.setTimeout(function () {_mediaSourceBuffer.refill(_mediaSourceBuffer);},0,true);
        
        
    	}
    
	mediaSourceBuffer.prototype.signalRefill = function()
	{
        
		if(_mediaSourceBuffer.doRefill == false)
        {   
            console.log("signaling refill");
            _mediaSourceBuffer.doRefill = true;
            _mediaSourceBuffer.refill(_mediaSourceBuffer);  // asynch ... we will only dive once into this method
        }                                                   // 一旦被触发refill，那么通过callback，会一直fill到满
	}
	
	mediaSourceBuffer.prototype.getFillLevel = function()
	{
		return this.state("seconds");  //return buffer fill level in percent
	}
	
	mediaSourceBuffer.prototype.push = function(data,segmentDuration)
	{
		
       		_mediaSourceBuffer.fillState.seconds += segmentDuration;
        	_mediaSourceBuffer.add(data);
	
	}	
	
    
	
	mediaSourceBuffer.prototype.refill = function(object){
		
        if(object.doRefill == true){
        
            if(object.fillState.seconds < object.bufferSize.maxseconds){
        
                //console.log("Overlay buffer...");
                //console.log(object);
                //console.log("Fill state of overlay buffer: " + object.fillState.seconds);
		
		
                _dashFetchSegmentAsynchron(object);	
		
                object.callEventHandlers();  //显示当前buffer的状态，这个是在drain之前被显示，因此会大于等于minlevel
                                             //这时候fetch命令已经发出，但是还没回应，在等drain那里完成
            }else{
                object.doRefill = false;  //当fillState.seconds达到了max了，doRefill就重置为false了
            }
		}
	}
	
    _mediaSourceBuffer = new mediaSourceBuffer(bufferId);
	_mediaSourceBuffer.isOverlayBuffer = true;
	_mediaSourceBuffer.criticalState.seconds = criticalLevel;
	_mediaSourceBuffer.bufferSize.maxseconds = buffersize;
   	_mediaSourceBuffer.initBufferArray("seconds",2); // 这里的2是每个segment的大小，这里固定为2了，应该是根据mpd选择
	//_mediaSourceBuffer.mediaAPI = mediaAPI;  //从来未用到过
	_mediaSourceBuffer.videoElement = videoElement;
	_mediaSourceBuffer.lastTime = 0;
	_mediaSourceBuffer.mediaElementBufferedLastTime = 0;
	_mediaSourceBuffer.mediaElementBufferedUnderRun = true;
	_mediaSourceBuffer.id = bufferId;
   	_mediaSourceBuffer.playbackTimePlot = playbackTimePlot;
	_mediaSourceBuffer.registerEventHandler("minimumLevel", _mediaSourceBuffer.signalRefill);
	_mediaSourceBuffer.upperLimit = buffersize;
	_mediaSourceBuffer.lowerLimit = criticalLevel;
	_mediaSourceBuffer.playStartLimit = playStartLimit;
		
	
	return _mediaSourceBuffer;
}

