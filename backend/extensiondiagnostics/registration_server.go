//go:build server

package extensiondiagnostics

import "github.com/wailsapp/wails/v3/pkg/application"

// Before the browser event websocket connects, Wails injects its virtual native
// window. It is not the browser caller's identity and must never receive a lease.
func registrationPending(window application.Window) bool {
	_, ready := window.(interface{ ClientID() string })
	return !ready
}
