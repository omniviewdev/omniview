package exec

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/exec"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ExecProvider is the engine's version-independent interface for exec plugins.
// For v1, method signatures match SDK exec.Provider exactly (doc 20 §13.7).
// When v2 redesigns exec (context.Context, interfaces), this diverges.
type ExecProvider interface {
	GetSupportedResources(ctx *types.PluginContext) []exec.Handler
	GetSession(ctx *types.PluginContext, sessionID string) (*exec.Session, error)
	ListSessions(ctx *types.PluginContext) ([]*exec.Session, error)
	CreateSession(ctx *types.PluginContext, opts exec.SessionOptions) (*exec.Session, error)
	AttachSession(ctx *types.PluginContext, sessionID string) (*exec.Session, []byte, error)
	DetachSession(ctx *types.PluginContext, sessionID string) (*exec.Session, error)
	CloseSession(ctx *types.PluginContext, sessionID string) error
	ResizeSession(ctx *types.PluginContext, sessionID string, cols, rows int32) error
	Stream(ctx context.Context, in chan exec.StreamInput) (chan exec.StreamOutput, error)
}
