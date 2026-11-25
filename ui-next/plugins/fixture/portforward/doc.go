// Package portforward is the network half of the seam's ports fixture (ui-next/plugins/fixture, the plugin `fixture-g-ports`): a small TCP server that the plugin runs itself, the target, and a real networker
// forwarder that listens on the loopback and relays every connection it accepts to that server. The host starts a forward through the plugin's networker capability, as it does for any plugin, and what comes back
// through the forward is the greeting the server sends, which only the server can send.
//
// What a forward is held to, and what the tests in this directory prove: it is ready when it listens; it says a listener that failed on its error channel; it has a session id of its own; and when its context is
// cancelled, which is what closing the session, stopping the plugin or retiring its connection does, it closes the listener and every connection it relays, and nothing of it is left running.
package portforward
