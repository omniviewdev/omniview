package profiling

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// Embed the real provider to override only configured reads used by resolution.
type configuredProvider struct {
	pkgsettings.Provider
	values map[string]any
}

func (p configuredProvider) GetSettingValue(id string) (any, error) { return p.values[id], nil }

func TestResolveConfig(t *testing.T) {
	provider := configuredProvider{values: map[string]any{"developer.pprof_enabled": false, "developer.pprof_port": 6060}}
	for _, tc := range []struct {
		name, env         string
		rejected          []string
		enabled           bool
		port              int
		source            string
		diagnostic, fatal bool
	}{
		{name: "default disabled", port: 6060, source: "settings"},
		{name: "environment enables ephemeral", env: "0", enabled: true, source: "environment"},
		{
			name: "environment overrides rejected", env: "6061",
			rejected: []string{"developer.pprof_port"}, enabled: true, port: 6061, source: "environment",
		},
		{
			name: "rejected port fails closed", rejected: []string{"developer.pprof_port"},
			source: "settings", diagnostic: true,
		},
		{
			name: "rejected enable fails closed", rejected: []string{"developer.pprof_enabled"},
			source: "settings", diagnostic: true,
		},
		{name: "unrelated rejected value", rejected: []string{"developer.gopath"}, port: 6060, source: "settings"},
		{name: "invalid environment", env: "65536", source: "environment", fatal: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config, source, err := ResolveConfig(provider, tc.rejected, tc.env)
			if (err != nil) != tc.fatal || source != tc.source ||
				config.Enabled != tc.enabled || config.Port != tc.port ||
				(config.Diagnostic != "") != tc.diagnostic {
				t.Fatalf("config=%+v source=%q err=%v", config, source, err)
			}
		})
	}
	for _, env := range []string{"-1", "abc", "localhost:6060", "0.0.0.0:6060", " "} {
		if _, _, err := ResolveConfig(provider, nil, env); err == nil {
			t.Fatalf("accepted %q", env)
		}
	}
	for _, values := range []map[string]any{
		{}, {"developer.pprof_enabled": "true", "developer.pprof_port": 6060},
		{"developer.pprof_enabled": true, "developer.pprof_port": -1},
		{"developer.pprof_enabled": true, "developer.pprof_port": 65536},
		{"developer.pprof_enabled": true, "developer.pprof_port": 6060.5},
	} {
		config, _, err := ResolveConfig(configuredProvider{values: values}, nil, "")
		if err != nil || config.Enabled || config.Diagnostic == "" {
			t.Fatalf("unsafe recovery: %+v %v", config, err)
		}
		service := New(config, "settings")
		if service.Start() == nil || service.GetStatus().Running || service.GetStatus().Error == "" {
			t.Fatal("invalid saved settings did not fail closed")
		}
	}
	provider.values["developer.pprof_enabled"] = true
	config, _, err := ResolveConfig(provider, nil, "")
	if err != nil || !config.Enabled || config.Port != 6060 {
		t.Fatalf("saved opt-in rejected: %+v %v", config, err)
	}
	if provider.values["developer.pprof_port"] != 6060 {
		t.Fatal("override mutated saved configuration")
	}
}

func TestLifecycle(t *testing.T) {
	disabled := New(Config{Port: 6060}, "settings")
	if err := disabled.Start(); err != nil || disabled.GetStatus().Running || disabled.GetStatus().URL != "" {
		t.Fatalf("disabled status: %+v %v", disabled.GetStatus(), err)
	}
	service := New(Config{Enabled: true, Port: 0}, "settings")
	if err := service.Start(); err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	status := service.GetStatus()
	if !status.Running || status.URL == "" || strings.Contains(status.URL, ":0/") || status.Source != "settings" {
		t.Fatalf("bad active status: %+v", status)
	}
	if err := service.Start(); err != nil || service.GetStatus().URL != status.URL {
		t.Fatal("Start was not idempotent")
	}
	if wrapper := (&ServiceWrapper{Service: service}).GetStatus(); wrapper != status {
		t.Fatal("wrapper changed runtime facts")
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	if closedStatus := service.GetStatus(); closedStatus.Running || closedStatus.URL != "" {
		t.Fatalf("closed status: %+v", closedStatus)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	if err := service.Start(); err == nil {
		t.Fatal("closed service restarted")
	}
}

func TestOccupiedPortAndServeFailure(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	_, portString, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portString)
	service := New(Config{Enabled: true, Port: port}, "settings")
	if startErr := service.Start(); startErr == nil {
		t.Fatal("occupied port accepted")
	}
	if status := service.GetStatus(); status.Running || status.URL != "" || status.Error == "" {
		t.Fatalf("bind error status: %+v", status)
	}
	service = New(Config{Enabled: true, Port: 0}, "environment")
	if startErr := service.Start(); startErr != nil {
		t.Fatal(startErr)
	}
	defer service.Close()
	if closeErr := service.listener.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	deadline := time.Now().Add(2 * time.Second)
	for service.GetStatus().Running && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	status := service.GetStatus()
	if status.Running || status.URL != "" || status.Error == "" || status.Source != "environment" {
		t.Fatalf("serve error status: %+v", status)
	}
}

func TestSavedChangesDoNotRebind(t *testing.T) {
	provider := configuredProvider{values: map[string]any{"developer.pprof_enabled": true, "developer.pprof_port": 0}}
	config, source, err := ResolveConfig(provider, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	service := New(config, source)
	if startErr := service.Start(); startErr != nil {
		t.Fatal(startErr)
	}
	defer service.Close()
	active := service.GetStatus()
	provider.values["developer.pprof_enabled"] = false
	provider.values["developer.pprof_port"] = 6062
	if service.GetStatus() != active {
		t.Fatal("saved change changed active listener")
	}
	res, err := http.Get(active.URL)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	service.Close()
	config, source, err = ResolveConfig(provider, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	restarted := New(config, source)
	defer restarted.Close()
	if startErr := restarted.Start(); startErr != nil || restarted.GetStatus().Running {
		t.Fatalf("saved disable not applied after restart: %v", startErr)
	}
}

func TestPreparedProviderAndEnvironmentDoNotChangeSavedValues(t *testing.T) {
	provider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{PluginSettings: []pkgsettings.Category{{
		ID: "developer",
		Settings: map[string]pkgsettings.Setting{
			"pprof_enabled": {ID: "pprof_enabled", Type: pkgsettings.Toggle, Default: false},
			"pprof_port":    {ID: "pprof_port", Type: pkgsettings.Integer, Default: 6060},
		},
	}}})
	config, source, err := ResolveConfig(provider, nil, "")
	if err != nil || config.Enabled || config.Port != 6060 || source != "settings" {
		t.Fatalf("prepared defaults: %+v %s %v", config, source, err)
	}
	if setErr := provider.SetSetting("developer.pprof_enabled", true); setErr != nil {
		t.Fatal(setErr)
	}
	if setErr := provider.SetSetting("developer.pprof_port", float64(0)); setErr != nil {
		t.Fatal(setErr)
	}
	config, _, err = ResolveConfig(provider, nil, "")
	if err != nil || !config.Enabled || config.Port != 0 || config.Diagnostic != "" {
		t.Fatalf("normalized saved config: %+v %v", config, err)
	}
	config, source, err = ResolveConfig(provider, nil, "6061")
	if err != nil || config.Port != 6061 || source != "environment" {
		t.Fatalf("override: %+v %s %v", config, source, err)
	}
	if port, readErr := provider.GetInt("developer.pprof_port"); readErr != nil || port != 0 {
		t.Fatalf("saved port mutated: %d %v", port, readErr)
	}
}
