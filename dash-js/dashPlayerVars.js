// 20260826 新增：整个测试的时间零点，取这个文件（<head> 里第一个被加载执行的 script）
// 执行到这一行的那一刻——这是页面生命周期里 JS 能拿到 Date.now() 的最早时机，比
// DASH_MPD_loaded()/第一个分片请求都早。之所以要"尽可能早"：server7.js 收到这次
// HTML 请求的时刻（它自己 console.log 的 "Request Received for: / at: <ts>"）
// 和这个值几乎是同一时刻（同机器上 HTML 请求发出到这行执行，中间只有网络往返 + 解析，
// 通常几到几十毫秒）——以后要把"这次测试录到的真实网速"喂给 server7.js 做 delay sweep
// 复现实验时，就拿这个值和 server7 日志里的时间戳对齐，两边误差最小。
// 见 snapshots_FORMAT.md 里的说明。
window.__dashTestEpoch = Date.now();

var video;
var dashPlayer;
var currentRep, curSegment=0;
var lastCall = 0;
var myBandwidth;
var myFplot;		
var myFplot2;
var overlayBuffer;
var myBuffer;
var bps;
var timeID = 0;
var adaptation;


//var xmlHttp;
		