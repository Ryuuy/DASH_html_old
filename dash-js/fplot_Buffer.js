/*
 * fPlotBuffer.js
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

function fPlotBuffer(_canvas, period, width, height) // period will give us the max period length of the function to plot ...
{
	
	this.canvas = _canvas;
	// we will have to check the time!
	this.startTime = new Date().getTime();
	this.f = new Array();
	this.width = width;
	this.height = height;
	this.graphwidth = width - 80;
	this.graphheight = height - 100;
	this.canvas.translate(50, height-100); //translate the origin to the bottom left
	this.canvas.scale(1, -1);
    this.period = period
/*	this.canvas.strokeStyle = "rgba(0,0,0,.5)";
	this.canvas.lineWidth = 0.8;
	this.canvas.beginPath();
	this.canvas.moveTo(0,0);
	this.canvas.lineTo(500000, 0);
	this.canvas.moveTo(0,0);
	this.canvas.lineTo(0,5000000);
	this.canvas.stroke();
	this.canvas.closePath();*/

}

fPlotBuffer.prototype.initNewFunction = function (type) {

	this.f[type] = new Object();
	this.f[type].cnt = 0
	this.f[type].values = new Array();
	this.f[type].timeStamps = new Array();
	this.f[type].timeStampsOver = new Array();

}

fPlotBuffer.prototype.updateOnlyPlaybackTime = function(value, type)
{
    
    
    
}

fPlotBuffer.prototype.update = function(value, type)
{
	this.f[type].values[this.f[type].cnt] = value;	
	this.f[type].timeStamps[this.f[type].cnt] = new Date().getTime();
	this.f[type].cnt++;
	this.plot();
}


fPlotBuffer.prototype.updateBps = function(timeStamp,timeStampOver,DLbps){

    this.f[0].timeStamps[this.f[0].cnt] = timeStamp;
	this.f[0].timeStampsOver[this.f[0].cnt] = timeStampOver;
	this.f[0].values[this.f[0].cnt] = DLbps;
	this.f[0].cnt++;
	this.plot();
}

fPlotBuffer.prototype.plot = function()
{
	// clear the canvas
	
	//this.canvas.translate(-50, -(this.height));
	this.canvas.setTransform(1,0,0,1,0,0);
	this.canvas.clearRect(0,0,this.width,this.height);

	//this.canvas.beginPath();
	//this.canvas.moveTo(0,0);
	//this.canvas.lineTo(180,180);
	//this.canvas.stroke();

	this.canvas.translate(50, this.height-100); //translate the origin to the bottom left
	this.canvas.scale(1, -1);

	// find the maximum for right Y scaling
	var maxY = (parseInt(maxBandwidth/1024/1024)+1)*1000-1;
	var steppingY = 300; // 1000 kbit steps for the Y-axis

    for(var i=0;i<this.f[0].values.length;i++){
          if((this.f[0].values[i]/1024) > maxY) {
               maxY = (this.f[0].values[i])/1024;   //这里一旦选到最大值了，f[n]里那个值一直存在
                                                         //所以以后不会有小于暂定最大值得
               steppingY = maxY/8;
               maxY = maxY*1.09;
           }
         }



	
	//画一个画布的边框box
	this.canvas.strokeStyle = "rgba(0,0,0,0.7)";
	this.canvas.lineWidth = 0.8;
	this.canvas.beginPath();
	this.canvas.moveTo(0,0);
	this.canvas.lineTo(this.width - 80, 0);
	//this.canvas.moveTo(0,0);
	this.canvas.lineTo(this.width - 80,this.height - 100);
	this.canvas.lineTo(0, this.height - 100)
	
	this.canvas.closePath();
	this.canvas.stroke();
	
	
	//将坐标轴的描述加上去
	//plot axis description
	this.canvas.save();

    // 在画坐标轴的描述时，坐标原点以及方向已经被重置
	this.canvas.setTransform(1,0,0,1,0,0);

    // 画纵坐标
     var maxYdraw;
     var steppingYdraw;
     var unit = "(Kbps)";
    if (maxY > 10000){

    	maxYdraw = maxY/1024;
    	steppingYdraw = steppingY/1024; 
    	unit = "(Mbps)"
    }else{

    	maxYdraw = maxY;
    	steppingYdraw = steppingY; 
    }

	for(var n=0; n < maxYdraw/steppingYdraw;n++)
	{
		this.canvas.fillStyle    = 'rgba(7,195,5,1)';
		this.canvas.font         = '10px sans-serif';
		this.canvas.textBaseline = 'top';
		var textDraw = n*steppingYdraw;
		textDraw = textDraw.toFixed(2);
		var metrics = this.canvas.measureText(textDraw);
		this.canvas.fillText(textDraw, 50 - metrics.width, this.graphheight - ((((n*steppingYdraw)/maxYdraw) * this.graphheight)+10));
	}
	// 画左纵坐标，也就是buffer

	var plotBufferMax = 45;
	var plotBufferStep = 5;

	for(var n=0; n < plotBufferMax/plotBufferStep;n++)
	{
		this.canvas.fillStyle    = 'rgba(0,0,0,1)';
		this.canvas.font         = '10px sans-serif';
		this.canvas.textBaseline = 'top';
		var textDraw = n*plotBufferStep;
		//textDraw = textDraw.toFixed(2);
		var metrics = this.canvas.measureText(textDraw);
		this.canvas.fillText(textDraw, this.width - 30, this.graphheight - ((((n*plotBufferStep)/plotBufferMax) * this.graphheight)+10));
	}
	
	// 画横坐标
    
    
    var xCut = 15
    var currentMaxTimeBps = Math.max(...this.f[0].timeStampsOver);
    var currentMaxTimeBuffer = Math.max(...this.f[1].timeStamps);
    var startTime = this.f[0].timeStamps[0];
    var currentMaxTime = (Math.max(currentMaxTimeBps, currentMaxTimeBuffer) - startTime)/1000;
    var steppingX = parseInt(currentMaxTime/xCut)+1;
    var maxX = steppingX*xCut

	for(var n=0; n <= maxX/steppingX;n++)
	{
		this.canvas.fillStyle    = '#00f';
		this.canvas.font         = '10px sans-serif';
		this.canvas.textBaseline = 'top';
		var metrics = this.canvas.measureText(n*steppingX); 
	
		this.canvas.fillText(parseInt(n*steppingX), 50 + (((n*steppingX)/maxX) * this.graphwidth) - metrics.width/2, this.height - 95);
	}
        this.canvas.fillStyle    = '#00f';
        this.canvas.font         = '14px sans-serif';
        this.canvas.textBaseline = 'top';
        var metrics = this.canvas.measureText("Time (Sec)");
        this.canvas.fillText("Time (Sec)", this.graphwidth - metrics.width, this.height - 75);
    
	
		this.canvas.fillStyle    = 'rgba(7,195,5,1)';
		this.canvas.font         = '14px sans-serif';
		this.canvas.textBaseline = 'top';
		var metrics = this.canvas.measureText("Actual Throughput" + unit);
	
		this.canvas.fillText("Actual Throughput " + unit, 10 + metrics.width/2, this.height - 75);
		
		this.canvas.fillStyle    = 'rgba(0,0,0,1)';
		this.canvas.font         = '14px sans-serif';
		this.canvas.textBaseline = 'top';
	//	var metrics = this.canvas.measureText("Representation Bandwidth");
	
		this.canvas.fillText("Buffer Occupancy (Sec)", 10 + metrics.width*2, this.height - 75);
	
    // 这里恢复了移动后的坐标系，原点再左下角
	this.canvas.restore();
	

	
	
	
	// plot all tracked functions
	for(var n = 0; n < this.f.length; n++)
	{   
		if (this.f[n] != null){

			// 画真实bps的图，在第二张画布里才会用到
	     if(n==0){

	     	this.canvas.strokeStyle = "rgba(7,195,5,1)";
            this.canvas.setLineDash([]);

            for(var i=0;i<this.f[n].values.length;i++)
	        {
	        	var startPoint = (this.f[n].timeStamps[i] - startTime)/1000;
	        	var endPoint = (this.f[n].timeStampsOver[i] - startTime)/1000;
	        	var HighPoint = this.f[n].values[i];

	        	this.canvas.beginPath();
                this.canvas.moveTo((startPoint/maxX)*this.graphwidth,0);
                this.canvas.lineTo((startPoint/maxX)*this.graphwidth,(HighPoint/maxY/1024)*this.graphheight);
                this.canvas.lineTo((endPoint/maxX)*this.graphwidth,(HighPoint/maxY/1024)*this.graphheight);
                this.canvas.lineTo((endPoint/maxX)*this.graphwidth,0);
                this.canvas.stroke();
	            this.canvas.closePath();
                }
	        }
		
        if(n==1)
        {
            this.canvas.strokeStyle = "rgba(0,0,0,1)";
            // draw the playback time line
            if (this.f[n].values.length > 0){ 

            this.canvas.setLineDash([]);
            this.canvas.beginPath();
            this.canvas.moveTo(0,0);

            for(var i=0;i<this.f[n].values.length;i++)
		  {
		     var nextX = (this.f[n].timeStamps[i] - startTime)/1000;
		     var nextY = this.f[n].values[i];
		     this.canvas.lineTo((nextX/maxX)*this.graphwidth,(nextY/plotBufferMax)*this.graphheight);
		    	
	       } 

	        this.canvas.stroke();
	        this.canvas.closePath();
           
        }
        

	  }

    }
  }
}