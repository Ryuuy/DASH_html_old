// 2018.6.24 1.增加一个estimated throughput的log输出

function create_buffer_log(){
    
    var newwindow = window.open("http://127.0.0.1:8080/DASH-JS-master/logResults.html")
   
    newwindow.document.write("Log of Buffer")
    newwindow.document.write("<BR>");
    newwindow.document.write("----Time (ms)----Buffer State (Sec)----")
    newwindow.document.write("<BR>");
    var startTime = myFplot2.f[0].timeStamps[0];

    for(var i=0;i<myFplot2.f[1].cnt;i++){
	newwindow.document.write(String(myFplot2.f[1].timeStamps[i]-startTime) + " " + String(myFplot2.f[1].values[i]));
	newwindow.document.write("<BR>");
    }
}

function create_BW_log(){
    
    var newwindow = window.open("http://127.0.0.1:8080/DASH-JS-master/logResults.html")

    newwindow.document.write("Log of Actual Download Speed")
    newwindow.document.write("<BR>");
    newwindow.document.write("----Start Time (ms)----End Time (ms)----Download Speed (bps)----")
    newwindow.document.write("<BR>");
    var startTime = myFplot2.f[0].timeStamps[0];

    for(var i=0;i<myFplot2.f[0].cnt;i++){
	newwindow.document.write(String(myFplot2.f[0].timeStamps[i]-startTime) + " " + String(myFplot2.f[0].timeStampsOver[i]-startTime) + " " + String(myFplot2.f[0].values[i]));
	newwindow.document.write("<BR>");
    }
}

function create_BW_getTime_log(){
    
    var newwindow = window.open("http://127.0.0.1:8080/DASH-JS-master/logResults.html")

    newwindow.document.write("Log of Actual Download Speed with getTime() logs")
    newwindow.document.write("<BR>");
    newwindow.document.write("----Start Time (ms)----End Time (ms)----Download Speed (bps)----")
    newwindow.document.write("<BR>");

    for(var i=0;i<myFplot2.f[0].cnt;i++){
	newwindow.document.write(String(myFplot2.f[0].timeStamps[i]) + " " + String(myFplot2.f[0].timeStampsOver[i]) + " " + String(myFplot2.f[0].values[i]));
	newwindow.document.write("<BR>");
    }
}

function create_rep_log(){
    
    var newwindow = window.open("http://127.0.0.1:8080/DASH-JS-master/logResults.html")
    
    newwindow.document.write("Log of Selected Bitrate")
    newwindow.document.write("<BR>");
    newwindow.document.write("----Time (ms)----Bitrate (bps)----")
    newwindow.document.write("<BR>");
    var startTime = myFplot2.f[0].timeStamps[0];

    for(var i=0;i<myFplot.f[1].cnt;i++){
	newwindow.document.write(String(myFplot.f[1].timeStamps[i]-startTime) + " " + String(myFplot.f[1].values[i]));
	newwindow.document.write("<BR>");
    }
}


function create_all_logs(){
    
    var newwindow = window.open("http://127.0.0.1:8080/DASH-JS-master/logResults.html")
    var startTime = myFplot2.f[0].timeStamps[0];
    
    newwindow.document.write("Log of Buffer")
    newwindow.document.write("<BR>");
    newwindow.document.write("----Time (ms)----Buffer State (Sec)----")
    newwindow.document.write("<BR>");
    

    for(var i=0;i<myFplot2.f[1].cnt;i++){
	newwindow.document.write(String(myFplot2.f[1].timeStamps[i]-startTime) + " " + String(myFplot2.f[1].values[i]));
	newwindow.document.write("<BR>");
    }
    newwindow.document.write("<BR>");

    newwindow.document.write("Log of Actual Throughput")
    newwindow.document.write("<BR>");
    newwindow.document.write("----Start Time (ms)----End Time (ms)----Download Speed (bps)----")
    newwindow.document.write("<BR>");

    for(var i=0;i<myFplot2.f[0].cnt;i++){
	newwindow.document.write(String(myFplot2.f[0].timeStamps[i]-startTime) + " " + String(myFplot2.f[0].timeStampsOver[i]-startTime) + " " + String(myFplot2.f[0].values[i]));
	newwindow.document.write("<BR>");
    }
    
    newwindow.document.write("<BR>");

    newwindow.document.write("Log of Predicted Bitrate")
    newwindow.document.write("<BR>");
    newwindow.document.write("----Time (ms)----Bitrate (bps)----")
    newwindow.document.write("<BR>");

    for(var i=0;i<myFplot.f[0].cnt;i++){
	newwindow.document.write(String(myFplot.f[0].timeStamps[i]-startTime) + " " + String(myFplot.f[0].values[i]));
	newwindow.document.write("<BR>");
    }

    newwindow.document.write("<BR>");

    newwindow.document.write("Log of Selected Bitrate")
    newwindow.document.write("<BR>");
    newwindow.document.write("----Time (ms)----Bitrate (bps)----")
    newwindow.document.write("<BR>");

    for(var i=0;i<myFplot.f[1].cnt;i++){
	newwindow.document.write(String(myFplot.f[1].timeStamps[i]-startTime) + " " + String(myFplot.f[1].values[i]));
	newwindow.document.write("<BR>");
    }
}

function create_progress_log(){

	var newwindow = window.open("http://127.0.0.1:8080/DASH-JS-master/logResults.html");
	var startTime = myFplot2.f[0].timeStamps[0];
	
	newwindow.document.write("Log of onProgress Event in Streaming")
    newwindow.document.write("<BR>");
    newwindow.document.write("----TimeStamp (ms)----Data Transfered (Sec)----Segment ID")
    newwindow.document.write("<BR>");

    for (var i = 0; i<progressCnt; i++){
    newwindow.document.write(String(progressTimeStamp[i] - startTime) + " " + String(progressData[i]) + " " + String(progressTimeID[i]));
   	newwindow.document.write("<BR>");
    }


}

function create_progress_getTime_log(){

	var newwindow = window.open("http://127.0.0.1:8080/DASH-JS-master/logResults.html");
	
	newwindow.document.write("Log of onProgress Event in Streaming")
    newwindow.document.write("<BR>");
    newwindow.document.write("----TimeStamp (ms)----Data Transfered (Sec)----Segment ID")
    newwindow.document.write("<BR>");

    for (var i = 0; i<progressCnt; i++){
    newwindow.document.write(String(progressTimeStamp[i]) + " " + String(progressData[i]) + " " + String(progressTimeID[i]));
   	newwindow.document.write("<BR>");
    }


}