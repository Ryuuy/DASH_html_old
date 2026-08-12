/*
 * bandwidth.js
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
 
var maxBandwidth = (1024) * 1024;        // 4 Mbps

function bandwidth(initial_bps, hisSize, predSize)
{
	this.identifier = 0; //这个用来标记是fplot中的第几个线，这里是实测值，标为0.在adapt那里标为1
	this.bpsArray = new Array(); //用来保存
	//this.bpsMPD = initial_bps; //用来保存下载mpd时的速度
	this.bps = initial_bps;  //这个就是用来输出的根据输入预测的bps
	this.bpsCnt = 0;
	this.hisSize = hisSize; //使用的历史多少秒的data
	this.segStartForCalc = 0; // 在历史秒中，用于计算未来预测值的起始segment编号
	this.predSize = predSize; //预测未来多少秒的data
	this.observers = new Array();
	this.observer_num = 0;
}

// 增加观测该bandwidth的对象，主要就是fplot
bandwidth.prototype.addObserver = function (_obj){
	this.observers[this.observer_num++] = _obj;
	
}

bandwidth.prototype.notify = function(){
	if(this.observers.length > 0){
		
		for(var i=0;i< this.observers.length; i++)
		{
			this.observers[i].update(this.bps, this.identifier); // update 在fPlot类中有定义
		}
	}
}

bandwidth.prototype.calcWeightedBandwidth = function(_bps, timeID) {

	// 20260812 切换为基于实测吞吐量的加权平均预测（原本被注释掉的方法），不再使用 predTrace 查表
	// 2018.6.24 改写将来预测的方法
	this.bpsArray[timeID] = _bps;

    //找出属于从当前时间步往回推，在hisSize内的所有下载的segment，用这些来计算predited bps，当前只预测一秒
	for (var i = timeID; i >= 0;i--){

		if (__id[i] <= __idEnd[__idEnd.length-1]-this.hisSize*1000){

			this.segStartForCalc = i;
			break;
	        }
	}


	//用weighted averaging method计算

	//分子计算 var denominator = 0; 尚未考虑时间权重
	var numerator = 0;
	var denominator = 0;
	for (var i = this.segStartForCalc; i<=timeID; i++) {

		numerator = numerator + this.bpsArray[i]*(__idEnd[i] - __id[i]);
		denominator = denominator + (__idEnd[i] - __id[i]);

	}

	this.bps = parseInt(numerator/denominator);


    /*
    //20260812 已停用：这里用已经计算好的预设predTrace作为预测值，不通过js计算

    //client端以init的request发出的时刻作为起点。
    var currentTime = new Date().getTime() - myFplot2.f[0].timeStamps[0];
    var currentTpNum = Math.floor(currentTime/1000); //当次预测的网速编号
    this.bps =  predTrace[currentTpNum];
    */

	// inform the observers
	this.notify();
	return this.bps;
}

bandwidth.prototype.adjustWeights = function(hisSize, predSize) {

	this.hisSize = hisSize;
	this.predSize = predSize;

}

bandwidth.prototype.getBps = function () {

	return this.bps;

}