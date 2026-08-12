var DASHJS_VERSION = "0.5a";
var dashInstance;
var playbackTimePlot;
var playbackTimePlot2;

function updatePlaybackTime()
{
    playbackTimePlot.update(dashInstance.videoTag.currentTime, 2);
    
    window.setTimeout(function () { updatePlaybackTime(); },100);
    // 每0.1s就会更新实际播放的时间plot
    //console.log(dashInstance.videoTag.currentTime);
    
}

function DASH_MPD_loaded()
{
	//var currentTime = new Date().getTime() - globeStartTime;
    //var currentTpNum = Math.ceil(currentTime/1000); //当次预测的网速编号
    bps =  1; // 选择一个最小的码率，init和seg1都会选最小的
     
	myBandwidth = new bandwidth(bps, 10, 10); //第二个为历史秒数，第一个为预测秒数
   
	adaptation = init_rateBasedAdaptation(dashInstance.mpdLoader.mpdparser.pmpd, dashInstance.videoTag, myBandwidth);
	
   	myFplot = new fPlot(document.getElementById("graph").getContext("2d"),parsePT(dashInstance.mpdLoader.mpdparser.pmpd.mediaPresentationDuration),document.getElementById("graph").width,document.getElementById("graph").height);
 	myFplot.initNewFunction(0);  //0是estimated bandwidth
	myFplot.initNewFunction(1);  //1是选择的rep码率
    myFplot.initNewFunction(2); // the current playback time
    myFplot.initNewFunction(3); // 每个segment的真实速率表示，比estimated以及rate少一个segment，因为那两个有个虚线的预测segemnt
    playbackTimePlot = myFplot;
	

	// 加一个新的plot来表示Buffer的情况，实际数据请求时的速度bps与其所花费的时间，以及具体执行的时刻
	myFplot2 = new fPlotBuffer(document.getElementById("graph2").getContext("2d"),parsePT(dashInstance.mpdLoader.mpdparser.pmpd.mediaPresentationDuration),document.getElementById("graph").width,document.getElementById("graph").height);
 	myFplot2.initNewFunction(0);   //曲线0就是实际数据的下载曲线
 	myFplot2.initNewFunction(1);   //曲线1就是buffer情况的曲线
    playbackTimePlot2 = myFplot2;

	myBandwidth.addObserver(myFplot); //让myFplot观测myBandwidth的变化，一旦有新的变化，就提醒plot更新
	
	adaptation.addObserver(myFplot); //让myFplot观测adaptation的变化，一旦有新的变化，就提醒plot更新
    
    if (bps<maxBandwidth){
    	myFplot.update(bps, 0); //强行更新第一次下载mpd时的速度bps，基于此才有switch，否则switch总是多一个observer值
    } else{
    	myFplot.update(maxBandwidth, 0);
    }
	
	adaptation.switchRepresentation(); // try to get a better representation at the beginning
	
	overlayBuffer = init_mediaSourceBuffer(0, 4,4,2,dashInstance.videoTag,playbackTimePlot);

	// 20260812 新增：overlayBuffer 刚创建、还没存取过任何分片，这时候一次性把环形缓冲区
	// 物理槽位数开到所有 ISAC 模式的最大值，见 dash-js/isac.js 里的说明
	if (typeof initISACBufferCapacity === 'function') initISACBufferCapacity();

	overlayBuffer.addObserver(myFplot2); //让myFplot观测buffer的变化
	
	// 这里的第二个参数是触发refill时的最小buffer，第三个参数是最大buffer，第四个是当出现卡顿后，rebuffer到该值才让播放
	// 自适应时可能可以在这里进行调整，这时的分辨率可以设置在一定的1080，只有在预测到后面有极度的低速率，无论如何
	// 都来不及充满一定时长的buffer，再考虑降低分辨率。这里就是一个追及问题。在带宽足够时，可以在buffer所剩很少时
	// 再请求，如果带宽很差，就一直请求并且降低分辨率。criticalLevel 和 buffersize 应该是自适应地做调整

	dashInstance.overlayBuffer = overlayBuffer;
 	
    /* new MSE ... */
    var URL = window.URL || window.wekitURL;
    if(window.WebKitMediaSource != null){
        window.MediaSource = window.WebKitMediaSource;
    }
    var MSE = new window.MediaSource(); // 这里的MediaSource()是一个MSE的对象接口，用来对接<video>元素
    dashInstance.MSE = MSE;

    //使用 createObjectURL 创建虚拟 URL，并将 MediaSource 对象作为源。
    //将虚拟 URL 分配到视频元素的 src 属性。
    dashInstance.videoTag.src = URL.createObjectURL(MSE);

	

    //dashInstance.MSE.addEventListener('webkitsourceopen', onOpenSource, false);
	dashInstance.MSE.addEventListener('sourceopen', onOpenSource, false); //真正的开始触发下载是从这里开始的
	                                                                      //这里当MSE创建后，触发onOpenSource函数，连锁效应开始

	//dashInstance.MSE.addEventListener('webkitsourceended', onSourceEnded);
	dashInstance.MSE.addEventListener('sourceended', onOpenSource, false);
     
	
	overlayBuffer.addEventHandler(function(fillpercent, fillinsecs, max){ console.log("Event got called from overlay buffer, fillstate(%) = " + fillpercent + ", fillstate(s) = " + fillinsecs + ", max(s) = " + max); });
    

    //从这里开始就是反复调用，各种在js文件中调用，以及callback，前面的似乎都是在定义
    // setTimeout意思是过多少ms执行函数，这里是0.1s
   	window.setTimeout(function () { updatePlaybackTime(); },100);

    // 这里完了过后，可能是监听到要请求数据？直接跳到eventHandler.js里执行_dashSourceOpen（）
    // 也就是进入了DASHttp.js，在这里判断bps，并且判断读取哪个比特率的数据
    // 然后也在监听当前的buffer有多少，如果量足够就不会进行数据读取
}

function DASHPlayer(videoTag, URLtoMPD)
{
	console.log("DASH-JS Version: " + DASHJS_VERSION);
	dashInstance = this; //这是一个全局变量，指向DASHPlayer这个最外层的对象，任何函数都可以访问且修改
	this.videoTag = videoTag;  //对象的属性
	initDASHttp('no-cache', URLtoMPD);
    //callback('no-cache',URLtoMPD);
	this.mpdLoader = new MPDLoader(DASH_MPD_loaded);
	this.mpdLoader.loadMPD(URLtoMPD);
	//myBuffer = init_timeBuffer(2,10,0,video);
	//video.addEventListener('progress', , false);
}

