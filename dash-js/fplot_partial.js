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
	// 20260816 新增：这个点实际对应的视频内容时间点（秒），由调用方（DASHttp.js）算好传进来。
	// 用来把横坐标画成真实的内容时间轴，而不是"这是第几个点"这种容易被重试次数打乱的下标。
	this.f[type].xPos = new Array();

}

fPlot.prototype.updateOnlyPlaybackTime = function(value, type)
{
    
    
    
}

// 20260816：新增第三个参数 xPos——这个点实际对应的视频内容时间点（秒）。
// f[2]（播放进度那根黑线）不传这个参数，因为它的 value 本来就已经是内容时间点了，直接当横坐标用。
fPlot.prototype.update = function(value, type, xPos)
{
	this.f[type].values[this.f[type].cnt] = value;
	this.f[type].timeStamps[this.f[type].cnt] = new Date().getTime();
	this.f[type].xPos[this.f[type].cnt] = xPos;
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
                  // 20260812 新增：给 Y 轴自动扩展设一个封顶（单位 kbps）。不加这个的话，
                  // 关掉 server7.js 限速测试时，Estimated Bandwidth(真实测速)会冲到几万 kbps，
                  // 把坐标轴撑爆，导致 Representation Rate(蓝线，最高不过几千 kbps)被挤成贴底的一条线，
                  // 看起来像是一直是 0。只影响画图显示范围，不影响实际码率决策。
                  var maxYCap = 5000;
                  var scaledVal = Math.min(this.f[n].values[i]/1024, maxYCap);
                  if(scaledVal > maxY) {
                  	maxY = scaledVal;   //这里一旦选到最大值了，f[n]里那个值一直存在
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

    var currentMaxTime //当前更新到的最大内容时间点（秒）
    var maxX; //画布中只容纳 maxX秒的图
    var steppingX; //
    var xCut = 15; //画布中x共15个刻度

    // 20260816：横坐标改成看真实的内容时间点（xPos），不再用"这是第几个点"这种数组下标推算。
    // 下标会被失败重试打乱（f[0]/f[3] 可能比 f[1] 多推进几次，见 DASHttp.js 里的说明），
    // 用真实 xPos 就没有这个问题了。取 f[0]/f[1]/f[3] 里最新的 xPos，也别小于当前播放进度，
    // 保证播放头（黑色竖线）始终落在画布范围内。
    currentMaxTime = currentPlaybackTime;
    for (var t = 0; t <= 3; t++) {
    	if (t === 2) continue; // f[2] 是播放进度本身，不参与这里的比较
    	if (this.f[t] && this.f[t].xPos && this.f[t].xPos.length > 0) {
    		var lastXPos = this.f[t].xPos[this.f[t].xPos.length - 1];
    		if (typeof lastXPos === 'number' && lastXPos > currentMaxTime) {
    			currentMaxTime = lastXPos;
    		}
    	}
    }

    //找出比currentMaxTime更大总刻度的steppingX
    for (var i = 1; i > 0; i++){

    	if (i*2*xCut > currentMaxTime){

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
		   // 20260816：横坐标改用 this.f[n].xPos[i]（真实内容时间点），不再用下标推算——
		   // 每个点画成宽 2 秒（一个分片时长）的台阶，从 xPos[i] 到 xPos[i]+2。
		   for(var i=1;i<this.f[n].values.length-1;i++)
		  {
		     	if (typeof this.f[n].xPos[i] !== 'number') continue;
		     	var xStart = (this.f[n].xPos[i]/maxX)*this.graphwidth;
		     	var xEnd = ((this.f[n].xPos[i]+2)/maxX)*this.graphwidth;
		     	var yVal = ((this.f[n].values[i]/(1024))/maxY)*this.graphheight;
		     	this.canvas.lineTo(xStart, yVal);
		        this.canvas.lineTo(xEnd, yVal);

	       }

	        this.canvas.stroke();
	        this.canvas.closePath();

	        this.canvas.setLineDash([5, 5]);
	        this.canvas.beginPath();
	        var lastIdx = this.f[n].values.length-1;
	        if (typeof this.f[n].xPos[lastIdx] === 'number') {
	        	var xLastStart = (this.f[n].xPos[lastIdx]/maxX)*this.graphwidth;
	        	var xLastEnd = ((this.f[n].xPos[lastIdx]+2)/maxX)*this.graphwidth;
	        	var yPrev = ((this.f[n].values[lastIdx-1]/(1024))/maxY)*this.graphheight;
	        	var yLast = ((this.f[n].values[lastIdx]/(1024))/maxY)*this.graphheight;
	        	this.canvas.moveTo(xLastStart, yPrev);
	        	this.canvas.lineTo(xLastStart, yLast);
	        	this.canvas.lineTo(xLastEnd, yLast);
	        }

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
		   // 20260816：横坐标改用 this.f[n].xPos[i]（真实内容时间点），理由同上面 n==0/1 的说明。

		    for(var i=1;i<this.f[n].values.length;i++)
		   {
		     	if (typeof this.f[n].xPos[i] !== 'number') continue;
		     	var xStart = (this.f[n].xPos[i]/maxX)*this.graphwidth;
		     	var xEnd = ((this.f[n].xPos[i]+2)/maxX)*this.graphwidth;
		     	var yVal = ((this.f[n].values[i]/(1024))/maxY)*this.graphheight;
		     	this.canvas.lineTo(xStart, yVal);
		        this.canvas.lineTo(xEnd, yVal);

	        }

	        this.canvas.stroke();
	        this.canvas.closePath();

	      }



		
		
	}

  }
}