// Package extensiondiagnostics brokers fresh, read-only frontend diagnostics.
package extensiondiagnostics

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const RequestEvent = "extensions/diagnostics/request"
const MaxPending = 16
const MaxPayloadBytes = 1 << 20
const MaxTimeout = 30 * time.Second
const MaxRuntimes = 64

var (
	ErrUnavailable = errors.New("extension diagnostics runtime is unavailable")
	ErrCapacity    = errors.New("extension diagnostics request capacity reached")
	ErrResponse    = errors.New("invalid, expired, or duplicate extension diagnostics response")
	ErrWindow      = errors.New("extension diagnostics response window does not match")
	ErrParams      = errors.New("invalid extension diagnostics request")
	ErrRuntime     = errors.New("extension diagnostics runtime could not complete the request")
	ErrUnsupported = errors.New("extension context lookup supports only built-in sidebar and drawer points")
)

type Options struct {
	IncludeSensitive bool   `json:"includeSensitive,omitempty"`
	PluginID         string `json:"pluginId,omitempty"`
	PointID          string `json:"pointId,omitempty"`
	IssuesOnly       bool   `json:"issuesOnly,omitempty"`
	Query            string `json:"query,omitempty"`
	ResourceKey      string `json:"resourceKey,omitempty"`
}

type Request struct {
	RequestID  string  `json:"requestId"`
	WindowName string  `json:"windowName"`
	Operation  string  `json:"operation"`
	Options    Options `json:"options"`
}

type Registration struct {
	WindowName string `json:"windowName"`
	Token      string `json:"token"`
	Pending    bool   `json:"pending,omitempty"`
}

type RuntimeInfo struct {
	WindowName   string    `json:"windowName"`
	RegisteredAt time.Time `json:"registeredAt"`
	LastSeen     time.Time `json:"lastSeen"`
}

type runtimeRegistration struct {
	info  RuntimeInfo
	token string
	alive func() bool
}

type result struct {
	payload json.RawMessage
	err     error
}

type pending struct {
	window            string
	operation         string
	options           Options
	ctx               context.Context
	result            chan result
	registrationToken string
}

// Broker never retains snapshots. Every query requires a new frontend response.
type Broker struct {
	mu       sync.Mutex
	emit     func(Request) error
	pending  map[string]*pending
	runtimes map[string]*runtimeRegistration
	closed   bool
}

func NewBroker() *Broker {
	return &Broker{pending: make(map[string]*pending), runtimes: make(map[string]*runtimeRegistration)}
}

// Start attaches the trusted host transport for fresh diagnostic requests.
func (b *Broker) Start(emit func(Request) error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.closed {
		b.emit = emit
	}
}

func (b *Broker) removeRuntimeLocked(window string) {
	delete(b.runtimes, window)
	for id, p := range b.pending {
		if p.window == window {
			delete(b.pending, id)
			p.result <- result{err: ErrUnavailable}
		}
	}
}

func (b *Broker) pruneRuntimesLocked() {
	for window, runtime := range b.runtimes {
		if runtime.alive != nil && !runtime.alive() {
			b.removeRuntimeLocked(window)
		}
	}
}

// RegisterRuntime leases an identity authenticated by the trusted host adapter.
// The liveness check must identify that same native window or browser client.
func (b *Broker) RegisterRuntime(window string, alive func() bool) (Registration, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed || b.emit == nil {
		return Registration{}, ErrUnavailable
	}
	if !ValidRequest(window, "snapshot", Options{}) {
		return Registration{}, ErrWindow
	}
	b.pruneRuntimesLocked()
	if _, exists := b.runtimes[window]; !exists && len(b.runtimes) >= MaxRuntimes {
		return Registration{}, ErrCapacity
	}
	b.removeRuntimeLocked(window)
	now := time.Now().UTC()
	token := uuid.NewString()
	b.runtimes[window] = &runtimeRegistration{info: RuntimeInfo{WindowName: window, RegisteredAt: now, LastSeen: now}, token: token, alive: alive}
	return Registration{WindowName: window, Token: token}, nil
}

// UnregisterRuntime releases only the matching host-issued registration lease.
func (b *Broker) UnregisterRuntime(window, token string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if runtime := b.runtimes[window]; runtime != nil && runtime.token == token {
		b.removeRuntimeLocked(window)
	}
}

// Windows lists runtime registrations, never cached registry snapshots.
func (b *Broker) Windows(ctx context.Context) ([]RuntimeInfo, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed || b.emit == nil {
		return nil, ErrUnavailable
	}
	b.pruneRuntimesLocked()
	windows := make([]RuntimeInfo, 0, len(b.runtimes))
	for _, runtime := range b.runtimes {
		windows = append(windows, runtime.info)
	}
	sort.Slice(windows, func(i, j int) bool { return windows[i].WindowName < windows[j].WindowName })
	return windows, nil
}

func ValidRequest(window, operation string, options Options) bool {
	if strings.TrimSpace(window) == "" || len(window) > 128 || strings.ContainsAny(window, "\x00\r\n") {
		return false
	}
	for _, value := range []string{options.PluginID, options.PointID, options.Query, options.ResourceKey} {
		if len(value) > 4096 || strings.ContainsRune(value, '\x00') {
			return false
		}
	}
	switch operation {
	case "snapshot":
		return options.ResourceKey == ""
	case "lookup":
		return strings.TrimSpace(options.PointID) != "" && strings.TrimSpace(options.PluginID) != "" && strings.TrimSpace(options.ResourceKey) != "" && !options.IssuesOnly && options.Query == ""
	default:
		return false
	}
}

func (b *Broker) Query(ctx context.Context, window, operation string, options Options) (json.RawMessage, error) {
	if window == "" {
		window = "main"
	}
	if !ValidRequest(window, operation, options) {
		return nil, ErrParams
	}
	ctx, cancel := context.WithTimeout(ctx, MaxTimeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	id := uuid.NewString()
	p := &pending{window: window, operation: operation, options: options, ctx: ctx, result: make(chan result, 1)}
	b.mu.Lock()
	if b.closed || b.emit == nil {
		b.mu.Unlock()
		return nil, ErrUnavailable
	}
	b.pruneRuntimesLocked()
	runtime := b.runtimes[window]
	if runtime == nil {
		b.mu.Unlock()
		return nil, ErrUnavailable
	}
	p.registrationToken = runtime.token
	if len(b.pending) >= MaxPending {
		b.mu.Unlock()
		return nil, ErrCapacity
	}
	b.pending[id] = p
	emit := b.emit
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		delete(b.pending, id)
		b.mu.Unlock()
	}()
	if err := emit(Request{RequestID: id, WindowName: window, Operation: operation, Options: options}); err != nil {
		return nil, ErrUnavailable
	}
	select {
	case response := <-p.result:
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return response.payload, response.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Respond consumes a valid correlation exactly once. The trusted host adapter
// must authenticate the caller's window before forwarding a response.
// Rejected responses cannot consume another window's request or revive a
// cancelled request.
func (b *Broker) Respond(id, window, payload, errorMessage string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	p, ok := b.pending[id]
	if !ok || p.ctx.Err() != nil {
		delete(b.pending, id)
		return ErrResponse
	}
	if p.window != window {
		return ErrWindow
	}
	runtime := b.runtimes[window]
	if runtime == nil || runtime.token != p.registrationToken || runtime.alive != nil && !runtime.alive() {
		return ErrResponse
	}
	runtime.info.LastSeen = time.Now().UTC()
	if len(payload) > MaxPayloadBytes || len(errorMessage) > 8192 {
		return ErrResponse
	}
	if errorMessage != "" {
		// Do not transport arbitrary plugin exceptions through protocol errors.
		responseError := ErrRuntime
		if p.operation == "lookup" && errorMessage == "unsupported-context" {
			responseError = ErrUnsupported
		}
		delete(b.pending, id)
		p.result <- result{err: responseError}
		return nil
	}
	var envelope struct {
		SchemaVersion int    `json:"schemaVersion"`
		CapturedAt    string `json:"capturedAt"`
		WindowName    string `json:"windowName"`
		PointID       string `json:"pointId"`
		PluginID      string `json:"pluginId"`
		ResourceKey   string `json:"resourceKey"`
	}
	data := json.RawMessage(payload)
	if json.Unmarshal(data, &envelope) != nil || envelope.SchemaVersion != 1 || envelope.WindowName != window {
		return ErrResponse
	}
	if _, err := time.Parse(time.RFC3339Nano, envelope.CapturedAt); err != nil {
		return ErrResponse
	}
	if p.operation == "lookup" && (envelope.PointID != p.options.PointID || envelope.PluginID != p.options.PluginID || envelope.ResourceKey != p.options.ResourceKey) {
		return ErrResponse
	}
	delete(b.pending, id)
	p.result <- result{payload: data}
	return nil
}

// Close disconnects the host transport and releases all pending queries.
func (b *Broker) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
	b.emit = nil
	clear(b.runtimes)
	for id, p := range b.pending {
		delete(b.pending, id)
		p.result <- result{err: ErrUnavailable}
	}
}
