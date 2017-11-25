package main

import (
	"govoice/routing"
	"log"
	"net/http"

	"github.com/kabukky/httpscerts"
)

func main() {

	// Check if the cert files are available.
	err := httpscerts.Check("cert.pem", "key.pem")
	// If they are not available, generate new ones.
	if err != nil {
		err = httpscerts.Generate("cert.pem", "key.pem", "127.0.0.1:8080")
		if err != nil {
			log.Fatal("Error: Couldn't create https certs.")
		}
	}

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
	http.ListenAndServe(":8080", nil)
}
