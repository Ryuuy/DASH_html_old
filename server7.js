// 这是一个简单的Node HTTP服务器,能处理当前目录的文件
// 并能实现两种特殊的URL用于测试
// 用HTTP://localhost:8080或http://127.0.0.1:8080 连接这个服务器
 
// 首先加载所有需要用到的模块
var http = require('http');    // 加载http服务api模块
var fs = require('fs');      // 加载fs文件服务api模块
var path = require('path');  // 20260827 新增：session 自动保存要拼文件夹路径
var server = new http.Server();  // 创建新的HTTP服务器
var urlapi = require('url');    // 创建url路由api模块
server.listen(8080);       // 监听端口8000

// 20260827 新增：网页每次刷新自动建一个按时间命名的文件夹，定期把这次测试的
// 数据整份存进去，见下面 /api/session/save 和 dash-js/sessionAutoSave.js。
// 只允许写进这个目录下面，文件名也是白名单——sessionId/filename 都是前端传来的，
// 不做校验的话理论上能拼出 "../../别的地方" 这种路径去写任意文件，虽然只是
// 本地实验室工具，这个校验成本很低，还是做一下。
var SESSIONS_DIR = path.join(__dirname, 'sessions');
var SESSION_ID_RE = /^[0-9_-]+$/;
var ALLOWED_SESSION_FILENAMES = [
  'meta.json', 'buffer_by_rep.json', 'net_speed.json',
  'doppler_shadow_events.json', 'power_dbfs_judgments.json'
];

var htmlStartTime; // 用来记录每次首次请求视频网页的时间，进而从此开始通过response的写入，控制网速
var segStartTime;  // 用来记录每次首次请求segment的时间
var isSegStart;
var contentArrayCnt; //用来记录每次请求中，当前Byte的位置
var contentLength;   //记录每次请求的文件的大小，单位是Byte
var responseGlobal;  //在全局定义一个指针去访问response?
var contentGlobal; //在全局定义一个指针去访问content
var delayInterval; // 全局的delayInterval
var tpTrace = require('./throughputTrace/thruputTraceFerry.js'); //将thruputTrace1.js中定义的throughput读取进来到tpTrace

// 20260812 新增：限速开关。true=按 tpTrace 限速（原有行为）；false=不限速，全速把文件发出去
var THROTTLE_ENABLED = false;

// 20260826 新增：回答"这个网速是不是 2 秒一次"——不是，tpTrace 是"每 TRACE_SAMPLE_INTERVAL_MS
// 毫秒一个值"，跟分片时长（2秒）完全没关系，只是巧合地都是小数字。默认 1000（1秒一档），
// 跟 throughputTrace/thruputTraceFerry.js 这类老 trace 文件的格式对上（数组第 i 项 = 第 i 秒
// 的目标 bps）。想更精细，就配一个 bucketMs 更小的新 trace 文件（比如 dash-js/fplot_NetSpeed.js
// 的 downloadTraceFile() 导出的那种，文件开头会带 traceIntervalMs 告诉你该配多少），
// 这里改成一样的值即可——两边必须一致，不然 currentTpNum 算出来的下标会跟 trace 数组本身的
// 采样间隔对不上，读到的目标 bps 就是错的（比如 trace 是 200ms 一档却按 1000ms 一档去读，
// 播放 5 倍速的“网速”变化，跟实际录到的完全不是一回事）。
var TRACE_SAMPLE_INTERVAL_MS = 1000;

// 20261009 新增：NTG-2501 监视数据（網页第 8/9/10 张图的数据源）。
// 浏览器没法直接读 NTG 的 xml_master_monitor.cgi（跨域 + 要 POST），所以由 server7.js 代为轮询：
//   - 后台线程每 NTG_POLL_MS（默认 200ms=5Hz）POST 一次 Master（192.168.1.201），一份 XML 里四个方向全有
//     （跟 ntg2501_power_logger/ntg2501_http_logger.py 同一个接口；Python logger 还在跑的话两边请求量叠加，
//     设备 httpd 在 >50Hz 时会拒连，所以这里默认只开 5Hz）
//   - 每个样本追加写到 ntg2501_power_logger/logs/ntg_server7_<启动时间>.csv（"保存"；server 本地写盘，
//     不占被测无线链路）
//   - GET /api/ntg?since=<ts_ms> 返回 since 之后的新样本，网页每 500ms 取一次增量
// 关掉：环境变量 NTG_ENABLE=0；换 IP：NTG_MASTER_IP=...；换频率：NTG_POLL_MS=...
var NTG_ENABLE = process.env.NTG_ENABLE !== '0';
var NTG_MASTER_IP = process.env.NTG_MASTER_IP || '192.168.1.201';
var NTG_POLL_MS = Math.max(50, parseInt(process.env.NTG_POLL_MS || '200', 10));
var NTG_KEEP = 40000;                 // 内存里保留的最大样本数（5Hz 约 2.2 小时）
var ntgSamples = [];                  // {ts, wr_up, wr_down, in_up, in_down, out_up, out_down, rx_up, rx_down, tx_up, tx_down, cnr_up, cnr_down, mod_up, mod_down}
var ntgLastError = null;
var ntgCsvStream = null;
var NTG_NUM_TAGS = {
  wireless_range_up: 'wr_up', wireless_range_down: 'wr_down',
  input_rate_up: 'in_up', input_rate_down: 'in_down',
  output_rate_up: 'out_up', output_rate_down: 'out_down',
  quality_rx_up_level: 'rx_up', quality_rx_down_level: 'rx_down',
  quality_tx_up_level: 'tx_up', quality_tx_down_level: 'tx_down',
  quality_rx_up_cnr: 'cnr_up', quality_rx_down_cnr: 'cnr_down'
};
var NTG_CSV_COLS = ['ts', 'wr_up', 'wr_down', 'in_up', 'in_down', 'out_up', 'out_down',
                    'rx_up', 'rx_down', 'tx_up', 'tx_down', 'cnr_up', 'cnr_down', 'mod_up', 'mod_down'];

function ntgPollOnce() {
  var t0 = Date.now();
  var req = http.request({ host: NTG_MASTER_IP, port: 80, path: '/xml_master_monitor.cgi', method: 'POST',
                           headers: { 'Content-Length': 0 }, timeout: 2000 }, function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      var smp = { ts: Math.round((t0 + Date.now()) / 2) };   // 请求中点作为采样时刻
      var gotAny = false;
      Object.keys(NTG_NUM_TAGS).forEach(function (tag) {
        var m = new RegExp('<' + tag + '>(.*?)</' + tag + '>').exec(body);
        var v = m ? parseFloat(m[1]) : NaN;
        smp[NTG_NUM_TAGS[tag]] = isNaN(v) ? null : v;
        if (!isNaN(v)) gotAny = true;
      });
      ['up_mod_val', 'down_mod_val'].forEach(function (tag) {
        var m = new RegExp('<' + tag + '>(.*?)</' + tag + '>').exec(body);
        smp[tag === 'up_mod_val' ? 'mod_up' : 'mod_down'] = m ? m[1].trim() : '';
      });
      if (!gotAny) { ntgLastError = '响应里没有数值字段（IP 指的是 Slave？）'; return; }
      ntgLastError = null;
      ntgSamples.push(smp);
      if (ntgSamples.length > NTG_KEEP) ntgSamples.splice(0, ntgSamples.length - NTG_KEEP);
      if (ntgCsvStream) ntgCsvStream.write(NTG_CSV_COLS.map(function (k) { return smp[k] === null ? '' : smp[k]; }).join(',') + '\n');
    });
  });
  req.on('timeout', function () { req.destroy(new Error('timeout')); });
  req.on('error', function (e) { ntgLastError = String(e.message || e); });
  req.end();
}

function startNtgPoller() {
  if (!NTG_ENABLE) { console.log('NTG poller: 已禁用（NTG_ENABLE=0）'); return; }
  try {
    var logDir = path.join(__dirname, 'ntg2501_power_logger', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    var csvPath = path.join(logDir, 'ntg_server7_' + stamp + '.csv');
    ntgCsvStream = fs.createWriteStream(csvPath, { flags: 'a' });
    ntgCsvStream.write(NTG_CSV_COLS.join(',') + '\n');
    console.log('NTG poller: ' + NTG_MASTER_IP + ' 每 ' + NTG_POLL_MS + 'ms，保存到 ' + csvPath);
  } catch (e) { console.log('NTG poller: 建 CSV 失败 ' + e); }
  setInterval(ntgPollOnce, NTG_POLL_MS);
}
startNtgPoller();

// 使用on方法注册事件处理,该事件一直被监听,任何的请求都会进入回调函数,执行相应的操作
server.on('request', function(request, response) { // 当有request请求的时候触发处理函数  
  // 解析请求的URL
  var url = urlapi.parse(request.url);
  
  //监听请求的网站,以当前脚本目录为根目录的url地址
  // 这种连续的两次取时间 new Date().getTime()得到的结果是一样的。
  var timeRequestReceived = new Date().getTime();
  console.log("Request Received for: " + url.pathname + "  at: " + new Date().getTime());

  // 20260827 新增：session 自动保存端点，POST /api/session/save，
  // body: {sessionId, filename, data}。跟下面的静态文件 switch 是分开的
  // 路径——POST 请求不该被当成"求某个文件名的静态资源"塞进 fs.readFile()
  // 那条 default 分支，所以在 switch 之前拦掉，处理完直接 return 不往下走。
  if (request.method === 'POST' && url.pathname === '/api/session/save') {
    var chunks = [];
    request.on('data', function (chunk) { chunks.push(chunk); });
    request.on('end', function () {
      try {
        var payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        var sessionId = payload.sessionId;
        var filename = payload.filename;

        if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
          throw new Error('非法 sessionId: ' + sessionId);
        }
        if (ALLOWED_SESSION_FILENAMES.indexOf(filename) === -1) {
          throw new Error('非法 filename: ' + filename);
        }

        var dir = path.join(SESSIONS_DIR, sessionId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, filename), JSON.stringify(payload.data, null, 2), 'utf-8');

        response.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        response.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.log('session save 失败: ' + e);
        response.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
        response.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // 20261009 新增：NTG 增量接口。GET /api/ntg?since=<ts_ms>  ->  {now, enabled, error, samples:[...]}
  if (request.method === 'GET' && url.pathname === '/api/ntg') {
    var since = parseFloat(new URLSearchParams(url.query || '').get('since')) || 0;
    var out = [];
    for (var ni = ntgSamples.length - 1; ni >= 0 && ntgSamples[ni].ts > since; ni--) out.push(ntgSamples[ni]);
    out.reverse();
    response.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ now: Date.now(), enabled: NTG_ENABLE, masterIp: NTG_MASTER_IP, error: ntgLastError, samples: out }));
    return;
  }

  // 特殊URL会让服务器在发送响应前先等待
  switch(url.pathname) {  //判断请求的路径信息
  case ''||'/' : // 处理请求的网站根目录,指定加载对应的文件夹,一般以根目录的index.html为默认,nodejs是高效流处理的方案,也可以通过配置文件来配置
    
    htmlStartTime = timeRequestReceived; //记录request来时真正的时间点，在switch前，这里只被执行一次
    isSegStart = true;
    fs.readFile("./dashtest_2sDASH_1080p-public-access.html", function(err, content){ //打开请求的文件
      if(err) { //输出错误信息,也可以自定义错误信息
        response.writeHead(404, { 'Content-Type':'text/plain; charset="UTF-8"' });
        response.write(err.message);
        response.end();
      } else { //请求成功返回数据
        response.writeHead(200, { 'Content-Type' : 'text/html; charset=UTF-8' }); //告诉相应头文件,返回数据的类型
        
        response.write(content); //返回的内容,有时候还会加上buffer数据类型
        response.end(); //结束响应,不写的话,会一直处于响应状态,页面不会显示内容
        var responseEndTime = new Date().getTime() - htmlStartTime;
        console.log("response of .html ended at : " + new Date().getTime() + "; From  HTML request is " + responseEndTime);
      }
    });
    break;
 
 
  default:// 处理来自本地目录的文件,主要是一些静态资源文件,搭建静态服务器还有其他的方法
    var filename = url.pathname.substring(1);  // 去掉前导'/'
    var type = getType(filename.substring(filename.lastIndexOf('.')+1));
    //console.log(filename); //取得文件类型 css  js ....
    // 异步读取文件,并将内容作为单独的数据模块传给回调函数
    // 对于确实很大的文件,使用流API fs.createReadStream()更好
    fs.readFile(filename, function(err, content){
      if(err) {
        response.writeHead(404, { 'Content-Type':'text/plain; charset="UTF-8"' });
        response.write(err.message);
        response.end();
      } else {

        if (filename.match(".m4s") && THROTTLE_ENABLED){

          if (isSegStart == true){
          segStartTime = timeRequestReceived;// 这里也换成第一个seg的request到来的时间，取switch前的时间点
          console.log("The first segment request comes at " + (segStartTime - htmlStartTime)/1000 + " from HTML request; The latter are counted from Seg1 Request");
          isSegStart = false;
          }

          response.writeHead(200, { 'Content-Type' : type });
          contentGlobal = content;
          responseGlobal = response;
          contentArrayCnt = 0;
          contentLength  = content.length;

          // 20260812 临时调试：监听连接是否被客户端提前关闭/出错
          response.on('close', function () { console.log("DEBUG: response 'close' event fired for " + filename + " at " + new Date().getTime() + ", contentArrayCnt=" + contentArrayCnt + "/" + contentLength); });
          response.on('error', function (err) { console.log("DEBUG: response 'error' event for " + filename + ": " + err); });

          delayInterval = 100; //设定默认控制传输速率时的采用的延时间隔,单位ms 毫秒
          dataResponse();

        }
        else {

          response.writeHead(200, { 'Content-Type' : type });
          response.write(content);
          response.end();
          var responseEndTime = new Date().getTime() - htmlStartTime;
          console.log("response of " + filename + " ended at : " + new Date().getTime() + "; From  HTML request is " + responseEndTime/1000);

        }
        
        
      }
    });
    break;
  }   
});
 
//这里定义了一个用来判断文件类型的函数
function getType(endTag){
  var type=null;
  switch(endTag){
  case 'html' :
     type = 'text/html; charset=UTF-8';
    break;
  case 'htm' :
    type = 'text/html; charset=UTF-8';
    break;
  case 'js' : 
    type = 'application/javascript; charset="UTF-8"';
    break;
  case 'css' :
    type = 'text/css; charset="UTF-8"';
    break;
  case 'txt' :
    type = 'text/plain; charset="UTF-8"';
    break;
  case 'manifest' :
    type = 'text/cache-manifest; charset="UTF-8"';
    break;
  default :
    type = 'application/octet-stream';
    break;
  }
  return type;
}


//这里定义了一个用来判断文件类型的函数
function dataResponse(){

  var currentTime = new Date().getTime() - segStartTime; //当次发送response时距离Seg1 Request接收到的时间
  var currentTpNum = Math.floor(currentTime/TRACE_SAMPLE_INTERVAL_MS); //当次应该选取的网速编号
  var currentThroughput = tpTrace[currentTpNum];   //单位是bps，bit每秒
  var responseNext = Math.ceil(currentThroughput*delayInterval/8000);  //单位是Byte,也就是8bit

  // 20260812 临时调试
  console.log("DEBUG dataResponse tick: contentArrayCnt=" + contentArrayCnt + "/" + contentLength + ", currentTpNum=" + currentTpNum + ", currentThroughput=" + currentThroughput + ", responseNext=" + responseNext + ", destroyed=" + (responseGlobal ? responseGlobal.destroyed : "no-response-obj"));
  //console.log("The length of the sending data is" + responseNext);
  //var responseNext = 20000;

  //console.log("The next datasize for response is: " + responseNext);
  
  if (contentArrayCnt < contentLength){

    var contentEnd = contentArrayCnt + responseNext;

    if (contentEnd < contentLength){
       //console.log("Write data of length: " + responseNext + "Byte at " + new Date().getTime());
       responseGlobal.write(contentGlobal.slice(contentArrayCnt, contentEnd));
       contentArrayCnt = contentEnd;
       setTimeout(function () {dataResponse();}, delayInterval)
    }
    else if (contentEnd >= contentLength){

         responseGlobal.write(contentGlobal.slice(contentArrayCnt, contentLength));
         delayInterval = Math.floor((contentLength-contentArrayCnt)*8/currentThroughput*1000)
         contentArrayCnt = contentLength;
         setTimeout(function () {responseGlobal.end(); var responseEndTime = new Date().getTime() - segStartTime;console.log("response of ended at : " + new Date().getTime() + "; From  Seg1 request is " + responseEndTime/1000);}, delayInterval)
         //responseGlobal.end()
       }      

    }
  }


