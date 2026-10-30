package mcprelay

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
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

func (f *fakeTools) CallTool(_ context.Context, pluginID string, connection *sdktypes.Connection, name string, arguments json.RawMessage) (*sdktools.Result, error) {
	f.mu.Lock()
	f.calls = append(f.calls, recordedCall{pluginID: pluginID, connection: connection, name: name, arguments: arguments})
	f.mu.Unlock()
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
}

func (f *fakeConnections) ListAllConnections(context.Context) (map[string][]sdktypes.Connection, error) {
	return f.connections, nil
}

func (f *fakeConnections) ListConnections(_ context.Context, pluginID string) ([]sdktypes.Connection, error) {
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
				{Name: "list_namespaces", Description: "lists", Scope: sdktools.ScopeConnection, InputSchema: sdktools.ObjectSchema(nil), Annotations: sdktools.Annotations{ReadOnly: true}},
				{Name: "delete_resource", Description: "deletes", Scope: sdktools.ScopeConnection, InputSchema: sdktools.ObjectSchema(map[string]any{"name": map[string]any{"type": "string"}}, "name"), Annotations: sdktools.Annotations{Destructive: true}},
			},
		},
		"alpha": {
			Meta:  config.PluginMeta{ID: "alpha", Name: "Alpha"},
			Tools: []sdktools.Descriptor{{Name: "ping", Scope: sdktools.ScopePlugin, InputSchema: sdktools.ObjectSchema(nil), Annotations: sdktools.Annotations{ReadOnly: true}}},
		},
	}}
	connections := &fakeConnections{connections: map[string][]sdktypes.Connection{
		"kubernetes": {{ID: "prod", Name: "Production"}, {ID: "test", Name: "Test cluster"}},
	}}
	store := &memoryStore{}
	relay := New(Options{Log: logging.NewNop(), Store: store, Tools: fakeTools, Connections: connections, Version: "test"})
	relay.listenAddr = "127.0.0.1:0"
	service := &ServiceWrapper{Relay: relay}

	require.NoError(t, relay.loadConfig())
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
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	require.NoError(t, err)
	require.NotEmpty(t, result.Content)
	text, ok := result.Content[0].(*mcp.TextContent)
	require.True(t, ok)
	return text.Text, result.IsError
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

	// Confirm override off: the call goes straight through.
	require.NoError(t, h.service.SetToolOverride(Scope{"kubernetes", "test"}, "kubernetes_delete_resource", ToolOverride{Confirm: new(false)}))
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

	text, isError = callText(t, session, "kubernetes_list_namespaces", map[string]any{"connection_id": "test"})
	require.False(t, isError, text)

	// Plugin-scoped tool with structured content.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
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
	require.Equal(t, "preset", byName["kubernetes_list_namespaces"].EnabledSource)
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
		{Name: "plugin_next", Scope: sdktools.ScopePlugin, InputSchema: schema, Annotations: sdktools.Annotations{ReadOnly: true}},
		{Name: "connection_next", Scope: sdktools.ScopeConnection, InputSchema: schema, Annotations: sdktools.Annotations{ReadOnly: true}},
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
	ctrl := tools.NewController(logging.NewNop())
	require.NoError(t, ctrl.OnPluginStart("arithmetic", config.PluginMeta{ID: "arithmetic"}, arithmeticBackend{}))
	connections := &fakeConnections{connections: map[string][]sdktypes.Connection{
		"arithmetic": {{ID: "prod", Name: "Production"}},
	}}
	relay := New(Options{Log: logging.NewNop(), Store: &memoryStore{}, Tools: ctrl, Connections: connections, Version: "test"})
	relay.listenAddr = "127.0.0.1:0"
	service := &ServiceWrapper{Relay: relay}
	require.NoError(t, relay.loadConfig())
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
			text, failed := callText(t, session, "arithmetic_"+scope+"_next", args)
			require.False(t, failed, text)
			require.Equal(t, "9007199254740994", text)
		})
	}
}
