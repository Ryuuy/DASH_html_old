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

function endBitrateMeasurementByID(id, lengthInBytes){

	
	end = new Date().getTime();
	__idEnd[id] = end;
	var downloadBps = ((lengthInBytes*8)/(end - __id[id]))*1000;
	myFplot2.updateBps(__id[id], end, downloadBps);
	myFplot.update(downloadBps, 3); // 图一中增加一个真实速率的
	

	// return bps
	//console.log("END id: " + id + " time: " +end);
	//console.log("Start: " + __id[id]);
	return downloadBps;
}