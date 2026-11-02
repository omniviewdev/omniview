// Package processinfo exposes sampled process identity without lifecycle authority.
package processinfo

import (
	"os"
	"sort"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Snapshot struct {
	ObservedAt time.Time `json:"observedAt"`
	Processes  []Process `json:"processes"`
}

type Process struct {
	Key               string                         `json:"key"`
	Role              string                         `json:"role"`
	PluginID          string                         `json:"pluginID"`
	Ownership         string                         `json:"ownership"`
	Identity          *devsession.ProcessObservation `json:"identity"`
	Windows           []Window                       `json:"windows"`
	WindowAssociation string                         `json:"windowAssociation"`
	Evidence          string                         `json:"evidence"`
	Error             string                         `json:"error"`
}

type Window struct {
	Name      string `json:"name"`
	ID        uint   `json:"id"`
	NativeID  int64  `json:"nativeID"`
	Ownership string `json:"ownership"`
	Error     string `json:"error"`
}

type pluginProvider interface {
	GetPluginProcesses() []plugin.PluginProcessInfo
}

type Service struct {
	app       *application.App
	plugins   pluginProvider
	host      devsession.ProcessObservation
	hostError string
	observe   func(int) (devsession.ProcessObservation, error)
	windows   func() []Window
}

// New captures self identity once. Failure never adopts a later process lifetime.
func New(app *application.App, plugins interface {
	GetPluginProcesses() []plugin.PluginProcessInfo
}) *Service {
	s := &Service{app: app, plugins: plugins, observe: devsession.ObserveProcess}
	var err error
	s.host, err = s.observe(os.Getpid())
	if err != nil {
		s.hostError = err.Error()
	}
	s.windows = s.nativeWindows
	return s
}

func (s *Service) hostIdentity() (*devsession.ProcessObservation, string) {
	if s.hostError != "" {
		return nil, s.hostError
	}
	if s.host.PID <= 0 || s.host.StartIdentity == "" || s.host.Executable == "" {
		return nil, "Host identity is unavailable"
	}
	current, err := s.observe(s.host.PID)
	if err != nil {
		return nil, err.Error()
	}
	if current != s.host {
		return nil, "Host process identity changed"
	}
	identity := current
	return &identity, ""
}

// GetSnapshot returns observations, not a guarantee of continued process liveness.
func (s *Service) GetSnapshot() Snapshot {
	host := Process{Key: "host", Role: "host", Ownership: "unverified", WindowAssociation: "unverified", Evidence: "self", Windows: []Window{}}
	host.Identity, host.Error = s.hostIdentity()
	if s.windows != nil {
		host.Windows = s.windows()
	}
	// Fence the native collection before asking the provider for its final batch.
	if host.Identity != nil {
		host.Identity, host.Error = s.hostIdentity()
	}
	if host.Identity != nil {
		host.Ownership = "verified"
		if len(host.Windows) > 0 {
			host.WindowAssociation = "verified"
		}
		for _, window := range host.Windows {
			if window.Ownership != "verified" || window.Error != "" {
				host.WindowAssociation = "unverified"
			}
		}
	} else {
		for i := range host.Windows {
			host.Windows[i].NativeID = 0
			host.Windows[i].Ownership = "unverified"
			host.Windows[i].Error = "Host identity is unavailable"
		}
	}
	sort.Slice(host.Windows, func(i, j int) bool { return host.Windows[i].ID < host.Windows[j].ID })
	processes := []Process{host}
	if s.plugins != nil {
		// This is the last blocking collection: the provider fences all its results.
		entries := s.plugins.GetPluginProcesses()
		for _, entry := range entries {
			row := Process{Key: "plugin:" + entry.PluginID, Role: "plugin", PluginID: entry.PluginID, Ownership: entry.Ownership, Identity: entry.Identity, Error: entry.Error, Windows: []Window{}, WindowAssociation: "unverified", Evidence: "backend"}
			if row.Ownership == "shared" {
				row.Evidence = "in-process"
				row.Identity = host.Identity
				if row.Identity == nil && row.Error == "" {
					row.Error = host.Error
				}
			}
			if row.Error != "" || row.Identity == nil || (row.Ownership != "verified" && row.Ownership != "shared") {
				row.Identity = nil
				row.Ownership = "unverified"
				if row.Error == "" {
					row.Error = "Process identity is unavailable"
				}
			}
			processes = append(processes, row)
		}
	}
	for _, role := range []string{"webcontent", "gpu"} {
		processes = append(processes, Process{Key: role, Role: role, Ownership: "unverified", Windows: []Window{}, WindowAssociation: "unverified", Evidence: "public-api-unavailable", Error: "Public APIs do not identify this window's worker process"})
	}
	return Snapshot{ObservedAt: time.Now(), Processes: processes}
}
