//go:build !server

package main

// serverBuild says whether this is the server build, the only one in which Wails listens on the application server's address.
const serverBuild = false
