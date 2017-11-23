package main

import (
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	st "goVoice/streamingTree"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Streamer struct {
	ID              string
	Channel         chan interface{}
	ResponseChannel chan interface{}
	Tree            *st.StreamingTree
}

type StreamingMap struct {
	Streamers map[string]*Streamer
	lock      *sync.Mutex
}

func (sm StreamingMap) getStreamingTrees() []st.StreamingTree {
	log.Printf("Getting trees %d", len(sm.Streamers))
	result := []st.StreamingTree{}
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

func main() {
	streams := &StreamingMap{}
	streams.lock = new(sync.Mutex)
	streams.Streamers = make(map[string]*Streamer)
	routerBox := make(chan SocketMessage)
	upgradeHttpRequestsToSockets(streams, routerBox)

	log.Println("Starting to serve websockets")
	go serve(routerBox, streams)

	http.HandleFunc("/printTrees", func(w http.ResponseWriter, r *http.Request) {
		printStreamingTrees(w, r, *streams)
	})
	http.ListenAndServe(":8124", nil)
}

func upgradeHttpRequestsToSockets(streams *StreamingMap, routerBox chan SocketMessage) {
	http.HandleFunc("/websocket", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("Got a new request: %v \n", r.URL)
		id := r.URL.Query().Get("id")

		route := makeNewStreamer(id)
		streams.lock.Lock()
		streams.Streamers[id] = &route
		streams.lock.Unlock()

		con := Err1(upgrader.Upgrade(w, r, nil)).(*websocket.Conn)
		go readMessages(con, routerBox)
		go publishMessages(con, route.Channel)
	})
}

func makeNewStreamer(id string) Streamer {
	log.Printf("making new streamer %v \n", id)
	channel := make(chan (interface{}))
	respChannel := make(chan interface{}, 20)
	return Streamer{ID: id, Channel: channel, ResponseChannel: respChannel}
}

func readMessages(con *websocket.Conn, routerBox chan SocketMessage) {
	readDelay := 5 * time.Millisecond
	for {
		time.Sleep(readDelay)

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

func serve(routerBox chan SocketMessage, streams *StreamingMap) {
	for x := range routerBox {
		// log.Printf("@serving %s: %s\n", x.ID, x.Message)

		switch x.Message {
		case "create or join":
			go onCreateOrJoin(x, streams)
			break
		case "got parent stream":
			log.Printf("Got parent stream message from %s on tree %s", x.ID, x.TreeID)
			streams.Streamers[x.ID].ResponseChannel <- x
			break
		default:
			go routeMessage(x, *streams)
			break
		}
	}
}

func onCreateOrJoin(x SocketMessage, streams *StreamingMap) {
	streams.lock.Lock()
	defer streams.lock.Unlock()
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
		streamer.Tree = &st.StreamingTree{Root: x.ID}
		streams.Streamers[x.ID].Channel <- SocketMessage{x.ID, "", "created", ""}
	}
}

func addChild(childId string, streams *StreamingMap) map[string]string {
	keys := getMapKeysExcept(streams.Streamers, childId)
	parents := make(map[string]string)
	for _, k := range keys {
		streamer := streams.Streamers[k]
		parent := st.AddChild(streamer.Tree, childId)
		parents[k] = parent
	}

	return parents
}

func makeNewStreamingTree(id string, streams StreamingMap) *st.StreamingTree {
	existingTrees := streams.getStreamingTrees()
	return st.NewStreamingTree(id, existingTrees)
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

func announceNewTree(tree *st.StreamingTree, treeID string, streams StreamingMap) {
	if tree == nil || tree.Children == nil {
		return
	}
	rootStreamer := streams.Streamers[tree.Root]
	for _, child := range tree.Children {
		rootStreamer.Channel <- SocketMessage{child.Root, treeID, "newcommer", ""}
	}

	for _, child := range tree.Children {
		rsp := (<-streams.Streamers[child.Root].ResponseChannel).(SocketMessage)
		log.Printf("Wanting to announce kid tree for %s in tree %s", child.Root, treeID)
		if rsp.Message == "got parent stream" && rsp.TreeID == treeID {
			announceNewTree(child, treeID, streams)
		}
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

func printStreamingTrees(w http.ResponseWriter, r *http.Request, streams StreamingMap) {
	for _, s := range streams.Streamers {
		fmt.Fprintf(w, " \n --- printing tree %s ---- \n", s.ID)
		st.PrettyPrintTree(*s.Tree, 0, w)
	}
}
