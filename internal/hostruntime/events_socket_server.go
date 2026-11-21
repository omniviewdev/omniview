//go:build server

package hostruntime

import (
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// eventsSocketWait bounds the hold. The socket is registered a few milliseconds after the page's first call (INV1
// measured 1 to 20 ms in both engines); a second is far beyond that and is the most a document whose socket never opens
// loses on a call. When it expires the call is served as stock Wails serves it, so a page whose socket never opens
// keeps one identity (the main window's) for all its calls and its sessions stay valid.
const eventsSocketWait = time.Second

// EventsSocketMiddleware holds a browser document's runtime call until its events socket is registered. Stock Wails
// names a server-mode caller by the socket's BrowserWindow; until the socket is accepted it resolves the call to the
// first native window instead, so a window-bound capability issued in that gap (an activity session) is refused when
// the same document returns once the socket is up. Only a document is held: it sends an Origin with every POST and a
// client id from its runtime; a script (the seam's own calls, curl) sends no Origin and is never held.
func EventsSocketMiddleware() application.Middleware {
	return eventsSocketMiddleware(func(clientID string) bool { return application.GetBrowserWindow(clientID) != nil }, eventsSocketWait)
}
