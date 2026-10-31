//go:build !production

package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/pprof"
	"os"
	"strconv"
	"time"
)

const (
	maxHostCPUProfileSeconds = 120
	maxHostTraceSeconds      = 15
)

// startHostPprof starts an explicitly requested, host-only development listener.
// Port 0 lets the OS select a free port; the actual URL is written to stderr.
func startHostPprof(port string) (*http.Server, error) {
	if port == "" {
		return nil, nil
	}
	if _, err := strconv.ParseUint(port, 10, 16); err != nil {
		return nil, fmt.Errorf("OMNIVIEW_PPROF_PORT must be a port number from 0 to 65535: %w", err)
	}
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", port))
	if err != nil {
		return nil, fmt.Errorf("start host pprof: %w", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /debug/pprof/", pprof.Index)
	mux.HandleFunc("GET /debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("GET /debug/pprof/profile", boundedPprofHandler(pprof.Profile, maxHostCPUProfileSeconds))
	mux.HandleFunc("GET /debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("GET /debug/pprof/trace", boundedPprofHandler(pprof.Trace, maxHostTraceSeconds))
	server := &http.Server{
		Addr:              listener.Addr().String(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		IdleTimeout:       30 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Host != listener.Addr().String() || len(r.Header.Values("Origin")) != 0 {
				http.Error(w, "pprof requires a direct loopback request without Origin", http.StatusForbidden)
				return
			}
			mux.ServeHTTP(w, r)
		}),
	}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintf(os.Stderr, "host pprof server failed: %v\n", err)
		}
	}()
	fmt.Fprintf(os.Stderr, "host pprof listening at http://%s/debug/pprof/ (local access is unauthenticated)\n", listener.Addr())
	return server, nil
}

// boundedPprofHandler prevents HEAD requests from starting captures and clamps
// explicit durations while preserving the standard handlers' default durations.
func boundedPprofHandler(handler http.HandlerFunc, maxSeconds int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "profiling captures require GET", http.StatusMethodNotAllowed)
			return
		}
		seconds, err := strconv.ParseFloat(r.FormValue("seconds"), 64)
		if err == nil && seconds > float64(maxSeconds) {
			r.Form.Set("seconds", strconv.Itoa(maxSeconds))
		}
		handler(w, r)
	}
}
