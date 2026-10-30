// Package mcprelay serves one Streamable HTTP MCP endpoint on loopback and
// relays tool calls to plugins that expose the SDK "tools" capability.
package mcprelay

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
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
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	toolCallTimeout   = 2 * time.Minute
	readHeaderTimeout = 5 * time.Second
	shutdownTimeout   = 5 * time.Second
	listenHost        = "127.0.0.1"
	mcpPath           = "/mcp"
	keepAliveInterval = 30 * time.Second

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
	Log         logging.Logger
	Store       ConfigStore
	Tools       tools.Controller
	Connections resource.Service
	Version     string
}

// Relay owns the MCP server, the policy document and the HTTP listener.
type Relay struct {
	log         logging.Logger
	store       ConfigStore
	tools       tools.Controller
	connections resource.Service
	server      *mcp.Server
	app         *application.App

	mu         sync.Mutex // guards cfg, catalog, registered, listener state
	cfg        Config
	loaded     bool
	catalog    []ToolInfo
	registered map[string]bool
	listener   net.Listener
	httpServer *http.Server
	listenErr  string
	listenAddr string // tests set "127.0.0.1:0"; empty means the configured port

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
	r.server = mcp.NewServer(
		&mcp.Implementation{Name: "omniview", Version: o.Version},
		&mcp.ServerOptions{Instructions: instructions, KeepAlive: keepAliveInterval},
	)
	o.Tools.OnChange(r.resync)
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
	return nil
}

// ServiceShutdown stops the listener.
func (r *Relay) ServiceShutdown() error {
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
		r.emit(EventStatus, r.statusLocked())
		return
	}
	mux := http.NewServeMux()
	mux.Handle(mcpPath, r.auth(mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return r.server },
		&mcp.StreamableHTTPOptions{},
	)))
	server := &http.Server{Handler: mux, ReadHeaderTimeout: readHeaderTimeout}
	r.listener = listener
	r.httpServer = server
	r.listenErr = ""
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			r.log.Errorw(context.Background(), "mcp relay server stopped", "error", serveErr)
			r.mu.Lock()
			if r.httpServer == server {
				r.listener = nil
				r.httpServer = nil
				r.listenErr = serveErr.Error()
			}
			status := r.statusLocked()
			r.mu.Unlock()
			r.emit(EventStatus, status)
		}
	}()
	r.log.Infow(context.Background(), "mcp relay listening", "endpoint", r.endpointLocked())
	r.emit(EventStatus, r.statusLocked())
}

// stopListener detaches the HTTP server under the lock and shuts it down
// outside it, so in-flight handlers that need the lock can finish.
func (r *Relay) stopListener() {
	r.mu.Lock()
	server := r.httpServer
	r.httpServer = nil
	r.listener = nil
	status := r.statusLocked()
	r.mu.Unlock()
	if server == nil {
		return
	}
	for session := range r.server.Sessions() {
		_ = session.Close()
	}
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		r.log.Warnw(ctx, "mcp relay shutdown", "error", err)
	}
	r.emit(EventStatus, status)
}

// restartListener applies the current Enabled/Port/Token state.
func (r *Relay) restartListener() {
	r.stopListener()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cfg.Enabled {
		r.startListenerLocked()
		return
	}
	r.listenErr = ""
	r.emit(EventStatus, r.statusLocked())
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
		r.mu.Unlock()
		authorization := req.Header.Get("Authorization")
		if len(req.Header.Values("Authorization")) != 1 ||
			subtle.ConstantTimeCompare([]byte(authorization), []byte(expected)) != 1 {
			unauthorized(w)
			return
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
func (r *Relay) allowedConnections(cfg *Config) map[string][]string {
	all, err := r.connections.ListAllConnections(invocation.HostContext(context.Background()))
	if err != nil {
		r.log.Warnw(context.Background(), "mcp relay: list connections", "error", err)
		return nil
	}
	out := make(map[string][]string, len(all))
	for pluginID, connections := range all {
		for _, connection := range connections {
			if cfg.ConnectionAccess(pluginID, connection.ID) {
				out[pluginID] = append(out[pluginID], connection.ID)
			}
		}
	}
	return out
}

// resync rebuilds the catalog and registers exactly the listed tools.
func (r *Relay) resync() {
	r.mu.Lock()
	if !r.loaded {
		r.mu.Unlock()
		return
	}
	cfg := r.cfg
	r.mu.Unlock()

	catalog := BuildCatalog(r.tools.ListAll())
	allowed := r.allowedConnections(&cfg)

	desired := map[string]ToolInfo{}
	for _, t := range catalog {
		if t.Status == StatusOK && cfg.Listed(t, allowed[t.PluginID]) {
			desired[t.MCPName] = t
		}
	}

	r.mu.Lock()
	r.catalog = catalog
	var removed []string
	for name := range r.registered {
		if _, ok := desired[name]; !ok {
			removed = append(removed, name)
			delete(r.registered, name)
		}
	}
	var added []ToolInfo
	for name, t := range desired {
		if !r.registered[name] {
			r.registered[name] = true
			added = append(added, t)
		}
	}
	r.mu.Unlock()

	sort.Slice(added, func(i, j int) bool { return added[i].MCPName < added[j].MCPName })
	if len(removed) > 0 {
		r.server.RemoveTools(removed...)
	}
	for _, t := range added {
		r.server.AddTool(mcpTool(t), r.handler(t))
	}
	if len(removed) > 0 || len(added) > 0 {
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
		args := map[string]any{}
		if len(req.Params.Arguments) > 0 {
			if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
				return nil, fmt.Errorf("arguments must be a JSON object: %w", err)
			}
		}

		r.mu.Lock()
		cfg := r.cfg
		r.mu.Unlock()
		allowed := r.allowedConnections(&cfg)
		if !cfg.Listed(t, allowed[t.PluginID]) {
			return errorResult(fmt.Sprintf("tool %s is disabled in Omniview AI Tools settings", t.MCPName)), nil
		}

		if t.BuiltIn {
			return r.listConnections(ctx, &cfg, t)
		}

		var connection *sdktypes.Connection
		connectionID := ""
		if t.Scope == ScopeConnection {
			id, ok := args[connectionIDArg].(string)
			if !ok || id == "" {
				return errorResult(fmt.Sprintf("%s is required; call %s_%s", connectionIDArg, t.PluginID, listConnectionsTool)), nil
			}
			resolved, err := r.connections.GetConnection(invocation.HostContext(ctx), t.PluginID, id)
			if err != nil {
				return errorResult(fmt.Sprintf("unknown connection %s for plugin %s", id, t.PluginID)), nil
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

		if cfg.Confirm(t.PluginID, connectionID, t) {
			payload := PendingConfirmation{
				MCPName:      t.MCPName,
				PluginID:     t.PluginID,
				PluginName:   t.PluginName,
				ConnectionID: connectionID,
				Arguments:    argsJSON,
			}
			if connection != nil {
				payload.ConnectionName = connection.Name
			}
			approved, reason := r.awaitConfirmation(ctx, payload)
			if !approved {
				switch reason {
				case "timeout":
					return errorResult("confirmation timed out after 2 minutes"), nil
				case "cancelled":
					return nil, ctx.Err()
				default:
					return errorResult("the user denied this call"), nil
				}
			}
		}

		callCtx, cancel := context.WithTimeout(ctx, toolCallTimeout)
		defer cancel()
		result, err := r.tools.CallTool(callCtx, t.PluginID, connection, t.Name, argsJSON)
		if err != nil {
			return errorResult(err.Error()), nil
		}

		out := &mcp.CallToolResult{IsError: result.IsError, Content: make([]mcp.Content, 0, len(result.Content))}
		for _, c := range result.Content {
			out.Content = append(out.Content, &mcp.TextContent{Text: c.Text})
		}
		if len(result.StructuredContent) > 0 {
			out.StructuredContent = result.StructuredContent
		}
		return out, nil
	}
}

type connectionListing struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Description  string         `json:"description,omitempty"`
	Labels       map[string]any `json:"labels,omitempty"`
	EnabledTools []string       `json:"enabled_tools"`
}

func (r *Relay) listConnections(ctx context.Context, cfg *Config, t ToolInfo) (*mcp.CallToolResult, error) {
	connections, err := r.connections.ListConnections(invocation.HostContext(ctx), t.PluginID)
	if err != nil {
		return errorResult(err.Error()), nil
	}
	r.mu.Lock()
	catalog := r.catalog
	r.mu.Unlock()

	listings := make([]connectionListing, 0, len(connections))
	for _, connection := range connections {
		if !cfg.ConnectionAccess(t.PluginID, connection.ID) {
			continue
		}
		enabled := []string{}
		for _, candidate := range catalog {
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
