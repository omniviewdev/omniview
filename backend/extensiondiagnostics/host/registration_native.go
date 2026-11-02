//go:build !server

package host

import "github.com/wailsapp/wails/v3/pkg/application"

func registrationPending(application.Window) bool {
	return false
}
