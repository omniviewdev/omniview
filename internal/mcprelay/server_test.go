package mcprelay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/tools"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

// ---- fakes ----

type memoryStore struct {
	mu   sync.Mutex
	data []byte
}

func (m *memoryStore) SaveMCPRelayConfig(cfg any) error {
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.data = data
	m.mu.Unlock()
	return nil
}

func (m *memoryStore) LoadMCPRelayConfig(out any) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.data == nil {
		return false, nil
	}
	return true, json.Unmarshal(m.data, out)
}

type recordedCall struct {
	pluginID   string
	connection *sdktypes.Connection
	name       string
	arguments  json.RawMessage
}

type fakeTools struct {
	mu        sync.Mutex
	plugins   map[string]tools.PluginTools
	listeners []func()
	callErr   error
	callHook  func(context.Context) error
	calls     []recordedCall
}

func (f *fakeTools) OnPluginInit(string, config.PluginMeta) {}
func (f *fakeTools) OnPluginStart(string, config.PluginMeta, plugintypes.PluginBackend) error {
	return nil
}
func (f *fakeTools) OnPluginStop(string, config.PluginMeta) error     { return nil }
func (f *fakeTools) OnPluginShutdown(string, config.PluginMeta) error { return nil }
func (f *fakeTools) OnPluginDestroy(string, config.PluginMeta) error  { return nil }
func (f *fakeTools) ListPlugins() ([]string, error)                   { return nil, nil }
func (f *fakeTools) HasPlugin(string) bool                            { return true }

func (f *fakeTools) ListAll() map[string]tools.PluginTools {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]tools.PluginTools, len(f.plugins))
	for k, v := range f.plugins {
		out[k] = v
	}
	return out
}

func (f *fakeTools) CallTool(ctx context.Context, pluginID string, connection *sdktypes.Connection, name string, arguments json.RawMessage) (*sdktools.Result, error) {
	f.mu.Lock()
	f.calls = append(f.calls, recordedCall{pluginID: pluginID, connection: connection, name: name, arguments: arguments})
	callErr, hook := f.callErr, f.callHook
	f.mu.Unlock()
	if hook != nil {
		if err := hook(ctx); err != nil {
			return nil, err
		}
	}
	if callErr != nil {
		return nil, callErr
	}
	if name == "ping" {
		return sdktools.JSONResult(map[string]any{"pong": true})
	}
	return sdktools.TextResult("done " + name), nil
}

func (f *fakeTools) OnChange(fn func()) { f.listeners = append(f.listeners, fn) }

func (f *fakeTools) lastCall() recordedCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[len(f.calls)-1]
}

type fakeConnections struct {
	resource.Service
	connections map[string][]sdktypes.Connection
	states      map[string][]resource.ConnectionState
	stateErr    error
	stateHook   func()
	listHook    func()
}

func (f *fakeConnections) ListAllConnections(context.Context) (map[string][]sdktypes.Connection, error) {
	return f.connections, nil
}

func (f *fakeConnections) GetAllConnectionStates(context.Context) (map[string][]resource.ConnectionState, error) {
	if f.stateHook != nil {
		f.stateHook()
	}
	if f.stateErr != nil {
		return nil, f.stateErr
	}
	if f.states != nil {
		return f.states, nil
	}
	out := make(map[string][]resource.ConnectionState)
	for plugin, connections := range f.connections {
		for _, connection := range connections {
			out[plugin] = append(out[plugin], resource.ConnectionState{
				Connection: connection, Readiness: sdktypes.ConnectionStatusConnected,
			})
		}
	}
	return out, nil
}

func (f *fakeConnections) ListConnections(_ context.Context, pluginID string) ([]sdktypes.Connection, error) {
	if f.listHook != nil {
		f.listHook()
	}
	return f.connections[pluginID], nil
}

func (f *fakeConnections) GetConnection(_ context.Context, pluginID, connectionID string) (sdktypes.Connection, error) {
	for _, c := range f.connections[pluginID] {
		if c.ID == connectionID {
			return c, nil
		}
	}
	return sdktypes.Connection{}, errors.New("connection not found")
}

// ---- harness ----

type harness struct {
	relay   *Relay
	service *ServiceWrapper
	tools   *fakeTools
	store   *memoryStore
	url     string
	token   string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	fakeTools := &fakeTools{plugins: map[string]tools.PluginTools{
		"kubernetes": {
			Meta: config.PluginMeta{ID: "kubernetes", Name: "Kubernetes"},
			Tools: []sdktools.Descriptor{
				{Name: "list_namespaces", Description: "lists", Scope: sdktools.ScopeConnection, InputSchema: sdktools.ObjectSchema(nil), Annotations: sdktools.Annotations{ReadOnly: new(true)}},
				{Name: "delete_resource", Description: "deletes", Scope: sdktools.ScopeConnection, InputSchema: sdktools.ObjectSchema(map[string]any{"name": map[string]any{"type": "string"}}, "name"), Annotations: sdktools.Annotations{Destructive: new(true)}},
			},
		},
		"alpha": {
			Meta:  config.PluginMeta{ID: "alpha", Name: "Alpha"},
			Tools: []sdktools.Descriptor{{Name: "ping", Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil), Annotations: sdktools.Annotations{ReadOnly: new(true)}}},
		},
	}}
	connections := &fakeConnections{connections: map[string][]sdktypes.Connection{
		"kubernetes": {{ID: "prod", Name: "Production"}, {ID: "test", Name: "Test cluster"}},
	}}
	store := &memoryStore{}
	relay := New(Options{Log: logging.NewNop(), Store: store, Tools: fakeTools, Connections: connections, Version: "test", ShowConfirmation: func() error { return nil }})
	relay.listenAddr = "127.0.0.1:0"
	service := &ServiceWrapper{Relay: relay}

	require.NoError(t, relay.loadConfig())
	require.NoError(t, service.SetToolOverride(Scope{}, "alpha_ping", ToolOverride{Enabled: new(true)}))
	require.NoError(t, service.SetToolOverride(Scope{}, "kubernetes_list_namespaces", ToolOverride{Enabled: new(true)}))
	require.NoError(t, service.SetEnabled(true))
	t.Cleanup(relay.stopListener)

	status := service.GetStatus()
	require.True(t, status.Running, status.Error)
	return &harness{relay: relay, service: service, tools: fakeTools, store: store, url: status.Endpoint, token: service.GetConfig().Token}
}

type bearerTransport struct{ token string }

func (b bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(req)
}

func (h *harness) connect(t *testing.T, opts *mcp.ClientOptions) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, opts)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:   h.url,
		HTTPClient: &http.Client{Transport: bearerTransport{token: h.token}},
	}, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func toolNames(t *testing.T, session *mcp.ClientSession) []string {
	t.Helper()
	result, err := session.ListTools(context.Background(), nil)
	require.NoError(t, err)
	names := make([]string, 0, len(result.Tools))
	for _, tool := range result.Tools {
		names = append(names, tool.Name)
	}
	return names
}

func callText(t *testing.T, session *mcp.ClientSession, name string, args map[string]any) (string, bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if args == nil {
		args = map[string]any{}
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	require.NoError(t, err)
	require.NotEmpty(t, result.Content)
	text, ok := result.Content[0].(*mcp.TextContent)
	require.True(t, ok)
	return text.Text, result.IsError
}

func approveNext(t *testing.T, service *ServiceWrapper) {
	t.Helper()
	go func() {
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if pending := service.ListPendingConfirmations(); len(pending) > 0 {
				_ = service.ResolveConfirmation(pending[0].ID, true)
				return
			}
			time.Sleep(time.Millisecond)
		}
	}()
}

// ---- tests ----

func TestRelayRejectsMissingBearer(t *testing.T) {
	h := newHarness(t)
	resp, err := http.Post(h.url, "application/json", nil)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	require.Equal(t, "Bearer", resp.Header.Get("WWW-Authenticate"))

	req, err := http.NewRequest(http.MethodPost, h.url, nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+h.token)
	req.Header.Set("Origin", "http://evil.example")
	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestRelayListsToolsPerPolicy(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	require.Equal(t, "omniview", session.InitializeResult().ServerInfo.Name)

	require.Equal(t, []string{"alpha_ping", "kubernetes_list_connections", "kubernetes_list_namespaces"}, toolNames(t, session))

	result, err := session.ListTools(context.Background(), nil)
	require.NoError(t, err)
	for _, tool := range result.Tools {
		if tool.Name != "kubernetes_list_namespaces" {
			continue
		}
		schema, ok := tool.InputSchema.(map[string]any)
		require.True(t, ok)
		require.Contains(t, schema["properties"], "connection_id")
		require.Equal(t, []any{"connection_id"}, schema["required"])
		require.True(t, tool.Annotations.ReadOnlyHint)
	}

	require.NoError(t, h.service.ApplyPreset(Scope{}, PresetAll))
	require.Contains(t, toolNames(t, session), "kubernetes_delete_resource")

	require.NoError(t, h.service.SetToolOverride(Scope{}, "kubernetes_list_namespaces", ToolOverride{Enabled: new(false)}))
	require.NotContains(t, toolNames(t, session), "kubernetes_list_namespaces")

	require.NoError(t, h.service.SetPluginEnabled("alpha", false))
	require.NotContains(t, toolNames(t, session), "alpha_ping")
	require.NoError(t, h.service.SetPluginEnabled("alpha", true))
	require.Contains(t, toolNames(t, session), "alpha_ping")

	// Config survives a reload from the store.
	var persisted Config
	found, err := h.store.LoadMCPRelayConfig(&persisted)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, PresetAll, persisted.Global.Preset)
}

func TestRelayNotifiesToolListChanges(t *testing.T) {
	h := newHarness(t)
	changed := make(chan struct{}, 8)
	session := h.connect(t, &mcp.ClientOptions{
		ToolListChangedHandler: func(context.Context, *mcp.ToolListChangedRequest) { changed <- struct{}{} },
	})
	_ = toolNames(t, session)
	require.NoError(t, h.service.ApplyPreset(Scope{}, PresetAll))
	select {
	case <-changed:
	case <-time.After(5 * time.Second):
		t.Fatal("no tools/list_changed notification")
	}
}

func TestRelayConnectionPolicyAndConfirmation(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)

	require.NoError(t, h.service.ApplyPreset(Scope{"kubernetes", "prod"}, PresetReadOnly))
	require.NoError(t, h.service.ApplyPreset(Scope{"kubernetes", "test"}, PresetAll))
	require.Contains(t, toolNames(t, session), "kubernetes_delete_resource")

	text, isError := callText(t, session, "kubernetes_delete_resource", map[string]any{"connection_id": "prod", "name": "cm"})
	require.True(t, isError)
	require.Contains(t, text, "not permitted on connection Production (prod)")

	text, isError = callText(t, session, "kubernetes_delete_resource", map[string]any{"name": "cm"})
	require.True(t, isError)
	require.Contains(t, text, "connection_id is required")

	text, isError = callText(t, session, "kubernetes_delete_resource", map[string]any{"connection_id": "ghost", "name": "cm"})
	require.True(t, isError)
	require.Contains(t, text, "unknown connection ghost")

	// Destructive tools need confirmation: approve from a goroutine.
	go func() {
		for {
			pending := h.service.ListPendingConfirmations()
			if len(pending) > 0 {
				_ = h.service.ResolveConfirmation(pending[0].ID, true)
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	text, isError = callText(t, session, "kubernetes_delete_resource", map[string]any{"connection_id": "test", "name": "cm"})
	require.False(t, isError, text)
	require.Equal(t, "done delete_resource", text)
	call := h.tools.lastCall()
	require.Equal(t, "kubernetes", call.pluginID)
	require.Equal(t, "test", call.connection.ID)
	require.Equal(t, "Test cluster", call.connection.Name)
	require.JSONEq(t, `{"name":"cm"}`, string(call.arguments), "connection_id is stripped")

	// Denied.
	denied := make(chan PendingConfirmation, 1)
	go func() {
		for {
			pending := h.service.ListPendingConfirmations()
			if len(pending) > 0 {
				denied <- pending[0]
				_ = h.service.ResolveConfirmation(pending[0].ID, false)
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	text, isError = callText(t, session, "kubernetes_delete_resource", map[string]any{"connection_id": "test", "name": "cm"})
	require.True(t, isError)
	require.Equal(t, "the user denied this call", text)
	deniedRequest := <-denied
	require.Equal(t, "kubernetes_delete_resource", deniedRequest.MCPName)
	require.Equal(t, "Test cluster", deniedRequest.ConnectionName)

	// A false custom hint/override cannot suppress required conservative consent.
	require.NoError(t, h.service.SetToolOverride(Scope{"kubernetes", "test"}, "kubernetes_delete_resource", ToolOverride{Confirm: new(false)}))
	approveNext(t, h.service)
	text, isError = callText(t, session, "kubernetes_delete_resource", map[string]any{"connection_id": "test", "name": "cm2"})
	require.False(t, isError, text)
	require.Empty(t, h.service.ListPendingConfirmations())

	require.ErrorContains(t, h.service.ResolveConfirmation("nope", true), "no pending confirmation")
}

func TestRelayListConnectionsHonoursAccess(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)

	text, isError := callText(t, session, "kubernetes_list_connections", nil)
	require.False(t, isError)
	var listing struct {
		Connections []struct {
			ID           string   `json:"id"`
			Name         string   `json:"name"`
			EnabledTools []string `json:"enabled_tools"`
		} `json:"connections"`
	}
	require.NoError(t, json.Unmarshal([]byte(text), &listing))
	require.Len(t, listing.Connections, 2)
	require.Equal(t, []string{"kubernetes_list_namespaces"}, listing.Connections[0].EnabledTools)

	require.NoError(t, h.service.SetConnectionAccess("kubernetes", "prod", AccessBlocked))
	text, _ = callText(t, session, "kubernetes_list_connections", nil)
	require.NoError(t, json.Unmarshal([]byte(text), &listing))
	require.Len(t, listing.Connections, 1)
	require.Equal(t, "test", listing.Connections[0].ID)

	text, isError = callText(t, session, "kubernetes_list_namespaces", map[string]any{"connection_id": "prod"})
	require.True(t, isError)
	require.Contains(t, text, "not permitted")

	approveNext(t, h.service)
	text, isError = callText(t, session, "kubernetes_list_namespaces", map[string]any{"connection_id": "test"})
	require.False(t, isError, text)

	// Plugin-scoped tool with structured content.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	approveNext(t, h.service)
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "alpha_ping"})
	require.NoError(t, err)
	require.False(t, result.IsError)
	require.Equal(t, map[string]any{"pong": true}, result.StructuredContent)
	require.Nil(t, h.tools.lastCall().connection)
}

func TestRelayViewsAndPresets(t *testing.T) {
	h := newHarness(t)

	views, err := h.service.ListTools(Scope{})
	require.NoError(t, err)
	byName := map[string]ToolView{}
	for _, v := range views {
		byName[v.MCPName] = v
	}
	require.Len(t, byName, 4)
	require.True(t, byName["kubernetes_list_namespaces"].Enabled)
	require.Equal(t, "inherited", byName["kubernetes_list_namespaces"].EnabledSource)
	require.False(t, byName["kubernetes_delete_resource"].Enabled)
	require.True(t, byName["kubernetes_delete_resource"].Confirm)
	require.Equal(t, "default", byName["kubernetes_delete_resource"].ConfirmSource)
	require.True(t, byName["kubernetes_list_connections"].BuiltIn)

	connectionViews, err := h.service.ListTools(Scope{"kubernetes", "prod"})
	require.NoError(t, err)
	require.Len(t, connectionViews, 2, "connection scope lists only connection-scoped tools")
	require.Equal(t, "inherited", connectionViews[0].EnabledSource)

	require.NoError(t, h.service.SetToolOverride(Scope{}, "kubernetes_delete_resource", ToolOverride{Enabled: new(true)}))
	require.NoError(t, h.service.SaveUserPreset("Ops"))
	presets := h.service.ListPresets()
	require.Equal(t, "Ops", presets[3].Name)
	require.Equal(t, 4, presets[3].ToolCount, "three read-only tools plus the overridden delete tool")
	require.Equal(t, "Ops", h.service.GetConfig().GlobalPreset)
	require.Equal(t, []string{"Ops"}, h.service.GetConfig().UserPresets)

	policies, err := h.service.ListConnectionPolicies()
	require.NoError(t, err)
	require.Len(t, policies, 2)
	require.Equal(t, "Production", policies[0].ConnectionName)
	require.Equal(t, "Kubernetes", policies[0].PluginName)
	require.True(t, policies[0].EffectiveAccess)
	require.Equal(t, "Ops", policies[0].EffectivePreset)

	require.ErrorContains(t, h.service.DeleteUserPreset("Ops"), "in use")
	require.ErrorContains(t, h.service.SetPort(80), "port must be")
	require.ErrorContains(t, h.service.ListToolsErr(Scope{PluginID: "kubernetes"}), "scope needs")
}

func (s *ServiceWrapper) ListToolsErr(scope Scope) error {
	_, err := s.ListTools(scope)
	return err
}

func TestRelayDisableStopsListener(t *testing.T) {
	h := newHarness(t)
	require.NoError(t, h.service.SetEnabled(false))
	status := h.service.GetStatus()
	require.False(t, status.Running)
	require.False(t, status.Enabled)
	_, err := http.Post(h.url, "application/json", nil)
	require.Error(t, err)
	require.NoError(t, h.service.RotateToken())
	require.NotEqual(t, h.token, h.service.GetConfig().Token)
}

func TestRelayToolChangeResyncs(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	h.tools.mu.Lock()
	delete(h.tools.plugins, "alpha")
	h.tools.mu.Unlock()
	for _, fn := range h.tools.listeners {
		fn()
	}
	require.NotContains(t, toolNames(t, session), "alpha_ping")
}

// arithmeticProvider performs a real computation after checking the scope
// contract received through the host controller.
type arithmeticProvider struct{}

func (arithmeticProvider) ListTools(*sdktypes.PluginContext) ([]sdktools.Descriptor, error) {
	schema := sdktools.ObjectSchema(map[string]any{"value": map[string]any{"type": "integer"}}, "value")
	return []sdktools.Descriptor{
		{Name: "plugin_next", Scope: sdktools.ScopePlugin, InputSchema: schema, Annotations: sdktools.Annotations{ReadOnly: new(true)}},
		{Name: "connection_next", Scope: sdktools.ScopeConnection, InputSchema: schema, Annotations: sdktools.Annotations{ReadOnly: new(true)}},
	}, nil
}

func (arithmeticProvider) CallTool(ctx *sdktypes.PluginContext, input sdktools.CallInput) (*sdktools.Result, error) {
	if input.Name == "connection_next" {
		if input.Route == nil || input.Route.Connection != "prod" || ctx.Connection == nil || ctx.Connection.ID != "prod" {
			return nil, errors.New("connection tool requires explicit prod route")
		}
	} else if input.Route != nil || ctx.Connection != nil {
		return nil, errors.New("plugin tool must not select a connection")
	}
	var args struct {
		Value int64 `json:"value"`
	}
	if err := json.Unmarshal(input.Arguments, &args); err != nil {
		return nil, err
	}
	return sdktools.TextResult(strconv.FormatInt(args.Value+1, 10)), nil
}

type arithmeticBackend struct {
	plugintypes.PluginBackend
}

func (arithmeticBackend) Dispense(string) (interface{}, error) { return arithmeticProvider{}, nil }
func (arithmeticBackend) NegotiatedVersion() int               { return 1 }

func TestRelayHTTPUsesHostControllerRoutesAndPreservesIntegers(t *testing.T) {
	ctrl := tools.NewController(logging.NewNop(), nil)
	require.NoError(t, ctrl.OnPluginStart("arithmetic", config.PluginMeta{ID: "arithmetic"}, arithmeticBackend{}))
	connections := &fakeConnections{connections: map[string][]sdktypes.Connection{
		"arithmetic": {{ID: "prod", Name: "Production"}},
	}}
	relay := New(Options{Log: logging.NewNop(), Store: &memoryStore{}, Tools: ctrl, Connections: connections, Version: "test", ShowConfirmation: func() error { return nil }})
	relay.listenAddr = "127.0.0.1:0"
	service := &ServiceWrapper{Relay: relay}
	require.NoError(t, relay.loadConfig())
	require.NoError(t, service.ApplyPreset(Scope{}, PresetAll))
	require.NoError(t, service.SetEnabled(true))
	t.Cleanup(relay.stopListener)
	h := &harness{url: service.GetStatus().Endpoint, token: service.GetConfig().Token}
	session := h.connect(t, nil)
	for _, scope := range []string{"plugin", "connection"} {
		t.Run(scope, func(t *testing.T) {
			args := map[string]any{"value": json.Number("9007199254740993")}
			if scope == "connection" {
				args[connectionIDArg] = "prod"
			}
			approveNext(t, service)
			text, failed := callText(t, session, "arithmetic_"+scope+"_next", args)
			require.False(t, failed, text)
			require.Equal(t, "9007199254740994", text)
		})
	}
}

func TestAuthenticatedPostRejectsOversizeBeforeDispatch(t *testing.T) {
	h := newHarness(t)
	reached := false
	handler := h.relay.auth(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	request := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(strings.Repeat("x", maxRequestBytes+1)))
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Authorization", "Bearer "+h.token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	require.Equal(t, http.StatusRequestEntityTooLarge, response.Code)
	require.False(t, reached)
}

func TestSameNameReplacementPublishesNewDescriptor(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	h.tools.mu.Lock()
	entry := h.tools.plugins["alpha"]
	entry.Tools[0].Description = "replacement process"
	entry.Generation++
	h.tools.plugins["alpha"] = entry
	h.tools.mu.Unlock()
	h.relay.resync()
	result, err := session.ListTools(context.Background(), nil)
	require.NoError(t, err)
	for _, tool := range result.Tools {
		if tool.Name == "alpha_ping" {
			require.Equal(t, "replacement process", tool.Description)
			return
		}
	}
	t.Fatal("replacement tool missing")
}

func TestStoppedRelayIgnoresLateInventory(t *testing.T) {
	h := newHarness(t)
	require.NoError(t, h.relay.ServiceShutdown())
	h.tools.mu.Lock()
	delete(h.tools.plugins, "alpha")
	h.tools.mu.Unlock()
	h.relay.resync()
	views, err := h.service.ListTools(Scope{})
	require.NoError(t, err)
	require.Len(t, views, 6, "late callback must not republish stopped inventory")
}

func TestScopedCustomToolReadinessUsesNativeState(t *testing.T) {
	h := newHarness(t)
	connections := h.relay.connections.(*fakeConnections)
	connections.states = map[string][]resource.ConnectionState{
		"kubernetes": {{Connection: sdktypes.Connection{ID: "prod"}, Readiness: sdktypes.ConnectionStatusDisconnected}},
	}
	views, err := h.service.ListTools(Scope{"kubernetes", "prod"})
	require.NoError(t, err)
	require.NotEmpty(t, views)
	for _, view := range views {
		require.Equal(t, "prod", view.ConnectionID)
		require.False(t, view.Ready)
		require.False(t, view.Listed)
	}
	connections.stateErr = errors.New("readiness unavailable")
	_, err = h.service.ListTools(Scope{"kubernetes", "prod"})
	require.ErrorContains(t, err, "readiness unavailable")
}

func TestArgumentsRejectDuplicateFieldsBeforeRoutingRemarshal(t *testing.T) {
	for _, raw := range []string{
		`{"connection_id":"first","connection_id":"second"}`,
		`{"input":{"name":"first","name":"second"}}`,
		`{"input":[{"name":"first","name":"second"}]}`,
	} {
		require.Error(t, rejectDuplicateFields([]byte(raw)))
	}
	require.NoError(t, rejectDuplicateFields([]byte(`{"value":9007199254740993,"input":{"name":"one"}}`)))
}

func TestPolicyChangeBeforeBindRequiresFreshBuiltinConsent(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	connections := h.relay.connections.(*fakeConnections)
	armed := make(chan struct{}, 1)
	armed <- struct{}{}
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	connections.stateHook = func() {
		select {
		case <-armed:
			close(entered)
			<-release
		default:
		}
	}
	done := make(chan error, 1)
	go func() {
		_, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "kubernetes_list_connections"})
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("builtin did not enter discovery")
	}
	require.NoError(t, h.service.SetToolOverride(Scope{}, "kubernetes_list_connections", ToolOverride{Confirm: new(true)}))
	unblock()
	require.Eventually(t, func() bool { return len(h.service.ListPendingConfirmations()) == 1 }, time.Second, time.Millisecond)
	pending := h.service.ListPendingConfirmations()
	require.NoError(t, h.service.ResolveConfirmation(pending[0].ID, true))
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("confirmed builtin did not finish")
	}
}

func TestBuiltinFencesResultAfterPolicyRevocation(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	connections := h.relay.connections.(*fakeConnections)
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	connections.listHook = func() { close(entered); <-release }
	type outcome struct {
		result *mcp.CallToolResult
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "kubernetes_list_connections"})
		done <- outcome{result, err}
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("builtin did not enter native listing")
	}
	require.NoError(t, h.service.SetConnectionAccess("kubernetes", "prod", AccessBlocked))
	unblock()
	select {
	case got := <-done:
		require.True(t, got.err != nil || (got.result != nil && got.result.IsError))
	case <-time.After(time.Second):
		t.Fatal("revoked builtin did not finish")
	}
}

func TestShutdownBoundsBlockedSessionClose(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	done := make(chan error, 1)
	go func() {
		done <- drainHTTPServer(ctx, &http.Server{}, func() { close(entered); <-release })
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("session drain did not start")
	}
	cancel()
	select {
	case err := <-done:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(time.Second):
		t.Fatal("blocked session close escaped shutdown deadline")
	}
}

func TestSaveGlobalPresetDoesNotPromoteConnectionGrant(t *testing.T) {
	h := newHarness(t)
	require.NoError(t, h.service.SetToolOverride(Scope{"kubernetes", "prod"}, "kubernetes_delete_resource", ToolOverride{Enabled: new(true)}))
	require.NoError(t, h.service.SaveUserPreset("GlobalOnly"))
	h.relay.mu.Lock()
	saved := h.relay.cfg.UserPresets["GlobalOnly"]
	h.relay.mu.Unlock()
	require.NotContains(t, saved.Tools, "kubernetes_delete_resource")
	require.Contains(t, saved.Tools, "alpha_ping")
}

func TestGeneratedViewUsesPinnedRoutePolicy(t *testing.T) {
	h := newHarness(t)
	const name = "resource_route_policy"
	require.NoError(t, h.service.SetToolOverride(Scope{}, name, ToolOverride{Enabled: new(false), Confirm: new(false)}))
	require.NoError(t, h.service.SetToolOverride(Scope{"kubernetes", "prod"}, name, ToolOverride{Enabled: new(true), Confirm: new(true)}))
	h.relay.mu.Lock()
	h.relay.catalog = append(h.relay.catalog, ToolInfo{
		MCPName: name, PluginID: "kubernetes", Scope: ScopeConnection, Status: StatusOK, ReadOnly: true,
		Resource: &ResourceBinding{PluginID: "kubernetes", Route: resourcev2.AccessRoute{Connection: "prod"}, Operation: "resource.Get"},
	})
	h.relay.mu.Unlock()
	views, err := h.service.ListTools(Scope{})
	require.NoError(t, err)
	for _, view := range views {
		if view.MCPName == name {
			require.Equal(t, "prod", view.ConnectionID)
			require.True(t, view.Enabled)
			require.True(t, view.Confirm)
			require.Equal(t, "override", view.EnabledSource)
			return
		}
	}
	t.Fatal("generated route view missing")
}

func TestActualHTTPCallsRetainOneHostSessionAfterInitializeResponse(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	var mu sync.Mutex
	var accepted []AuditEvent
	h.relay.authority.SetAudit(func(event AuditEvent) {
		if event.Outcome == "admitted" {
			mu.Lock()
			accepted = append(accepted, event)
			mu.Unlock()
		}
	})
	for range 2 {
		result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "kubernetes_list_connections"})
		require.NoError(t, err)
		require.False(t, result.IsError, "real HTTP session must outlive the initialize POST")
	}
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, accepted, 2)
	require.NotEmpty(t, accepted[0].SessionID)
	require.Equal(t, accepted[0].SessionID, accepted[1].SessionID)
	require.Equal(t, accepted[0].CredentialID, accepted[1].CredentialID)
}

func TestActualHTTPDeleteCancelsPendingConsentBeforeSDKDrain(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	callCtx, cancelCall := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelCall()
	callDone := make(chan struct{})
	go func() {
		defer close(callDone)
		_, _ = session.CallTool(callCtx, &mcp.CallToolParams{
			Name: "kubernetes_list_namespaces", Arguments: map[string]any{"connection_id": "prod"},
		})
	}()
	require.Eventually(t, func() bool { return len(h.service.ListPendingConfirmations()) == 1 }, 5*time.Second, time.Millisecond)
	pending := h.service.ListPendingConfirmations()[0]
	sessionID := ""
	for native := range h.relay.server.Sessions() {
		sessionID = native.ID()
	}
	require.NotEmpty(t, sessionID, "stateful HTTP must expose the host-issued SDK selector")
	deleteCtx, cancelDelete := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDelete()
	// The SDK consumes Header.Get; reject duplicates rather than bypassing
	// authority retirement while the SDK drains the first selected session.
	duplicate, err := http.NewRequestWithContext(deleteCtx, http.MethodDelete, h.url, nil)
	require.NoError(t, err)
	duplicate.Header.Set("Authorization", "Bearer "+h.token)
	duplicate.Header.Add("Mcp-Session-Id", sessionID)
	duplicate.Header.Add("Mcp-Session-Id", sessionID)
	rejected, err := http.DefaultClient.Do(duplicate)
	require.NoError(t, err)
	rejected.Body.Close()
	require.Equal(t, http.StatusBadRequest, rejected.StatusCode)
	require.Len(t, h.service.ListPendingConfirmations(), 1, "rejected selector must not enter SDK drain")
	request, err := http.NewRequestWithContext(deleteCtx, http.MethodDelete, h.url, nil)
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer "+h.token)
	request.Header.Set("Mcp-Session-Id", sessionID)
	deleteDone := make(chan error, 1)
	go func() {
		response, err := http.DefaultClient.Do(request)
		if err == nil {
			response.Body.Close()
			if response.StatusCode != http.StatusNoContent {
				err = fmt.Errorf("DELETE returned %d", response.StatusCode)
			}
		}
		deleteDone <- err
	}()
	require.Eventually(t, func() bool { return len(h.service.ListPendingConfirmations()) == 0 }, 3*time.Second, time.Millisecond)
	require.Error(t, h.service.ResolveConfirmation(pending.ID, true), "DELETE must make late approval impossible")
	select {
	case err := <-deleteDone:
		require.NoError(t, err)
	case <-deleteCtx.Done():
		t.Fatal("DELETE waited for consent instead of canceling it")
	}
	select {
	case <-callDone:
	case <-callCtx.Done():
		t.Fatal("deleted session retained its accepted RPC")
	}
	h.tools.mu.Lock()
	defer h.tools.mu.Unlock()
	require.Empty(t, h.tools.calls, "deleted consent must not dispatch native tools")
}

func TestActualHTTPRejectsNullObjectArguments(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	_, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "kubernetes_list_connections", Arguments: json.RawMessage(`null`),
	})
	require.Error(t, err)
}

func TestActualHTTPNativeFailureIsSafeToolErrorNotCancellation(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	h.tools.mu.Lock()
	h.tools.callErr = errors.New("private native diagnostic")
	h.tools.mu.Unlock()
	approveNext(t, h.service)
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "alpha_ping", Arguments: map[string]any{}})
	require.NoError(t, err, "authority cleanup cancellation must not replace a native error")
	require.True(t, result.IsError)
	require.Len(t, result.Content, 1)
	require.Equal(t, "tool invocation failed", result.Content[0].(*mcp.TextContent).Text)
	h.tools.mu.Lock()
	firstCalls := len(h.tools.calls)
	h.tools.callErr = nil
	h.tools.mu.Unlock()
	require.Equal(t, 1, firstCalls, "regression must reach real provider dispatch")
	approveNext(t, h.service)
	next, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "alpha_ping", Arguments: map[string]any{}})
	require.NoError(t, err, "a provider error must not retire the actual MCP session")
	require.False(t, next.IsError)
	require.Equal(t, map[string]any{"pong": true}, next.StructuredContent)
	h.tools.mu.Lock()
	defer h.tools.mu.Unlock()
	require.Len(t, h.tools.calls, 2)
}

func TestActualHTTPCallerCancellationStillCancelsNativeWork(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	entered, cancelled := make(chan struct{}), make(chan struct{})
	h.tools.mu.Lock()
	h.tools.callHook = func(ctx context.Context) error {
		close(entered)
		<-ctx.Done()
		close(cancelled)
		return ctx.Err()
	}
	h.tools.mu.Unlock()
	approveNext(t, h.service)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "alpha_ping", Arguments: map[string]any{}})
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("native dispatch did not start")
	}
	cancel()
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("caller cancellation did not end the RPC")
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("caller cancellation did not reach native work")
	}
}
