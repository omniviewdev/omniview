//go:build server

package main

import (
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const buildName = "server"

func pageConnected(clientID string) bool { return application.GetBrowserWindow(clientID) != nil }

func run(app *application.App, p *probe, _ string) error {
	fmt.Printf("SERVER-READY http://127.0.0.1:%d/ ws=%d\n", envInt("PROBE_PORT", 34171), p.wsPort)
	return app.Run()
}

func macOptions() application.MacOptions { return application.MacOptions{} }
