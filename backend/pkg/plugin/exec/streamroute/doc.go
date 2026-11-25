// Package streamroute holds the test of the real route of the terminal channel: a Wails application in server mode, with the host's
// own terminal controller behind the one stream the host registers, and a WebSocket client that speaks the frames of
// docs/ui-next/terminal-channel-protocol.md to it. It is a package of its own because application.New keeps the first application
// of a process in a global, and the tests of the exec package share a process.
package streamroute
