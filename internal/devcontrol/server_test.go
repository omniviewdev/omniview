//go:build devcontrol

package devcontrol

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const testWorkspace = "f14566c4-5130-4e3f-aa09-3e49c63b29a6"

func fixtureServer(t *testing.T) (*Server, pkgsettings.Provider, *settingsstore.Store) {
	t.Helper()
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	// A host provider has no PluginID. Plugin-mode providers resolve every key
	// against category "plugin", unlike the host's category.setting addressing.
	provider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{PluginSettings: []pkgsettings.Category{{ID: "limits", Settings: map[string]pkgsettings.Setting{"count": {ID: "count", Type: pkgsettings.Integer, Value: 3, Default: 3, Validator: func(value any) error {
		v, ok := value.(int)
		if !ok || v < 1 {
			return errors.New("private validator detail")
		}
		return nil
	}}, "secret": {ID: "secret", Type: pkgsettings.Password, Value: "fixture-secret", Default: "fixture-secret", Sensitive: true}}}}})
	initial, err := provider.GetInt("limits.count")
	if err != nil || initial != 3 {
		t.Fatalf("invalid host provider fixture: value=%d err=%v", initial, err)
	}
	persisted, err := store.LoadCategory("limits")
	if err != nil || len(persisted) != 0 {
		t.Fatalf("invalid initial persistence fixture: values=%v err=%v", persisted, err)
	}
	provider.RegisterChangeHandler("limits", func(values map[string]any) {
		if err := store.SaveCategory("limits", values); err != nil {
			t.Error(err)
		}
	})
	s := newServer(context.Background(), Config{Descriptor: devcontract.InstanceDescriptor{WorkspaceID: testWorkspace, Generation: "host-generation"}, Adapters: Adapters{Settings: NewSettingsAdapter(provider, nil)}}, []byte("test-token-with-more-than-thirty-two-bytes"))
	s.host = "127.0.0.1:45678"
	t.Cleanup(func() { s.cancel() })
	return s, provider, store
}

func send(t *testing.T, s *Server, operation string, params any, change func(*http.Request, *devcontract.Request)) devcontract.Response {
	t.Helper()
	p, _ := json.Marshal(params)
	request := devcontract.Request{ProtocolVersion: 1, RequestID: "request", WorkspaceID: testWorkspace, Generation: "host-generation", Operation: operation, Params: p}
	r := httptest.NewRequest(http.MethodPost, "http://"+s.host+"/v1/control", nil)
	r.RemoteAddr = "127.0.0.1:34567"
	r.Header.Set("Authorization", "Bearer "+string(s.token))
	if change != nil {
		change(r, &request)
	}
	data, _ := json.Marshal(request)
	r.Body = http.NoBody
	if len(data) > 0 {
		r.Body = ioBody(data)
	}
	w := httptest.NewRecorder()
	s.serveHTTP(w, r)
	var response devcontract.Response
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON: %v %s", err, w.Body.String())
	}
	return response
}

func ioBody(data []byte) *readCloser { return &readCloser{bytes.NewReader(data)} }

type readCloser struct{ *bytes.Reader }

func (*readCloser) Close() error { return nil }

func waitOperation(t *testing.T, s *Server, response devcontract.Response) devcontract.Response {
	t.Helper()
	if response.OperationID == "" {
		t.Fatalf("not accepted: %+v", response)
	}
	return send(t, s, "operation.wait", OperationParams{OperationID: response.OperationID, TimeoutMS: 2000}, nil)
}

// Removing target/auth/Host/origin checks would mutate the actual provider and DB.
func TestDeniedBeforeProviderEffects(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*http.Request, *devcontract.Request)
	}{
		{"token", func(r *http.Request, _ *devcontract.Request) { r.Header.Set("Authorization", "Bearer wrong") }},
		{"workspace", func(_ *http.Request, r *devcontract.Request) { r.WorkspaceID = "other" }},
		{"generation", func(_ *http.Request, r *devcontract.Request) { r.Generation = "stale" }},
		{"host", func(r *http.Request, _ *devcontract.Request) { r.Host = "evil.example" }},
		{"origin", func(r *http.Request, _ *devcontract.Request) { r.Header.Set("Origin", "http://evil.example") }},
		{"peer", func(r *http.Request, _ *devcontract.Request) { r.RemoteAddr = "192.0.2.1:1234" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, p, store := fixtureServer(t)
			r := send(t, s, "settings.set", map[string]any{"scope": "host", "id": "limits.count", "value": 9}, test.change)
			if r.Status != "failed" {
				t.Fatalf("accepted denied request: %+v", r)
			}
			value, err := p.GetInt("limits.count")
			if err != nil {
				t.Fatalf("provider lookup failed: %v", err)
			}
			if value != 3 {
				t.Fatalf("provider changed from 3 to %d", value)
			}
			persisted, err := store.LoadCategory("limits")
			if err != nil {
				t.Fatal(err)
			}
			if len(persisted) != 0 {
				t.Fatal("persistence mutated")
			}
		})
	}
}

// This exercises SDK validation/hooks and real bbolt persistence, not an echo.
func TestRoundTripTypedProviderMutationAndPersistence(t *testing.T) {
	s, p, store := fixtureServer(t)
	r := waitOperation(t, s, send(t, s, "settings.set", map[string]any{"scope": "host", "id": "limits.count", "value": 9}, nil))
	if r.Status != "succeeded" {
		t.Fatalf("mutation failed: %+v", r)
	}
	value, err := p.GetInt("limits.count")
	if err != nil || value != 9 {
		t.Fatalf("provider=%d %v", value, err)
	}
	persisted, err := store.LoadCategory("limits")
	if err != nil || persisted["count"] != float64(9) {
		t.Fatalf("persisted=%v %v", persisted, err)
	}
	r = send(t, s, "settings.get", map[string]any{"scope": "host", "id": "limits.count"}, nil)
	if string(r.Result) != "9" {
		t.Fatalf("read=%s", r.Result)
	}
	r = waitOperation(t, s, send(t, s, "settings.set", map[string]any{"scope": "host", "id": "limits.count", "value": 0}, nil))
	if r.Status != "failed" || strings.Contains(r.Error.Message, "private") {
		t.Fatalf("unsafe validation response: %+v", r)
	}
	persisted, err = store.LoadCategory("limits")
	if err != nil {
		t.Fatal(err)
	}
	if persisted["count"] != float64(9) {
		t.Fatal("invalid mutation persisted")
	}
	r = send(t, s, "settings.schema", map[string]any{"scope": "host"}, nil)
	if strings.Contains(string(r.Result), "fixture-secret") {
		t.Fatal("secret leaked")
	}
}

func TestWaitTimeoutDoesNotCancelAcceptedMutation(t *testing.T) {
	s, _, _ := fixtureServer(t)
	started := make(chan struct{})
	release := make(chan struct{})
	s.adapters.Inspect = func(context.Context) (devcontract.InstanceDescriptor, error) {
		close(started)
		<-release
		return devcontract.InstanceDescriptor{}, nil
	}
	accepted := s.accept(devcontract.Request{RequestID: "slow"}, func(ctx context.Context) (any, error) { return s.adapters.Inspect(ctx) })
	<-started
	response := send(t, s, "operation.wait", OperationParams{OperationID: accepted.OperationID, TimeoutMS: 1}, nil)
	if response.Error == nil || response.Error.Code != "timeout" {
		t.Fatalf("wait: %+v", response)
	}
	close(release)
	response = waitOperation(t, s, accepted)
	if response.Status != "succeeded" {
		t.Fatalf("eventual state: %+v", response)
	}
}

func TestStrictTypedParamsAndReadAuthentication(t *testing.T) {
	s, _, _ := fixtureServer(t)
	for _, op := range []string{"instance.inspect", "plugin.list", "settings.schema", "operation.get"} {
		r := send(t, s, op, map[string]any{}, func(r *http.Request, _ *devcontract.Request) { r.Header.Del("Authorization") })
		if r.Error == nil || r.Error.Code != "unauthorized" {
			t.Fatalf("unauthorized read %s: %+v", op, r)
		}
	}
	r := send(t, s, "settings.set", map[string]any{"scope": "host", "id": "limits.count", "value": 7, "shell": "ignored?"}, nil)
	if r.Error == nil || r.Error.Code != "invalid_params" {
		t.Fatalf("unknown field accepted: %+v", r)
	}
	r = send(t, s, "Go.Call", map[string]any{}, nil)
	if r.Error == nil || r.Error.Code != "unknown_operation" {
		t.Fatal("method escape allowed")
	}
}

func TestSafeBoundedErrors(t *testing.T) {
	e := safeError(errors.New(strings.Repeat("Bearer secret ", 10000)))
	data, _ := json.Marshal(e)
	if len(data) > 1024 || strings.Contains(string(data), "secret") {
		t.Fatalf("unsafe error: %s", data)
	}
}

func TestRealClientRoundTripPersistsValidatedSetting(t *testing.T) {
	s, p, store := fixtureServer(t)
	server := httptest.NewUnstartedServer(http.HandlerFunc(s.serveHTTP))
	s.host = server.Listener.Addr().String()
	server.Start()
	defer server.Close()
	client, err := NewClient(s.Endpoint(), s.token, testWorkspace, "host-generation")
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := client.Call(context.Background(), "settings.set", SettingsParams{Scope: "host", ID: "limits.count", Value: json.RawMessage("12")})
	if err != nil {
		t.Fatal(err)
	}
	completed, err := client.Wait(context.Background(), accepted.OperationID, time.Second)
	if err != nil || completed.Status != "succeeded" {
		t.Fatalf("completion=%+v err=%v", completed, err)
	}
	value, err := p.GetInt("limits.count")
	if err != nil {
		t.Fatalf("provider lookup failed: %v", err)
	}
	persisted, err := store.LoadCategory("limits")
	if err != nil || value != 12 || persisted["count"] != float64(12) {
		t.Fatalf("provider=%v persisted=%v err=%v", value, persisted, err)
	}
	read, err := client.Call(context.Background(), "settings.get", SettingsParams{Scope: "host", ID: "limits.count"})
	if err != nil || string(read.Result) != "12" {
		t.Fatalf("read=%+v err=%v", read, err)
	}
}

type fixturePlugins struct{ Plugins }
type fixtureDev struct{ Dev }

func TestStartupPrivateDiscoveryAndGenerationOwnedCleanup(t *testing.T) {
	store, err := devsession.OpenDiscoveryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	process, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: testWorkspace, Generation: "published-generation", Role: "host", Source: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	descriptor := devcontract.InstanceDescriptor{SchemaVersion: devcontract.SchemaVersion, WorkspaceID: testWorkspace, InstanceID: "7da9b9de-d833-4075-b3a7-1e74c7051386", Generation: "published-generation", Kind: "development", StateRoot: t.TempDir(), Process: process}
	_, provider, _ := fixtureServer(t)
	s, err := Start(context.Background(), Config{Descriptor: descriptor, Discovery: store, Adapters: Adapters{Inspect: func(context.Context) (devcontract.InstanceDescriptor, error) { return descriptor, nil }, Plugins: fixturePlugins{}, Dev: fixtureDev{}, Settings: NewSettingsAdapter(provider, nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close(context.Background())
	discovery, err := store.Read(context.Background(), testWorkspace, descriptor.Generation)
	if err != nil {
		t.Fatal(err)
	}
	token, err := os.ReadFile(discovery.TokenFile)
	if err != nil {
		t.Fatal(err)
	}
	if len(token) < 32 {
		t.Fatal("short token")
	}
	encoded, _ := json.Marshal(discovery)
	if bytes.Contains(encoded, token) {
		t.Fatal("token leaked into discovery")
	}
	endpoint, _ := url.Parse(s.Endpoint())
	host, _, err := net.SplitHostPort(endpoint.Host)
	if err != nil || host != "127.0.0.1" {
		t.Fatalf("not IPv4 loopback: %s", s.Endpoint())
	}
	if err := store.Remove(context.Background(), testWorkspace, "wrong-generation"); !errors.Is(err, devsession.ErrOwnership) {
		t.Fatalf("wrong generation cleanup: %v", err)
	}
	if _, err := store.Read(context.Background(), testWorkspace, descriptor.Generation); err != nil {
		t.Fatalf("wrong cleanup removed live descriptor: %v", err)
	}
	client, err := NewClient(s.Endpoint(), token, testWorkspace, descriptor.Generation)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Call(context.Background(), "instance.inspect", EmptyParams{}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Read(context.Background(), testWorkspace, descriptor.Generation); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("discovery survives close: %v", err)
	}
}

func TestClientInterruptedWaitPreservesOperationAndEventualResult(t *testing.T) {
	s, _, _ := fixtureServer(t)
	server := httptest.NewUnstartedServer(http.HandlerFunc(s.serveHTTP))
	s.host = server.Listener.Addr().String()
	server.Start()
	defer server.Close()
	client, err := NewClient(s.Endpoint(), s.token, testWorkspace, "host-generation")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	started := make(chan struct{})
	release := make(chan struct{})
	accepted := s.accept(devcontract.Request{RequestID: "slow"}, func(context.Context) (any, error) {
		close(started)
		<-release
		return map[string]bool{"completed": true}, nil
	})
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	response, err := client.Wait(ctx, accepted.OperationID, time.Second)
	if devcontract.ExitCode(err) != 7 || response.OperationID != accepted.OperationID || response.Status != "running" || response.Error == nil {
		t.Fatalf("interrupted wait=%+v err=%v", response, err)
	}
	close(release)
	response, err = client.Wait(context.Background(), accepted.OperationID, time.Second)
	if err != nil || response.Status != "succeeded" {
		t.Fatalf("eventual=%+v err=%v", response, err)
	}
}

func TestClientWrongTokenIsUnauthorizedAndDoesNotPersist(t *testing.T) {
	s, p, store := fixtureServer(t)
	server := httptest.NewUnstartedServer(http.HandlerFunc(s.serveHTTP))
	s.host = server.Listener.Addr().String()
	server.Start()
	defer server.Close()
	client, err := NewClient(s.Endpoint(), []byte("wrong-token-with-more-than-thirty-two-bytes"), testWorkspace, "host-generation")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.Call(context.Background(), "settings.set", SettingsParams{Scope: "host", ID: "limits.count", Value: json.RawMessage("20")})
	if devcontract.ExitCode(err) != 6 {
		t.Fatalf("wrong token exit=%d err=%v", devcontract.ExitCode(err), err)
	}
	value, err := p.GetInt("limits.count")
	if err != nil {
		t.Fatalf("provider lookup failed: %v", err)
	}
	persisted, err := store.LoadCategory("limits")
	if err != nil {
		t.Fatal(err)
	}
	if value != 3 || len(persisted) != 0 {
		t.Fatal("unauthorized request changed real state")
	}
}

type dependencyDevFixture struct {
	Dev
	generation string
	watching   bool
	changes    int
}

func (d *dependencyDevFixture) SetDependencyWatching(ctx context.Context, id, generation string, enabled bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if id != "fixture" || generation != d.generation {
		return devcontract.Fail(4, "stale_target", "managed plugin generation does not match")
	}
	d.watching = enabled
	d.changes++
	return nil
}
func TestDependencyWatchingMutationRequiresTypedTargetAndAuthorization(t *testing.T) {
	s, _, _ := fixtureServer(t)
	watcher := &dependencyDevFixture{generation: "plugin-generation", watching: true}
	s.adapters.Dev = watcher
	for _, test := range []struct {
		name   string
		params any
		change func(*http.Request, *devcontract.Request)
	}{
		{"missing enabled", map[string]any{"id": "fixture", "generation": "plugin-generation"}, nil},
		{"missing plugin generation", map[string]any{"id": "fixture", "enabled": false}, nil},
		{"unknown parameter", map[string]any{"id": "fixture", "generation": "plugin-generation", "enabled": false, "shell": "no"}, nil},
		{"wrong token", DependenciesParams{ID: "fixture", Generation: "plugin-generation", Enabled: false}, func(r *http.Request, _ *devcontract.Request) { r.Header.Set("Authorization", "Bearer wrong") }},
		{"wrong host generation", DependenciesParams{ID: "fixture", Generation: "plugin-generation", Enabled: false}, func(_ *http.Request, r *devcontract.Request) { r.Generation = "old-host" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := send(t, s, "plugin.dev.dependencies", test.params, test.change)
			if response.Status != "failed" || response.OperationID != "" {
				t.Fatalf("invalid toggle accepted: %+v", response)
			}
			if watcher.changes != 0 || !watcher.watching {
				t.Fatal("denied toggle reached watcher")
			}
		})
	}
	stale := waitOperation(t, s, send(t, s, "plugin.dev.dependencies", DependenciesParams{ID: "fixture", Generation: "old-plugin", Enabled: false}, nil))
	if stale.Status != "failed" || watcher.changes != 0 || !watcher.watching {
		t.Fatalf("stale plugin toggle had effects: %+v", stale)
	}
	disabled := waitOperation(t, s, send(t, s, "plugin.dev.dependencies", DependenciesParams{ID: "fixture", Generation: "plugin-generation", Enabled: false}, nil))
	if disabled.Status != "succeeded" || watcher.watching || watcher.changes != 1 {
		t.Fatalf("watcher was not disabled: %+v", disabled)
	}
	enabled := waitOperation(t, s, send(t, s, "plugin.dev.dependencies", DependenciesParams{ID: "fixture", Generation: "plugin-generation", Enabled: true}, nil))
	if enabled.Status != "succeeded" || !watcher.watching || watcher.changes != 2 {
		t.Fatalf("watcher was not enabled: %+v", enabled)
	}
}
