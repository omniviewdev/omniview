//go:build !server

package hostruntime

import (
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// DevelopmentServerMiddleware returns no policy for native wails:// requests,
// which are not requests to an HTTP listener.
func DevelopmentServerMiddleware(_ instance.Profile) application.Middleware {
	return nil
}
