//go:build !devcontrol

package devcontrol

import (
	"context"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// Server is inert in ordinary/release builds. No listener, dispatcher, auth
// implementation or host adapter is linked without the explicit devcontrol tag.
type Server struct{}

func Start(context.Context, Config) (*Server, error)                          { return nil, ErrDisabled }
func (*Server) Endpoint() string                                              { return "" }
func (*Server) Refresh(context.Context, devcontract.InstanceDescriptor) error { return ErrDisabled }
func (*Server) Close(context.Context) error                                   { return nil }
