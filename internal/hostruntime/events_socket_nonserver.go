//go:build !server

package hostruntime

import "github.com/wailsapp/wails/v3/pkg/application"

// EventsSocketMiddleware returns nothing for native windows, whose calls name
// their window and which have no events socket.
func EventsSocketMiddleware() application.Middleware {
	return nil
}
