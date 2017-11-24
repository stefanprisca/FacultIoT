package main

import (
	"govoice/routing"
	"log"
	"net/http"
)

func main() {

	fs := http.FileServer(http.Dir("../web"))
	http.Handle("/", fs)

	router := routing.NewRouter()
	http.HandleFunc("/websocket", func(w http.ResponseWriter, r *http.Request) {
		routing.UpgradeToRouterSocket(router, w, r)
	})

	log.Println("Starting to serve websockets")
	go routing.Serve(router)

	http.HandleFunc("/printTrees", func(w http.ResponseWriter, r *http.Request) {
		routing.PrintStreamingTrees(w, *router)
	})
	http.ListenAndServe(":8124", nil)
}
