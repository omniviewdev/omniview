//go:build ui_next && (server || !cgo || purego || (!darwin && !linux) || ios || android || (linux && gtk3))

package windowmaterial

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/settings"
)

// Configure keeps a solid native backing on unsupported toolkits, including
// Windows. Server windows exist only in the registry: never run or show them.
func Configure(app *application.App, service *settings.Service, options *application.WebviewWindowOptions) {
	options.Mac.Backdrop = application.MacBackdropNormal
	var mu sync.RWMutex
	result := (preference{}).inPage()
	setup(app, service, func(request settings.AppearanceRequest) {
		value := nativePreference(request).inPage()
		mu.Lock()
		result = value
		mu.Unlock()
	}, func(string) settings.AppearanceMaterial {
		mu.RLock()
		defer mu.RUnlock()
		return result
	})
}
