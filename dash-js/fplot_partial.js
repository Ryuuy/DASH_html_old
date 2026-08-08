// 2018.6.30 在plot中加入一个每个segment真实的下载速率的表示。与estimated以及rate形成对比
// 2018.6.24 1.改写estimated 和  selected rate的plot，不再翻页，而是一直表示

/*
 * fPlot.js
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



function fPlot(_canvas, period, width, height) // period will give us the max period length of the function to plot ...
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

fPlot.prototype.initNewFunction = function (type) {

	this.f[type] = new Object();
	this.f[type].cnt = 0
	this.f[type].values = new Array();
	this.f[type].timeStamps = new Array();
	this.f[type].timeStampsOver = new Array();

}

fPlot.prototype.updateOnlyPlaybackTime = function(value, type)
{
    
    
    
}

fPlot.prototype.update = function(value, type)
{
	this.f[type].values[this.f[type].cnt] = value;	
	this.f[type].timeStamps[this.f[type].cnt] = new Date().getTime();
	this.f[type].cnt++;
	this.plot();
}


fPlot.prototype.updateBps = function(timeStamp,timeStampOver,DLbps){

    this.f[3].timeStamps[this.f[3].cnt] = timeStamp;
	this.f[3].timeStampsOver[this.f[3].cnt] = timeStampOver;
	this.f[3].values[this.f[3].cnt] = DLbps;
	this.f[3].cnt++;
	this.plot();
}

fPlot.prototype.plot = function()
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
	// find the maximum for Y scaling
	var maxY = (parseInt(maxBandwidth/1024/1024)+1)*1000-1;
	var steppingY = 300; // 200 kbit steps for the Y-axis
	
	for(var n = 0; n < this.f.length; n++)
	{
	
	   if (this.f[n] != null){
		  for(var i=0;i<this.f[n].values.length;i++)
		  {
              if(n!= 2)
              {
                  if((this.f[n].values[i]/1024) > maxY) {
                  	maxY = (this.f[n].values[i])/1024;   //这里一旦选到最大值了，f[n]里那个值一直存在
                                                         //所以以后不会有小于暂定最大值得
                    steppingY = maxY/8;
                    maxY = maxY*1.09;
                  }
              }
		  }
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
	//this.canvas.translate(-50,-(this.height));

	//this.canvas.beginPath();
	//this.canvas.moveTo(0,290);
	//this.canvas.lineTo(this.width - 51, 290);
	//this.canvas.stroke();

//	this.canvas.scale(1, -1);
    
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
		this.canvas.fillStyle    = '#00f';
		this.canvas.font         = '10px sans-serif';
		this.canvas.textBaseline = 'top';
		var textDraw = n*steppingYdraw;
		textDraw = textDraw.toFixed(2);
		var metrics = this.canvas.measureText(textDraw);
		this.canvas.fillText(textDraw, 50 - metrics.width, this.graphheight - ((((n*steppingYdraw)/maxYdraw) * this.graphheight)+10));
	}
	
	// 画横坐标
    var currentPlaybackTime 

    if (this.f[2].values.length > 0){

       currentPlaybackTime = this.f[2].values[this.f[2].cnt-1];

    } else {

    	currentPlaybackTime = 0;

    }

    var currentRangeStart = 0;
	var currentSegmentStart = 0;

    var currentMaxTime //当前更新到的最大秒数
    var maxX; //画布中只容纳 maxX秒的图
    var steppingX; //
    var xCut = 15; //画布中x共15个刻度
    currentMaxTime = this.f[0].cnt;

    //找出比currentMaxTime更大总刻度的steppingX
    for (var i = 1; i > 0; i++){

    	if (i*2*xCut > currentMaxTime*2){

    		steppingX = 2*i;
    		maxX = 2*i*xCut;
    		break;
    	}

    }
	

	for(var n=0; n <= maxX/steppingX;n++)
	{
		this.canvas.fillStyle    = '#00f';
		this.canvas.font         = '10px sans-serif';
		this.canvas.textBaseline = 'top';
		var metrics = this.canvas.measureText(n*steppingX); 
	
		this.canvas.fillText(parseInt(n*steppingX), 50 + (((n*steppingX)/maxX) * this.graphwidth) - metrics.width/2, this.height - 95);
	}
        this.canvas.fillStyle    = 'rgba(0,0,0,1)';
        this.canvas.font         = '14px sans-serif';
        this.canvas.textBaseline = 'top';
        var metrics = this.canvas.measureText("Time (Sec)");
        this.canvas.fillText("Time (Sec)", this.graphwidth - metrics.width+30, this.height - 75);
    
	
		this.canvas.fillStyle    = '#ff0000';
		this.canvas.font         = '14px sans-serif';
		this.canvas.textBaseline = 'top';
		var metrics = this.canvas.measureText("Estimated Bandwidth" + unit);
	
		this.canvas.fillText("Estimated Bandwidth" + unit, 150 + metrics.width/2, this.height - 75);
		
		this.canvas.fillStyle    = '#0000ff';
		this.canvas.font         = '14px sans-serif';
		this.canvas.textBaseline = 'top';
	//	var metrics = this.canvas.measureText("Representation Bandwidth");
	
		this.canvas.fillText("Representation Rate" + unit, 80 + metrics.width*2, this.height - 75);

		this.canvas.fillStyle    = 'rgba(7,195,5,1)';
		this.canvas.font         = '14px sans-serif';
		this.canvas.textBaseline = 'top';
		var metrics = this.canvas.measureText("Actual Throughput" + unit);
	
		this.canvas.fillText("Actual Throughput " + unit, metrics.width/2 - 40, this.height - 75);
	
    // 这里恢复了移动后的坐标系，原点再左下角
	this.canvas.restore();
	

	
	
	
	// plot all tracked functions
	for(var n = 0; n < this.f.length; n++)
	{
		if (this.f[n] != null){
		
        if(n==2)
        {
            this.canvas.strokeStyle = "rgba(0,0,0,1)";
            // draw the playback time line
            if (this.f[n].values.length > 0){ 
            
            var barPosition = (((currentPlaybackTime - currentRangeStart)/maxX) * this.graphwidth);
            
            this.canvas.beginPath();
            this.canvas.moveTo(barPosition,0);
            this.canvas.lineTo(barPosition,this.graphheight);
            this.canvas.stroke();
            this.canvas.closePath();
            }
            continue;
        }
        
        
        if (n == 0 || n == 1){
		   if(n==0) this.canvas.strokeStyle = "rgba(255,0,0,1)";
		   if(n==1) this.canvas.strokeStyle = "rgba(0,0,255,1)";

	       this.canvas.setLineDash([]);
           this.canvas.beginPath();
           this.canvas.moveTo(0,0);
		   //因为values里记录的，第0是根据mpd估计的init，第1是根据init估计的segment1
		   //所以要从values[1]开始才是估计的segment1的速度
		   //values[n]是根据第n-1个segment下载的真实速度来预判的第n个将会选择那个，实际下载只完成到第n-1个
		   for(var i=currentSegmentStart+1;i<this.f[n].values.length-1;i++)
		  {
		     	this.canvas.lineTo((2*(i-currentSegmentStart-1)/maxX)*this.graphwidth, ((this.f[n].values[i]/(1024))/maxY)*this.graphheight);
		        this.canvas.lineTo((2*(i+1-currentSegmentStart-1)/maxX)*this.graphwidth, ((this.f[n].values[i]/(1024))/maxY)*this.graphheight);
		    	
	       } 

	        this.canvas.stroke();
	        this.canvas.closePath();
	           	
	        this.canvas.setLineDash([5, 5]);
	        this.canvas.beginPath();
	     	this.canvas.moveTo((2*(this.f[n].values.length-1-currentSegmentStart-1)/maxX)*this.graphwidth,((this.f[n].values[this.f[n].values.length-1-1]/(1024))/maxY)*this.graphheight);
	    	this.canvas.lineTo((2*(this.f[n].values.length-1-currentSegmentStart-1)/maxX)*this.graphwidth, ((this.f[n].values[this.f[n].values.length-1]/(1024))/maxY)*this.graphheight);
	    	this.canvas.lineTo((2*(this.f[n].values.length-1+1-currentSegmentStart-1)/maxX)*this.graphwidth, ((this.f[n].values[this.f[n].values.length-1]/(1024))/maxY)*this.graphheight);
		    	
	        this.canvas.stroke();
	        this.canvas.closePath();
	        this.canvas.setLineDash([]);
	        this.canvas.clearRect(this.graphwidth+1,0,30,this.graphheight);
        }
         
          
	      // 画真实bps的图
	      if (n == 3){

	        this.canvas.strokeStyle = "rgba(7,195,5,1)";
	        this.canvas.setLineDash([]);
            this.canvas.beginPath();
            this.canvas.moveTo(0,0);
		   //因为values里记录的，第0init，第1是segment1
		   //所以要从values[1]开始才是估计的segment1的速度

		    for(var i=currentSegmentStart+1;i<this.f[n].values.length;i++)
		   {
		     	this.canvas.lineTo((2*(i-currentSegmentStart-1)/maxX)*this.graphwidth, ((this.f[n].values[i]/(1024))/maxY)*this.graphheight);
		        this.canvas.lineTo((2*(i+1-currentSegmentStart-1)/maxX)*this.graphwidth, ((this.f[n].values[i]/(1024))/maxY)*this.graphheight);
		    	
	        } 

	        this.canvas.stroke();
	        this.canvas.closePath();

	      }



		
		
	}

  }
}