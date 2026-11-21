//go:build server

package hostruntime

import (
	"net/http"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	eventsSocketWait = time.Second
	eventsSocketPoll = 5 * time.Millisecond
)

// EventsSocketMiddleware holds a browser document's runtime call until its
// events socket is registered. Stock Wails names a server-mode caller by the
// socket's BrowserWindow; until the socket is accepted it resolves the call to
// the first native window instead, so a window-bound capability issued in that
// gap (an activity session) is refused when the same document returns once
// the socket is up. Only a document is held: it sends an Origin with every POST
// and a client id from its runtime. A caller that never opens a socket (a
// script) is passed on after eventsSocketWait.
func EventsSocketMiddleware() application.Middleware {
	return eventsSocketMiddleware(func(clientID string) bool { return application.GetBrowserWindow(clientID) != nil }, eventsSocketWait)
}

func eventsSocketMiddleware(registered func(clientID string) bool, wait time.Duration) application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			clientID := r.Header.Get("x-wails-client-id")
			if r.Method == http.MethodPost && clientID != "" && r.Header.Get("Origin") != "" {
				deadline := time.NewTimer(wait)
				defer deadline.Stop()
				tick := time.NewTicker(eventsSocketPoll)
				defer tick.Stop()
				for !registered(clientID) {
					select {
					case <-r.Context().Done():
						return
					case <-deadline.C:
						next.ServeHTTP(w, r)
						return
					case <-tick.C:
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
