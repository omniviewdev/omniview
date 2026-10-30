package mcprelay

import (
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Wails event names emitted by the relay.
const (
	EventStatus                = "mcp/status"
	EventConfigChanged         = "mcp/config_changed"
	EventToolsChanged          = "mcp/tools_changed"
	EventConfirmationRequested = "mcp/confirmation/requested"
	EventConfirmationResolved  = "mcp/confirmation/resolved"
)

// Status is the listener state shown in the UI.
type Status struct {
	Enabled  bool   `json:"enabled"`
	Running  bool   `json:"running"`
	Endpoint string `json:"endpoint"`
	Error    string `json:"error"`
}

// PendingConfirmation is one tool call that waits for the user.
type PendingConfirmation struct {
	ID             string `json:"id"`
	MCPName        string `json:"mcpName"`
	PluginID       string `json:"pluginID"`
	PluginName     string `json:"pluginName"`
	ConnectionID   string `json:"connectionID"`
	ConnectionName string `json:"connectionName"`
	// ArgumentsJSON is text, not embedded JSON: JavaScript must not round
	// integer literals or erase negative zero before showing consent.
	ArgumentsJSON   string            `json:"argumentsJSON"`
	RequestedAt     time.Time         `json:"requestedAt"`
	Origin          string            `json:"origin"`
	CredentialID    string            `json:"credentialID"`
	SessionID       string            `json:"sessionID"`
	InvocationID    string            `json:"invocationID"`
	Target          invocation.Target `json:"target"`
	PolicyRevision  uint64            `json:"policyRevision"`
	CatalogRevision uint64            `json:"catalogRevision"`
}

// ConfirmationResolved reports how a pending confirmation ended.
type ConfirmationResolved struct {
	ID       string `json:"id"`
	Approved bool   `json:"approved"`
	Reason   string `json:"reason"` // approved | denied | timeout | cancelled
}

func init() {
	application.RegisterEvent[Status](EventStatus)
	application.RegisterEvent[string](EventConfigChanged)
	application.RegisterEvent[string](EventToolsChanged)
	application.RegisterEvent[PendingConfirmation](EventConfirmationRequested)
	application.RegisterEvent[ConfirmationResolved](EventConfirmationResolved)
}
