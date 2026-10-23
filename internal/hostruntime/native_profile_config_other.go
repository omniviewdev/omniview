//go:build !darwin && !server

package hostruntime

import "github.com/omniviewdev/omniview/internal/instance"

func validateNativeBundle(_ instance.Profile) error { return nil }
