package routing

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

const channelBufferSize = 100

// Router represents the main component. It contains the necessary information about routing with streaming trees
type Router struct {
	streams   *StreamingMap
	routerBox chan SocketMessage
}

// Streamer is a single streaming unit in the system. This is the representative of a peer communicating in the chat
type Streamer struct {
	ID           string
	Channel      chan interface{}
	StreamLoaded map[string]chan bool
	Tree         *streamingTree
}

// StreamingMap associates streamers with their ids, and allows for multithreded access
type StreamingMap struct {
	Streamers map[string]*Streamer
	lock      *sync.Mutex
}

func (sm StreamingMap) getStreamingTreesExcept(exceptID string) []streamingTree {
	result := []streamingTree{}
	for _, s := range sm.Streamers {
		if s.Tree != nil && s.ID != exceptID {
			result = append(result, *s.Tree)
		}
	}
	return result
}

// SocketMessage describes the messages being exchanged with the browser
type SocketMessage struct {
	ID          string
	TreeID      string
	Message     interface{}
	Destination string
}

// NewRouter creates a new instance of the Router
func NewRouter() *Router {
	streams := &StreamingMap{}
	streams.lock = new(sync.Mutex)
	streams.Streamers = make(map[string]*Streamer)
	routerBox := make(chan SocketMessage, channelBufferSize*5)
	return &Router{streams, routerBox}
}

// UpgradeToRouterSocket upgrades the given request to a router communication socket
func UpgradeToRouterSocket(router *Router, w http.ResponseWriter, r *http.Request) {
	log.Printf("Got a new request: %v \n", r.URL)
	id := r.URL.Query().Get("id")
	if id == "" {
		fmt.Fprint(w, "Cannot open a connection without a valid ID!")
		return
	}

	if _, ok := router.streams.Streamers[id]; ok {
		fmt.Fprint(w, "The provided ID is already taken!")
		return
	}

	route := makeNewStreamer(id)
	router.streams.lock.Lock()
	router.streams.Streamers[id] = &route
	router.streams.lock.Unlock()

	con := err1(upgrader.Upgrade(w, r, nil)).(*websocket.Conn)
	go readMessages(id, con, router.routerBox)
	go publishMessages(con, route.Channel)
}

func makeNewStreamer(id string) Streamer {
	log.Printf("making new streamer %v \n", id)
	channel := make(chan (interface{}), channelBufferSize)
	readyStreams := make(map[string]chan bool)
	return Streamer{ID: id, Channel: channel, StreamLoaded: readyStreams}
}

func readMessages(id string, con *websocket.Conn, routerBox chan SocketMessage) {
	for {
		nextReq := &SocketMessage{}
		err := con.ReadJSON(nextReq)
		if err != nil {
			routerBox <- SocketMessage{ID: id, Message: "bye"}
			return
		}
		if nextReq.ID != "" {
			routerBox <- *nextReq
		}
	}
}

func publishMessages(conn *websocket.Conn, channel chan interface{}) {
	for x := range channel {
		err := conn.WriteJSON(x)
		if err != nil {
			return
		}
	}
}

// Serve begins routing incoming messages.
func Serve(router *Router) {
	for x := range router.routerBox {
		if _, ok := router.streams.Streamers[x.ID]; !ok {
			continue
		}

		if _, ok := router.streams.Streamers[x.Destination]; x.Destination != "" && !ok {
			continue
		}

		router.streams.lock.Lock()
		switch x.Message {
		case "create or join":
			onCreateOrJoin(x, router.streams)
			break

		case "got user media":
			routeMessage(x, *router.streams)
			onGotUserMedia(x, router.streams)
			break

		case "got parent stream":
			//log.Printf("Got parent stream message from %s on tree %s", x.ID, x.TreeID)
			streamer := router.streams.Streamers[x.ID]
			streamer.StreamLoaded[x.TreeID] <- true
			break

		case "bye":
			log.Printf("Connection lost with %s", x.ID)
			routeMessage(x, *router.streams)
			onHangup(x.ID, router.streams)
			break

		default:
			routeMessage(x, *router.streams)
			break
		}
		router.streams.lock.Unlock()
	}
}

func onCreateOrJoin(x SocketMessage, streams *StreamingMap) {

	initializeStreamLoadedChannels(x.ID, streams)

	if len(streams.Streamers) >= 2 {
		streams.Streamers[x.ID].Channel <- SocketMessage{x.ID, "", "join", ""}
		parents := addNewStreamer(x.ID, streams)
		announceNewChild(x.ID, parents, *streams)
	} else {
		streamer := streams.Streamers[x.ID]
		streamer.Tree = &streamingTree{Root: x.ID}
		streams.Streamers[x.ID].Channel <- SocketMessage{x.ID, "", "created", ""}
	}
}

func initializeStreamLoadedChannels(newSID string, streams *StreamingMap) {
	keys := getMapKeysExcept(streams.Streamers, newSID)
	newStreamer := streams.Streamers[newSID]
	for _, k := range keys {
		streamer := streams.Streamers[k]
		newStreamer.StreamLoaded[k] = make(chan bool, channelBufferSize)
		streamer.StreamLoaded[newSID] = make(chan bool, channelBufferSize)
	}
}

func addNewStreamer(id string, streams *StreamingMap) map[string]string {
	keys := getMapKeysExcept(streams.Streamers, id)
	parents := make(map[string]string)
	for _, k := range keys {
		streamer := streams.Streamers[k]
		parent := addChild(streamer.Tree, id)
		parents[k] = parent
	}

	return parents
}

func onGotUserMedia(x SocketMessage, streams *StreamingMap) {
	newStreamer := streams.Streamers[x.ID]
	newStreamer.Tree = makeNewStreamingTree(x.ID, *streams)
	announceNewTree(newStreamer.Tree, newStreamer.Tree.Root, *streams)
}

func makeNewStreamingTree(id string, streams StreamingMap) *streamingTree {
	existingTrees := streams.getStreamingTreesExcept(id)
	return newStreamingTree(id, existingTrees)
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

func announceNewChild(childID string,
	parents map[string]string, streams StreamingMap) {
	for tID, pID := range parents {
		log.Printf("Sending newcommer message to %s", pID)
		streams.Streamers[pID].Channel <- SocketMessage{childID, tID, "newcommer", ""}
	}
}

func announceNewTree(tree *streamingTree, treeID string, streams StreamingMap) {
	if tree == nil || tree.Children == nil {
		return
	}
	rootStreamer := streams.Streamers[tree.Root]
	for _, child := range tree.Children {
		log.Printf("sending newcommer message to %s", rootStreamer.ID)
		rootStreamer.Channel <- SocketMessage{child.Root, treeID, "newcommer", ""}
	}
	for _, child := range tree.Children {
		var kid = child
		go func() {
			<-streams.Streamers[kid.Root].StreamLoaded[treeID]
			announceNewTree(kid, treeID, streams)
		}()
	}
}

func onHangup(id string, streams *StreamingMap) {
	close(streams.Streamers[id].Channel)
	for _, sl := range streams.Streamers[id].StreamLoaded {
		close(sl)
	}
	delete(streams.Streamers, id)

	for _, s := range streams.Streamers {
		orphans := deleteChild(s.Tree, id)
		for _, o := range orphans {
			parent := addChild(s.Tree, o.Root)
			streams.Streamers[parent].Channel <- SocketMessage{o.Root, s.Tree.Root, "newcommer", ""}
		}
	}
}

func routeMessage(x SocketMessage, streams StreamingMap) {
	if x.Destination == "" {
		broadcastMessage(x.ID, x, streams)
	} else {
		streams.Streamers[x.Destination].Channel <- x
	}
}

func broadcastMessage(senderID string, message interface{}, streams StreamingMap) {
	for id, route := range streams.Streamers {
		if id != senderID {
			route.Channel <- message
		}
	}
}

func err1(arg interface{}, err error) interface{} {
	if err != nil {
		log.Fatal(err.Error())
	}
	return arg
}

// PrintStreamingTrees prints the active streaming trees to the writer
func PrintStreamingTrees(w io.Writer, router Router) {
	streams := *router.streams
	for _, s := range streams.Streamers {
		fmt.Fprintf(w, " \n --- printing tree %s ---- \n", s.ID)
		prettyPrintTree(*s.Tree, 0, w)
	}
}
