'use strict';

var isChannelReady = false
var isInitiating = true
var streamLoaded = false
var localStream;
var pcs = {};
var remoteStream;
var turnReady;

var startedPeers = {}

function isStarted(pId){
  var s = startedPeers[pId]
  return s !== undefined && s
}

const socketId = prompt("Enter user id:")

var pcConfig = {
  'iceServers': [{
    'urls': 'stun:stun.l.google.com:19302'
  }]
};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

/////////////////////////////////////////////

var room = 'foo';
// Could prompt for room name:
// room = prompt('Enter room name:');

var socket = new WebSocket('ws://127.0.0.1:8124/websocket?id='+socketId)

function sendMessage(message) {
  console.log('Client sending message: ', message);
  socket.send(JSON.stringify({ id:socketId, message: message }))
}

// var recording = prompt("Input recording name:")

socket.onopen = function () {
  if (room !== '') {
    sendMessage('create or join');
    console.log('Attempted to create or  join room', room);
  }
}

// function loadLocalStream(recording) {
//   if(streamLoaded){
//     console.log("Stream already")
//     return
//   }
//   console.log(`Adding local stream from file ${recording}.`);
//   var localVideo = document.getElementById('localVideo');
//   localVideo.src = `./resources/${recording}`
//   localVideo.play()
//   localStream = localVideo.captureStream();
//   sendMessage('got user media');
//   streamLoaded = true
// }


var localVideo = document.querySelector('#localVideo');
var remoteVideos = document.querySelector('#remoteVideos');
var openVideoSpots = []

navigator.mediaDevices.getUserMedia({
  audio: true,
  video: false
})
.then(gotStream)
.catch(function(e) {
  alert('getUserMedia() error: ' + e.name);
});

function gotStream(stream) {
  console.log('Adding local stream.')
  localVideo.src = window.URL.createObjectURL(stream)
  localStream = stream
  sendMessage('got user media')
}

socket.onmessage = function (evnt){
  var data = evnt.data.replace('\n', '')
  var socketMsg = JSON.parse(data)
  var pId = socketMsg.ID
  var message = socketMsg.Message
  console.log('Client received message:', message)
  switch (message) {
    case 'created':
      isInitiating = false
      break
    case 'join':
      isChannelReady = true;

      makeNewVideoElement()
      break;
      
    case 'full':
      console.log('Room ' + room + ' is full');
      break;

    case 'newcommer':
      isChannelReady = true;
      break;
    
    case 'got user media':
      makeNewVideoElement()
      maybeStart(pId)
      break
  
    default:
      handleWebRTC(pId, message)
      break;
  }
}

// This client receives a message
function handleWebRTC(pId, message) {
  if (message.type === 'offer') {
    if (isInitiating && !isStarted(pId)) {
      maybeStart(pId);
    }
    pcs[pId].setRemoteDescription(new RTCSessionDescription(message));
    doAnswer(pId);
  } else if (message.type === 'answer' && isStarted(pId)) {
    console.log('Received an answer from the other side, setting remote description')
    pcs[pId].setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted(pId)) {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    pcs[pId].addIceCandidate(candidate);
  } else if (message === 'bye' && isStarted) {
    handleRemoteHangup();
  }
}

////////////////////////////////////////////////////

function maybeStart(pId) {
  console.log('>>>>>>> maybeStart() ', isStarted[pId], localStream, isChannelReady);
  if (!isStarted(pId) && typeof localStream !== 'undefined' && isChannelReady) {
    console.log('>>>>>> creating peer connection');
    createPeerConnection(pId);
    startedPeers[pId] = true;
    if(!isInitiating) {
      doCall(pId);
    }
  }
}

function makeNewVideoElement(){
  var video = document.createElement('video')
  video.controls = true
  video.autoplay = true
  video.muted = true
  remoteVideos.appendChild(video)
  openVideoSpots.push(video)
}

/////////////////////////////////////////////////////////

function createPeerConnection(pId) {
  try {
    var pc = new RTCPeerConnection(null);
    pc.addStream(localStream);
    pc.onicecandidate = handleIceCandidate;
    pc.ontrack = handleRemoteTrackAdded
    pc.onremovestream = handleRemoteStreamRemoved;
    pcs[pId] = pc
    console.log('Created RTCPeerConnnection');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function doCall(pId) {
  console.log('Sending offer to peer');
  pcs[pId].createOffer((sd) => {setLocalAndSendMessage(pId, sd)}, handleCreateOfferError);
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doAnswer(pId) {
  console.log('Sending answer to peer.');
  pcs[pId].createAnswer().then(
    (sd) => {setLocalAndSendMessage(pId, sd)},
    onCreateSessionDescriptionError
  );
}

function setLocalAndSendMessage(pId, sessionDescription) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  //  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  pcs[pId].setLocalDescription(sessionDescription);
  console.log('setLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription);
  isInitiating = false
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function requestTurn(turnURL) {
  var turnExists = false;
  for (var i in pcConfig.iceServers) {
    if (pcConfig.iceServers[i].url.substr(0, 5) === 'turn:') {
      turnExists = true;
      turnReady = true;
      break;
    }
  }
  if (!turnExists) {
    console.log('Getting TURN server from ', turnURL);
    // No TURN server. Get one from computeengineondemand.appspot.com:
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4 && xhr.status === 200) {
        var turnServer = JSON.parse(xhr.responseText);
        console.log('Got TURN server: ', turnServer);
        pcConfig.iceServers.push({
          'url': 'turn:' + turnServer.username + '@' + turnServer.turn,
          'credential': turnServer.password
        });
        turnReady = true;
      }
    };
    xhr.open('GET', turnURL, true);
    xhr.send();
  }
}

function handleIceCandidate(event) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    });
  } else {
    console.log('End of candidates.');
  }
}

function handleRemoteTrackAdded(event) {
  console.log('Remote stream added.');
  var stream = event.streams[0]
  var remoteVideo = openVideoSpots.pop()
  remoteVideo.src = window.URL.createObjectURL(stream);
  remoteStream = stream;
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
}

function stop(pId) {
  startedPeers[pId] = false;
  // isAudioMuted = false;
  // isVideoMuted = false;
  pcs[pId].close();
  pcs[pId] = null;
}

///////////////////////////////////////////

// Set Opus as the default audio codec if it's present.
function preferOpus(sdp) {
  var sdpLines = sdp.split('\r\n');
  var mLineIndex;
  // Search for m line.
  for (var i = 0; i < sdpLines.length; i++) {
    if (sdpLines[i].search('m=audio') !== -1) {
      mLineIndex = i;
      break;
    }
  }
  if (mLineIndex === null) {
    return sdp;
  }

  // If Opus is available, set it as the default in m line.
  for (i = 0; i < sdpLines.length; i++) {
    if (sdpLines[i].search('opus/48000') !== -1) {
      var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
      if (opusPayload) {
        sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex],
          opusPayload);
      }
      break;
    }
  }

  // Remove CN in m line and sdp.
  sdpLines = removeCN(sdpLines, mLineIndex);

  sdp = sdpLines.join('\r\n');
  return sdp;
}

function extractSdp(sdpLine, pattern) {
  var result = sdpLine.match(pattern);
  return result && result.length === 2 ? result[1] : null;
}

// Set the selected codec to the first in m line.
function setDefaultCodec(mLine, payload) {
  var elements = mLine.split(' ');
  var newLine = [];
  var index = 0;
  for (var i = 0; i < elements.length; i++) {
    if (index === 3) { // Format of media starts from the fourth.
      newLine[index++] = payload; // Put target payload to the first.
    }
    if (elements[i] !== payload) {
      newLine[index++] = elements[i];
    }
  }
  return newLine.join(' ');
}

// Strip CN from sdp before CN constraints is ready.
function removeCN(sdpLines, mLineIndex) {
  var mLineElements = sdpLines[mLineIndex].split(' ');
  // Scan from end for the convenience of removing an item.
  for (var i = sdpLines.length - 1; i >= 0; i--) {
    var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
    if (payload) {
      var cnPos = mLineElements.indexOf(payload);
      if (cnPos !== -1) {
        // Remove CN payload from m line.
        mLineElements.splice(cnPos, 1);
      }
      // Remove CN line in sdp
      sdpLines.splice(i, 1);
    }
  }

  sdpLines[mLineIndex] = mLineElements.join(' ');
  return sdpLines;
}
