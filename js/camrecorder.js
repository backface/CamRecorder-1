/**
 * CamRecorder
 *
 * @file Records video (and optionally audio) from input devices.
 * @version 0.6
 * @class
 * @requires mjpegaudio.js (for Safari only)
 * @requires recorder.js (for audio support in Safari only)
 *
 * -- MIT License
 *
 * Copyright (c) 2020 Valentin Schmidt
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
 * persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
 * FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

'use strict';

(function(root) {

	/**
	 * @constructor
	 * @param {object} videoElement
	 * @param {boolean} recordAudio
	 * @param {number} videoWidth
	 * @param {number} videoHeight
	 * @param {number} fps
	 */
	var CamRecorder = function(videoElement, recordAudio, videoWidth, videoHeight, fps){

		this._hasMediaRecorder = typeof window.MediaRecorder != 'undefined';
		console.log('Native MediaRecorder: '+(this._hasMediaRecorder?'yes':'no'));

		this._videoElement = videoElement;
		this._videoWidth = videoWidth;
		this._videoHeight = videoHeight;
		this._fps = fps;
		this._audio = recordAudio;

		if (this._hasMediaRecorder){
			if (MediaRecorder.isTypeSupported){
				this._container = 'webm';
				this._mimeType = 'video/webm;codecs=vp9' + (this._audio?',opus':'');
				if (!MediaRecorder.isTypeSupported(this._mimeType)) {
					this._mimeType = 'video/webm;codecs=vp8' + (this._audio?',opus':'');
					if (!MediaRecorder.isTypeSupported(this._mimeType)) {
						this._mimeType = 'video/webm';
						if (!MediaRecorder.isTypeSupported(this._mimeType)) {
							this._mimeType = '';
						}
					}
				}
			}else{
				// assuming it's the experimental MediaRecorder in Safari
				this._mimeType = 'video/mp4'; // ;codec=h264,aac
				this._container = 'mp4';
			}
		}else{
			this._canvas = document.querySelector('#__recorder-canvas__');
			if (!this._canvas){
				this._canvas = document.createElement('canvas');
				this._canvas.id = '__recorder-canvas__';
				this._canvas.width = this._videoWidth;
				this._canvas.height = this._videoHeight;
				document.body.appendChild(this._canvas);
				this._canvas.style = 'display: none';
			}
			this._ctx = this._canvas.getContext('2d');
			this._mimeType = 'video/avi;codec=mjpg' + (this._audio?',pcm':'');
			this._container = 'avi';
		}

		console.log('Using MimeType: '+this._mimeType);
	};

	/**
	 * Initializes input devices (camera and optionally microphone)
	 */
	CamRecorder.prototype.init = function(){
		return navigator.mediaDevices.getUserMedia({
			audio: this._audio,
			video: {
				width: {ideal: this._videoWidth},
				height: {ideal: this._videoHeight},
				//aspectRatio: {ideal: 1.3333333333},
				frameRate: {ideal: this._fps},
			}
		})
		.then((stream) => {
			this._stream = stream;
			this._videoElement = attachMediaStream(this._videoElement, stream);
			if (this._audio && !this._hasMediaRecorder){
				var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
				var sourceNode = audioCtx.createMediaStreamSource(stream);
				this._wavrec = new Recorder(sourceNode);
			}
		})
		.catch((e) => {
			console.error(e);
		});
	};

	/**
	 * Starts recording
	 */
	CamRecorder.prototype.start = function(){
		this._frames = [];
		if (this._hasMediaRecorder){
			this._mediaRecorder = new MediaRecorder(this._stream, {mimeType: this._mimeType});
			this._mediaRecorder.ondataavailable = (e) => {
				if (e.data && e.data.size > 0) {
					this._frames.push(e.data);
				}
			};
			this._mediaRecorder.onstop = (e) => {
				this._blob = new Blob(this._frames, {type: this._mimeType});
				if (this._cb) this._cb(this._blob);
			};
			this._mediaRecorder.start();
		}else{
			this._rec = setInterval(() => {
				this._ctx.drawImage(this._videoElement, 0, 0, this._videoWidth, this._videoHeight);
				this._frames.push(this._canvas.toDataURL('image/jpeg')); // The default JPEG quality is 0.92
			}, 1000/this._fps);
			if (this._audio) this._wavrec.record();
		}
	}

	/**
	 * Stops recording
	 * @param {function} [cb] - callback that receives the final video as blob
	 */
	CamRecorder.prototype.stop = function(cb){
		if (this._hasMediaRecorder){
			this._cb = cb;
			this._mediaRecorder.stop();
		}else{
			clearInterval(this._rec);
			if (this._audio){
				this._wavrec.stop();
				if (console.time) console.time('Encoding Audio');
				this._wavrec.exportRaw((data) => {
					if (console.timeEnd) console.timeEnd('Encoding Audio');
					if (console.time) console.time('Encoding AVI');
					var mjpeg = new MJPEGBuilder();
					mjpeg.setup(this._videoWidth, this._videoHeight, this._fps);
					for (var frame_num=0;frame_num<this._frames.length;frame_num++){
						mjpeg.addFrame(this._frames[frame_num]);
					}
					// [blob, numChannels, sampleRate]
					mjpeg.addAudio(data[0], data[1], data[2]);
					this._blob = mjpeg.finish();
					if (console.timeEnd) console.timeEnd('Encoding AVI');
					this._wavrec.clear();
					if (cb) cb(this._blob);
				});
			}else{
				if (console.time) console.time('Encoding AVI');
				var mjpeg = new MJPEGBuilder();
				mjpeg.setup(this._videoWidth, this._videoHeight, this._fps);
				for (var frame_num=0;frame_num<this._frames.length;frame_num++){
					mjpeg.addFrame(this._frames[frame_num]);
				}
				this._blob = mjpeg.finish();
				if (console.timeEnd) console.timeEnd('Encoding AVI');
				if (cb) cb(this._blob);
			}
		}
	}

	/**
	 * @returns {object} the recorded video as blob
	 */
	CamRecorder.prototype.getVideoBlob = function(){
		return this._blob;
	}

	/**
	 * @returns {string} the recorded video's container (webm, mp4 or avi)
	 */
	CamRecorder.prototype.getVideoContainer = function(){
		return this._container;
	}

	/**
	 * Utility, saves recorded video as local file
	 * @param {string} [basename] - the default basename (filename without ext) for saved video
	 */
	CamRecorder.prototype.saveAsFile = function(basename){
		if (!basename) basename = 'recording';
		var a = document.createElement('a');
		document.body.appendChild(a);
		a.style = 'display: none';
		var url = window.URL.createObjectURL(this._blob);
		a.href = url;
		a.download = basename+'.'+this._container;
		a.click();
		setTimeout(() => {
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);
		}, 100);
	};

	/**
	 * Utility, uploads recorded video via ajax and HTTP POST
	 * @param {string} url
	 * @param {string} varName - POST var name for uploaded video
	 * @param {string} basename - the basename (filename without ext) for uploaded video
	 * @param {object} postVars - additional POST vars, {} for none
	 * @param {function} cbLoaded
	 * @param {function} [cbProgress]
	 */
	CamRecorder.prototype.upload =  function (url, varName, basename, postVars, cbLoaded, cbProgress) {
		if (!basename) basename = 'recording';
		var fd = new FormData();
		fd.append(varName, this._blob, basename+'.'+this._container);
		if (postVars){
			for (var k in postVars) fd.append(k, postVars[k]);
		}
		var xhr = new XMLHttpRequest();
		xhr.addEventListener('load', function(e) {
			cbLoaded(true, e);
		}, false);
		xhr.addEventListener('error', function(e) {
			cbLoaded(false, e);
		}, false);
		if (xhr.upload && cbProgress) {
			xhr.upload.onprogress = function(e){
				if (e.lengthComputable) {
					cbProgress(e.loaded/e.total);
				}
			}
		}
		xhr.open('POST', url);
		xhr.send(fd);
	};

	// export
	root.CamRecorder = CamRecorder;

})(window);
