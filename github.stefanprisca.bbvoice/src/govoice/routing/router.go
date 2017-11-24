package routing

import (
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Router struct {
	streams   *StreamingMap
	routerBox chan SocketMessage
}

type Streamer struct {
	ID           string
	Channel      chan interface{}
	StreamLoaded map[string]chan bool
	Tree         *StreamingTree
}

type StreamingMap struct {
	Streamers map[string]*Streamer
	lock      *sync.Mutex
}

func (sm StreamingMap) getStreamingTrees() []StreamingTree {
	log.Printf("Getting trees %d", len(sm.Streamers))
	result := []StreamingTree{}
	for _, s := range sm.Streamers {
		if s.Tree != nil {
			result = append(result, *s.Tree)
		}
	}
	return result
}

type SocketMessage struct {
	ID          string
	TreeID      string
	Message     interface{}
	Destination string
}

func NewRouter() *Router {
	streams := &StreamingMap{}
	streams.lock = new(sync.Mutex)
	streams.Streamers = make(map[string]*Streamer)
	routerBox := make(chan SocketMessage)
	return &Router{streams, routerBox}
}

func UpgradeToRouterSocket(router *Router, w http.ResponseWriter, r *http.Request) {
	log.Printf("Got a new request: %v \n", r.URL)
	id := r.URL.Query().Get("id")

	route := makeNewStreamer(id)
	router.streams.lock.Lock()
	router.streams.Streamers[id] = &route
	router.streams.lock.Unlock()

	con := Err1(upgrader.Upgrade(w, r, nil)).(*websocket.Conn)
	go readMessages(con, router.routerBox)
	go publishMessages(con, route.Channel)
}

func makeNewStreamer(id string) Streamer {
	log.Printf("making new streamer %v \n", id)
	channel := make(chan (interface{}))
	readyStreams := make(map[string]chan bool)
	return Streamer{ID: id, Channel: channel, StreamLoaded: readyStreams}
}

func readMessages(con *websocket.Conn, routerBox chan SocketMessage) {
	// readDelay := time.Millisecond
	for {
		// time.Sleep(readDelay)

		nextReq := &SocketMessage{}
		Err0(con.ReadJSON(nextReq))
		if nextReq.ID != "" {
			// log.Printf("Received new frame on the websocket: %v \n", nextReq)
			routerBox <- *nextReq
		}
	}
}

func publishMessages(conn *websocket.Conn, channel chan interface{}) {
	for x := range channel {
		// log.Printf("Sending a new event on the websock: %s\n", x)
		Err0(conn.WriteJSON(x))
	}
}

func Serve(router *Router) {
	for x := range router.routerBox {
		// log.Printf("@serving %s: %s\n", x.ID, x.Message)

		switch x.Message {
		case "create or join":
			go onCreateOrJoin(x, router.streams)
			break
		case "got parent stream":
			log.Printf("Got parent stream message from %s on tree %s", x.ID, x.TreeID)
			router.streams.Streamers[x.ID].StreamLoaded[x.TreeID] <- true
			break
		default:
			go routeMessage(x, *router.streams)
			break
		}
	}
}

func onCreateOrJoin(x SocketMessage, streams *StreamingMap) {
	streams.lock.Lock()
	defer streams.lock.Unlock()

	initializeStreamLoadedChannels(x.ID, streams)

	if len(streams.Streamers) >= 2 {
		streams.Streamers[x.ID].Channel <- SocketMessage{x.ID, "", "join", ""}
		parents := addChild(x.ID, streams)
		announceNewChild(x.ID, parents, *streams)

		// TODO: This is a synchronization issue. I might have to create more messages
		// for a better control of the flow. Include more states in the WebRTC state machine.
		time.Sleep(100 * time.Millisecond)
		newStreamer := streams.Streamers[x.ID]
		newStreamer.Tree = makeNewStreamingTree(x.ID, *streams)
		announceNewTree(newStreamer.Tree, newStreamer.Tree.Root, *streams)
	} else {
		streamer := streams.Streamers[x.ID]
		streamer.Tree = &StreamingTree{Root: x.ID}
		streams.Streamers[x.ID].Channel <- SocketMessage{x.ID, "", "created", ""}
	}
}

func initializeStreamLoadedChannels(newSID string, streams *StreamingMap) {
	keys := getMapKeysExcept(streams.Streamers, newSID)
	newStreamer := streams.Streamers[newSID]
	for _, k := range keys {
		streamer := streams.Streamers[k]
		newStreamer.StreamLoaded[k] = make(chan bool)
		streamer.StreamLoaded[newSID] = make(chan bool)
	}
}

func addChild(childId string, streams *StreamingMap) map[string]string {
	keys := getMapKeysExcept(streams.Streamers, childId)
	parents := make(map[string]string)
	for _, k := range keys {
		streamer := streams.Streamers[k]
		parent := AddChild(streamer.Tree, childId)
		parents[k] = parent
	}

	return parents
}

func makeNewStreamingTree(id string, streams StreamingMap) *StreamingTree {
	existingTrees := streams.getStreamingTrees()
	return NewStreamingTree(id, existingTrees)
}

func getMapKeys(m map[string]*Streamer) []string {
	keys := []string{}
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func getMapKeysExcept(m map[string]*Streamer, id string) []string {
	keys := []string{}
	for k := range m {
		if k == id {
			continue
		}
		keys = append(keys, k)
	}
	return keys
}

func routeMessage(x SocketMessage, streams StreamingMap) {
	if x.Destination == "" {
		broadcastMessage(x.ID, x, streams)
	} else {
		streams.Streamers[x.Destination].Channel <- x
	}
}

func announceNewChild(childId string,
	parents map[string]string,
	streams StreamingMap) {
	for tID, pID := range parents {
		streams.Streamers[pID].Channel <- SocketMessage{childId, tID, "newcommer", ""}
	}
}

func announceNewTree(tree *StreamingTree, treeID string, streams StreamingMap) {

	if tree == nil || tree.Children == nil {
		return
	}

	log.Printf("Announcing new tree %s %v ", treeID, tree)

	rootStreamer := streams.Streamers[tree.Root]
	for _, child := range tree.Children {
		rootStreamer.Channel <- SocketMessage{child.Root, treeID, "newcommer", ""}
	}

	for _, child := range tree.Children {
		if child.Children == nil {
			continue
		}

		var kid = child
		//go func() {
		log.Printf("Waiting for %s to load stream in tree %s", kid.Root, treeID)
		<-streams.Streamers[kid.Root].StreamLoaded[treeID]

		log.Printf("Wanting to announce kid tree for %s in tree %s", kid.Root, treeID)
		announceNewTree(kid, treeID, streams)
		//}()
	}
}

func broadcastMessage(senderId string, message interface{}, streams StreamingMap) {
	for id, route := range streams.Streamers {
		if id != senderId {
			route.Channel <- message
		}
	}
}

func Err0(err error) {
	if err != nil {
		log.Fatal(err.Error())
	}
}

func Err1(arg interface{}, err error) interface{} {
	Err0(err)
	return arg
}

func Err2(arg interface{}, arg2 interface{}, err error) (interface{}, interface{}) {
	Err0(err)
	return arg, arg2
}

func PrintStreamingTrees(w http.ResponseWriter, r *http.Request, router Router) {
	streams := *router.streams
	for _, s := range streams.Streamers {
		fmt.Fprintf(w, " \n --- printing tree %s ---- \n", s.ID)
		PrettyPrintTree(*s.Tree, 0, w)
	}
}
