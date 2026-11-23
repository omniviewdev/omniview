//go:build !server

package exec

// countsAsDelivery says whether the serialization that is running is the one that is DELIVERY of a stdout
// event. In a native build the first one is: it is the window's, made in Wails' dispatch worker just before
// it hands the event to the web view and waits for the main thread, so it comes only after the window has
// run the event before.
func countsAsDelivery() bool { return true }
