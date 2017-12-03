/*
METRICS:
Def: A node X starts receiving from another node Y when the stream of Y is added to node X

1) Joined Network: 
  Given network, how much it takes for new node to receive from everyone else
  Measure: joined message -> streams(all) != undefined

2) Newcommer:
  given a network, how much it takes for existing nodes to start receiving from new node
  Measure: newcommer message -> stream(newNOde) != undefined

3) Leave:
  given a network, how much time it takes for node X to start receiving from all other nodes
    after node Y left the network
  Measure:  handleRemoteHangup(Y) -> streams added:
    - how many streams are added back
    - how much it took to add any of them.

=> event based measuring:
  1) Events: Joined, Newcommer, Leave
    {treeId, name, timestamp, networkSize}
  2) Reactions: Stream Added
    {treeId, timestamp}
  - Each event will create a new active measurement.
  - after each event, reactions will add data to the measurement
*/

var events = {}
var reactions = {}

function newEvent(treeId, description, networkSize){
  var timestamp = Date.now()
  events[treeId] = {time:timestamp, description:description, size:networkSize}
}

function recordStreamReceived(treeId){
  var timestamp = Date.now()
  reactions[treeId] = timestamp 
}

function getTimesToReceiveFromNewcommers(){
  // Reactions with a GotUserMedia event in the events
  var sum = 0
  var number = 0
  Object.keys(reactions).forEach(k =>{
    if (events[k] === "GotUserMedia"){
      sum += reactions[k] - events[k].time
      number += 1
    }
  })
  return sum/number
}

function getTimeToReceiveFromExisting(){
  // Reactions without any GotUserMedia event
  var sum = 0
  var number = 0
  Object.keys(reactions).forEach(k =>{
    if (events[k] === undefined){
      sum += reactions[k] - events[k].time
      number += 1
    }
  })
  return sum/number
}

function getTimeToReceiveAfterBye() {
  // Reactions after the bye event
  var sum = 0
  var number = 0
  Object.keys(events).forEach(k =>{
    if (events[k].description === "Bye") {
      Object.keys(reactions).foreach(r =>{
        if (reactions[r] > events[k].time){
          sum += reactions[k] - events[k].time
          number += 1
        }
      })
    }
  })
  return sum/number
}