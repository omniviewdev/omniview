// Package profiling owns the explicitly enabled, loopback-only host profiler.
package profiling

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/pprof"
	"strconv"
	"sync"
	"time"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const (
	maxHostCPUProfileSeconds = 120
	maxHostTraceSeconds      = 15
	hostReadHeaderTimeout    = 5 * time.Second
	hostReadTimeout          = 10 * time.Second
	hostIdleTimeout          = 30 * time.Second
)

type Config struct {
	Enabled bool
	Port    int
	// Diagnostic prevents recovered invalid preferences from enabling a listener.
	Diagnostic string
}

type Status struct {
	Running bool   `json:"running"`
	URL     string `json:"url"`
	Source  string `json:"source"`
	Error   string `json:"error"`
}

// ResolveConfig reads prepared settings without mutating their saved values.
// Only malformed explicit environment input is a fatal configuration error.
func ResolveConfig(provider pkgsettings.Provider, rejectedIDs []string, environment string) (Config, string, error) {
	if environment != "" {
		port, err := strconv.ParseUint(environment, 10, 16)
		if err != nil {
			return Config{}, "environment", fmt.Errorf("OMNIVIEW_PPROF_PORT must be a port number from 0 to 65535: %w", err)
		}
		return Config{Enabled: true, Port: int(port), Diagnostic: ""}, "environment", nil
	}
	invalid := func() (Config, string, error) {
		return Config{
			Enabled: false,
			Port:    0,
			Diagnostic: "Host profiling settings are invalid or unavailable. " +
				"Save valid profiling settings and restart Omniview.",
		}, "settings", nil
	}
	for _, id := range rejectedIDs {
		if id == "developer.pprof_enabled" || id == "developer.pprof_port" {
			return invalid()
		}
	}
	if provider == nil {
		return invalid()
	}
	enabled, err := provider.GetSettingValue("developer.pprof_enabled")
	if err != nil {
		return invalid()
	}
	port, err := provider.GetSettingValue("developer.pprof_port")
	if err != nil {
		return invalid()
	}
	enabledValue, ok := enabled.(bool)
	if !ok {
		return invalid()
	}
	portValue, ok := port.(int)
	if !ok || portValue < 0 || portValue > 65535 {
		return invalid()
	}
	return Config{Enabled: enabledValue, Port: portValue, Diagnostic: ""}, "settings", nil
}

type Service struct {
	mu       sync.Mutex
	config   Config
	status   Status
	server   *http.Server
	listener net.Listener
	closed   bool
}

func New(config Config, source string) *Service {
	return &Service{
		mu:       sync.Mutex{},
		config:   config,
		status:   Status{Running: false, URL: "", Source: source, Error: config.Diagnostic},
		server:   nil,
		listener: nil,
		closed:   false,
	}
}

// Start is idempotent. Saving preferences never calls Start or changes this snapshot.
func (s *Service) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("host profiling service is closed")
	}
	if s.server != nil {
		return nil
	}
	if s.config.Diagnostic != "" {
		return errors.New(s.config.Diagnostic)
	}
	if s.config.Port < 0 || s.config.Port > 65535 {
		s.status.Error = "Host profiling port must be from 0 to 65535."
		return errors.New(s.status.Error)
	}
	if !s.config.Enabled {
		return nil
	}
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(
		context.Background(), "tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(s.config.Port)),
	)
	if err != nil {
		s.status.Error = fmt.Sprintf("Host profiling could not listen on 127.0.0.1:%d: %v", s.config.Port, err)
		return errors.New(s.status.Error)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /debug/pprof/", pprof.Index)
	mux.HandleFunc("GET /debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("GET /debug/pprof/profile", boundedPprofHandler(pprof.Profile, maxHostCPUProfileSeconds))
	mux.HandleFunc("GET /debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("GET /debug/pprof/trace", boundedPprofHandler(pprof.Trace, maxHostTraceSeconds))
	server := &http.Server{
		Addr:              listener.Addr().String(),
		ReadHeaderTimeout: hostReadHeaderTimeout,
		ReadTimeout:       hostReadTimeout,
		IdleTimeout:       hostIdleTimeout,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Host != listener.Addr().String() || len(r.Header.Values("Origin")) != 0 {
				http.Error(w, "pprof requires a direct loopback request without Origin", http.StatusForbidden)
				return
			}
			mux.ServeHTTP(w, r)
		}),
	}
	s.server, s.listener = server, listener
	s.status.Running, s.status.URL, s.status.Error = true, "http://"+server.Addr+"/debug/pprof/", ""
	go func() {
		serveErr := server.Serve(listener)
		s.mu.Lock()
		defer s.mu.Unlock()
		s.status.Running, s.status.URL = false, ""
		if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) && !s.closed {
			s.status.Error = fmt.Sprintf("Host profiling server failed: %v", serveErr)
		}
	}()
	return nil
}

func (s *Service) Close() error {
	s.mu.Lock()
	s.closed = true
	s.status.Running, s.status.URL = false, ""
	server := s.server
	s.mu.Unlock()
	if server == nil {
		return nil
	}
	return server.Close()
}

func (s *Service) GetStatus() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// ServiceWrapper exposes runtime facts, never listener controls, to the frontend.
type ServiceWrapper struct{ Service *Service }

func (s *ServiceWrapper) GetStatus() Status { return s.Service.GetStatus() }

// boundedPprofHandler prevents HEAD captures and clamps explicit durations while
// preserving the standard handlers' default durations.
func boundedPprofHandler(handler http.HandlerFunc, maxSeconds int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "profiling captures require GET", http.StatusMethodNotAllowed)
			return
		}
		// GET captures use query parameters only. Populate Form so the standard
		// handlers do not attempt to parse a request body through FormValue.
		r.Form = r.URL.Query()
		seconds, err := strconv.ParseFloat(r.Form.Get("seconds"), 64)
		if err == nil && seconds > float64(maxSeconds) {
			r.Form.Set("seconds", strconv.Itoa(maxSeconds))
		}
		handler(w, r)
	}
}
