package devcontract

import "time"

type ProcessIdentity struct {
	PID           int    `json:"pid"`
	StartIdentity string `json:"startIdentity"`
	Executable    string `json:"executable"`
	WorkspaceID   string `json:"workspaceID"`
	Generation    string `json:"generation"`
	Role          string `json:"role"`
	Source        string `json:"source,omitempty"`
}
type Endpoints struct {
	Browser *string `json:"browser"`
	Vite    *string `json:"vite"`
	HMR     *string `json:"hmr"`
	MCP     *string `json:"mcp"`
	Control *string `json:"control"`
	Health  *string `json:"health"`
}
type RepositoryResolution struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	Ref    string `json:"ref"`
	Commit string `json:"commit"`
}
type PluginState struct {
	ID               string `json:"id"`
	Version          string `json:"version"`
	Source           string `json:"source"`
	Generation       string `json:"generation"`
	Mode             string `json:"mode"`
	BuildStatus      string `json:"buildStatus"`
	ViteStatus       string `json:"viteStatus"`
	RPCStatus        string `json:"rpcStatus"`
	ControllerStatus string `json:"controllerStatus"`
	OperationID      string `json:"operationID,omitempty"`
	LastError        *Error `json:"lastError,omitempty"`
}

// InstanceDescriptor contains no credentials; the token value is never part of discovery.
type InstanceDescriptor struct {
	SchemaVersion int                    `json:"schemaVersion"`
	WorkspaceID   string                 `json:"workspaceID"`
	InstanceID    string                 `json:"instanceID"`
	Generation    string                 `json:"generation"`
	Kind          string                 `json:"kind"`
	Channel       string                 `json:"channel"`
	DisplayName   string                 `json:"displayName"`
	StateRoot     string                 `json:"stateRoot"`
	Process       ProcessIdentity        `json:"process"`
	Version       string                 `json:"version"`
	Commit        string                 `json:"commit"`
	Repositories  []RepositoryResolution `json:"repositories"`
	Endpoints     Endpoints              `json:"endpoints"`
	Plugins       []PluginState          `json:"plugins"`
	Readiness     string                 `json:"readiness"`
	LastError     *Error                 `json:"lastError,omitempty"`
	StartedAt     time.Time              `json:"startedAt"`
}
type Discovery struct {
	InstanceDescriptor
	TokenFile string `json:"tokenFile"`
}
type BootIdentity struct {
	SchemaVersion int    `json:"schemaVersion"`
	InstanceID    string `json:"instanceID"`
	DisplayName   string `json:"displayName"`
	Generation    string `json:"generation"`
	Kind          string `json:"kind"`
}

func (d InstanceDescriptor) BootIdentity() BootIdentity {
	return BootIdentity{SchemaVersion: d.SchemaVersion, InstanceID: d.InstanceID, DisplayName: d.DisplayName, Generation: d.Generation, Kind: d.Kind}
}
