package main

import (
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

type Route struct {
	Channel chan (interface{})
	Tree    interface{}
}

type RouteMap struct {
	Routes map[string]*Route
	lock   *sync.Mutex
}

type SocketRequest struct {
	ID      string
	Message interface{}
}

func main() {
	routes := RouteMap{}
	routes.lock = new(sync.Mutex)
	routes.Routes = make(map[string]*Route)
	routerBox := make(chan SocketRequest)
	http.HandleFunc("/websocket", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("Got a new request: %v \n", r.URL)
		id := r.URL.Query().Get("id")

		route := makeNewRoute()
		routes.lock.Lock()
		routes.Routes[id] = route
		routes.lock.Unlock()

		con := Err1(upgrader.Upgrade(w, r, nil)).(*websocket.Conn)
		go readMessages(con, routerBox)
		go publishMessages(con, route.Channel)

		log.Println("Websocket upgraded, starting to publish")
	})

	log.Println("Starting to serve websockets")
	go serve(routerBox, routes)
	http.ListenAndServe(":8124", nil)
}

func makeNewRoute() *Route {
	channel := make(chan (interface{}))
	tree := interface{}(0)
	return &Route{channel, tree}
}

func readMessages(con *websocket.Conn, routerBox chan SocketRequest) {
	readDelay := 5 * time.Millisecond
	for {
		time.Sleep(readDelay)

		nextReq := &SocketRequest{}
		Err0(con.ReadJSON(nextReq))
		if nextReq.ID != "" {
			log.Printf("Received new frame on the websocket: %v \n", nextReq)
			routerBox <- *nextReq
		}
	}
}

func publishMessages(conn *websocket.Conn, channel chan interface{}) {
	for x := range channel {
		log.Printf("Sending a new event on the websock: %s\n", x)
		Err0(conn.WriteJSON(x))
	}
}

func serve(routerBox chan SocketRequest, routes RouteMap) {
	for x := range routerBox {
		log.Printf("@serving %s: %s\n", x.ID, x.Message)
		switch x.Message {
		case "create or join":
			if len(routes.Routes) >= 2 {
				routes.Routes[x.ID].Channel <- "join"
				for id, route := range routes.Routes {
					if id != x.ID {
						route.Channel <- "joined"
					}
				}
			} else {
				routes.Routes[x.ID].Channel <- "created"
			}
			break
		default:
			routes.lock.Lock()
			for id, route := range routes.Routes {
				if id != x.ID {
					route.Channel <- x.Message
				}
			}
			routes.lock.Unlock()
			break
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
