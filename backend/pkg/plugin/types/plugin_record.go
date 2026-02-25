package types

import (
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// PluginRecord is the host-side runtime state for a managed plugin.
// It holds both persisted configuration and runtime-only fields.
type PluginRecord struct {
	// Persisted fields.
	ID          string                `json:"id"`
	Phase       lifecycle.PluginPhase `json:"phase"`
	Metadata    config.PluginMeta     `json:"metadata"`
	Enabled     bool                  `json:"enabled"`
	DevMode     bool                  `json:"devMode"`
	DevPath     string                `json:"devPath,omitempty"`
	LastError   string                `json:"lastError,omitempty"`
	ErrorCount  int                   `json:"errorCount"`
	InstalledAt time.Time             `json:"installedAt"`

	// Runtime-only fields (not persisted).
	StateMachine *lifecycle.PluginStateMachine `json:"-"`
	Backend      PluginBackend                 `json:"-"`
	Capabilities []sdktypes.Capability         `json:"-"`
}

// ToInfo converts the host-side record to a frontend-safe PluginInfo.
func (r *PluginRecord) ToInfo() sdktypes.PluginInfo {
	phase := string(r.Phase)
	if r.StateMachine != nil {
		phase = string(r.StateMachine.Phase())
	}
	return sdktypes.PluginInfo{
		ID:           r.ID,
		Metadata:     r.Metadata,
		Phase:        phase,
		Enabled:      r.Enabled,
		DevMode:      r.DevMode,
		DevPath:      r.DevPath,
		Capabilities: r.Capabilities,
		LastError:    r.LastError,
	}
}

// NewPluginRecord creates a new PluginRecord with a state machine.
func NewPluginRecord(id string, meta config.PluginMeta, initialPhase lifecycle.PluginPhase) *PluginRecord {
	return &PluginRecord{
		ID:           id,
		Phase:        initialPhase,
		Metadata:     meta,
		Enabled:      true,
		InstalledAt:  time.Now(),
		StateMachine: lifecycle.NewPluginStateMachine(id, initialPhase),
	}
}

// PluginStateRecord is the subset of PluginRecord that gets persisted to disk.
type PluginStateRecord struct {
	ID          string                `json:"id"`
	Phase       lifecycle.PluginPhase `json:"phase"`
	Metadata    config.PluginMeta     `json:"metadata"`
	Enabled     bool                  `json:"enabled"`
	DevMode     bool                  `json:"devMode"`
	DevPath     string                `json:"devPath,omitempty"`
	LastError   string                `json:"lastError,omitempty"`
	ErrorCount  int                   `json:"errorCount"`
	InstalledAt time.Time             `json:"installedAt"`
}

// ToStateRecord converts a PluginRecord to its persistable form.
func (r *PluginRecord) ToStateRecord() PluginStateRecord {
	return PluginStateRecord{
		ID:          r.ID,
		Phase:       r.Phase,
		Metadata:    r.Metadata,
		Enabled:     r.Enabled,
		DevMode:     r.DevMode,
		DevPath:     r.DevPath,
		LastError:   r.LastError,
		ErrorCount:  r.ErrorCount,
		InstalledAt: r.InstalledAt,
	}
}
