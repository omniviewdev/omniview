//go:build !server

package main

import (
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const buildName = "native"

func pageConnected(string) bool { return true }

// run opens one native window (hidden unless PROBE_SHOWN is set) on the page, whose query string says what to run.
func run(app *application.App, p *probe, query string) error {
	url := "/"
	if query != "" {
		url = "/?" + query
	}
	p.win = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "probe", Title: "probe", Width: 320, Height: 200, Hidden: os.Getenv("PROBE_SHOWN") == "", URL: url,
	})
	if os.Getenv("PROBE_ACTIVE") != "" {
		app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
			p.win.Show()
			if os.Getenv("PROBE_TOP") != "" {
				p.win.SetSize(900, 600)
				p.win.SetAlwaysOnTop(true)
			}
			p.win.Focus()
		})
	}
	p.keepAlive()
	return app.Run()
}

func macOptions() application.MacOptions {
	if os.Getenv("PROBE_ACTIVE") != "" {
		return application.MacOptions{ActivationPolicy: application.ActivationPolicyRegular}
	}
	return application.MacOptions{ActivationPolicy: application.ActivationPolicyAccessory}
}
