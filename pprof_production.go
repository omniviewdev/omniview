//go:build production

package main

import (
	"fmt"
	"net/http"
)

func startHostPprof(port string) (*http.Server, error) {
	if port != "" {
		return nil, fmt.Errorf("OMNIVIEW_PPROF_PORT is unavailable in production builds")
	}
	return nil, nil
}
