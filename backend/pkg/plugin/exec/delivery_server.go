//go:build server

package exec

// countsAsDelivery says whether the serialization that is running is the one that is DELIVERY of a stdout
// event. In a server build it is the one that writes a client's socket: Wails also serializes every event
// for the window it keeps, in its dispatch worker, long before any socket has taken it.
func countsAsDelivery() bool { return serializedForAClientSocket() }
