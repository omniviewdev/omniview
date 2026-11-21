package hostruntime

import (
	"net/http"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const eventsSocketPoll = 5 * time.Millisecond

// eventsSocketMiddleware holds a browser document's runtime call until registered(clientID) says its events socket
// is up, for at most wait; it then passes the call on as before, so a document whose socket never opens is served, as
// stock Wails serves it, never refused. Only a document is held: a call with no Origin (a script) or one that names its
// window is passed on at once.
func eventsSocketMiddleware(registered func(clientID string) bool, wait time.Duration) application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			clientID := r.Header.Get("x-wails-client-id")
			// A call that names its window (the native runtime does; so does a harness that stands in for a native window) has an
			// identity of its own and may never register a socket, so it is not held.
			named := r.Header.Get("x-wails-window-name") != "" || r.Header.Get("x-wails-window-id") != ""
			if r.Method == http.MethodPost && clientID != "" && !named && r.Header.Get("Origin") != "" {
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
