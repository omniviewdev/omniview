// Package mcprelay serves one Streamable HTTP MCP endpoint on loopback and
// relays tool calls to plugins that expose the SDK "tools" capability.
package mcprelay

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/tools"
	"github.com/omniviewdev/omniview/internal/devsession"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

const (
	toolCallTimeout   = 2 * time.Minute
	readHeaderTimeout = 5 * time.Second
	shutdownTimeout   = 5 * time.Second
	listenHost        = "127.0.0.1"
	mcpPath           = "/mcp"
	keepAliveInterval = 30 * time.Second
	maxRequestBytes   = 1 << 20
	bodyReadTimeout   = 5 * time.Second

	instructions = "Omniview exposes tools from installed plugins. Tool names are `<plugin>_<tool>`. " +
		"Tools that take `connection_id` act on one plugin connection (for example one Kubernetes cluster); " +
		"call `<plugin>_list_connections` first to get IDs and the tools permitted on each connection. " +
		"Calls that the user has not permitted return an error result; pick another connection or ask the user."
)

// ConfigStore persists the relay document.
type ConfigStore interface {
	SaveMCPRelayConfig(cfg any) error
	LoadMCPRelayConfig(out any) (bool, error)
}

var _ ConfigStore = (*settingsstore.Store)(nil)

// Options are the relay dependencies.
type Options struct {
	Log                 logging.Logger
	Store               ConfigStore
	Tools               tools.Controller
	Connections         resource.Service
	Version             string
	Authority           *Authority
	Boundary            *invocation.Boundary
	ShowConfirmation    func() error
	Logs                ResourceLogsReader
	Metrics             ResourceMetricsReader
	Graph               ResourceGraphReader
	BorrowedConnections func(context.Context, string, string, bool) ([]sdktypes.Connection, error)
}

// Relay owns the MCP server, the policy document and the HTTP listener.
type Relay struct {
	log                  logging.Logger
	store                ConfigStore
	tools                tools.Controller
	connections          resource.Service
	server               *mcp.Server
	app                  *application.App
	authority            *Authority
	showConfirmation     func() error
	logs                 ResourceLogsReader
	metrics              ResourceMetricsReader
	graph                ResourceGraphReader
	borrowedConnections  func(context.Context, string, string, bool) ([]sdktypes.Connection, error)
	transitionMu         sync.Mutex
	resyncMu             sync.Mutex
	stopped              bool
	listenerCancel       context.CancelFunc
	unsubscribeInventory func()
	lifecycleCtx         context.Context
	lifecycleCancel      context.CancelFunc
	unsubscribeTools     func()

	mu                    sync.Mutex // guards cfg, catalog, registered, listener state
	cfg                   Config
	loaded                bool
	catalog               []ToolInfo
	configRevision        uint64
	inventoryReady        bool
	discoveryDirty        bool
	discoveryRunning      bool
	discoveredConnections map[string][]string
	configuredConnections map[string][]string
	discoveredBorrowed    map[string][]string
	registered            map[string]bool
	published             map[string]ToolInfo
	listener              net.Listener
	httpServer            *http.Server
	listenErr             string
	listenAddr            string // tests set "127.0.0.1:0"; empty means the configured port

	confirmMu sync.Mutex
	pending   map[string]*pendingEntry
}

// New builds the relay and subscribes to tool changes. Call ServiceStartup
// before serving.
func New(o Options) *Relay {
	r := &Relay{
		log:         o.Log.Named("MCPRelay"),
		store:       o.Store,
		tools:       o.Tools,
		connections: o.Connections,
		registered:  map[string]bool{},
		pending:     map[string]*pendingEntry{},
	}
	r.authority = o.Authority
	if r.authority == nil {
		r.authority = NewAuthority()
	}
	r.showConfirmation = o.ShowConfirmation
	r.logs = o.Logs
	r.metrics = o.Metrics
	r.graph = o.Graph
	r.borrowedConnections = o.BorrowedConnections
	r.lifecycleCtx, r.lifecycleCancel = context.WithCancel(context.Background())
	r.authority.SetAudit(func(event AuditEvent) {
		r.log.Infow(context.Background(), "MCP invocation audit", "event", event)
	})
	r.server = mcp.NewServer(
		&mcp.Implementation{Name: "omniview", Version: o.Version},
		&mcp.ServerOptions{Instructions: instructions, KeepAlive: keepAliveInterval},
	)
	if source, ok := o.Connections.(interface{ OnInventoryChange(func()) func() }); ok {
		r.unsubscribeInventory = source.OnInventoryChange(r.inventoryChanged)
	}
	if source, ok := o.Tools.(interface{ Subscribe(func()) func() }); ok {
		r.unsubscribeTools = source.Subscribe(r.toolsChanged)
	} else {
		o.Tools.OnChange(r.toolsChanged)
	}
	return r
}

// ServiceStartup loads the document, registers tools and starts the listener
// when enabled.
func (r *Relay) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	r.app = application.Get()
	if err := r.loadConfig(); err != nil {
		return err
	}
	r.resync()
	r.restartListener()
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.lifecycleCtx.Done():
				return
			case <-ticker.C:
				r.requestDiscovery()
			}
		}
	}()
	return nil
}

// ServiceShutdown stops the listener.
func (r *Relay) ServiceShutdown() error {
	r.lifecycleCancel()
	r.mu.Lock()
	r.stopped = true
	r.authority.Retire()
	r.mu.Unlock()
	r.resyncMu.Lock()
	r.resyncMu.Unlock()
	if r.unsubscribeInventory != nil {
		r.unsubscribeInventory()
	}
	if r.unsubscribeTools != nil {
		r.unsubscribeTools()
	}
	r.stopListener()
	return nil
}

// loadConfig reads the document or creates the default one. Without a
// settings store (persistence disabled app-wide) the relay runs in memory.
func (r *Relay) loadConfig() error {
	var cfg Config
	found := false
	if r.store != nil {
		var err error
		found, err = r.store.LoadMCPRelayConfig(&cfg)
		if err != nil {
			return fmt.Errorf("mcp relay: %w", err)
		}
	} else {
		r.log.Warnw(context.Background(), "mcp relay: settings persistence disabled; changes are not saved")
	}
	if !found {
		token, err := devsession.GenerateToken()
		if err != nil {
			return fmt.Errorf("mcp relay: generate token: %w", err)
		}
		cfg = DefaultConfig(string(token))
		if err = r.save(cfg); err != nil {
			return err
		}
	}
	cfg.normalize()
	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("mcp relay: stored config is invalid: %w", err)
	}
	r.mu.Lock()
	r.cfg = cfg
	r.loaded = true
	r.authority.UpdatePolicy(cfg)
	r.mu.Unlock()
	return nil
}

func (r *Relay) save(cfg Config) error {
	if r.store == nil {
		return nil
	}
	if err := r.store.SaveMCPRelayConfig(cfg); err != nil {
		return fmt.Errorf("mcp relay: save config: %w", err)
	}
	return nil
}

func (r *Relay) emit(name string, payload any) {
	if r.app != nil {
		r.app.Event.Emit(name, payload)
	}
}

// ---- listener ----

func (r *Relay) startListenerLocked() {
	if r.listener != nil {
		return
	}
	addr := r.listenAddr
	if addr == "" {
		addr = net.JoinHostPort(listenHost, strconv.Itoa(r.cfg.Port))
	}
	listener, err := net.Listen("tcp4", addr)
	if err != nil {
		r.listenErr = err.Error()
		r.log.Errorw(context.Background(), "mcp relay listen failed", "error", err, "port", r.cfg.Port)
		return
	}
	mux := http.NewServeMux()
	mux.Handle(mcpPath, r.auth(mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return r.server },
		&mcp.StreamableHTTPOptions{Stateless: false},
	)))
	listenerCtx, listenerCancel := context.WithCancel(context.Background())
	server := &http.Server{Handler: mux, ReadHeaderTimeout: readHeaderTimeout,
		BaseContext: func(net.Listener) context.Context { return listenerCtx }}
	r.listenerCancel = listenerCancel
	r.listener = listener
	r.httpServer = server
	r.listenErr = ""
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			r.log.Errorw(context.Background(), "mcp relay server stopped", "error", serveErr)
			r.mu.Lock()
			if r.httpServer != server {
				r.mu.Unlock()
				return
			}
			r.listener = nil
			r.httpServer = nil
			r.listenErr = serveErr.Error()
			listenerCancel()
			r.listenerCancel = nil
			r.authority.Retire()
			status := r.statusLocked()
			r.mu.Unlock()
			r.emit(EventStatus, status)
		}
	}()
	r.log.Infow(context.Background(), "mcp relay listening", "endpoint", r.endpointLocked())
}

// stopListener detaches the HTTP server under the lock and shuts it down
// outside it, so in-flight handlers that need the lock can finish.
func (r *Relay) stopListener() {
	r.transitionMu.Lock()
	defer r.transitionMu.Unlock()
	r.stopListenerOwned()
}

func (r *Relay) stopListenerOwned() {
	r.mu.Lock()
	server := r.httpServer
	cancel := r.listenerCancel
	r.listenerCancel = nil
	r.httpServer = nil
	r.listener = nil
	status := r.statusLocked()
	r.authority.Retire()
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if server == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := drainHTTPServer(ctx, server, func() {
		var sessions sync.WaitGroup
		for session := range r.server.Sessions() {
			sessions.Add(1)
			go func() { defer sessions.Done(); _ = session.Close() }()
		}
		sessions.Wait()
	}); err != nil {
		r.log.Warnw(ctx, "mcp relay shutdown", "error", err)
	}
	r.emit(EventStatus, status)
}

// restartListener applies the current Enabled/Port/Token state.
func (r *Relay) restartListener() {
	r.transitionMu.Lock()
	defer r.transitionMu.Unlock()
	r.stopListenerOwned()
	r.mu.Lock()
	if r.cfg.Enabled && !r.stopped {
		r.startListenerLocked()
	} else {
		r.listenErr = ""
	}
	status := r.statusLocked()
	r.mu.Unlock()
	r.emit(EventStatus, status)
}

func (r *Relay) endpointLocked() string {
	if r.listener == nil {
		return "http://" + net.JoinHostPort(listenHost, strconv.Itoa(r.cfg.Port)) + mcpPath
	}
	return "http://" + r.listener.Addr().String() + mcpPath
}

func (r *Relay) statusLocked() Status {
	return Status{
		Enabled:  r.cfg.Enabled,
		Running:  r.listener != nil,
		Endpoint: r.endpointLocked(),
		Error:    r.listenErr,
	}
}

// auth enforces loopback peer, no Origin header and one matching bearer token.
func (r *Relay) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		peer, _, err := net.SplitHostPort(req.RemoteAddr)
		if err != nil || peer != listenHost || len(req.Header.Values("Origin")) != 0 {
			unauthorized(w)
			return
		}
		r.mu.Lock()
		expected := "Bearer " + r.cfg.Token
		authorization := req.Header.Get("Authorization")
		if len(req.Header.Values("Authorization")) != 1 ||
			subtle.ConstantTimeCompare([]byte(authorization), []byte(expected)) != 1 {
			r.mu.Unlock()
			unauthorized(w)
			return
		}
		req = req.WithContext(r.authority.Authenticate(req.Context()))
		r.mu.Unlock()
		if len(req.Header.Values("Mcp-Session-Id")) > 1 {
			http.Error(w, "multiple session selectors are not permitted", http.StatusBadRequest)
			return
		}
		if req.Method == http.MethodDelete {
			// The header only selects an existing SDK-owned native session.
			// Bearer verification and the authority epoch still authorize closure.
			selected := req.Header.Get("Mcp-Session-Id")
			if selected != "" {
				for session := range r.server.Sessions() {
					if session.ID() == selected {
						if err := r.authority.CloseSession(req.Context(), session); err != nil {
							unauthorized(w)
							return
						}
						break
					}
				}
			}
		}
		if req.Method == http.MethodPost {
			controller := http.NewResponseController(w)
			_ = controller.SetReadDeadline(time.Now().Add(bodyReadTimeout))
			body, err := io.ReadAll(http.MaxBytesReader(w, req.Body, maxRequestBytes))
			_ = req.Body.Close()
			_ = controller.SetReadDeadline(time.Time{})
			if err != nil {
				var oversized *http.MaxBytesError
				if errors.As(err, &oversized) {
					http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
				} else {
					http.Error(w, "request body unavailable", http.StatusRequestTimeout)
				}
				return
			}
			req.Body = io.NopCloser(bytes.NewReader(body))
		}
		next.ServeHTTP(w, req)
	})
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", "Bearer")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
}

// ---- tool registration ----

// allowedConnections lists, per plugin, the connection IDs the policy lets
// the relay target.
func (r *Relay) allowedConnections(parent context.Context, cfg *Config) map[string][]string {
	if r.connections == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(invocation.HostContext(parent), 10*time.Second)
	defer cancel()
	all, err := r.connections.GetAllConnectionStates(ctx)
	if err != nil {
		r.log.Warnw(context.Background(), "mcp relay: list connections", "error", err)
		return nil
	}
	out := make(map[string][]string, len(all))
	for pluginID, connections := range all {
		for _, state := range connections {
			connection := state.Connection
			if state.ReadinessError == nil && state.Readiness == sdktypes.ConnectionStatusConnected && cfg.ConnectionAccess(pluginID, connection.ID) {
				out[pluginID] = append(out[pluginID], connection.ID)
			}
		}
	}
	return out
}

// listedConnections retains configured borrowed routes even when stopped.
func (r *Relay) listedConnections(ctx context.Context, cfg *Config, tool ToolInfo, local []string) []string {
	if tool.ConnectionOwner == "" || r.borrowedConnections == nil {
		return local
	}
	connections, err := r.borrowedConnections(ctx, tool.PluginID, tool.ConnectionOwner, false)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(connections))
	for _, connection := range connections {
		if cfg.ConnectionAccess(tool.PluginID, connection.ID) {
			out = append(out, connection.ID)
		}
	}
	return out
}

// requestDiscovery coalesces notifications without blocking their producer.
func (r *Relay) requestDiscovery() {
	r.mu.Lock()
	if !r.loaded || r.stopped {
		r.mu.Unlock()
		return
	}
	r.discoveryDirty = true
	if r.discoveryRunning {
		r.mu.Unlock()
		return
	}
	r.discoveryRunning = true
	r.resyncMu.Lock()
	r.mu.Unlock()
	go r.discoverLoop()
}

// resync provides synchronous initial discovery and explicit refreshes.
func (r *Relay) resync() {
	r.mu.Lock()
	if !r.loaded || r.stopped {
		r.mu.Unlock()
		return
	}
	r.discoveryDirty = true
	if r.discoveryRunning {
		r.mu.Unlock()
		return
	}
	r.discoveryRunning = true
	r.resyncMu.Lock()
	r.mu.Unlock()
	r.discoverLoop()
}

func (r *Relay) discoverLoop() {
	for {
		r.mu.Lock()
		if r.stopped || !r.discoveryDirty {
			r.discoveryRunning = false
			r.resyncMu.Unlock()
			r.mu.Unlock()
			return
		}
		r.discoveryDirty = false
		revision := r.configRevision
		r.mu.Unlock()
		r.discover(revision)
	}
}

func (r *Relay) discover(revision uint64) {
	catalog := BuildCatalog(r.tools.ListAll())
	catalog = append(catalog, genericKubernetesTools()...)
	listingCtx := invocation.HostContext(r.lifecycleCtx)
	discoveryCtx, discoveryCancel := context.WithTimeout(listingCtx, 10*time.Second)
	defer discoveryCancel()
	connected := map[string][]string{}
	configured := map[string][]string{}
	if r.connections != nil {
		profiles, err := r.connections.ListAllConnections(discoveryCtx)
		if err == nil {
			for pluginID, entries := range profiles {
				for _, connection := range entries {
					configured[pluginID] = append(configured[pluginID], connection.ID)
				}
			}
		}
		states, err := r.connections.GetAllConnectionStates(discoveryCtx)
		if err == nil {
			var routes []ResourceRoute
			for pluginID, entries := range states {
				for _, state := range entries {
					if state.ReadinessError == nil && state.Readiness == sdktypes.ConnectionStatusConnected {
						connected[pluginID] = append(connected[pluginID], state.Connection.ID)
						routes = append(routes, ResourceRoute{PluginID: pluginID, PluginName: pluginID,
							Route: resourcev2.AccessRoute{Connection: state.Connection.ID}})
					}
				}
			}
			readers := ResourceReaders{Logs: r.logs, Metrics: r.metrics, Graph: r.graph}
			generated, discoveryErr := BuildResourceCatalogWithReaders(discoveryCtx, r.connections, routes, readers)
			catalog = append(catalog, generated...)
			if discoveryErr != nil {
				r.log.Warnw(discoveryCtx, "resource tool discovery incomplete", "error", discoveryErr)
			}
		}
		builtins := map[string]bool{}
		for _, tool := range catalog {
			if tool.BuiltIn {
				builtins[tool.PluginID] = true
			}
		}
		for _, tool := range catalog {
			if (tool.Resource != nil || isGenericKubernetesTool(tool)) && !builtins[tool.PluginID] {
				builtins[tool.PluginID] = true
				catalog = append(catalog, listConnectionsInfo(tool.PluginID, tool.PluginName))
			}
		}
	}

	finalizeCatalog(catalog)
	borrowed := map[string][]string{}
	for _, tool := range catalog {
		if tool.ConnectionOwner == "" || r.borrowedConnections == nil {
			continue
		}
		key := tool.PluginID + "\x00" + tool.ConnectionOwner
		if _, exists := borrowed[key]; exists {
			continue
		}
		borrowed[key] = nil
		connections, err := r.borrowedConnections(listingCtx, tool.PluginID, tool.ConnectionOwner, false)
		if err == nil {
			for _, connection := range connections {
				borrowed[key] = append(borrowed[key], connection.ID)
			}
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.stopped || r.discoveryDirty {
		return
	}
	if r.configRevision != revision {
		// Discovery is policy-independent, but publication must use a fresh fence.
		// Keep the inventory and project only the current revision.
		revision = r.configRevision
	}
	catalogChanged := !reflect.DeepEqual(r.catalog, catalog)
	r.catalog = catalog
	r.inventoryReady = true
	r.discoveredConnections = connected
	r.configuredConnections = configured
	r.discoveredBorrowed = borrowed
	if catalogChanged {
		r.authority.UpdateCatalog(catalog)
	}
	r.projectPolicyLocked(revision, catalogChanged)
}

// toolsChanged publishes the cheap native-tool snapshot before returning.
// Resource discovery remains coalesced, but removed or replaced native tools
// must not retain callable handlers while an unrelated resource scan runs.
func (r *Relay) toolsChanged() {
	catalog := BuildCatalog(r.tools.ListAll())
	catalog = append(catalog, genericKubernetesTools()...)
	r.mu.Lock()
	if !r.loaded || r.stopped {
		r.mu.Unlock()
		return
	}
	r.discoveryDirty = true
	builtins := map[string]bool{}
	for _, tool := range catalog {
		if tool.BuiltIn {
			builtins[tool.PluginID] = true
		}
	}
	for _, tool := range catalog {
		if isGenericKubernetesTool(tool) && !builtins[tool.PluginID] {
			builtins[tool.PluginID] = true
			catalog = append(catalog, listConnectionsInfo(tool.PluginID, tool.PluginName))
		}
	}
	for _, tool := range r.catalog {
		if tool.Resource == nil {
			continue
		}
		catalog = append(catalog, tool)
		if !builtins[tool.PluginID] {
			builtins[tool.PluginID] = true
			catalog = append(catalog, listConnectionsInfo(tool.PluginID, tool.PluginName))
		}
	}
	finalizeCatalog(catalog)
	changed := !reflect.DeepEqual(r.catalog, catalog)
	r.catalog = catalog
	if changed {
		r.authority.UpdateCatalog(catalog)
	}
	r.projectPolicyLocked(r.configRevision, changed)
	r.mu.Unlock()
	r.requestDiscovery()
}

func finalizeCatalog(catalog []ToolInfo) {
	sort.SliceStable(catalog, func(i, j int) bool {
		if catalog[i].MCPName != catalog[j].MCPName {
			return catalog[i].MCPName < catalog[j].MCPName
		}
		return catalog[i].PluginID < catalog[j].PluginID
	})
	counts := make(map[string]int, len(catalog))
	builtinNames := make(map[string]bool)
	for _, tool := range catalog {
		if tool.Status == StatusOK || tool.Status == StatusConflict {
			counts[tool.MCPName]++
			if tool.BuiltIn && tool.Status == StatusOK {
				builtinNames[tool.MCPName] = true
			}
		}
	}
	for i := range catalog {
		tool := &catalog[i]
		if tool.Status == StatusOK && counts[tool.MCPName] > 1 && (!tool.BuiltIn || !builtinNames[tool.MCPName]) {
			tool.Status = StatusConflict
		}
	}
}

// projectPolicyLocked performs no discovery or external inventory reads.
// Holding mu through registration prevents stale publications after retirement.
func (r *Relay) projectPolicyLocked(revision uint64, catalogChanged bool) {
	if r.stopped || revision != r.configRevision {
		return
	}
	desired := map[string]ToolInfo{}
	allowedByRoute := map[string][]string{}
	for _, tool := range r.catalog {
		key := tool.PluginID
		ids := r.discoveredConnections[tool.PluginID]
		if isGenericKubernetesTool(tool) {
			key += "\x00configured"
			ids = r.configuredConnections[tool.PluginID]
		}
		if tool.ConnectionOwner != "" {
			key += "\x00" + tool.ConnectionOwner
			ids = r.discoveredBorrowed[key]
		}
		allowed, exists := allowedByRoute[key]
		if !exists {
			allowed = make([]string, 0, len(ids))
			for _, id := range ids {
				if r.cfg.ConnectionAccess(tool.PluginID, id) {
					allowed = append(allowed, id)
				}
			}
			allowedByRoute[key] = allowed
		}
		if tool.Status == StatusOK && r.cfg.Listed(tool, allowed) {
			desired[tool.MCPName] = tool
		}
	}
	if r.published == nil {
		r.published = make(map[string]ToolInfo)
	}
	var removed []string
	for name := range r.registered {
		if _, ok := desired[name]; !ok {
			removed = append(removed, name)
			delete(r.registered, name)
			delete(r.published, name)
		}
	}
	var added []ToolInfo
	for name, tool := range desired {
		r.registered[name] = true
		if prior, exists := r.published[name]; !exists || (catalogChanged && !reflect.DeepEqual(prior, tool)) {
			r.published[name] = tool
			added = append(added, tool)
		}
	}
	sort.Slice(added, func(i, j int) bool { return added[i].MCPName < added[j].MCPName })
	if len(removed) > 0 {
		r.server.RemoveTools(removed...)
	}
	for _, tool := range added {
		r.server.AddTool(mcpTool(tool), r.handler(tool))
	}
	if catalogChanged || len(removed) > 0 || len(added) > 0 {
		r.emit(EventToolsChanged, "")
	}
}

func mcpTool(t ToolInfo) *mcp.Tool {
	tool := &mcp.Tool{
		Name:        t.MCPName,
		Description: t.Description,
		InputSchema: t.InputSchema,
		Annotations: &mcp.ToolAnnotations{
			Title:           t.Title,
			ReadOnlyHint:    t.ReadOnly,
			DestructiveHint: new(t.Destructive),
			IdempotentHint:  t.Idempotent,
			OpenWorldHint:   new(t.OpenWorld),
		},
	}
	if t.OutputSchema != nil {
		tool.OutputSchema = t.OutputSchema
	}
	return tool
}

func errorResult(message string) *mcp.CallToolResult {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: message}}}
}

// ---- tool calls ----

func (r *Relay) handler(t ToolInfo) mcp.ToolHandler {
	return func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		requestCtx := ctx
		var sessionErr error
		ctx, sessionErr = r.authority.Session(ctx, req.Session)
		if sessionErr != nil {
			return errorResult("authenticated session is unavailable"), nil
		}
		args := map[string]any{}
		if len(req.Params.Arguments) > 0 {
			if err := rejectDuplicateFields(req.Params.Arguments); err != nil {
				return nil, err
			}
			decoder := json.NewDecoder(bytes.NewReader(req.Params.Arguments))
			decoder.UseNumber()
			if err := decoder.Decode(&args); err != nil {
				return nil, fmt.Errorf("arguments must be a JSON object: %w", err)
			}
			if args == nil {
				return nil, errors.New("arguments must be a JSON object")
			}
			var trailing any
			if err := decoder.Decode(&trailing); err != io.EOF {
				return nil, errors.New("arguments must contain one JSON object")
			}
		}

		r.mu.Lock()
		cfg := r.cfg
		r.mu.Unlock()
		var allowed []string
		if t.Scope == ScopeConnection && t.ConnectionOwner == "" {
			if isGenericKubernetesTool(t) {
				r.mu.Lock()
				allowed = append(allowed, r.configuredConnections[t.PluginID]...)
				r.mu.Unlock()
			} else {
				allowed = r.allowedConnections(ctx, &cfg)[t.PluginID]
			}
		}
		if !cfg.Listed(t, r.listedConnections(ctx, &cfg, t, allowed)) {
			return errorResult(fmt.Sprintf("tool %s is disabled in Omniview AI Tools settings", t.MCPName)), nil
		}

		var connection *sdktypes.Connection
		connectionID := ""
		if t.Scope == ScopeConnection {
			id, ok := args[connectionIDArg].(string)
			if !ok || id == "" {
				return errorResult(fmt.Sprintf("%s is required; call %s_%s", connectionIDArg, t.PluginID, listConnectionsTool)), nil
			}
			if t.Resource != nil && id != t.Resource.Route.Connection {
				return errorResult("connection does not match advertised resource route"), nil
			}
			var resolved sdktypes.Connection
			if t.ConnectionOwner != "" {
				if r.borrowedConnections == nil {
					return errorResult("OWNER_UNAVAILABLE: The connection owner is unavailable."), nil
				}
				configured, err := r.borrowedConnections(ctx, t.PluginID, t.ConnectionOwner, false)
				if err != nil {
					return errorResult("OWNER_UNAVAILABLE: The connection owner is unavailable."), nil
				}
				found := false
				for _, candidate := range configured {
					if candidate.ID == id {
						resolved, found = candidate, true
						break
					}
				}
				if !found {
					return errorResult("GRANT_DENIED: Cross-plugin connection access is not permitted."), nil
				}
			} else {
				var err error
				resolved, err = r.connections.GetConnection(ctx, t.PluginID, id)
				if err != nil {
					return errorResult(fmt.Sprintf("unknown connection %s for plugin %s", id, t.PluginID)), nil
				}
			}
			if !cfg.ConnectionEnabled(t.PluginID, id, t) {
				return errorResult(fmt.Sprintf(
					"tool %s is not permitted on connection %s (%s) by the Omniview AI Tools policy",
					t.MCPName, resolved.Name, id,
				)), nil
			}
			delete(args, connectionIDArg)
			connection = &resolved
			connectionID = id
		}

		argsJSON, err := json.Marshal(args)
		if err != nil {
			return nil, err
		}
		ctx, err = r.authority.Bind(ctx, t, connectionID, argsJSON)
		if err != nil {
			return errorResult("tool authorization expired"), nil
		}

		requiresConfirmation, err := r.authority.Confirm(ctx)
		if err != nil {
			return errorResult("tool authorization expired"), nil
		}
		if requiresConfirmation {
			payload := PendingConfirmation{
				MCPName:       t.MCPName,
				PluginID:      t.PluginID,
				PluginName:    t.PluginName,
				ConnectionID:  connectionID,
				ArgumentsJSON: string(argsJSON),
			}
			if t.ConnectionOwner != "" {
				payload.PluginName += " via " + t.ConnectionOwner
			}
			if connection != nil {
				payload.ConnectionName = connection.Name
			}
			approved, reason := r.awaitConfirmation(ctx, payload)
			if !approved {
				switch reason {
				case "timeout":
					return errorResult("confirmation timed out after 2 minutes"), nil
				case "unavailable":
					return errorResult("confirmation window is unavailable"), nil
				case "cancelled":
					if requestCtx.Err() != nil {
						return nil, requestCtx.Err()
					}
					return errorResult("tool authorization expired"), nil
				default:
					return errorResult("the user denied this call"), nil
				}
			}
			if err := r.authority.Approve(ctx); err != nil {
				return errorResult("tool authorization expired"), nil
			}
		}

		callCtx, cancel := context.WithTimeout(ctx, toolCallTimeout)
		defer cancel()
		var result *sdktools.Result
		var builtinResult *mcp.CallToolResult
		err = r.authority.Dispatch(callCtx, func(dispatchCtx context.Context) error {
			var callErr error
			if isGenericKubernetesTool(t) {
				builtinResult, callErr = r.dispatchGenericKubernetes(dispatchCtx, t, connection, argsJSON)
				return callErr
			}
			if t.BuiltIn {
				policy, err := r.authority.Policy(dispatchCtx)
				if err != nil {
					return err
				}
				builtinResult, err = r.listConnections(dispatchCtx, &policy, t)
				return err
			}
			if t.Resource != nil {
				value, resourceErr := DispatchResource(dispatchCtx, r.connections, t, argsJSON)
				if resourceErr != nil {
					return resourceErr
				}
				encoded, encodeErr := json.Marshal(value)
				if encodeErr != nil {
					return encodeErr
				}
				result = &sdktools.Result{StructuredContent: encoded}
				return nil
			}
			result, callErr = r.tools.CallTool(tools.WithGeneration(dispatchCtx, t.Generation), t.PluginID, connection, t.Name, argsJSON)
			return callErr
		})
		if err != nil {
			if requestCtx.Err() != nil {
				return nil, requestCtx.Err()
			}
			switch resourcev2.ErrorCode(err) {
			case "CONNECTION_NOT_STARTED":
				return errorResult("CONNECTION_NOT_STARTED: The owner connection is not started."), nil
			case "OWNER_UNAVAILABLE":
				return errorResult("OWNER_UNAVAILABLE: The connection owner is unavailable."), nil
			case "GRANT_DENIED":
				return errorResult("GRANT_DENIED: Cross-plugin connection access is not permitted."), nil
			case "DELEGATION_NOT_ACTIVE":
				return errorResult("DELEGATION_NOT_ACTIVE: The delegated tool call is not active."), nil
			}
			return errorResult("tool invocation failed"), nil
		}
		if t.BuiltIn || isGenericKubernetesTool(t) {
			return builtinResult, nil
		}
		if result == nil {
			return errorResult("tool invocation failed"), nil
		}
		if t.ConnectionOwner != "" && result.IsError {
			switch result.ErrorCode {
			case "GRANT_DENIED":
				return errorResult("GRANT_DENIED: Cross-plugin connection access is not permitted."), nil
			case "CONNECTION_NOT_STARTED":
				return errorResult("CONNECTION_NOT_STARTED: The owner connection is not started."), nil
			case "OWNER_UNAVAILABLE":
				return errorResult("OWNER_UNAVAILABLE: The connection owner is unavailable."), nil
			case "DELEGATION_NOT_ACTIVE":
				return errorResult("DELEGATION_NOT_ACTIVE: The delegated tool call is not active."), nil
			case "CONFLICT":
				return errorResult("CONFLICT: The object changed during the update."), nil
			case "TIMEOUT":
				return errorResult("TIMEOUT: The operation timed out."), nil
			case "UNSUPPORTED":
				return errorResult("UNSUPPORTED: The operation is not supported."), nil
			default:
				return errorResult("tool invocation failed"), nil
			}
		}

		out := &mcp.CallToolResult{IsError: result.IsError, Content: make([]mcp.Content, 0, len(result.Content))}
		for _, c := range result.Content {
			out.Content = append(out.Content, &mcp.TextContent{Text: c.Text})
		}
		if !result.IsError && len(result.StructuredContent) > 0 {
			out.StructuredContent = result.StructuredContent
		}
		return out, nil
	}
}

// dispatchResolvedKubernetes rechecks the discovered operation's own policy and
// consent before using its catalog observation at the native boundary.
func (r *Relay) dispatchResolvedKubernetes(ctx context.Context, tool ToolInfo, argsJSON []byte) (*mcp.CallToolResult, error) {
	confirm, err := r.authority.resolveKubernetes(ctx, tool, argsJSON)
	if err != nil {
		return nil, err
	}
	if confirm {
		payload := PendingConfirmation{
			MCPName: tool.MCPName, PluginID: tool.PluginID, PluginName: tool.PluginName,
			ConnectionID: tool.Resource.Route.Connection, ArgumentsJSON: string(argsJSON),
		}
		approved, _ := r.awaitConfirmation(ctx, payload)
		if !approved {
			return errorResult("the user denied this call or authorization expired"), nil
		}
		if err := r.authority.approveResolvedKubernetes(ctx); err != nil {
			return nil, err
		}
	}
	value, err := DispatchResource(ctx, r.connections, tool, argsJSON)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return &mcp.CallToolResult{StructuredContent: json.RawMessage(encoded)}, nil
}

type connectionListing struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Description  string         `json:"description,omitempty"`
	Labels       map[string]any `json:"labels,omitempty"`
	EnabledTools []string       `json:"enabled_tools"`
}

func (r *Relay) listConnections(ctx context.Context, cfg *Config, t ToolInfo) (*mcp.CallToolResult, error) {
	connections, err := r.connections.ListConnections(ctx, t.PluginID)
	if err != nil {
		return errorResult(err.Error()), nil
	}
	r.mu.Lock()
	catalog := r.catalog
	listed := make(map[string]bool, len(r.registered))
	for name, enabled := range r.registered {
		listed[name] = enabled
	}
	r.mu.Unlock()

	if r.borrowedConnections != nil {
		owners := make(map[string]bool)
		for _, candidate := range catalog {
			if candidate.PluginID == t.PluginID && candidate.ConnectionOwner != "" {
				owners[candidate.ConnectionOwner] = true
			}
		}
		for owner := range owners {
			borrowed, borrowErr := r.borrowedConnections(ctx, t.PluginID, owner, true)
			if borrowErr != nil {
				return errorResult("OWNER_UNAVAILABLE: The connection owner is unavailable."), nil
			}
			connections = append(connections, borrowed...)
		}
	}

	listings := make([]connectionListing, 0, len(connections))
	for _, connection := range connections {
		if !cfg.ConnectionAccess(t.PluginID, connection.ID) {
			continue
		}
		enabled := []string{}
		for _, candidate := range catalog {
			if !listed[candidate.MCPName] || (candidate.Resource != nil && candidate.Resource.Route.Connection != connection.ID) {
				continue
			}
			if candidate.PluginID != t.PluginID || candidate.BuiltIn ||
				candidate.Scope != ScopeConnection || candidate.Status != StatusOK {
				continue
			}
			if cfg.ConnectionEnabled(t.PluginID, connection.ID, candidate) {
				enabled = append(enabled, candidate.MCPName)
			}
		}
		listings = append(listings, connectionListing{
			ID:           connection.ID,
			Name:         connection.Name,
			Description:  connection.Description,
			Labels:       connection.Labels,
			EnabledTools: enabled,
		})
	}
	payload := map[string]any{"connections": listings}
	text, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, err
	}
	return &mcp.CallToolResult{
		Content:           []mcp.Content{&mcp.TextContent{Text: string(text)}},
		StructuredContent: payload,
	}, nil
}

// rejectDuplicateFields checks the original argument document before removing
// routing fields or remarshal can erase ambiguous object members.
func rejectDuplicateFields(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value func() error
	value = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, container := token.(json.Delim)
		if !container {
			return nil
		}
		switch delimiter {
		case '{':
			seen := map[string]bool{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok || seen[name] {
					return errors.New("arguments contain duplicate object fields")
				}
				seen[name] = true
				if err := value(); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := value(); err != nil {
					return err
				}
			}
		default:
			return errors.New("arguments contain malformed JSON")
		}
		_, err = decoder.Token()
		return err
	}
	if err := value(); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("arguments must contain one JSON object")
	}
	return nil
}

func (r *Relay) inventoryChanged() {
	r.requestDiscovery()
	r.mu.Lock()
	active := r.loaded && !r.stopped
	r.mu.Unlock()
	if active {
		r.emit(EventToolsChanged, "")
	}
}

// Session.Close waits for handlers; its drain shares the HTTP shutdown deadline.
func drainHTTPServer(ctx context.Context, server *http.Server, closeSessions func()) error {
	sessionsDone := make(chan struct{})
	go func() { closeSessions(); close(sessionsDone) }()
	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- server.Shutdown(ctx) }()
	var shutdownErr error
	for sessionsDone != nil || shutdownDone != nil {
		select {
		case <-ctx.Done():
			_ = server.Close()
			return ctx.Err()
		case <-sessionsDone:
			sessionsDone = nil
		case err := <-shutdownDone:
			shutdownErr = err
			shutdownDone = nil
		}
	}
	if shutdownErr != nil {
		_ = server.Close()
	}
	return shutdownErr
}
