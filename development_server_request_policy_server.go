//go:build server

package main

import (
	"net"
	"net/http"
	"net/netip"
	"path"
	"strconv"
	"strings"

	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// developmentServerMiddleware protects the complete development HTTP mux,
// including RPC and WebSocket routes that bypass the asset middleware. This is
// browser request provenance enforcement, not authentication of local clients.
func developmentServerMiddleware(profile instance.Profile) application.Middleware {
	if profile.Descriptor.Kind != "development" {
		return nil
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Frame-Options", "DENY")
			if !developmentServerRequestAllowed(r) {
				http.Error(w, "development server request forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func developmentServerRequestAllowed(r *http.Request) bool {
	// net/http supplies the accepted TCP connection's local address. Do not
	// infer the listener from Host or trust any forwarded authority headers.
	local, ok := r.Context().Value(http.LocalAddrContextKey).(*net.TCPAddr)
	if !ok || local == nil || !local.IP.IsLoopback() || local.Port < 1 || local.Port > 65535 {
		return false
	}
	host, port, err := net.SplitHostPort(r.Host)
	if err != nil {
		return false
	}
	if host != "localhost" {
		address, err := netip.ParseAddr(host)
		if err != nil || !address.IsLoopback() {
			return false
		}
	}
	requestPort, err := strconv.ParseUint(port, 10, 16)
	if err != nil || int(requestPort) != local.Port {
		return false
	}
	for _, site := range r.Header.Values("Sec-Fetch-Site") {
		site = strings.TrimSpace(site)
		if strings.EqualFold(site, "cross-site") || strings.EqualFold(site, "same-site") {
			return false
		}
	}
	if origins := r.Header.Values("Origin"); len(origins) != 0 {
		if len(origins) != 1 {
			return false
		}
		scheme := "http://"
		if r.TLS != nil {
			scheme = "https://"
		}
		// Exact serialization rules out null, userinfo, paths, queries,
		// fragments, multiple origins and scheme/authority substitutions.
		authority, ok := strings.CutPrefix(origins[0], scheme)
		if !ok || authority != r.Host {
			return false
		}
	}
	// Wails dispatches runtime calls by decoded URL.Path, including GET query
	// calls. The generated runtime always supplies this nonsecret header.
	// Requiring it blocks legacy browser subresource requests with neither
	// Origin nor Fetch Metadata; it does not authenticate nonbrowser clients.
	// Clean also covers slash/dot variants before the outer mux redirects.
	if path.Clean(r.URL.Path) == "/wails/runtime" && strings.TrimSpace(r.Header.Get("x-wails-client-id")) == "" {
		return false
	}
	return true
}
