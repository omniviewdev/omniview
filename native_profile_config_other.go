//go:build !darwin && !server

package main

import "github.com/omniviewdev/omniview/internal/instance"

func validateNativeBundle(_ instance.Profile) error { return nil }
