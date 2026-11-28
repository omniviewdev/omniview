package main

import (
	"context"
	"net"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/opener"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/omniviewdev/omniview/internal/ownservers"
)

// AppService is the main application service for Wails v3.
// It is registered as a Wails service and exposes methods to the frontend.
type AppService struct {
	descriptorMu sync.RWMutex
	descriptor   devcontract.InstanceDescriptor
	opener       *opener.Opener
}

// NewAppService retains a safe detached snapshot of the selected instance.
func NewAppService(descriptor devcontract.InstanceDescriptor) *AppService {
	return &AppService{descriptorMu: sync.RWMutex{}, descriptor: instance.Snapshot(descriptor), opener: opener.New()}
}

// GetInstanceInfo returns authoritative runtime identity without credentials.
func (a *AppService) GetInstanceInfo() devcontract.InstanceDescriptor {
	a.descriptorMu.RLock()
	defer a.descriptorMu.RUnlock()
	return instance.Snapshot(a.descriptor)
}

// updateInstanceInfo is host-only: a frontend binding must never be able to
// replace authoritative identity/readiness. Publish after endpoint transitions.
func (a *AppService) updateInstanceInfo(descriptor devcontract.InstanceDescriptor) {
	snapshot := instance.Snapshot(descriptor)
	a.descriptorMu.Lock()
	a.descriptor = snapshot
	a.descriptorMu.Unlock()
}

// ServiceStartup is called during application startup.
func (a *AppService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

// ServiceShutdown is called during application shutdown.
func (a *AppService) ServiceShutdown() error {
	return nil
}

// GetOperatingSystem returns the operating system type this application is running on.
func (a *AppService) GetOperatingSystem() string {
	switch runtime.GOOS {
	case "darwin":
		return "macos"
	case "windows":
		return "windows"
	default:
		return "linux"
	}
}

// FileDialogOptions defines options for file dialogs exposed to the frontend.
type FileDialogOptions struct {
	DefaultDirectory           string       `json:"defaultDirectory"`
	DefaultFilename            string       `json:"defaultFilename"`
	Title                      string       `json:"title"`
	Filters                    []FileFilter `json:"filters"`
	ShowHiddenFiles            bool         `json:"showHiddenFiles"`
	CanCreateDirectories       bool         `json:"canCreateDirectories"`
	ResolvesAliases            bool         `json:"resolvesAliases"`
	TreatPackagesAsDirectories bool         `json:"treatPackagesAsDirectories"`
}

// FileFilter defines a filter for dialog boxes.
type FileFilter struct {
	DisplayName string `json:"displayName"` // Filter information EG: "Image Files (*.jpg, *.png)"
	Pattern     string `json:"pattern"`     // semicolon separated list of extensions, EG: "*.jpg;*.png"
}

// setOwnServers says where the host's own servers listen (host:port each), asked when an address is checked: the opener refuses an address of any of them.
func (a *AppService) setOwnServers(addresses func() []string) { a.opener.SetOwn(addresses) }

// OpenExternalURL opens an address in the system's browser after the host's checks: http and https only, no user information, not one of the host's own
// servers, at most 2,083 bytes (backend/pkg/opener). A refusal is the answer `{ opened: false, reason }` with the reason `scheme`, `userinfo`,
// `own-server`, `malformed` or `too-long`; the call fails only when the system's browser could not be started. Nothing here is a shell command.
func (a *AppService) OpenExternalURL(address string) (opener.Result, error) {
	return a.opener.OpenExternalURL(address)
}

// OpenFileSelectionDialog opens a native file selection dialog using the v3 Dialog API.
func (a *AppService) OpenFileSelectionDialog(opts FileDialogOptions) ([]string, error) {
	app := application.Get()
	dialog := app.Dialog.OpenFile()

	if opts.Title != "" {
		dialog.SetTitle(opts.Title)
	}
	if opts.DefaultDirectory != "" {
		dialog.SetDirectory(opts.DefaultDirectory)
	}
	dialog.CanChooseFiles(true)
	dialog.CanCreateDirectories(opts.CanCreateDirectories)
	dialog.ShowHiddenFiles(opts.ShowHiddenFiles)
	dialog.ResolvesAliases(opts.ResolvesAliases)
	dialog.TreatsFilePackagesAsDirectories(opts.TreatPackagesAsDirectories)

	for _, f := range opts.Filters {
		dialog.AddFilter(f.DisplayName, f.Pattern)
	}

	return dialog.PromptForMultipleSelection()
}

// SaveFileDialog opens a native save file dialog using the v3 Dialog API.
func (a *AppService) SaveFileDialog(opts FileDialogOptions) (string, error) {
	app := application.Get()
	dialog := app.Dialog.SaveFile()

	if opts.Title != "" {
		dialog.SetMessage(opts.Title)
	}
	if opts.DefaultDirectory != "" {
		dialog.SetDirectory(opts.DefaultDirectory)
	}
	if opts.DefaultFilename != "" {
		dialog.SetFilename(opts.DefaultFilename)
	}
	dialog.CanCreateDirectories(opts.CanCreateDirectories)
	dialog.ShowHiddenFiles(opts.ShowHiddenFiles)
	dialog.TreatsFilePackagesAsDirectories(opts.TreatPackagesAsDirectories)

	for _, f := range opts.Filters {
		dialog.AddFilter(f.DisplayName, f.Pattern)
	}

	return dialog.PromptForSingleSelection()
}

// WriteFileContent writes string content to the given file path.
func (a *AppService) WriteFileContent(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}

// wailsServerAddress is where the server build's own server listens, resolved as Wails resolves it (pkg/application/application_server.go): the
// WAILS_SERVER_HOST and WAILS_SERVER_PORT of the environment over the configured host and port (the e2e harness and the docs run on 34215), and a port
// that is not 1 to 65535 is ignored.
func wailsServerAddress() string {
	host := os.Getenv("WAILS_SERVER_HOST")
	if host == "" {
		host = serverModeHost
	}
	port := serverModePort
	if text := os.Getenv("WAILS_SERVER_PORT"); text != "" {
		if parsed, err := strconv.Atoi(text); err == nil && parsed >= 1 && parsed <= maxServerPort {
			port = parsed
		}
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

// maxServerPort is the largest port number.
const maxServerPort = 65535

// hostServers are the addresses of every server the host listens on now: the application server, the listeners that registered themselves, and the sources.
func hostServers(sources ...func() []string) []string {
	out := ownservers.Addresses()
	if serverBuild {
		out = append(out, wailsServerAddress()) // Wails listens there in the server build only
	}
	if address, ok := wailsMCPAddress(); ok && mcpBuild {
		out = append(out, address)
	}
	for _, source := range sources {
		out = append(out, source()...)
	}
	return out
}

// ownServerSources are the sources of the servers that are not the application server or registered listeners: the diagnostics endpoint, the host profiler and the Vite
// servers of the dev instances.
func ownServerSources(diagnostics, profiler func() string, vite func() []string) func() []string {
	return func() []string { return append([]string{diagnostics(), profiler()}, vite()...) }
}

// profilerAddress is where the host profiler serves pprof while it runs, as host:port taken from the URL of its status (`http://127.0.0.1:<port>/debug/pprof/`); empty
// when it is off, failed to start, or has no address.
func profilerAddress(running bool, statusURL string) string {
	if !running {
		return ""
	}
	parsed, err := url.Parse(statusURL)
	if err != nil {
		return ""
	}
	return parsed.Host
}

// wailsMCPAddress is where Wails' own MCP server listens in the -tags mcp development builds (pkg/application/mcp_enabled.go): WAILS_MCP_HOST over 127.0.0.1 and
// WAILS_MCP_PORT over 9099. It is not known for port 0 (the system picks one), and the server is behind a bearer token as well.
func wailsMCPAddress() (string, bool) {
	host := os.Getenv("WAILS_MCP_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	port := wailsMCPDefaultPort
	if text := os.Getenv("WAILS_MCP_PORT"); text != "" {
		parsed, err := strconv.Atoi(text)
		if err != nil || parsed <= 0 || parsed > maxServerPort {
			return "", false
		}
		port = parsed
	}
	return net.JoinHostPort(host, strconv.Itoa(port)), true
}

// wailsMCPDefaultPort is the port of Wails' MCP server unless WAILS_MCP_PORT says another.
const wailsMCPDefaultPort = 9099
