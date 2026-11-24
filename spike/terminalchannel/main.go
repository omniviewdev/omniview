// Command terminalchannel is a throwaway spike (branch wip/spike/terminal-channel, no PR): it measures four ways of
// getting a local terminal's output to the page that owns it, on both builds of the host (native Wails and `-tags
// server`), against the host's real terminal manager and, for the baseline, its real exec lane.
//
//	events  the path the host has today: the real exec controller and wrapper, Wails events (the baseline)
//	stream  Wails' own GoStream (application.HandleStream / Stream): a held poll in the native build, a WebSocket in
//	        the server build, one handler for both
//	ws      a WebSocket the host serves itself on a loopback listener, the capability as the first frame
//	pull    a bound call, Read(cap, from, max, waitMs), that is both the acknowledgement and the fetch
//
// The page (web/) picks the transport and the state of the client (healthy, stalled, ...) from its query string, runs
// the scenario and reports through Probe.Report; the host samples its own memory and the WebKit content processes.
package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	_ "net/http/pprof"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	execpkg "github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	"github.com/omniviewdev/omniview/internal/hostruntime"
	"github.com/omniviewdev/omniview/internal/shellenv"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

//go:embed web
var webFiles embed.FS

func envInt(name string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(name)); err == nil {
		return v
	}
	return fallback
}

func main() {
	shellenv.RememberLaunchEnvironment()
	// A throwaway HOME: no profile of the user's is read by the shells the probe starts.
	home, err := os.MkdirTemp("", "tc-spike-home-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(home)
	_ = os.Setenv("HOME", home)

	log := logging.NewNop()
	if os.Getenv("PROBE_LOG") != "" {
		log = logging.New(logging.Config{Name: "probe", Backend: logging.NewDefaultHCLBackend("probe", logging.LevelInfo), Level: logging.NewLevelController(logging.LevelInfo), Fields: nil, Now: nil})
	}
	ctrl := execpkg.NewController(log, nil, nil)
	realm := invocation.NewWindowRealm(func(string) {}, invocation.WithLogger(log), invocation.WithPageSweep(pageConnected, 2*time.Second))
	wrapper := &execpkg.ServiceWrapper{Ctrl: ctrl, Realm: realm}

	if port := os.Getenv("PROBE_PPROF"); port != "" {
		go func() { _ = http.ListenAndServe("127.0.0.1:"+port, nil) }()
	}
	p := newProbe(log)
	site, err := fs.Sub(webFiles, "web")
	if err != nil {
		panic(err)
	}
	options := application.Options{
		Name:     "tcspike",
		Services: []application.Service{application.NewService(wrapper), application.NewService(&Probe{p: p})},
		Assets: application.AssetOptions{
			Handler: http.FileServerFS(site),
		},
		Mac:    macOptions(),
		Server: application.ServerOptions{Host: "127.0.0.1", Port: envInt("PROBE_PORT", 34171)},
	}
	chain := []application.Middleware{p.wsRouteMiddleware()}
	if sockets := hostruntime.EventsSocketMiddleware(); sockets != nil {
		chain = append([]application.Middleware{sockets}, chain...)
	}
	options.Assets.Middleware = application.ChainMiddleware(chain...)
	app := application.New(options)
	p.app = app
	app.HandleStream("term", p.handleStream)
	p.startWS()

	query := strings.TrimPrefix(os.Getenv("PROBE_QUERY"), "?")
	if err := run(app, p, query); err != nil {
		fmt.Fprintln(os.Stderr, "RUN-ERROR", err)
		os.Exit(1)
	}
	_ = context.Background()
}
