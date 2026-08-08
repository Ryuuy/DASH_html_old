// 这是一个简单的Node HTTP服务器,能处理当前目录的文件
// 并能实现两种特殊的URL用于测试
// 用HTTP://localhost:8080或http://127.0.0.1:8080 连接这个服务器
 
// 首先加载所有需要用到的模块
var http = require('http');    // 加载http服务api模块
var fs = require('fs');      // 加载fs文件服务api模块
var server = new http.Server();  // 创建新的HTTP服务器
var urlapi = require('url');    // 创建url路由api模块
server.listen(8080);       // 监听端口8000

var htmlStartTime; // 用来记录每次首次请求视频网页的时间，进而从此开始通过response的写入，控制网速
var segStartTime;  // 用来记录每次首次请求segment的时间
var isSegStart;
var contentArrayCnt; //用来记录每次请求中，当前Byte的位置
var contentLength;   //记录每次请求的文件的大小，单位是Byte
var responseGlobal;  //在全局定义一个指针去访问response?
var contentGlobal; //在全局定义一个指针去访问content
var delayInterval; // 全局的delayInterval
var tpTrace = require('./throughputTrace/thruputTraceFerry.js'); //将thruputTrace1.js中定义的throughput读取进来到tpTrace

// 使用on方法注册事件处理,该事件一直被监听,任何的请求都会进入回调函数,执行相应的操作
server.on('request', function(request, response) { // 当有request请求的时候触发处理函数  
  // 解析请求的URL
  var url = urlapi.parse(request.url);
  
  //监听请求的网站,以当前脚本目录为根目录的url地址
  // 这种连续的两次取时间 new Date().getTime()得到的结果是一样的。
  var timeRequestReceived = new Date().getTime();
  console.log("Request Received for: " + url.pathname + "  at: " + new Date().getTime());
 
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

        if (filename.match(".m4s")){

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
  var currentTpNum = Math.floor(currentTime/1000); //当次应该选取的网速编号
  var currentThroughput = tpTrace[currentTpNum];   //单位是bps，bit每秒
  var responseNext = Math.ceil(currentThroughput*delayInterval/8000);  //单位是Byte,也就是8bit
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


