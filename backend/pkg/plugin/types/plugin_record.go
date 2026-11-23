package types

import (
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// PluginInfo is the host-owned, frontend-safe plugin inventory descriptor.
type PluginInfo struct {
	sdktypes.PluginInfo
	Origin         string `json:"origin"`
	FrontendModule string `json:"frontendModule"`
	ReleaseChannel string `json:"releaseChannel"`
	// Incompatible is set on a plugin the host refused because its process speaks a plugin protocol the host does not run: the two numbers the window words itself, and no text.
	Incompatible *Incompatibility `json:"incompatible,omitempty"`
}

// PluginRecord is the host-side runtime state for a managed plugin.
// It holds both persisted configuration and runtime-only fields.
type PluginRecord struct {
	// Persisted fields.
	ID             string                `json:"id"`
	Phase          lifecycle.PluginPhase `json:"phase"`
	Metadata       config.PluginMeta     `json:"metadata"`
	Enabled        bool                  `json:"enabled"`
	DevMode        bool                  `json:"devMode"`
	DevPath        string                `json:"devPath,omitempty"`
	LastError      string                `json:"lastError,omitempty"`
	ErrorCount     int                   `json:"errorCount"`
	InstalledAt    time.Time             `json:"installedAt"`
	ReleaseChannel string                `json:"releaseChannel,omitempty"`

	// Runtime-only fields (not persisted).
	Origin          string                        `json:"-"`
	FrontendModule  string                        `json:"-"`
	StateMachine    *lifecycle.PluginStateMachine `json:"-"`
	Backend         PluginBackend                 `json:"-"`
	Capabilities    []sdktypes.Capability         `json:"-"`
	ProtocolVersion int                           `json:"-"`
	// Incompatible is why the host refused the plugin's protocol, when it did: set when the failed record is stored, never persisted (the next load decides again).
	Incompatible *Incompatibility `json:"-"`
}

// ToInfo converts the host-side record to a frontend-safe PluginInfo.
func (r *PluginRecord) ToInfo() PluginInfo {
	phase := string(r.Phase)
	if r.StateMachine != nil {
		phase = string(r.StateMachine.Phase())
	}
	origin := r.Origin
	if origin == "" {
		origin = "external"
	}
	info := PluginInfo{Origin: origin, FrontendModule: r.FrontendModule, ReleaseChannel: r.ReleaseChannel, Incompatible: nil, PluginInfo: sdktypes.PluginInfo{
		ID:           r.ID,
		Metadata:     r.Metadata,
		Phase:        phase,
		Enabled:      r.Enabled,
		DevMode:      r.DevMode,
		DevPath:      r.DevPath,
		Capabilities: r.Capabilities,
		LastError:    r.LastError,
	}}
	if r.Incompatible != nil {
		facts := *r.Incompatible
		info.Incompatible = &facts
	}
	return info
}

// NewPluginRecord creates a new PluginRecord with a state machine.
func NewPluginRecord(id string, meta config.PluginMeta, initialPhase lifecycle.PluginPhase) *PluginRecord {
	return &PluginRecord{
		ID:              id,
		Phase:           initialPhase,
		Metadata:        meta,
		Enabled:         true,
		DevMode:         false,
		DevPath:         "",
		LastError:       "",
		ErrorCount:      0,
		InstalledAt:     time.Now(),
		StateMachine:    lifecycle.NewPluginStateMachine(id, initialPhase),
		Backend:         nil,
		Capabilities:    nil,
		ProtocolVersion: 0,
		Incompatible:    nil,
	}
}

// PluginStateRecord is the subset of PluginRecord that gets persisted to disk.
type PluginStateRecord struct {
	ID             string                `json:"id"`
	Phase          lifecycle.PluginPhase `json:"phase"`
	Metadata       config.PluginMeta     `json:"metadata"`
	Enabled        bool                  `json:"enabled"`
	DevMode        bool                  `json:"devMode"`
	DevPath        string                `json:"devPath,omitempty"`
	LastError      string                `json:"lastError,omitempty"`
	ErrorCount     int                   `json:"errorCount"`
	InstalledAt    time.Time             `json:"installedAt"`
	ReleaseChannel string                `json:"releaseChannel,omitempty"`
}

// ToStateRecord converts a PluginRecord to its persistable form.
func (r *PluginRecord) ToStateRecord() PluginStateRecord {
	return PluginStateRecord{
		ID:             r.ID,
		Phase:          r.Phase,
		Metadata:       r.Metadata,
		Enabled:        r.Enabled,
		DevMode:        r.DevMode,
		DevPath:        r.DevPath,
		LastError:      r.LastError,
		ErrorCount:     r.ErrorCount,
		InstalledAt:    r.InstalledAt,
		ReleaseChannel: r.ReleaseChannel,
	}
}
