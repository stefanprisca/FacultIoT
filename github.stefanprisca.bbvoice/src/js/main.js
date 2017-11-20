'use strict';

var isInitiating = true
var streamLoaded = false

const socketId = prompt("Enter user id:")

var incomingConnections = {}
var streams = {}
var outgoingConnections = {}

var turnReady

var startedInputPeers = {}
function isReceiving(pId){
  var s = startedInputPeers[pId]
  return s !== undefined && s
}

var readyChannels = {}
function isChannelReady(pId){
  var s = readyChannels[pId]
  return s !== undefined && s
}

var startedOutputPeers = {}
function isSending(pId){
  var s = startedOutputPeers[pId]
  return s !== undefined && s
}

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

function sendMessage(message, destination = "") {
  console.log('Client sending message: ', message);
  socket.send(JSON.stringify({ id:socketId, message: message, destination: destination }))
}

// var recording = prompt("Input recording name:")

socket.onopen = function () {
  if (room !== '') {
    sendMessage('create or join');
    console.log('Attempted to create or  join room', room);
  }
}

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
  streams[socketId] = stream
  sendMessage('got user media')
}

socket.onmessage = function (evnt){
  var data = evnt.data.replace('\n', '')
  var socketMsg = JSON.parse(data)
  var pId = socketMsg.ID
  var message = socketMsg.Message
  console.log('Client received message:', message, pId)
  switch (message) {
    case 'created':
      isInitiating = false
      break
    
    case 'join':
      readyChannels[pId] = true;
      break;
      
    case 'full':
      console.log('Room ' + room + ' is full');
      break;

    case 'newcommer':
      // Someone new is comming. Maybe start sending them data
      maybeStartSending(pId)
      break;
    
    case 'got user media':
    // Someone wants to send me data, so make a new video element to receive it
      makeNewVideoElement()
      readyChannels[pId] = true;
      maybeStartReceiving(pId);
      break
  
    default:
      handleWebRTC(pId, message)
      break;
  }
}

// This client receives a message
function handleWebRTC(pId, message) {
  if (message.type === 'offer') {
    if (isInitiating && !isReceiving(pId)) {
      makeNewVideoElement()
      maybeStartReceiving(pId);
    }
    incomingConnections[pId].setRemoteDescription(new RTCSessionDescription(message));
    doAnswer(pId);
  } else if (message.type === 'answer' && isSending(pId)) {
    console.log('Received an answer from the other side, setting remote description', pId)
    outgoingConnections[pId].setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && (isSending(pId) || isReceiving(pId))) {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    if(isSending(pId)) {
      outgoingConnections[pId].addIceCandidate(candidate);
    }
    if(isReceiving(pId)) {
      incomingConnections[pId].addIceCandidate(candidate);
    }
  } else if (message === 'bye') {
    handleRemoteHangup();
  }
}

////////////////////////////////////////////////////

function maybeStartSending(pId) {
  console.log(`>>>>>>> maybeStart Sending pid = ${pId}`, isSending[pId], streams[socketId], isChannelReady);
  if (!isSending(pId) && typeof streams[socketId] !== 'undefined') {
    console.log(`>>>>>> creating outgoing peer connection 4 ${pId}`);
    createOutputPeerConnection(pId);
    startedOutputPeers[pId] = true;
    if(!isInitiating) {
      doCall(pId);
    }
  }
}

function maybeStartReceiving(pId) {
  console.log(`>>>>>>> maybeStart Receiving () pid = ${pId}`, isReceiving[pId], streams[socketId], isChannelReady);
  if (!isReceiving(pId) && isChannelReady(socketId)) {
    console.log(`>>>>>> creating incoming peer connection for ${pId}`);
    createInputPeerConnection(pId);
    startedInputPeers[pId] = true;
    if(!isInitiating) {
      doCall(pId);
    }
  }
}

function makeNewVideoElement() {
  console.log(`@${socketId}: Making a new video element for the remote peer`)
  var video = document.createElement('video')
  video.controls = true
  video.autoplay = true
  video.muted = true
  remoteVideos.appendChild(video)
  openVideoSpots.push(video)
}

/////////////////////////////////////////////////////////

function createOutputPeerConnection(pId) {
  try {
    var pc = new RTCPeerConnection(null);
    pc.addStream(streams[socketId])
    pc.onicecandidate = (event) => {handleIceCandidate(event, pId)};
    // pc.ontrack = handleRemoteTrackAdded
    // pc.onremovestream = handleRemoteStreamRemoved;
    outgoingConnections[pId] = pc
    console.log(`Created Output RTCPeerConnnection for ${pId}`);
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function createInputPeerConnection(pId) {
  try {
    var pc = new RTCPeerConnection(null);
    pc.addStream(new MediaStream())
    pc.onicecandidate = (event) => {handleIceCandidate(event, pId)};
    pc.ontrack = (e) => handleRemoteTrackAdded(e, pId)
    pc.onremovestream = handleRemoteStreamRemoved;
    incomingConnections[pId] = pc
    console.log(`Created Input RTCPeerConnnection for ${pId}`);
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function doCall(pId) {
  console.log('Sending offer to peer');
  outgoingConnections[pId].createOffer(
    (sd) => {setOutgoingLocalAndSendMessage(sd, pId)}, handleCreateOfferError);
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doAnswer(pId) {
  console.log('Sending answer to peer.');
  incomingConnections[pId].createAnswer().then(
    (sd) => {setIncomingLocalAndSendMessage(sd, pId)},
    onCreateSessionDescriptionError
  );
}

function setOutgoingLocalAndSendMessage(sessionDescription, pId) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  //  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  outgoingConnections[pId].setLocalDescription(sessionDescription);
  console.log('setOutgoingLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription, pId);
  isInitiating = false
}

function setIncomingLocalAndSendMessage(sessionDescription, pId) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  //  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  incomingConnections[pId].setLocalDescription(sessionDescription);
  console.log('setIncomingLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription, pId);
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

function handleIceCandidate(event, pId) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    }, pId);
  } else {
    console.log('End of candidates.');
  }
}

function handleRemoteTrackAdded(event, pId) {
  console.log(`Remote stream added! ${openVideoSpots}`)
  var stream = event.streams[0]
  var remoteVideo = openVideoSpots.pop()
  remoteVideo.src = window.URL.createObjectURL(stream)
  streams[pId] = stream
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event)
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
