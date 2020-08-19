'use strict';

const VIDEO_WIDTH = 480;
const VIDEO_HEIGHT = 360;
const VIDEO_FPS = 15;
const VIDEO_DUR_MS = 3500;

var videoCamera = document.querySelector('video#cam');
var videoRecorded = document.querySelector('video#recorded');
var statusDisplay = document.querySelector('#status-display');
var buttonRecord = document.querySelector('button#record');
var buttonSave = document.querySelector('button#save');
var buttonUpload = document.querySelector('button#upload');
var checkboxAudio = document.querySelector('input#audio');

var camRecorder = new CamRecorder(videoCamera, checkboxAudio.checked, VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS);

function logStatus(msg) {
	//console.log(msg);
	statusDisplay.innerHTML = msg;
}

checkboxAudio.addEventListener('click', (e) => {
	camRecorder = new CamRecorder(videoCamera, this.checked, VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS);
	buttonSave.disabled = true;
	buttonUpload.disabled = true;
});

buttonRecord.addEventListener('click', (e) => {
	buttonRecord.disabled = true;
	buttonSave.disabled = true;
	buttonUpload.disabled = true;
	checkboxAudio.disabled = true;
	
	if (!videoRecorded.paused) videoRecorded.pause();
	videoRecorded.autoplay = true;
	
	camRecorder.start();
	setTimeout(function() {
		camRecorder.stop(function(blob) {			
			videoRecorded.src = window.URL.createObjectURL(blob);
		
			buttonRecord.disabled = false
			buttonSave.disabled = false;
			buttonUpload.disabled = false;
			checkboxAudio.disabled = false;
		});
	}, VIDEO_DUR_MS);
});

buttonSave.addEventListener('click', (e) => {
	camRecorder.saveAsFile();
});

buttonUpload.addEventListener('click', (e) => {
	buttonUpload.disabled = true;
	camRecorder.upload(
		'upload.php',
		'clip',
		'myvideo',
		{category_id: 1},
		function(ok, e){
			if (ok) logStatus('The clip was uploaded successfully \\o/');
			else logStatus('Uploading the clip failed :-(');
			//if (e.target.responseText) alert(e.target.responseText);
			buttonUpload.disabled = false;
		},
		function(prog){
			logStatus('Uploading clip ['+Math.ceil(100*prog)+'%]');
		}
	);
});
