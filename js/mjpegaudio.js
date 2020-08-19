/**
 * Javascript MJPEG AVI Builder
 *
 * @file Creates MJPEG AVI from JPGs, and optionally also adds an audio track from a raw PCM audio blob.
 * @version 0.2
 *
 * -- MIT License
 *
 * Copyright (c) 2012 Satoshi Ueyama
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
 *
 *
 * This is a both reduced and extended version of the original script. The JPEGScanner was
 * removed, and audio support was added.
 * Audio support by (c) 2020 Valentin Schmidt
 */

'use strict';

(function(aGlobal) {

	var AVIF_HASINDEX = 0x00000010;
	var AVIIF_KEYFRAME = 0x00000010;
	var RateBase = 1000000;
	var Verbose = false;

	function MJPEGBuilder() {
		this.movieDesc = {
			w: 0, h:0, fps: 0,
			videoStreamSize: 0,
			maxJPEGSize: 0
		};

		this.avi = MJPEGBuilder.createAVIStruct();
		this.headerLIST = MJPEGBuilder.createHeaderLIST();
		this.moviLIST   = MJPEGBuilder.createMoviLIST();
		this.frameList  = [];
	}

	MJPEGBuilder.prototype = {
		setup: function(frameWidth, frameHeight, fps) {
			this.movieDesc.w = frameWidth;
			this.movieDesc.h = frameHeight;
			this.movieDesc.fps = fps;
		},

		addFrame: function(u) {
			var frame = atob(u.slice(23));
			// binary string to typed array
			var len = frame.length;
			if (len % 2) len++; // padding
			var arr = new Uint8Array(len);
			for (var i = 0; i < len; i++){
				arr[i] = frame.charCodeAt(i);
			}

			var blob = new Blob([arr.buffer], {type: 'image/jpeg'});

			var bsize = blob.size;
			this.movieDesc.videoStreamSize += bsize;
			this.frameList.push(blob);

			if (this.movieDesc.maxJPEGSize < bsize) {
				this.movieDesc.maxJPEGSize = bsize;
			}
		},

		addAudio: function(blob, numChannels, sampleRate) {
			this.audioBlob = blob;
			this.audioNumChannels = numChannels;
			this.audioSampleRate = sampleRate;
		},

		addVideoStreamData: function(list, blob) {
			var stream = MJPEGBuilder.createMoviStream();
			stream.dwSize = blob.size;
			stream.handler = function(bb) {
				bb.push(blob);
			};
			list.push(stream);
			return stream.dwSize + 8;
		},

		// adds audio as single (non-interleaved) 01wb chunk
		addAudioStreamData: function(list, blob) {
			var stream = MJPEGBuilder.createMoviStream();
			stream.chType = '01wb';
			stream.dwSize = blob.size;
			stream.handler = function(bb) {
				bb.push(blob);
			};
			list.push(stream);
			return stream.dwSize + 8;
		},

		finish: function(onFinish) {
			var streamSize = 0;
			this.moviLIST.aStreams = [];
			var frameCount = this.frameList.length;
			var frameIndices = [];
			var frOffset = 4;
			var IndexEntryOrder = ['chId', 'dwFlags', 'dwOffset', 'dwLength'];
			for (var i = 0;i < frameCount;i++) {
				var frsize = this.addVideoStreamData(this.moviLIST.aStreams, this.frameList[i]);
				frameIndices.push({
					chId: '00dc',
					dwFlags: AVIIF_KEYFRAME,
					dwOffset: frOffset,
					dwLength: frsize - 8,
					_order: IndexEntryOrder
				})

				frOffset += frsize;
				streamSize += frsize;
			};

			if (this.audioBlob){
				// audio as single (non-interleaved) 01wb chunk
				var frsize = this.addAudioStreamData(this.moviLIST.aStreams, this.audioBlob);
				frameIndices.push({
					chId: '01wb',
					dwFlags: AVIIF_KEYFRAME,
					dwOffset: frOffset,
					dwLength: frsize - 8,
					_order: IndexEntryOrder
				})
				streamSize += frsize;
			}

			this.moviLIST.dwSize = streamSize + 4;

			// stream header (strh)
			var frameDu = Math.floor(RateBase / this.movieDesc.fps);
			var strh = MJPEGBuilder.createStreamHeader();
			strh.wRight  = this.movieDesc.w;
			strh.wBottom = this.movieDesc.h;
			strh.dwLength = this.frameList.length;
			strh.dwScale  = frameDu;

			// strf
			var bi = MJPEGBuilder.createBitmapHeader();
			bi.dwWidth  = this.movieDesc.w;
			bi.dwHeight = this.movieDesc.h;
			bi.dwSizeImage = 3 * bi.dwWidth * bi.dwHeight;
			var strf = MJPEGBuilder.createStreamFormat();
			strf.dwSize = bi.dwSize;
			strf.sContent = bi;

			// strl
			var strl = MJPEGBuilder.createStreamHeaderLIST();
			strl.dwSize = 4 + (strh.dwSize + 8) + (strf.dwSize + 8);
			strl.aList = [strh, strf];

			// audio
			if (this.audioBlob){
				// strh_audio
				var strh_audio = MJPEGBuilder.createStreamHeader();
				strh_audio.chTypeFourCC = 'auds';
				strh_audio.chHandlerFourCC = '\0\0\0\0'; //???
				strh_audio.dwScale  = 1;
				strh_audio.dwRate = this.audioNumChannels * this.audioSampleRate;
				// dwLength: size of stream in units as defined in dwRate and dwScale
				strh_audio.dwLength = this.audioNumChannels * this.audioSampleRate * frameCount / this.movieDesc.fps;
				strh_audio.dwSampleSize = 2;
				strh_audio.wRight  = 0;
				strh_audio.wBottom = 0;

				// strf_audio
				// The structure of the strf chunk depends on the media type.
				// Video streams use the BITMAPINFOHEADER structure, whereas audio streams use the WAVEFORMATEX structure
				var strf_audio = MJPEGBuilder.createStreamFormat();
				strf_audio.dwSize = 18;
				var wh = MJPEGBuilder.createWavHeader();
				wh.wnChannels = this.audioNumChannels;
				wh.dwnSamplesPerSec = this.audioSampleRate;
				wh.dwnAvgBytesPerSec = this.audioSampleRate*this.audioNumChannels;
				strf_audio.sContent = wh;

				// strl_audio
				var strl_audio = MJPEGBuilder.createStreamHeaderLIST();
				strl_audio.dwSize = 4 + (strh.dwSize + 8) + (strf_audio.dwSize + 8);
				strl_audio.aList = [strh_audio, strf_audio];
			}

			// AVI header
			var avih = MJPEGBuilder.createAVIMainHeader();
			avih.dwMicroSecPerFrame = frameDu;
			avih.dwMaxBytesPerSec = this.movieDesc.maxJPEGSize * this.movieDesc.fps;
			avih.dwTotalFrames = this.frameList.length;
			avih.dwWidth  = this.movieDesc.w;
			avih.dwHeight = this.movieDesc.h;
			avih.dwSuggestedBufferSize = 0;

			var hdrlSize = 4;
			hdrlSize += avih.dwSize + 8;
			hdrlSize += strl.dwSize + 8;
			if (this.audioBlob) hdrlSize += strl_audio.dwSize + 8;
			this.headerLIST.dwSize = hdrlSize;
			this.headerLIST.aData = (this.audioBlob) ? [avih, strl, strl_audio] : [avih, strl];

			var indexChunk = {
				chFourCC: 'idx1',
				dwSize: frameIndices.length * 16,
				aData: frameIndices,
				_order: ['chFourCC', 'dwSize', 'aData']
			};

			// AVI Container
			var aviSize = 0;
			aviSize += 8 + this.headerLIST.dwSize;
			aviSize += 8 + this.moviLIST.dwSize;
			aviSize += 8 + indexChunk.dwSize;

			this.avi.dwSize = aviSize + 4;
			this.avi.aData = [this.headerLIST, this.moviLIST, indexChunk];

			var chunks = [];
			MJPEGBuilder.appendStruct(chunks, this.avi);
			return new Blob(chunks, {type: 'video/avi'});
		}
	};

	MJPEGBuilder.appendStruct = function(bb, s, nest) {
		nest = nest || 0;
		if (!s._order) {
			throw "Structured data must have '_order'";
		}

		var od = s._order;
		var len = od.length;

		for (var i = 0;i < len;i++) {
			var fieldName = od[i];
			var val = s[fieldName];
			if (Verbose) {
				console.log("\t\t\t\t\t\t\t\t".substring(0,nest) + fieldName);
			}
			switch(fieldName.charAt(0)) {
			case 'b': // BYTE
				var _abtempBYTE = new ArrayBuffer(1);
				var _u8tempBYTE = new Uint8Array(_abtempBYTE);

				_u8tempBYTE[0] = val;
				bb.push(_abtempBYTE);
				break
			case 'c': // chars
				bb.push(val);
				break;
			case 'd': // DWORD
				var _abtempDWORD = new ArrayBuffer(4);
				var _u8tempDWORD = new Uint8Array(_abtempDWORD);

				_u8tempDWORD[0] =  val		& 0xff;
				_u8tempDWORD[1] = (val >> 8)  & 0xff;
				_u8tempDWORD[2] = (val >> 16) & 0xff;
				_u8tempDWORD[3] = (val >> 24) & 0xff;
				bb.push(_abtempDWORD);
				break;
			case 'w': // WORD
				var _abtempWORD = new ArrayBuffer(2);
				var _u8tempWORD = new Uint8Array(_abtempWORD);

				_u8tempWORD[0] =  val		& 0xff;
				_u8tempWORD[1] = (val >> 8)  & 0xff;
				bb.push(_abtempWORD);
				break
			case 'W': // WORD(BE)
				var _abtempWORD = new ArrayBuffer(2);
				var _u8tempWORD = new Uint8Array(_abtempWORD);

				_u8tempWORD[0] = (val >> 8)  & 0xff;
				_u8tempWORD[1] =  val		& 0xff;
				bb.push(_abtempWORD);
				break
			case 'a': // Array of structured data
				var dlen = val.length;
				for (var j = 0;j < dlen;j++) {
					MJPEGBuilder.appendStruct(bb, val[j], nest+1);
				}
				break;
			case 'r': // Raw(ArrayBuffer)
				bb.push(val);
				break;
			case 's': // Structured data
				MJPEGBuilder.appendStruct(bb, val, nest+1);
				break;
			case 'h': // Handler function
				val(bb);
				break;
			default:
				throw "Unknown data type: "+fieldName;
				break;
			}
		}
	};

	MJPEGBuilder.createAVIStruct = function() {
		return {
			chRIFF: 'RIFF',
			chFourCC: 'AVI ',
			dwSize: 0,
			aData: null,
			_order: ['chRIFF', 'dwSize', 'chFourCC', 'aData']
		};
	};

	MJPEGBuilder.createAVIMainHeader = function() {
		return {
			chFourCC: 'avih',
			dwSize: 56,
			dwMicroSecPerFrame: 66666,
			dwMaxBytesPerSec: 1000,
			dwPaddingGranularity: 0,
			dwFlags: AVIF_HASINDEX,
			dwTotalFrames: 1,
			dwInitialFrames: 0,
			dwStreams: 2,
			dwSuggestedBufferSize: 0,
			dwWidth: 10,
			dwHeight: 20,
			dwReserved1: 0,
			dwReserved2: 0,
			dwReserved3: 0,
			dwReserved4: 0,
			_order: [
				'chFourCC', 'dwSize',
				'dwMicroSecPerFrame', 'dwMaxBytesPerSec', 'dwPaddingGranularity', 'dwFlags',
				'dwTotalFrames', 'dwInitialFrames', 'dwStreams', 'dwSuggestedBufferSize',
				'dwWidth', 'dwHeight', 'dwReserved1', 'dwReserved2', 'dwReserved3', 'dwReserved4'
			]
		};
	};

	MJPEGBuilder.createHeaderLIST = function() {
		return {
			chLIST: 'LIST',
			dwSize: 0,
			chFourCC: 'hdrl',
			aData: null,
			_order: ['chLIST', 'dwSize', 'chFourCC', 'aData']
		};
	};

	MJPEGBuilder.createMoviLIST = function() {
		return {
			chLIST: 'LIST',
			dwSize: 0,
			chFourCC: 'movi',
			aStreams: null,
			_order: ['chLIST', 'dwSize', 'chFourCC', 'aStreams']
		};
	};

	MJPEGBuilder.createMoviStream = function() {
		return {
			chType: '00dc',
			dwSize: 0,
			handler: null,
			_order: ['chType', 'dwSize', 'handler']
		}
	};

	MJPEGBuilder.createStreamHeaderLIST = function() {
		return {
			chLIST: 'LIST',
			dwSize: 0,
			chFourCC: 'strl',
			aList: null,
			_order: ['chLIST', 'dwSize', 'chFourCC', 'aList']
		};
	};

	MJPEGBuilder.createStreamFormat = function() {
		return {
			chFourCC: 'strf',
			dwSize: 0,
			sContent: null,
			_order: ['chFourCC', 'dwSize', 'sContent']
		};
	};

	MJPEGBuilder.createStreamHeader = function() {
		return {
			chFourCC: 'strh',
			dwSize: 56,
			chTypeFourCC: 'vids',
			chHandlerFourCC: 'mjpg',
			dwFlags: 0,
			wPriority: 0,
			wLanguage: 0,
			dwInitialFrames: 0,
			dwScale: 66666,
			dwRate: RateBase,
			dwStart: 0,
			dwLength: 0,
			dwSuggestedBufferSize: 0,
			dwQuality: 10000,
			dwSampleSize: 0,
			wLeft: 0,
			wTop: 0,
			wRight: 0,
			wBottom: 0,
			_order:[
				'chFourCC', 'dwSize', 'chTypeFourCC', 'chHandlerFourCC',
				'dwFlags', 'wPriority', 'wLanguage', 'dwInitialFrames', 'dwScale',
				'dwRate', 'dwStart', 'dwLength', 'dwSuggestedBufferSize',
				'dwQuality', 'dwSampleSize', 'wLeft', 'wTop', 'wRight', 'wBottom'
			]
		};
	};

	MJPEGBuilder.createBitmapHeader = function() {
		return {
			dwSize:	40,
			dwWidth:   10,
			dwHeight:  20,
			wPlanes:   1,
			wBitcount: 24,
			chCompression: 'MJPG',
			dwSizeImage: 600,
			dwXPelsPerMeter: 0,
			dwYPelsPerMeter: 0,
			dwClrUsed: 0,
			dwClrImportant: 0,
			_order: [
				'dwSize', 'dwWidth', 'dwHeight', 'wPlanes', 'wBitcount', 'chCompression',
				'dwSizeImage', 'dwXPelsPerMeter', 'dwYPelsPerMeter', 'dwClrUsed', 'dwClrImportant'
			]
		}
	};

	MJPEGBuilder.createWavHeader = function() {
		return {
			wFormatTag: 1,
			wnChannels: 0,
			dwnSamplesPerSec: 0,
			dwnAvgBytesPerSec: 0,
			wnBlockAlign: 2,
			wBitsPerSample: 16,
			wcbSize: 0,
			_order: [
				'wFormatTag', 'wnChannels', 'dwnSamplesPerSec', 'dwnAvgBytesPerSec', 'wnBlockAlign', 'wBitsPerSample', 'wcbSize'
			]
		}
	};

	// export
	aGlobal.MJPEGBuilder = MJPEGBuilder;

})(window);
