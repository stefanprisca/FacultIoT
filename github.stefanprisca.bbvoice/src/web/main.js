'use strict';

var isInitiating = true
var streamLoaded = false

const socketId = getSocketId() 
document.getElementById("myName").innerText = socketId

function getSocketId(){
  var loc = document.location.href
  var url = new URL(loc)
  return getParameterByName('Nickname', url)
}

function getParameterByName(name, url) {
  if (!url) url = window.location.href;
  name = name.replace(/[\[\]]/g, "\\$&");
  var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
      results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, " "));
}

var incomingConnections = {}
function addIncomingConnection(treeId, pc){
  incomingConnections[treeId] = pc
}

var streams = {}

var outgoingConnections = {}
function addOutgoingConnection(treeId, pId, pc){
  var tree = outgoingConnections[treeId]
  if (tree === undefined) {
    tree = {}
  }
  tree[pId] = pc
  outgoingConnections[treeId] = tree
}

function removeOutgoingConnections(pId){
  var treeIds = Object.keys(outgoingConnections)
  treeIds.forEach(tId => {
    if (outgoingConnections[tId] !== undefined) {
      outgoingConnections[tId][pId] = undefined
    }
  })
}

var turnReady

var readyChannels = {}
function isChannelReady(pId){
  var s = readyChannels[pId]
  return s !== undefined && s
}

var startedInputPeers = {}
function isReceiving(treeId){
  var s = startedInputPeers[treeId]
  return s !== undefined && s
}

function startedReceiving(treeId){
  startedInputPeers[treeId] = true
}

var startedOutputPeers = {}
function isSending(pId, treeId){
  
  var tree = startedOutputPeers[treeId]
  if (tree === undefined) {
    return false
  }

  var s = tree[pId]
  return s !== undefined && s
}

function startedSending(treeId, pId){
  var tree = startedOutputPeers[treeId]
  if (tree === undefined) {
    tree = {}
  }
  tree[pId] = true
  startedOutputPeers[treeId] = tree
}

function stopSending(pId){
  var treeIds = Object.keys(startedOutputPeers)
  treeIds.forEach(tId => {
    if(startedOutputPeers[tId] !== undefined){
      startedOutputPeers[tId][pId] = undefined
    }
  })
  startedOutputPeers[pId] = undefined
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

var socket = new WebSocket('wss://52.28.20.194:443/websocket?id='+socketId)

function sendMessage(message, destination = "", treeId = "") {
  console.log('Client sending message: ', message);
  socket.send(JSON.stringify({ id:socketId, treeID: treeId, message: message, destination: destination }))
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
  video: true
})
.then(gotStream)
.catch(function(e) {
  	console.log("got user media error!")
	// alert('getUserMedia() error: ' + e.name);
});

function gotStream(stream) {
  console.log('Adding local stream.')
  localVideo.src = window.URL.createObjectURL(stream)
  streams[socketId] = stream
  sendMessage('got user media', "", socketId)
}

socket.onmessage = function (evnt){
  var data = evnt.data.replace('\n', '')
  var socketMsg = JSON.parse(data)
  var pId = socketMsg.ID
  var treeId = socketMsg.TreeID
  var message = socketMsg.Message
  console.log(`Client received messagr < "${message}" > from ${pId} on tree < ${treeId} >`)
  switch (message) {
    case 'created':
      readyChannels[socketId] = true
      isInitiating = false
	if (streams[socketId] !== undefined){
	      sendMessage('got user media', "", socketId)
	}	
	break
    
    case 'join':
	if (streams[socketId] !== undefined){
		sendMessage('got user media', "", socketId)
	}
      readyChannels[socketId] = true
      newEvent(socketId, "Joined", 0)
      break;
      
    case 'full':
      console.log('Room ' + room + ' is full');
      break;

    case 'newcommer':
      // Someone new is comming. Maybe start sending them data
      	readyChannels[pId] = true
        maybeStartSending(pId, treeId)
        newEvent(pId, "Newcommer", 0)
      break;
    
    case 'got user media':
    // Someone wants to send me data, so make a new video element to receive it
      makeNewVideoElement(pId)
      readyChannels[pId] = true;
      maybeStartReceiving(pId, treeId);
      break
    
    case 'bye':
      handleRemoteHangup(pId)
      newEvent(pId, "Bye", 0)
      break
  
    default:
      handleWebRTC(pId, treeId, message)
      break;
  }
}

// This client receives a message
function handleWebRTC(pId, treeId, message) {
  if (message.type === 'offer') {
    if (!isReceiving(treeId)) {
      makeNewVideoElement(treeId)
      maybeStartReceiving(pId, treeId);
    }
    incomingConnections[treeId]
        .setRemoteDescription(new RTCSessionDescription(message));
    doAnswer(pId, treeId);
  } else if (message.type === 'answer' && isSending(pId, treeId)) {
    console.log('Received an answer from the other side, setting remote description', pId)
    outgoingConnections[treeId][pId]
        .setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && (isSending(pId, treeId) || isReceiving(treeId))) {
    var candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate
    });
    if(isSending(pId, treeId)) {
      outgoingConnections[treeId][pId].addIceCandidate(candidate);
    }
    if(isReceiving(treeId)) {
      incomingConnections[treeId].addIceCandidate(candidate);
    }
  } else if (message === 'bye') {
    handleRemoteHangup();
  }
}

////////////////////////////////////////////////////

function maybeStartSending(pId, treeId) {
  console.log(`>>>>>>> maybeStart Sending pid = ${pId}`, 
    isSending(pId, treeId), streams[treeId], isChannelReady(pId))
  
  if (!isSending(pId, treeId) && typeof streams[treeId] !== 'undefined') {
    console.log(`>>>>>> creating outgoing peer connection for < ${pId} > in tree #${treeId}`);
    createOutputPeerConnection(pId, treeId);
    startedSending(treeId, pId)
    //if(!isInitiating) {
      doCall(pId, treeId);
    //}
  }
}

function maybeStartReceiving(pId, treeId) {
  console.log(`>>>>>>> maybeStart Receiving () pid = ${pId}`, 
    isReceiving(treeId), streams[treeId], isChannelReady(socketId));
  if (!isReceiving(treeId) && isChannelReady(socketId)) {
    console.log(`>>>>>> creating incoming peer connection for ${pId} in tree #${treeId}`);
    createInputPeerConnection(pId, treeId);
    startedReceiving(treeId)
  }
}

function makeNewVideoElement(pId) {
  console.log(`@${socketId}: Making a new video element for the remote peer`)
  var video = document.createElement('video')
  video.controls = true
  video.autoplay = true
  video.muted = true
  video.id = pId
  remoteVideos.appendChild(video)
  openVideoSpots.push(video)
}

/////////////////////////////////////////////////////////

function createOutputPeerConnection(pId, treeId) {
  try {
    var pc = new RTCPeerConnection(null);
    pc.addStream(streams[treeId])
    pc.onicecandidate = (event) => {handleIceCandidate(event, pId, treeId)};
    // pc.ontrack = handleRemoteTrackAdded
    // pc.onremovestream = handleRemoteStreamRemoved;
    addOutgoingConnection(treeId, pId, pc)
    console.log(`Created Output RTCPeerConnnection for ${pId} in tree #${treeId}`);
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function createInputPeerConnection(pId, treeId) {
  try {
    var pc = new RTCPeerConnection(null);
    pc.addStream(new MediaStream())
    pc.onicecandidate = (event) => {handleIceCandidate(event, pId, treeId)};
    pc.ontrack = (e) => handleRemoteTrackAdded(e, treeId)
    pc.onremovestream = handleRemoteStreamRemoved;
    addIncomingConnection(treeId, pc)
    console.log(`Created Input RTCPeerConnnection for ${pId} in tree #${treeId}`);
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function doCall(pId, treeId) {
  console.log(`'Sending offer to peer <${pId}> in tree #${treeId}`);
  outgoingConnections[treeId][pId].createOffer(
    (sd) => {setOutgoingLocalAndSendMessage(sd, pId, treeId)}, handleCreateOfferError);
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doAnswer(pId, treeId) {
  console.log(`'Sending answer to peer. <${pId}> in tree #${treeId}`);
  incomingConnections[treeId].createAnswer().then(
    (sd) => {setIncomingLocalAndSendMessage(sd, pId, treeId)},
    onCreateSessionDescriptionError
  );
}

function setOutgoingLocalAndSendMessage(sessionDescription, pId, treeId) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  //  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  outgoingConnections[treeId][pId].setLocalDescription(sessionDescription);
  console.log('setOutgoingLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription, pId, treeId);
  isInitiating = false
}

function setIncomingLocalAndSendMessage(sessionDescription, pId, treeId) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  //  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  incomingConnections[treeId].setLocalDescription(sessionDescription);
  console.log('setIncomingLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription, pId, treeId);
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

function handleIceCandidate(event, pId, treeId) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    }, pId, treeId);
  } else {
    console.log('End of candidates.');
  }
}

function handleRemoteTrackAdded(event, treeId) {
  console.log(`Remote stream added! ${openVideoSpots}`)
  var stream = event.streams[0]
  var remoteVideo = document.getElementById(treeId)
  if (remoteVideo === undefined) {
    remoteVideo = openVideoSpots.pop()
  }
  remoteVideo.src = window.URL.createObjectURL(stream)
  streams[treeId] = stream

  recordStreamReceived(treeId)

  sendMessage("got parent stream", "", treeId)
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event)
}

function handleRemoteHangup(pId) {
  console.log('Session terminated.')
  removeOutgoingConnections(pId)
  incomingConnections[pId] = undefined
  streams[pId] = undefined
  readyChannels[pId] = false
  startedInputPeers[pId] = false
  stopSending(pId)

  var videoElement = document.getElementById(pId)
  remoteVideos.removeChild(videoElement)
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
