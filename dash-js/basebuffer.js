/*
 * basebuffer.js
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
 

// base class for buffer implementations
// 这里定义了一个基本的“类”用于buffer应用

function baseBuffer()
{

	this.fillState = new Object();	// will hold the fill state of the buffer, in time and in bytes
	this.fillState.bytes = 0;
	this.fillState.seconds = 0;		// only seconds are used in the time domain, feel free to use fractions
	this.bufferSize = new Object(); // holds the size of the buffer
	this.bufferSize.maxseconds = 0;
	this.bufferSize.maxbytes = 0;
	this.criticalState = new Object(); // used for signaling that we may run out of buffered data
	this.criticalState.seconds = 0;
	this.criticalState.bytes = 0;
	this.underRunOccured = true;

	//绝对的上限buffer，和绝对的下线buffer，critical和maxseconds是用于临时调整的
	this.upperLimit = 0;
	this.lowerLimit = 0;
	
	this.eventHandlers = new Object();
	this.eventHandlers.handler = new Array();
	this.eventHandlers.cntHandlers = 0;
	
    //增加一个observer来观测buffer的量
	this.observers = new Array();
	this.observer_num = 0;
	this.identifier = 1;
	
	// buffer array, ring buffer ...
	this.buffer = new Object;
	this.buffer.array = new Array();
	this.buffer.first = 0; //环形buffer的第一个segment编号
	this.buffer.last = 0;  //环形buffer的最后一个segment编号
	this.buffer.size = 0;  //有几个buffer，每个buffer装一个segment的数据
	this.streamEnded = false;
	this.isOverlayBuffer = false;		// Overlay buffers are only used to mimic the behaviour of an HTML element or a video player where we have no access to the buffer of the unit
}

baseBuffer.prototype.initBufferArray = function(dimension,seglength)
{
	this.buffer.size = this.bufferSize.maxseconds / seglength;
	console.log("Buffer size: " + this.buffer.size);
	
	for(i = 0; i < (this.bufferSize.maxseconds / seglength); i++)
	{
		this.buffer.array[i] = new Object();
	}
	
}

baseBuffer.prototype.registerEventHandler = function(event, handler)
{
	this.eventHandlers.handler[this.eventHandlers.cntHandlers] = new Object();
	this.eventHandlers.handler[this.eventHandlers.cntHandlers].fn = handler;
	this.eventHandlers.handler[this.eventHandlers.cntHandlers].event = event;
	this.eventHandlers.cntHandlers++;
}

baseBuffer.prototype.callEvent = function(event,data)
{
	for(i=0;i<this.eventHandlers.handler.length;i++)
	{
		if(this.eventHandlers.handler[i].event == event) this.eventHandlers.handler[i].fn(data);
	}
}


baseBuffer.prototype.drain = function(dimension,amount)  //这里是慢慢地每两秒两秒地把buffer里的东西吐到MSE API的真正buffer里
                                                         //并非是去掉，这里的drain当然吐出来一些，buffer里东西就少一些                                                         
{
	//console.log("Draining buffer: " + object);
	if(dimension == "bytes")
	{
		if(this.fillState.bytes == 0 && this.streamEnded) return -1;
		if(this.fillState.bytes <= this.criticalState.bytes && !this.streamEnded)
        {
            this.callEvent("minimumLevel");
            return 0;
        }else{
            this.fillState.bytes -= amount;
            return this.get();
            
        }
    }
	
	if(dimension == "seconds")
	{
		
		if(this.fillState.seconds == 0 && this.streamEnded) return -1;
		
        if(this.fillState.seconds <= this.criticalState.seconds && !this.streamEnded) 
        {
        	//> The fill state is going below critical level. Signal minimumLevel event
        	// 一旦触发了这个event,也就是refill，会直接充满
        	//这个Event会在下面的if之后执行，原因不明确。。。
        	
            //this.callEvent("minimumLevel");
            
            //sleep(50000);
            //> But, if there is data in buffer, return that data if buffer underrun did not occur
            //> If there was buffer underrrun, we need to buffer for minimun buffer level before playing
            //> again
            //console.log("Check when to trigger callEvent")
            //这里比上一个this.callEvent先被触发，因此buffer里还有东西，也会被先拿出去一些，再执行充满

            //这里的underRunOccure的设置，使得一旦发生了buffer枯竭，必须要重新buffer充满到critical level才让重新播放
            //if (this.fillState.seconds > 0 && this.underRunOccured == false) {
            
            //这里一旦充满一个seg就又开始播放
            //2018.6.21修改逻辑，这里在触发请求refill时，提前将fillstate减去2秒，这样可以实现，Bmin和Bmax最小间隔2s
            if (this.fillState.seconds > 0 && this.underRunOccured == false) {	
            	this.fillState.seconds -= amount;
            	this.callEvent("minimumLevel");
                return this.get();
            }
            else if (this.fillState.seconds==0 && this.mediaElementBufferedUnderRun == true){
            	//> Signal Buffer underrun
            	this.callEvent("minimumLevel");
            	console.log("Buffer underrun!");
            	this.underRunOccured = true;
            }
            else if (this.fillState.seconds >= this.playStartLimit && this.underRunOccured == true){
            	
                this.underRunOccured = false; //在充满了playStartLimit过后又可以重新
            }

            
            
        }
        else{
        	//> Set under run occured false as there is enough buffer filled now
            this.underRunOccured = false;
            this.fillState.seconds -= amount;
            return this.get();
        }
    }	    
    return 0;
}

baseBuffer.prototype.state = function(dimension) {	//return buffer fill level in percent

	if(dimension == "bytes")
	{
	
		return (this.fillState.bytes / this.bufferSize.maxbytes)*100;
		
	}
	
	if(dimension == "seconds")
	{
		
		return (this.fillState.seconds / this.bufferSize.maxseconds)*100;
	}
	
	return -1;
	
}

baseBuffer.prototype.add = function(data)
{   
    //this.notify();
	//console.log("Adding chunk: " + this.buffer.last % this.buffer.size);
	//console.log("Fill state: " + this.fillState.seconds);
	this.buffer.array[this.buffer.last++ % this.buffer.size] = data

}

baseBuffer.prototype.get = function()
{   
    //this.notify();
	//console.log("Getting chunk: " + this.buffer.first % this.buffer.size);
	//console.log("Fill state: " + this.fillState.seconds);
	return this.buffer.array[this.buffer.first++ % this.buffer.size];
}

baseBuffer.prototype.addObserver = function (_obj){
	this.observers[this.observer_num++] = _obj;
	
}

baseBuffer.prototype.notify = function(){
	if(this.observers.length > 0){
		
		for(var i=0;i< this.observers.length; i++)
		{
			this.observers[i].update(this.fillState.seconds + this.mediaElementBuffered, this.identifier); // update 在fPlot类中有定义
		}
	}
}

function sleep(numberMillis) { 
var now = new Date(); 
var exitTime = now.getTime() + numberMillis; 
while (true) { 
now = new Date(); 
if (now.getTime() > exitTime) 
return; 
} 
}