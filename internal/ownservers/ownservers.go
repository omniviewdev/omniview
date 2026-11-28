// Package ownservers keeps the addresses of the servers the host itself listens on, for the host's URL opener (backend/pkg/opener): an address of one of
// them is never opened in a browser. A listener that is made while the host runs (a plugin's trace receiver, the development control server) adds its
// address when it listens and removes it when it stops, so the answer is what listens now.
package ownservers

import (
	"sync"
)

//nolint:gochecknoglobals // the host's listeners are one set per process
var (
	mu     sync.Mutex
	next   uint64
	listen = map[uint64]string{}
)

// Add records a listening address (host:port) and returns the function that removes it, which may be called more than once.
func Add(address string) func() {
	mu.Lock()
	defer mu.Unlock()
	next++
	id := next
	listen[id] = address
	return func() {
		mu.Lock()
		defer mu.Unlock()
		delete(listen, id)
	}
}

// Addresses are the addresses recorded now.
func Addresses() []string {
	mu.Lock()
	defer mu.Unlock()
	out := make([]string, 0, len(listen))
	for _, address := range listen {
		out = append(out, address)
	}
	return out
}
