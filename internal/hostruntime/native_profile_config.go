//go:build !server

package hostruntime

import (
	"fmt"
	"os"
	"runtime"
	"strings"

	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ConfigureNativeProfile runs before application.New and again after acquiring
// the stable profile guard. Stock WebKit uses the immutable bundle's default
// persistent datastore on Mac.
func ConfigureNativeProfile(options *application.Options, profile instance.Profile) error {
	if profile.Descriptor.Kind != "development" {
		return nil
	}
	options.Windows.WebviewUserDataPath = profile.WebviewRoot
	nativeID := "dev.omniview.workspace.w" + strings.ReplaceAll(profile.Descriptor.WorkspaceID, "-", "")
	options.Linux.ProgramName = nativeID
	options.Linux.ApplicationID = nativeID
	if runtime.GOOS == "linux" {
		if err := profile.ValidateNativeHostEnvironment(os.Getenv); err != nil {
			return err
		}
		if _, err := instance.RestoreNativeChildEnvironment(os.Environ()); err != nil {
			return fmt.Errorf("invalid native host environment: %w", err)
		}
	}
	return validateNativeBundle(profile)
}

// PrepareProfileRuntime prepares the resolved profile's runtime directories.
func PrepareProfileRuntime(profile instance.Profile) error {
	return profile.PrepareRuntime()
}
