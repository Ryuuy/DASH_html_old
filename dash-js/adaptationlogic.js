/*
 * adaptationlogic.js
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


function adaptationLogic(_mpd, video)
{
	this.mpd = _mpd;
	this.identifier = 1;
	var i=0,n=parseInt(_mpd.period[0].group[0].representation[0].bandwidth),m=0;
	this.mpd.period[0].group[0].representation.forEach(function(_rel){
			
			// 这里似乎是在找mpd里比特率最小的一个作为初始值？
			if(parseInt(_rel.bandwidth) < n)
			{
				m=i;
				n = parseInt(_rel.bandwidth);
			}
			i++;
		
	});
	console.log("DASH JS prototype [basic] adaptation selecting representation " + m + " with bandwidth: " + n);
	
	this.representationID = m;
	this.lowestRepresentationID = m;
	this.lowestRepresentation = _mpd.period[0].group[0].representation[m];
	this.currentRepresentation = _mpd.period[0].group[0].representation[m];
	if(this.currentRepresentation.baseURL == false) this.currentRepresentation.baseURL = _mpd.baseURL;
	if(this.lowestRepresentation.baseURL == false) this.lowestRepresentation.baseURL = _mpd.baseURL;
	this.currentRepresentation.curSegment = 0;
	this.resolutionSwitch = 0;
	this.mediaElement = video;
	
	this.observers = new Array();
	this.observer_num = 0;
}

function rateBasedAdaptation(bandwidth)
{
	
	this.bandwidth = bandwidth;
	console.log("DASH JS using adaptation: Rate Based Adaptation");
		
}

adaptationLogic.prototype.addObserver = function(_obj){
	this.observers[this.observer_num++] = _obj;
	
}

// 20260816：新增 xPos 参数——这个分片实际对应的视频内容时间点（秒），从 DASHttp.js
// 一路传过来（见 switchRepresentation() 和 DASHttp.js 里的说明），让第一张图（fplot_partial.js）
// 能按真实的内容时间轴画蓝线，而不是按"这是第几次调用"这种容易被重试次数打乱的下标。
adaptationLogic.prototype.notify = function(xPos) {
	if(this.observers.length > 0){

		for(var i=0;i< this.observers.length; i++)
		{
			this.observers[i].update(parseInt(this.currentRepresentation.bandwidth), this.identifier, xPos);
		}
	}
}

adaptationLogic.prototype._getNextChunk = function (count){

	return this.currentRepresentation.segmentList.segment[count];
}

adaptationLogic.prototype.getInitialChunk = function(presentation)
{
	return presentation.initializationSegment;
}

adaptationLogic.prototype._getNextChunkP = function (presentation, count){

	return presentation.segmentList.segment[count];
}

function init_rateBasedAdaptation(_mpd, video, bandwidth)
{
	rateBasedAdaptation.prototype = new adaptationLogic(_mpd, video);
	// 20260816：新增 xPos 参数，透传给 notify()，见该函数的说明
	// 20260817：新增 actualThroughputBps 参数——触发这次决策的那次分片下载的实测吞吐（bps），
	// 从 DASHttp.js 传过来，只是为了记进 dashTelemetry，不参与选码率的判断逻辑本身
	rateBasedAdaptation.prototype.switchRepresentation = function (xPos, actualThroughputBps){
	
			
			
			
			// select a matching bandwidth ...
			var i=0, n=parseInt(this.lowestRepresentation.bandwidth), m=this.representationID, _mybps = this.bandwidth.getBps();

			// 20260812 新增：ISAC 遮挡预警模式下，跳过按带宽估计选码率，直接强制走最低码率
			// （见 dash-js/isac.js），原有的按带宽选码率逻辑保留在 else 分支里，不受影响
			if (typeof isac !== 'undefined' && isac.mode === "shadowing") {

				n = parseInt(this.lowestRepresentation.bandwidth);
				m = this.lowestRepresentationID;

			} else {

			this.mpd.period[0].group[0].representation.forEach(function(_rel){
				if(parseInt(_rel.bandwidth) < _mybps && n <= parseInt(_rel.bandwidth))
				{
					//console.log("n: " + n + ", m:" + m);
					n = parseInt(_rel.bandwidth);
					m = i;

					//用于测试，强制每次都选择12，最高码率，或者每次都1，最低码率
					//m = 3;
				}
				i++;

			}
			);



			// 如果预测的bps小于最小bitrate，那么直接选择最小bitrate
			if (_mybps<parseInt(this.lowestRepresentation.bandwidth)){

		      	n = parseInt(this.lowestRepresentation.bandwidth);
		      	m = this.lowestRepresentationID;
            }

			}

			// 20260815 新增：ISAC 从 shadowing 切回 normal 后，只有当这里按实测带宽真的选出了
			// 比最低码率更高的档位，才算"确认链路真的恢复了"——不是 isac.mode 一变 normal 就信。
			// isac.recovering 为 false（不在"待确认"状态）或者 shadowing 分支强制选中最低码率时，
			// 这个条件天然不成立，不会误触发。
			if (typeof isac !== 'undefined' && isac.recovering && m !== this.lowestRepresentationID) {
				confirmRecovery();
			}

			console.log("n: " + n + ", m:" + m);
			
			// return the segment	
			if( m != this.representationID) 
			{
				// check if we should perform a resolution switch 只要有一个比例不同，就需要切换分辨率
				if (parseInt(this.currentRepresentation.width) != parseInt(this.mpd.period[0].group[0].representation[m].width) || parseInt(this.currentRepresentation.height) != parseInt(this.mpd.period[0].group[0].representation[m].height))
				{
					if(this.resolutionSwitch != 0) console.log("Doing nothing because a resolution switch is already ongoing");
						else
						{
							console.log("Resolution switch NYI");
							// force a new media source with the new resolution but don't hook it in, wait until enough data has been downloaded
							// only swith the bitrate within the given resolution 
							// 似乎这里即使判断出了需要换分辨率，也没有做任何变化
							//this.representationID = m;
					        //this.mpd.period[0].group[0].representation[m].curSegment = this.currentRepresentation.curSegment;
					        //this.currentRepresentation = this.mpd.period[0].group[0].representation[m];
					        //if(this.currentRepresentation.baseURL == false) this.currentRepresentation.baseURL = _mpd.baseURL;
					
						}
				}else{		
					// well, switching the bitrate is not that problem ...
					console.log("DASH rate based adaptation: SWITCHING STREAM TO BITRATE = " + this.mpd.period[0].group[0].representation[m].bandwidth);
					this.representationID = m; //这里的更新会在rateBasedAdaptation对象里增加一个属性
					this.mpd.period[0].group[0].representation[m].curSegment = this.currentRepresentation.curSegment;
					this.currentRepresentation = this.mpd.period[0].group[0].representation[m]; //这里的更新会在rateBasedAdaptation对象里增加一个属性
					if(this.currentRepresentation.baseURL == false) this.currentRepresentation.baseURL = _mpd.baseURL;
					
				}
			}

			// 2018.6.24增加buffer 的调整
            /*
			var rateRatio = _mybps/this.currentRepresentation.bandwidth;
			var rateMin = 2;
			var rateMax = 4;

			if (this.currentRepresentation.curSegment > 10){
				if (rateRatio <= rateMin){
					overlayBuffer.criticalState.seconds = overlayBuffer.upperLimit;
					overlayBuffer.bufferSize.maxseconds = overlayBuffer.upperLimit;
				}
				else if (rateRatio > rateMin && rateRatio < rateMax){

					var deltaBuffer = overlayBuffer.upperLimit - overlayBuffer.lowerLimit;
                    var adjustBuffer = overlayBuffer.lowerLimit + (rateMax - rateRatio)/(rateMax-rateMin)*deltaBuffer;

					overlayBuffer.criticalState.seconds = adjustBuffer;
					overlayBuffer.bufferSize.maxseconds = adjustBuffer;
				}

				else if (rateRatio >= rateMax){
					
                    overlayBuffer.criticalState.seconds = overlayBuffer.lowerLimit;
					overlayBuffer.bufferSize.maxseconds = overlayBuffer.lowerLimit;
               
				}
			}*/

			// 20260817 新增：把这次的最终码率决策记进遥测（见 telemetry.js），
			// 供第三张图（最终选中码率 + ISAC 状态）和外部同步分析用。
			// 注意放在上面的 representation 切换块之后——这样 m 对应的就是这次真正生效的选择
			// （这个 MPD 里所有档位分辨率都一样，恒定走 else 分支真正切换，不受 resolution NYI 影响）。
			if (typeof dashTelemetry !== 'undefined' && typeof xPos === 'number') {
				dashTelemetry.recordSegmentDecision({
					contentStart: xPos,
					contentEnd: xPos + 2, // 2 = 分片时长（秒），需要和 mpd 的 SegmentList duration 保持一致
					representationId: m,
					bandwidthNominal: n, // 选中档位的标称码率（bps）——在上面三条路径（shadowing 强制 / ABR 选中 / 低于最低码率兜底）里都被正确赋值成"选中档位的 bandwidth"
					estimatedBps: _mybps,
					actualThroughputBps: actualThroughputBps,
					isacMode: (typeof isac !== 'undefined') ? isac.mode : undefined,
					isacRecovering: (typeof isac !== 'undefined') ? isac.recovering : undefined
				});
			}

			this.notify(xPos);
		}

	ratebased = new rateBasedAdaptation(bandwidth);
	
	return ratebased;
}
