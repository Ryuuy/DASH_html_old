/*
 * rate_measurement.js
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

measurement = new Object();
measurement.startTimeMeasure = 0;
measurement.endTimeMeasure = 0;
var __id = new Array();   //全局变量，保存的每个seg的下载请求发出时间，从init开始，0算起

// 2018.6.21. 增加一个全局变量，保存的每个seg的下载完成时间，从init开始，0算起
var __idEnd = new Array();//全局变量

// 初始化时，计算bps的
function beginBitrateMeasurement(){
	
	measurement.startTimeMeasure =new Date().getTime();	
	//myFplot2.updateBpsBegin(measurement.startTimeMeasure);
	
}

function endBitrateMeasurement(lengthInBytes){

	measurement.endTimeMeasure =new Date().getTime();
	var downloadBps = ((lengthInBytes*8)/(measurement.endTimeMeasure - measurement.startTimeMeasure))*1000;
	
	//myFplot2.updateBpsOver(measurement.endTimeMeasure, downloadBps);

	// return bps
	console.log("The transmission time is: " + (measurement.endTimeMeasure - measurement.startTimeMeasure));
	return downloadBps;
}


// 在初始化过后，计算bps的，根据id计算
function beginBitrateMeasurementByID(id){

	__id[id]=new Date().getTime();

	//myFplot2.updateBpsBegin(temp);	

}

// 20260816：新增第三个参数 skipFirstGraphPlot、第四个参数 xPos。
// 第一张图（myFplot）里 estimated bandwidth（红，f[0]）/ representation rate（蓝，f[1]）/
// actual throughput（绿，f[3]）三条线原本共用"按数组下标当横坐标"的画法，隐含假设三个数组
// 严格同步地各推进一格——DASHttp.js 里超时/失败重试也会调这个函数记一次 0bps 采样，
// 但蓝线只在真正成功时才推进，几次重试下来下标就错位、图上看着像是串线了。
// 现在改成横坐标直接用 xPos（这个分片真实对应的视频内容时间点，秒），不再依赖下标，
// 所以理论上已经不会再错位；skipFirstGraphPlot 保留下来，重试时仍然不把失败样本画进第一张图，
// 避免同一个内容位置反复出现多个 0bps 的点，图看起来更干净。
// 第二张图（myFplot2）本来就是按真实时间戳画的，不受影响，两次都照常记录。
function endBitrateMeasurementByID(id, lengthInBytes, skipFirstGraphPlot, xPos){


	end = new Date().getTime();
	__idEnd[id] = end;
	var downloadBps = ((lengthInBytes*8)/(end - __id[id]))*1000;
	myFplot2.updateBps(__id[id], end, downloadBps);
	if (!skipFirstGraphPlot) {
		myFplot.update(downloadBps, 3, xPos); // 图一中增加一个真实速率的
	}


	// return bps
	//console.log("END id: " + id + " time: " +end);
	//console.log("Start: " + __id[id]);
	return downloadBps;
}