package resource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// A connection start that fails is told to every window by a connection/status event that says why,
// and the host keeps the reason, in the public form every provider error is handed to a user in, so
// that GetAllConnectionStates reads it back until a later start answers, the connection is stopped,
// or it leaves the plugin's list. A start fails when its provider call returns an error (a FAILED
// event) and when it answers, without an error, a status that is a failure (UNAUTHORIZED, FORBIDDEN,
// FAILED and the other words of the SDK that say the connection did not start): the event then keeps
// the status the provider answered, and the reason is the public error of that status's class, never
// the status's own text. The tests below hold each half of that: what the event says, what the state
// says, what clears the reason, what must never publish one, and that nothing kept outlives the
// connection it describes.

const (
	failurePlugin  = "p1"
	hostilePath    = "/Users/alice/.kube/config"
	hostileAddress = "10.20.30.40:6443"
	hostileToken   = "token=abc123def456ghi789"
	hostileMessage = "dial tcp " + hostileAddress + ": open " + hostilePath + ": " + hostileToken
)

// hostileFragments are the pieces of plugin text that must never reach a window.
func hostileFragments() []string {
	return []string{"alice", ".kube", "10.20.30.40", "abc123def456ghi789", "dial tcp", "PLUGIN-", "native secret"}
}

func listedConnection(id, name, endpoint string) types.Connection {
	return types.Connection{ID: id, Name: name, Data: map[string]any{"endpoint": endpoint}}
}

// startFailureCount is how many plugins and how many connections the host keeps a start failure for.
func startFailureCount(ctrl *controller) (int, int) {
	ctrl.connsMu.RLock()
	defer ctrl.connsMu.RUnlock()
	connections := 0
	for _, byConnection := range ctrl.startFailures {
		connections += len(byConnection)
	}
	return len(ctrl.startFailures), connections
}

func requireNoStartFailures(t *testing.T, ctrl *controller, when string) {
	t.Helper()
	plugins, connections := startFailureCount(ctrl)
	require.Zero(t, connections, "a start failure is still kept %s", when)
	require.Zero(t, plugins, "an empty set of start failures is still kept %s", when)
}

func marshalled(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	require.NoError(t, err)
	return string(encoded)
}

// failureHarness is the plugin "p1": its provider lists the connections the test sets, reports the
// readiness the test sets, and starts and stops as the test says (a success by default).
type failureHarness struct {
	t        *testing.T
	ctrl     *controller
	emitter  *recordingEmitter
	base     *mockProvider
	provider *readinessTestProvider

	startCalls atomic.Int32

	mu        sync.Mutex
	listed    []types.Connection
	listErr   error
	readiness types.ConnectionStatusCode
	start     func(ctx context.Context, id string) (types.ConnectionStatus, error)
}

func newFailureHarness(t *testing.T, listed ...types.Connection) *failureHarness {
	t.Helper()
	ctrl, emitter := newTestControllerWithEmitter(t)
	h := &failureHarness{t: t, ctrl: ctrl, emitter: emitter, listed: listed, readiness: types.ConnectionStatusDisconnected}
	h.base = connectionOverlayTestProvider()
	h.base.NativeConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		h.mu.Lock()
		defer h.mu.Unlock()
		if h.listErr != nil {
			return nil, h.listErr
		}
		return append([]types.Connection(nil), h.listed...), nil
	}
	h.base.StartConnectionFunc = func(ctx context.Context, id string) (types.ConnectionStatus, error) {
		h.startCalls.Add(1)
		h.mu.Lock()
		start := h.start
		h.mu.Unlock()
		if start != nil {
			return start(ctx, id)
		}
		return h.connected(id), nil
	}
	h.base.StopConnectionFunc = func(_ context.Context, id string) (types.Connection, error) { return h.connection(id), nil }
	h.provider = &readinessTestProvider{mockProvider: h.base, statusFunc: func(context.Context, string) (types.ConnectionStatus, error) {
		h.mu.Lock()
		defer h.mu.Unlock()
		return types.ConnectionStatus{Status: h.readiness}, nil
	}}
	registerMockPlugin(ctrl, failurePlugin, h.provider)
	h.load()
	return h
}

func (h *failureHarness) connection(id string) types.Connection {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, connection := range h.listed {
		if connection.ID == id {
			return connection
		}
	}
	return types.Connection{ID: id, Name: id}
}

func (h *failureHarness) connected(id string) types.ConnectionStatus {
	connection := h.connection(id)
	return types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &connection}
}

func (h *failureHarness) setList(listed ...types.Connection) {
	h.mu.Lock()
	h.listed = listed
	h.mu.Unlock()
}

func (h *failureHarness) setListErr(err error) {
	h.mu.Lock()
	h.listErr = err
	h.mu.Unlock()
}

func (h *failureHarness) setReadiness(readiness types.ConnectionStatusCode) {
	h.mu.Lock()
	h.readiness = readiness
	h.mu.Unlock()
}

func (h *failureHarness) setStart(start func(ctx context.Context, id string) (types.ConnectionStatus, error)) {
	h.mu.Lock()
	h.start = start
	h.mu.Unlock()
}

// failWith makes every start the provider is asked for return err.
func (h *failureHarness) failWith(err error) {
	h.setStart(func(context.Context, string) (types.ConnectionStatus, error) { return types.ConnectionStatus{}, err })
}

func (h *failureHarness) load() {
	h.t.Helper()
	_, err := h.ctrl.LoadConnections(testInvocationContext(), failurePlugin)
	require.NoError(h.t, err)
}

// watchRefresh is the sync the connection watch makes: it replaces the list with what the provider
// lists now and runs no profile transaction step of its own.
func (h *failureHarness) watchRefresh() {
	h.t.Helper()
	h.ctrl.pluginsMu.RLock()
	state := h.ctrl.plugins[failurePlugin]
	h.ctrl.pluginsMu.RUnlock()
	browser, ok := state.provider.(resource.ConnectionBrowser)
	require.True(h.t, ok, "the fixture provider is a connection browser")
	_, err := h.ctrl.refreshWatchedConnections(testInvocationContext(), failurePlugin, browser, state)
	require.NoError(h.t, err)
}

// register puts the plugin back after OnPluginStop took it away.
func (h *failureHarness) register() {
	registerMockPlugin(h.ctrl, failurePlugin, h.provider)
}

// startErr starts the connection the way a window does and returns what the host answered.
func (h *failureHarness) startErr(id string) error {
	_, err := h.ctrl.StartConnection(testInvocationContext(), failurePlugin, id)
	return err
}

func (h *failureHarness) stopErr(id string) error {
	_, err := h.ctrl.StopConnection(testInvocationContext(), failurePlugin, id)
	return err
}

func (h *failureHarness) statusEvents() []ConnectionStatusPayload {
	h.t.Helper()
	var payloads []ConnectionStatusPayload
	for _, event := range h.emitter.EventsWithKey(EventConnectionStatus) {
		require.Len(h.t, event.Data, 1)
		payload, ok := event.Data[0].(ConnectionStatusPayload)
		require.True(h.t, ok, "the payload of %s is a ConnectionStatusPayload, not %T", event.Key, event.Data[0])
		payloads = append(payloads, payload)
	}
	return payloads
}

func (h *failureHarness) states() map[string]ConnectionState {
	h.t.Helper()
	all, err := h.ctrl.GetAllConnectionStates(testInvocationContext())
	require.NoError(h.t, err)
	byID := make(map[string]ConnectionState, len(all[failurePlugin]))
	for _, state := range all[failurePlugin] {
		byID[state.Connection.ID] = state
	}
	return byID
}

func (h *failureHarness) state(id string) ConnectionState {
	h.t.Helper()
	state, ok := h.states()[id]
	require.True(h.t, ok, "the connection %q is not in the plugin's list", id)
	return state
}

// requireReads says the host reports the connection as the provider does, with no reason of its own.
func (h *failureHarness) requireReads(id string, readiness types.ConnectionStatusCode) {
	h.t.Helper()
	state := h.state(id)
	require.Equal(h.t, readiness, state.Readiness, "readiness of %s", id)
	require.Nil(h.t, state.ReadinessError, "readiness error of %s", id)
}

// retireRoute is what a profile change does to the route of a connection: its lifecycle epoch moves.
func (h *failureHarness) retireRoute(id string) {
	h.ctrl.pluginsMu.Lock()
	defer h.ctrl.pluginsMu.Unlock()
	state := h.ctrl.plugins[failurePlugin]
	if state.connectionLifecycleEpoch == nil {
		state.connectionLifecycleEpoch = make(map[string]uint64)
	}
	state.connectionLifecycleEpoch[id]++
}

// answers makes every start the provider is asked for end without an error, with status. The status
// carries what a plugin may put in one: a sentence, details and the connection, all plugin text.
func (h *failureHarness) answers(status types.ConnectionStatusCode) {
	h.setStart(func(_ context.Context, id string) (types.ConnectionStatus, error) {
		connection := h.connection(id)
		return types.ConnectionStatus{
			Status: status, Connection: &connection,
			Error: "PLUGIN-ERROR login failed " + hostileMessage, Details: "PLUGIN-DETAILS native secret " + hostileMessage,
		}, nil
	})
}

// keptFailure is the failure the host keeps for a connection of the plugin, nil when it keeps none.
func (h *failureHarness) keptFailure(id string) *apperror.AppError {
	h.ctrl.connsMu.RLock()
	defer h.ctrl.connsMu.RUnlock()
	return h.ctrl.startFailures[failurePlugin][id]
}

// failureKind is a way a start of a connection fails.
type failureKind struct {
	name string
	// set makes the provider fail every start it is asked for this way.
	set func(h *failureHarness)
	// start starts the connection and requires the answer this kind of failure gets: an error, or a status without one.
	start func(t *testing.T, h *failureHarness, id string)
}

// failureKinds are the ways a start fails: its provider call returns an error, or answers a failure status.
func failureKinds() []failureKind {
	answered := func(status types.ConnectionStatusCode) failureKind {
		return failureKind{
			name:  "the start answers " + string(status),
			set:   func(h *failureHarness) { h.answers(status) },
			start: func(t *testing.T, h *failureHarness, id string) { t.Helper(); require.NoError(t, h.startErr(id)) },
		}
	}
	return []failureKind{
		{
			name:  "the start returns an error",
			set:   func(h *failureHarness) { h.failWith(errors.New("refused")) },
			start: func(t *testing.T, h *failureHarness, id string) { t.Helper(); require.Error(t, h.startErr(id)) },
		},
		answered(types.ConnectionStatusUnauthorized),
		answered(types.ConnectionStatusFailed),
	}
}

// answeredFailure is a status a start can answer, without an error, that is a failure: the class of the
// public error the host gives it, and the state the window makes of that error.
type answeredFailure struct {
	status types.ConnectionStatusCode
	code   string
	window string
}

// answeredFailures are the failures the window made of a status that a start answered (outcomeOfStatus in
// ui-next/plugins/host/connections/words.ts). UNAUTHORIZED and FORBIDDEN are classes of their own. Every other
// word says the connection did not start and nothing more: INTERNAL, which the window reads as `failed`. It
// is not PROVIDER_ERROR, a 502 that the window reads as a server that did not answer.
func answeredFailures() []answeredFailure {
	return []answeredFailure{
		{types.ConnectionStatusUnauthorized, "UNAUTHORIZED", "unauthorized"},
		{types.ConnectionStatusForbidden, "FORBIDDEN", "forbidden"},
		{types.ConnectionStatusFailed, "INTERNAL", "failed"},
		{types.ConnectionStatusError, "INTERNAL", "failed"},
		{types.ConnectionStatusBadRequest, "INTERNAL", "failed"},
		{types.ConnectionStatusNotFound, "INTERNAL", "failed"},
		{types.ConnectionStatusTimeout, "INTERNAL", "failed"},
		{types.ConnectionStatusUnavailable, "INTERNAL", "failed"},
		{types.ConnectionStatusRequestEntityTooLarge, "INTERNAL", "failed"},
	}
}

// plainAnswer is an answer of a start, without an error, that does not say the connection failed to start.
type plainAnswer struct {
	name   string
	status types.ConnectionStatusCode
}

// answersThatAreNoFailure are PENDING (a start in progress), DISCONNECTED and UNKNOWN (no client is
// registered), no status at all (the zero value of a status) and a word this host does not know.
func answersThatAreNoFailure() []plainAnswer {
	return []plainAnswer{
		{"PENDING", types.ConnectionStatusPending},
		{"DISCONNECTED", types.ConnectionStatusDisconnected},
		{"UNKNOWN", types.ConnectionStatusUnknown},
		{"no status", ""},
		{"a word the host does not know", "REPLACED_BY_A_NEWER_SDK"},
	}
}

// publicClass is the error a class gives a window and nothing more: the class's own type, status,
// recovery and words. A suggestion, an action, an instance or a location is where plugin text would be.
func publicClass(t *testing.T, code string) apperror.AppError {
	t.Helper()
	switch code {
	case "UNAUTHORIZED":
		return apperror.AppError{Type: apperror.TypeResourceUnauthorized, Status: 401, Code: code, Title: "Authentication required", Detail: "The provider requires authentication.", Recovery: "none"}
	case "FORBIDDEN":
		return apperror.AppError{Type: apperror.TypeResourceForbidden, Status: 403, Code: code, Title: "Access denied", Detail: "The operation is not permitted.", Recovery: "none"}
	case "INTERNAL":
		return apperror.AppError{Type: apperror.TypeInternal, Status: 500, Code: code, Title: "Internal error", Detail: "The operation could not be completed.", Recovery: "none"}
	}
	require.FailNow(t, "no such class", code)
	return apperror.AppError{}
}

// requirePublicClass says failure is the public error of the class code and nothing more.
func requirePublicClass(t *testing.T, code string, failure *apperror.AppError, where string) {
	t.Helper()
	require.NotNil(t, failure, "%s says why the start failed", where)
	require.NoError(t, failure.Err, "%s keeps no raw error", where)
	assert.NotEmpty(t, failure.RequestID, "%s carries the host's correlation id", where)
	got := *failure
	got.RequestID = ""
	assert.Equal(t, publicClass(t, code), got, "%s is the public error of the class %s and nothing more", where, code)
}

// windowClass is what the window makes of a readiness error: the checks of classOf in
// ui-next/plugins/host/connections/words.ts, in its order, on the error as the window receives it (its JSON).
func windowClass(t *testing.T, failure *apperror.AppError) string {
	t.Helper()
	require.NotNil(t, failure, "the window is given no error to classify")
	var wire struct {
		Type     string `json:"type"`
		Status   int    `json:"status"`
		Code     string `json:"code"`
		Recovery string `json:"recovery"`
	}
	require.NoError(t, json.Unmarshal([]byte(marshalled(t, failure)), &wire))
	switch {
	case wire.Status == 401 || wire.Code == "UNAUTHORIZED" || wire.Type == apperror.TypeResourceUnauthorized:
		return "unauthorized"
	case wire.Status == 403 || wire.Code == "FORBIDDEN" || wire.Type == apperror.TypeResourceForbidden:
		return "forbidden"
	case wire.Recovery == "reconnect" || wire.Type == apperror.TypeConnectionFailed || wire.Type == apperror.TypeResourceTimeout ||
		wire.Status == 502 || wire.Status == 503 || wire.Status == 504:
		return "unreachable"
	default:
		return "failed"
	}
}

// ============================================================================
// The event
// ============================================================================

func TestAFailedStartEmitsOneFailedEventNamingTheConnectionAndCarryingThePublicError(t *testing.T) {
	h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"), listedConnection("c2", "Staging", "https://staging"))
	h.failWith(&resource.ResourceOperationError{Code: "UNAUTHORIZED", Title: "PLUGIN-TITLE", Message: "PLUGIN-SENTENCE", Err: errors.New("native cause")})

	err := h.startErr("c1")

	callerErr := requireAppError(t, err)
	events := h.statusEvents()
	require.Len(t, events, 1, "a start whose provider call failed publishes exactly one connection/status event")
	event := events[0]
	assert.Equal(t, failurePlugin, event.PluginID)
	assert.Equal(t, "c1", event.ConnectionID)
	assert.Equal(t, string(types.ConnectionStatusFailed), event.Status)
	assert.Equal(t, "Prod cluster", event.Name, "the event names the connection by its listed name")
	require.NotNil(t, event.Error, "the event says why the start failed")
	assert.Equal(t, "UNAUTHORIZED", event.Error.Code)
	assert.Equal(t, 401, event.Error.Status)
	assert.Equal(t, "Authentication required", event.Error.Title)
	assert.Equal(t, "The provider requires authentication.", event.Error.Detail)
	assert.NotEmpty(t, event.Error.RequestID, "the error carries the host's correlation id")
	public := *callerErr
	public.Err = nil
	assert.Equal(t, &public, event.Error, "the event holds the error the caller was given, without the raw error")
}

func TestTheFailedEventNamesAConnectionByItsIDWhenTheListHasNoNameForIt(t *testing.T) {
	for name, listed := range map[string][]types.Connection{
		"the connection is listed without a name": {{ID: "c1"}},
		"the connection is not listed at all":     {},
	} {
		t.Run(name, func(t *testing.T) {
			h := newFailureHarness(t, listed...)
			h.failWith(errors.New("refused"))

			require.Error(t, h.startErr("c1"))

			events := h.statusEvents()
			require.Len(t, events, 1)
			assert.Equal(t, "c1", events[0].Name)
			assert.Equal(t, string(types.ConnectionStatusFailed), events[0].Status)
		})
	}
}

// What the provider's error holds never reaches a window except through the gate that every provider
// error already passes: the class's words, and the provider's sentence only after PublicText cleaned it.
func TestAFailedStartCarriesNoRawProviderTextInTheEventOrTheReadinessError(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		code   string
		detail string
	}{
		{"a plain error that holds a path, an address and a token", errors.New(hostileMessage), "PROVIDER_ERROR", "The provider could not complete the operation."},
		{"a wrapped plain error", fmt.Errorf("start c1: %w", errors.New(hostileMessage)), "PROVIDER_ERROR", "The provider could not complete the operation."},
		{
			"a gRPC status whose message holds them", status.Error(codes.Unavailable, hostileMessage),
			"UNAVAILABLE", "The source is unavailable.",
		},
		{
			"a typed error whose sentence, title and suggestion the gate refuses",
			&resource.ResourceOperationError{
				Code: "TIMEOUT", Title: "Timed out at " + hostilePath, Message: hostileMessage,
				Suggestions: []string{"Open " + hostilePath}, Err: errors.New(hostileMessage),
			},
			"TIMEOUT", "The operation exceeded its deadline.",
		},
		{
			"a typed error of a class that never shows provider text",
			&resource.ResourceOperationError{
				Code: "FORBIDDEN", Title: "PLUGIN-TITLE", Message: "PLUGIN-SENTENCE",
				Suggestions: []string{"PLUGIN-SUGGESTION"}, Err: errors.New("native secret"),
			},
			"FORBIDDEN", "The operation is not permitted.",
		},
		{
			"a host-authored error whose detail leaks a path",
			apperror.New(apperror.TypeConnectionFailed, 503, "Source unavailable", hostileMessage),
			"UNAVAILABLE", "The source is unavailable.",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
			h.failWith(tc.err)

			require.Error(t, h.startErr("c1"))

			events := h.statusEvents()
			require.Len(t, events, 1)
			require.NotNil(t, events[0].Error)
			readinessError := h.state("c1").ReadinessError
			require.NotNil(t, readinessError, "the state reads the failure back")
			assert.Equal(t, tc.code, events[0].Error.Code)
			for _, where := range []struct{ name, encoded string }{
				{"the event", marshalled(t, events[0])},
				{"the readiness error", marshalled(t, readinessError)},
			} {
				assert.Contains(t, where.encoded, tc.detail, "%s says what the class says", where.name)
				for _, fragment := range hostileFragments() {
					assert.NotContains(t, where.encoded, fragment, "%s carries plugin text", where.name)
				}
			}
			assert.NoError(t, events[0].Error.Err, "the event keeps no raw error")
			assert.NoError(t, readinessError.Err, "the readiness error keeps no raw error")
		})
	}
}

// The same holds when the error comes over the transport, as a plugin's does: the SDK client
// restores the sentence into the typed error and the gate decides what of it is shown.
func TestAFailedStartAcrossTheTransportCarriesNoSentenceTheGateRefuses(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	provider := &readinessTestProvider{
		mockProvider: &mockProvider{StartConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{}, &resource.ResourceOperationError{Code: "TIMEOUT", Title: "PLUGIN-TITLE", Message: sinkHostile, Suggestions: []string{"PLUGIN-SUGGESTION"}}
		}},
		status: types.ConnectionStatus{Status: types.ConnectionStatusDisconnected, Connection: &types.Connection{ID: "c1"}},
	}
	registerMockPlugin(ctrl, failurePlugin, setupGRPCProvider(t, provider))
	ctrl.connsMu.Lock()
	ctrl.connections[failurePlugin] = []types.Connection{{ID: "c1", Name: "Prod cluster"}}
	ctrl.connsMu.Unlock()

	_, err := ctrl.StartConnection(testInvocationContext(), failurePlugin, "c1")

	require.Error(t, err)
	events := emitter.EventsWithKey(EventConnectionStatus)
	require.Len(t, events, 1)
	payload, ok := events[0].Data[0].(ConnectionStatusPayload)
	require.True(t, ok)
	require.NotNil(t, payload.Error)
	all, err := ctrl.GetAllConnectionStates(testInvocationContext())
	require.NoError(t, err)
	require.Len(t, all[failurePlugin], 1)
	require.NotNil(t, all[failurePlugin][0].ReadinessError)
	for _, encoded := range []string{marshalled(t, payload), marshalled(t, all[failurePlugin][0].ReadinessError)} {
		assert.False(t, ungated(encoded), "the provider's sentence got through: %s", encoded)
		assert.NotContains(t, encoded, "PLUGIN-")
		assert.Contains(t, encoded, "The operation exceeded its deadline.")
	}
}

// The same holds for a status that comes over the transport, as a plugin's does: the SDK client restores
// the status with the plugin's text, and the windows are given the class of the status and none of the text.
func TestAnAnsweredFailureAcrossTheTransportCarriesNoTextOfThePlugin(t *testing.T) {
	for _, tc := range answeredFailures() {
		t.Run(string(tc.status), func(t *testing.T) {
			ctrl, emitter := newTestControllerWithEmitter(t)
			provider := &readinessTestProvider{
				mockProvider: &mockProvider{StartConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
					return types.ConnectionStatus{
						Status: tc.status, Connection: &types.Connection{ID: "c1", Name: "Prod cluster"},
						Error: "PLUGIN-ERROR " + hostileMessage, Details: "PLUGIN-DETAILS native secret " + hostileMessage,
					}, nil
				}},
				status: types.ConnectionStatus{Status: types.ConnectionStatusDisconnected, Connection: &types.Connection{ID: "c1"}},
			}
			registerMockPlugin(ctrl, failurePlugin, setupGRPCProvider(t, provider))
			ctrl.connsMu.Lock()
			ctrl.connections[failurePlugin] = []types.Connection{{ID: "c1", Name: "Prod cluster"}}
			ctrl.connsMu.Unlock()

			answered, err := ctrl.StartConnection(testInvocationContext(), failurePlugin, "c1")

			require.NoError(t, err)
			assert.Equal(t, tc.status, answered.Status, "the caller is given the status the plugin answered")
			events := emitter.EventsWithKey(EventConnectionStatus)
			require.Len(t, events, 1)
			payload, ok := events[0].Data[0].(ConnectionStatusPayload)
			require.True(t, ok)
			assert.Equal(t, string(tc.status), payload.Status)
			all, err := ctrl.GetAllConnectionStates(testInvocationContext())
			require.NoError(t, err)
			require.Len(t, all[failurePlugin], 1)
			state := all[failurePlugin][0]
			assert.Equal(t, types.ConnectionStatusFailed, state.Readiness)
			requirePublicClass(t, tc.code, payload.Error, "the event")
			requirePublicClass(t, tc.code, state.ReadinessError, "the list")
			for _, encoded := range []string{marshalled(t, payload), marshalled(t, all)} {
				for _, fragment := range hostileFragments() {
					assert.NotContains(t, encoded, fragment, "plugin text got through: %s", encoded)
				}
			}
		})
	}
}

// ============================================================================
// What the state reads back
// ============================================================================

func TestAConnectionWhoseLastStartFailedReadsFailedWhateverThePluginReportsExceptConnected(t *testing.T) {
	for _, reported := range []types.ConnectionStatusCode{types.ConnectionStatusDisconnected, types.ConnectionStatusPending, types.ConnectionStatusFailed} {
		t.Run("the plugin reports "+string(reported), func(t *testing.T) {
			h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"), listedConnection("c2", "Staging", "https://staging"))
			h.failWith(&resource.ResourceOperationError{Code: "UNAUTHORIZED"})
			require.Error(t, h.startErr("c1"))
			h.setReadiness(reported)

			state := h.state("c1")

			assert.Equal(t, types.ConnectionStatusFailed, state.Readiness)
			require.NotNil(t, state.ReadinessError, "the state says why")
			events := h.statusEvents()
			require.Len(t, events, 1)
			assert.Equal(t, events[0].Error, state.ReadinessError, "the state says what the event said")
			h.requireReads("c2", reported)
		})
	}

	t.Run("the plugin reports no readiness at all", func(t *testing.T) {
		h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
		registerMockPlugin(h.ctrl, failurePlugin, h.base)
		h.failWith(&resource.ResourceOperationError{Code: "UNAUTHORIZED"})
		require.Error(t, h.startErr("c1"))

		state := h.state("c1")

		assert.Equal(t, types.ConnectionStatusFailed, state.Readiness)
		require.NotNil(t, state.ReadinessError)
		assert.Equal(t, "UNAUTHORIZED", state.ReadinessError.Code, "the failure replaces the words for a plugin that cannot say")
	})

	t.Run("the plugin reports connected", func(t *testing.T) {
		h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
		h.failWith(&resource.ResourceOperationError{Code: "UNAUTHORIZED"})
		require.Error(t, h.startErr("c1"))
		h.setReadiness(types.ConnectionStatusConnected)

		h.requireReads("c1", types.ConnectionStatusConnected)

		h.setReadiness(types.ConnectionStatusDisconnected)
		state := h.state("c1")
		assert.Equal(t, types.ConnectionStatusFailed, state.Readiness, "the failure is still the last word once the plugin stops saying connected")
		assert.NotNil(t, state.ReadinessError)
	})
}

// The reason belongs to one connection of one plugin.
func TestAFailureBelongsToItsPluginAndConnectionOnly(t *testing.T) {
	h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"), listedConnection("c2", "Staging", "https://staging"))
	other := connectionOverlayTestProvider(listedConnection("c1", "Prod cluster", "https://prod"))
	other.StartConnectionFunc = func(context.Context, string) (types.ConnectionStatus, error) {
		return types.ConnectionStatus{}, errors.New("refused")
	}
	registerMockPlugin(h.ctrl, "p2", &readinessTestProvider{mockProvider: other, status: types.ConnectionStatus{Status: types.ConnectionStatusDisconnected}})
	_, err := h.ctrl.LoadConnections(testInvocationContext(), "p2")
	require.NoError(t, err)
	h.failWith(errors.New("refused"))
	require.Error(t, h.startErr("c1"))

	assert.Equal(t, types.ConnectionStatusFailed, h.state("c1").Readiness, "the connection that failed reads FAILED")
	h.requireReads("c2", types.ConnectionStatusDisconnected)
	all, err := h.ctrl.GetAllConnectionStates(testInvocationContext())
	require.NoError(t, err)
	require.Len(t, all["p2"], 1)
	assert.Equal(t, types.ConnectionStatusDisconnected, all["p2"][0].Readiness, "a connection with the same id in another plugin is not failed")
	assert.Nil(t, all["p2"][0].ReadinessError)

	require.Error(t, h.startErrOn("p2", "c1"))

	h.setStart(nil)
	require.NoError(t, h.startErr("c1"))
	_, connections := startFailureCount(h.ctrl)
	assert.Equal(t, 1, connections, "a start that answered in one plugin clears its own connection's failure and keeps the other plugin's")

	h.failWith(errors.New("refused"))
	require.Error(t, h.startErr("c1"))
	require.NoError(t, h.ctrl.OnPluginStop(failurePlugin, defaultMeta()))
	_, connections = startFailureCount(h.ctrl)
	assert.Equal(t, 1, connections, "unloading one plugin keeps what the other plugin's connections failed with")
}

// What ends the failure of one connection ends that one only.
func TestAStartOrStopOfAnotherConnectionKeepsAFailure(t *testing.T) {
	h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"), listedConnection("c2", "Staging", "https://staging"))
	h.failWith(errors.New("refused"))
	require.Error(t, h.startErr("c1"))
	h.setStart(nil)

	require.NoError(t, h.startErr("c2"))
	require.NoError(t, h.stopErr("c2"))

	state := h.state("c1")
	assert.Equal(t, types.ConnectionStatusFailed, state.Readiness)
	assert.NotNil(t, state.ReadinessError)
}

func (h *failureHarness) startErrOn(pluginID, id string) error {
	_, err := h.ctrl.StartConnection(testInvocationContext(), pluginID, id)
	return err
}

// ============================================================================
// What clears the reason
// ============================================================================

func TestWhatEndsAFailureClearsItAndTheConnectionReadsAsThePluginReportsIt(t *testing.T) {
	c1 := listedConnection("c1", "Prod cluster", "https://prod")
	c2 := listedConnection("c2", "Staging", "https://staging")
	type ending struct {
		name string
		act  func(t *testing.T, h *failureHarness)
		// listed is whether the connection is in the plugin's list when act is done.
		listed bool
	}
	endings := []ending{
		{"a later start that succeeds", func(t *testing.T, h *failureHarness) {
			h.setStart(nil)
			require.NoError(t, h.startErr("c1"))
		}, true},
		{"a stop", func(t *testing.T, h *failureHarness) {
			require.NoError(t, h.stopErr("c1"))
		}, true},
		{"a discovery that no longer lists the connection", func(t *testing.T, h *failureHarness) {
			h.setList(c2)
			h.load()
			requireNoStartFailures(t, h.ctrl, "while the connection is gone")
			h.setList(c1, c2)
			h.load()
		}, true},
		{"a watch refresh that no longer lists the connection", func(t *testing.T, h *failureHarness) {
			h.setList(c2)
			h.watchRefresh()
			requireNoStartFailures(t, h.ctrl, "while the connection is gone")
			h.setList(c1, c2)
			h.watchRefresh()
		}, true},
		{"the removal of the connection", func(t *testing.T, h *failureHarness) {
			require.NoError(t, h.ctrl.RemoveConnection(testInvocationContext(), failurePlugin, "c1"))
		}, false},
		{"a discovery that changes what the connection connects with", func(_ *testing.T, h *failureHarness) {
			h.setList(listedConnection("c1", "Prod cluster", "https://moved"), c2)
			h.load()
		}, true},
		{"a discovery that fails and empties the list", func(t *testing.T, h *failureHarness) {
			h.setListErr(errors.New("discovery failed"))
			_, err := h.ctrl.LoadConnections(testInvocationContext(), failurePlugin)
			require.Error(t, err)
			requireNoStartFailures(t, h.ctrl, "while the list is empty")
			h.setListErr(nil)
			h.load()
		}, true},
		{"the plugin initialising again", func(t *testing.T, h *failureHarness) {
			h.ctrl.OnPluginInit(failurePlugin, defaultMeta())
			requireNoStartFailures(t, h.ctrl, "while the list is empty")
			h.load()
		}, true},
		{"the unload of the plugin", func(t *testing.T, h *failureHarness) {
			require.NoError(t, h.ctrl.OnPluginStop(failurePlugin, defaultMeta()))
			requireNoStartFailures(t, h.ctrl, "while the plugin is unloaded")
			h.register()
			h.load()
		}, true},
	}
	// A start that answers PENDING, DISCONNECTED, UNKNOWN, no status or a word this host does not know did not fail,
	// and it answered: it ends the failure of an earlier start, as every start that answers does, and the connection
	// reads as the provider reports it.
	for _, answer := range answersThatAreNoFailure() {
		endings = append(endings, ending{"a later start that answers " + answer.name, func(t *testing.T, h *failureHarness) {
			h.answers(answer.status)
			require.NoError(t, h.startErr("c1"))
		}, true})
	}
	for _, kind := range failureKinds() {
		t.Run(kind.name, func(t *testing.T) {
			for _, tc := range endings {
				t.Run(tc.name, func(t *testing.T) {
					h := newFailureHarness(t, c1, c2)
					kind.set(h)
					kind.start(t, h, "c1")
					require.Equal(t, types.ConnectionStatusFailed, h.state("c1").Readiness, "the premise: the failure is shown before")

					tc.act(t, h)

					requireNoStartFailures(t, h.ctrl, "after it")
					if tc.listed {
						h.requireReads("c1", types.ConnectionStatusDisconnected)
					}
					h.requireReads("c2", types.ConnectionStatusDisconnected)
				})
			}
		})
	}
}

// A sync that still lists the connection, unchanged or only renamed, is not an end of the failure:
// the watch runs for the plugin's life, and the Problems list must not lose the row at every pass.
func TestASyncThatKeepsTheConnectionKeepsItsFailure(t *testing.T) {
	c1 := listedConnection("c1", "Prod cluster", "https://prod")
	c2 := listedConnection("c2", "Staging", "https://staging")
	for _, kind := range failureKinds() {
		t.Run(kind.name, func(t *testing.T) {
			for _, tc := range []struct {
				name string
				act  func(h *failureHarness)
			}{
				{"a discovery that lists the same connections", func(h *failureHarness) { h.load() }},
				{"a watch refresh that lists the same connections", func(h *failureHarness) { h.watchRefresh() }},
				{"a discovery that only renames the connection", func(h *failureHarness) {
					h.setList(listedConnection("c1", "Prod, renamed", "https://prod"), c2)
					h.load()
				}},
				{"a watch refresh that drops another connection", func(h *failureHarness) {
					h.setList(c1)
					h.watchRefresh()
				}},
				{"a failed start of another connection", func(h *failureHarness) {
					kind.start(h.t, h, "c2")
				}},
			} {
				t.Run(tc.name, func(t *testing.T) {
					h := newFailureHarness(t, c1, c2)
					kind.set(h)
					kind.start(t, h, "c1")

					tc.act(h)

					state := h.state("c1")
					assert.Equal(t, types.ConnectionStatusFailed, state.Readiness)
					assert.NotNil(t, state.ReadinessError)
				})
			}
		})
	}
}

// A connection that left and came back is a new one to the host: what failed before is not its.
func TestAConnectionThatLeftTheListAndCameBackDoesNotBringItsOldFailureBack(t *testing.T) {
	c1 := listedConnection("c1", "Prod cluster", "https://prod")
	h := newFailureHarness(t, c1)
	h.failWith(errors.New("refused"))
	require.Error(t, h.startErr("c1"))
	require.Equal(t, types.ConnectionStatusFailed, h.state("c1").Readiness, "the premise: the failure is shown before the connection leaves")

	h.setList()
	h.watchRefresh()
	h.setList(c1)
	h.watchRefresh()

	h.requireReads("c1", types.ConnectionStatusDisconnected)
}

// ============================================================================
// What publishes nothing
// ============================================================================

func TestAStartThatTheHostRefusesRatherThanTheProviderEmitsNothingAndRecordsNothing(t *testing.T) {
	c1 := listedConnection("c1", "Prod cluster", "https://prod")
	cancelled, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	t.Run("the premise: the provider's own failure is published once on this fixture", func(t *testing.T) {
		h := newFailureHarness(t, c1)
		h.failWith(errors.New("refused"))

		require.Error(t, h.startErr("c1"))

		assert.Len(t, h.statusEvents(), 1)
		_, connections := startFailureCount(h.ctrl)
		assert.Equal(t, 1, connections)
	})
	t.Run("the premise: a failure status the provider answers is published once and kept on this fixture", func(t *testing.T) {
		h := newFailureHarness(t, c1)
		h.answers(types.ConnectionStatusUnauthorized)

		require.NoError(t, h.startErr("c1"))

		assert.Len(t, h.statusEvents(), 1)
		_, connections := startFailureCount(h.ctrl)
		assert.Equal(t, 1, connections)
	})
	for _, tc := range []struct {
		name string
		// run makes the call that is refused and returns what it answered.
		run func(h *failureHarness) error
		// code is the class of the answer, which shows the call was refused where the case says.
		code string
		// providerCalls is how many times the provider was asked to start.
		providerCalls int32
		// shown is whether the connection is in the plugin's list afterwards.
		shown bool
	}{
		{"the plugin is not loaded", func(h *failureHarness) error { return h.startErrOn("nobody", "c1") }, "NOT_FOUND", 0, true},
		{"the plugin cannot start connections", func(h *failureHarness) error {
			registerMockPlugin(h.ctrl, "catalog-only", &catalogOnlyProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
				return canonicalTestCatalog("proof", "pods"), nil
			}})
			return h.startErrOn("catalog-only", "c1")
		}, "UNSUPPORTED", 0, true},
		{"the connection is being reconfigured", func(h *failureHarness) error {
			h.ctrl.pluginsMu.Lock()
			h.ctrl.plugins[failurePlugin].sourceChanging = map[string]bool{"c1": true}
			h.ctrl.pluginsMu.Unlock()
			return h.startErr("c1")
		}, "INTERNAL", 0, false},
		{"the connection's route is retired before the provider is asked", func(h *failureHarness) error {
			registerMockPlugin(h.ctrl, failurePlugin, &featureHookProvider{readinessTestProvider: h.provider, onFeatures: func() { h.retireRoute("c1") }})
			return h.startErr("c1")
		}, "RESET_REQUIRED", 0, true},
		{"the connection's route is retired while the provider starts it", func(h *failureHarness) error {
			h.setStart(func(_ context.Context, id string) (types.ConnectionStatus, error) {
				h.retireRoute(id)
				return h.connected(id), nil
			})
			return h.startErr("c1")
		}, "RESET_REQUIRED", 1, true},
		{"the connection's route is retired while the provider fails to start it", func(h *failureHarness) error {
			h.setStart(func(context.Context, string) (types.ConnectionStatus, error) {
				h.retireRoute("c1")
				return types.ConnectionStatus{}, errors.New("refused")
			})
			return h.startErr("c1")
		}, "PROVIDER_ERROR", 1, true},
		{"the caller gives up while the provider starts the connection", func(h *failureHarness) error {
			h.setStart(func(ctx context.Context, _ string) (types.ConnectionStatus, error) {
				cancel()
				return types.ConnectionStatus{}, ctx.Err()
			})
			_, err := h.ctrl.StartConnection(cancelled, failurePlugin, "c1")
			return err
		}, "CANCELLED", 1, true},
		{"the boundary refuses the call", func(h *failureHarness) error {
			h.ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, _ invocation.Target) error {
				if operation == "resource.StartConnection" {
					return errors.New("denied")
				}
				return nil
			}))
			return h.startErr("c1")
		}, "FORBIDDEN", 0, true},
		{"the host's own catalog admission fails after the provider says connected", func(h *failureHarness) error {
			h.base.CatalogFunc = func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
				return resource.Catalog{}, errors.New("catalog down")
			}
			return h.startErr("c1")
		}, "PROVIDER_ERROR", 1, true},
		{"the connection's route is retired while the provider answers a failure status", func(h *failureHarness) error {
			h.setStart(func(_ context.Context, id string) (types.ConnectionStatus, error) {
				h.retireRoute(id)
				return types.ConnectionStatus{Status: types.ConnectionStatusUnauthorized}, nil
			})
			return h.startErr("c1")
		}, "RESET_REQUIRED", 1, true},
		{"the caller gives up while the provider answers a failure status", func(h *failureHarness) error {
			gaveUp, giveUp := context.WithCancel(testInvocationContext())
			defer giveUp()
			h.setStart(func(context.Context, string) (types.ConnectionStatus, error) {
				giveUp()
				return types.ConnectionStatus{Status: types.ConnectionStatusForbidden}, nil
			})
			_, err := h.ctrl.StartConnection(gaveUp, failurePlugin, "c1")
			return err
		}, "CANCELLED", 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newFailureHarness(t, c1)

			err := tc.run(h)

			assert.Equal(t, tc.code, requireAppError(t, err).Code, "the call was refused where the case says")
			assert.Equal(t, tc.providerCalls, h.startCalls.Load(), "the provider was asked this many times to start")
			assert.Empty(t, h.statusEvents(), "a refusal that is not the provider's failure publishes no connection/status event")
			requireNoStartFailures(t, h.ctrl, "after the refusal")
			if tc.shown {
				h.requireReads("c1", types.ConnectionStatusDisconnected)
			}
		})
	}
}

// featureHookProvider runs a hook where the controller asks the provider for its features, which
// is between the host's capture of the route's generation and its check of it.
type featureHookProvider struct {
	*readinessTestProvider
	onFeatures func()
}

func (p *featureHookProvider) Features(ctx context.Context) (resource.FeatureSet, error) {
	p.onFeatures()
	return resource.DetectFeatures(ctx, p.readinessTestProvider)
}

// ============================================================================
// A start that answers a status without an error
// ============================================================================

// A start can end without an error and answer a status that is not CONNECTED. UNAUTHORIZED and FORBIDDEN
// are the classes the window knows (sign-in needed, access denied), and every other word that says the
// connection did not start is a failure of no class in particular. The window used to remember that class
// itself (outcomeOfStatus in ui-next/plugins/host/connections/words.ts); the host's list has to say it now.
// The answer is a failed start like an error: one event with the status the provider answered and the public
// error of its class, the failure kept, and the list reading FAILED with that error. The status's own Error
// and Details are plugin text and reach no window.
func TestAStartThatAnswersAFailureStatusIsAFailedStartInTheEventTheRecordAndTheList(t *testing.T) {
	for _, tc := range answeredFailures() {
		t.Run(string(tc.status), func(t *testing.T) {
			h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"), listedConnection("c2", "Staging", "https://staging"))
			h.answers(tc.status)

			answered, err := h.ctrl.StartConnection(testInvocationContext(), failurePlugin, "c1")

			require.NoError(t, err, "the provider answered: the caller is given its answer, as before")
			assert.Equal(t, tc.status, answered.Status)
			events := h.statusEvents()
			require.Len(t, events, 1, "one start, one connection/status event")
			event := events[0]
			assert.Equal(t, failurePlugin, event.PluginID)
			assert.Equal(t, "c1", event.ConnectionID)
			assert.Equal(t, string(tc.status), event.Status, "the event says the status the provider answered")
			assert.Equal(t, "Prod cluster", event.Name)
			requirePublicClass(t, tc.code, event.Error, "the event")

			kept := h.keptFailure("c1")
			require.NotNil(t, kept, "the host keeps the failure")
			assert.Equal(t, event.Error, kept, "the record is what the event said")
			_, connections := startFailureCount(h.ctrl)
			assert.Equal(t, 1, connections)

			state := h.state("c1")
			assert.Equal(t, types.ConnectionStatusFailed, state.Readiness, "the list reads a failed start as FAILED, whatever status the provider answered")
			assert.Equal(t, event.Error, state.ReadinessError, "the list says what the event said")
			h.requireReads("c2", types.ConnectionStatusDisconnected)
		})
	}
}

// What the window makes of the error the list carries, by the checks of classOf: a sign-in for UNAUTHORIZED,
// access denied for FORBIDDEN and a failed start for the rest.
func TestTheListGivesTheWindowTheClassOfAnAnsweredFailure(t *testing.T) {
	t.Run("the premise: the provider class reads as unreachable, which is why the rest are not given it", func(t *testing.T) {
		assert.Equal(t, "unreachable", windowClass(t, apperror.ForResource(resource.NewError("PROVIDER_ERROR", ""), "r1")))
	})
	for _, tc := range answeredFailures() {
		t.Run(string(tc.status), func(t *testing.T) {
			h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
			h.answers(tc.status)
			require.NoError(t, h.startErr("c1"))

			events := h.statusEvents()
			require.Len(t, events, 1)
			assert.Equal(t, tc.window, windowClass(t, h.state("c1").ReadinessError), "what the window makes of the error of the list")
			assert.Equal(t, tc.window, windowClass(t, events[0].Error), "what the window makes of the error of the event")
		})
	}
}

// A status whose Error and Details hold a path, an address and a token never reaches the event, the
// record or the list: the host gives the class and nothing of the status's text.
func TestAnAnsweredFailureCarriesNoTextOfThePluginInTheEventTheRecordOrTheList(t *testing.T) {
	for _, tc := range answeredFailures() {
		t.Run(string(tc.status), func(t *testing.T) {
			h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
			h.answers(tc.status)
			require.NoError(t, h.startErr("c1"))

			events := h.statusEvents()
			require.Len(t, events, 1)
			kept := h.keptFailure("c1")
			require.NotNil(t, kept)
			listError := h.state("c1").ReadinessError
			require.NotNil(t, listError)
			for _, where := range []struct{ name, encoded string }{
				{"the event", marshalled(t, events[0])},
				{"the record", marshalled(t, kept)},
				{"the list", marshalled(t, h.states())},
			} {
				for _, fragment := range hostileFragments() {
					assert.NotContains(t, where.encoded, fragment, "%s carries plugin text", where.name)
				}
			}
			class := publicClass(t, tc.code)
			assert.Contains(t, marshalled(t, events[0]), class.Detail, "the event says what the class says")
			assert.Contains(t, marshalled(t, listError), class.Detail, "the list says what the class says")
		})
	}
}

// The event of an answered failure is named as the event of every answered start always was: the
// connection the provider returned, else its id.
func TestTheEventOfAnAnsweredFailureIsNamedAsTodaysEventIs(t *testing.T) {
	h := newFailureHarness(t, listedConnection("c1", "Listed name", "https://prod"))
	h.setStart(func(context.Context, string) (types.ConnectionStatus, error) {
		return types.ConnectionStatus{Status: types.ConnectionStatusForbidden, Connection: &types.Connection{ID: "c1", Name: "Name the provider returned"}}, nil
	})
	require.NoError(t, h.startErr("c1"))
	h.setStart(func(context.Context, string) (types.ConnectionStatus, error) {
		return types.ConnectionStatus{Status: types.ConnectionStatusForbidden}, nil
	})
	require.NoError(t, h.startErr("c1"))

	events := h.statusEvents()
	require.Len(t, events, 2)
	assert.Equal(t, "Name the provider returned", events[0].Name)
	assert.Equal(t, "c1", events[1].Name)
	for _, event := range events {
		assert.NotNil(t, event.Error)
	}
}

// PENDING is a start in progress, DISCONNECTED and UNKNOWN say only that no client is registered, and no status,
// or a word this host does not know, says nothing of a failure: none of them is a failure. The start publishes
// the one event it always did, with no error key, and keeps nothing.
func TestAStartThatAnswersAStatusThatIsNotAFailureRecordsNothingAndEmitsAsBefore(t *testing.T) {
	for _, tc := range answersThatAreNoFailure() {
		t.Run(tc.name, func(t *testing.T) {
			status := tc.status
			h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"), listedConnection("c2", "Staging", "https://staging"))
			// The premise, which needs the failure statuses to be failed starts: c1's answer is published and kept.
			h.answers(types.ConnectionStatusUnauthorized)
			require.NoError(t, h.startErr("c1"))
			premise := h.statusEvents()
			require.Len(t, premise, 1)
			require.NotNil(t, premise[0].Error, "the premise: a failure status is told with its error")

			h.answers(status)
			answered, err := h.ctrl.StartConnection(testInvocationContext(), failurePlugin, "c2")

			require.NoError(t, err)
			assert.Equal(t, status, answered.Status)
			events := h.statusEvents()
			require.Len(t, events, 2, "one event for the one start")
			assert.Equal(t, "c2", events[1].ConnectionID)
			assert.Equal(t, string(status), events[1].Status)
			assert.Equal(t, "Staging", events[1].Name)
			assert.Nil(t, events[1].Error, "a status that is not a failure has no reason")
			assert.NotContains(t, marshalled(t, events[1]), `"error"`, "an event without a reason has no error key, as before")
			assert.Nil(t, h.keptFailure("c2"), "nothing is kept for it")
			_, connections := startFailureCount(h.ctrl)
			assert.Equal(t, 1, connections, "only the failure of c1 is kept")
			h.requireReads("c2", types.ConnectionStatusDisconnected)
		})
	}
}

// A later start that answers another failure replaces the failure of the earlier one, whichever way that failed:
// the failure kept is the last start's, one for each connection.
func TestAStartThatAnswersAnotherFailureReplacesTheFailureOfAnEarlierStart(t *testing.T) {
	h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
	h.failWith(errors.New("refused"))
	require.Error(t, h.startErr("c1"))
	requireKept := func(code string) {
		t.Helper()
		kept := h.keptFailure("c1")
		require.NotNil(t, kept)
		assert.Equal(t, code, kept.Code, "the failure kept is the last start's")
		listed := h.state("c1").ReadinessError
		require.NotNil(t, listed)
		assert.Equal(t, code, listed.Code, "the list says it")
		_, connections := startFailureCount(h.ctrl)
		assert.Equal(t, 1, connections, "one failure for the connection, never one for each start")
	}
	requireKept("PROVIDER_ERROR")

	h.answers(types.ConnectionStatusUnauthorized)
	require.NoError(t, h.startErr("c1"))
	requireKept("UNAUTHORIZED")

	h.answers(types.ConnectionStatusForbidden)
	require.NoError(t, h.startErr("c1"))
	requireKept("FORBIDDEN")

	h.failWith(errors.New("refused"))
	require.Error(t, h.startErr("c1"))
	requireKept("PROVIDER_ERROR")
	assert.Len(t, h.statusEvents(), 4, "one event for each start")
}

// Whatever a start answers, it emits one connection/status event: not none, and not the failure's and then the answer's.
func TestEachStartEmitsOneEventWhateverItAnswers(t *testing.T) {
	h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
	failures := make(map[types.ConnectionStatusCode]bool)
	var statuses []types.ConnectionStatusCode
	for _, tc := range answeredFailures() {
		failures[tc.status] = true
		statuses = append(statuses, tc.status)
	}
	for _, answer := range answersThatAreNoFailure() {
		statuses = append(statuses, answer.status)
	}
	statuses = append(statuses, types.ConnectionStatusConnected, types.ConnectionStatusForbidden)
	for i, status := range statuses {
		if status == types.ConnectionStatusConnected {
			h.setStart(nil)
		} else {
			h.answers(status)
		}

		_, err := h.ctrl.StartConnection(testInvocationContext(), failurePlugin, "c1")

		require.NoError(t, err)
		events := h.statusEvents()
		require.Len(t, events, i+1, "the start that answered %s emitted one event", status)
		assert.Equal(t, string(status), events[i].Status)
		assert.Equal(t, failures[status], events[i].Error != nil, "the event of %s has its error exactly when the status is a failure", status)
	}
}

// The error key is the reason of a failed start and of nothing else: the event of a start that
// succeeded and the event of a stop are what they always were.
func TestOnlyTheFailedEventOfAStartThatErroredHasAnErrorKey(t *testing.T) {
	h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
	h.failWith(errors.New("refused"))
	require.Error(t, h.startErr("c1"))
	h.setStart(nil)

	require.NoError(t, h.startErr("c1"))
	require.NoError(t, h.stopErr("c1"))

	events := h.statusEvents()
	require.Len(t, events, 3)
	assert.Contains(t, marshalled(t, events[0]), `"error":{`, "the FAILED event says why")
	for _, event := range events[1:] {
		assert.Nil(t, event.Error)
		assert.NotContains(t, marshalled(t, event), `"error"`)
	}
}

// ============================================================================
// What outlives nothing
// ============================================================================

func TestTheFailuresKeptNeverOutnumberTheConnectionsThatAreStillListed(t *testing.T) {
	h := newFailureHarness(t)
	h.failWith(errors.New("refused"))

	const rounds = 60
	for round := range rounds {
		id := "c" + strconv.Itoa(round)
		h.setList(listedConnection(id, id, "https://"+id))
		h.watchRefresh()
		require.Error(t, h.startErr(id))
		plugins, connections := startFailureCount(h.ctrl)
		require.Equal(t, 1, plugins)
		require.Equal(t, 1, connections, "round %d: the failure of every connection that left the list went with it", round)
	}

	h.setList()
	h.watchRefresh()
	requireNoStartFailures(t, h.ctrl, "once no connection is listed")
}

func TestAFailedStartOfAConnectionThatIsNotListedLeavesNothingKept(t *testing.T) {
	h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
	h.failWith(errors.New("refused"))

	for round := range 200 {
		require.Error(t, h.startErr("ghost"+strconv.Itoa(round)))
	}

	requireNoStartFailures(t, h.ctrl, "for connections the plugin never listed")
	assert.Len(t, h.statusEvents(), 200, "each of those starts still told the windows that it failed")
}

func TestUnloadingAPluginDropsEveryFailureItHeld(t *testing.T) {
	var listed []types.Connection
	for i := range 40 {
		listed = append(listed, listedConnection("c"+strconv.Itoa(i), "c"+strconv.Itoa(i), "https://prod"))
	}
	h := newFailureHarness(t, listed...)
	h.failWith(errors.New("refused"))
	for _, connection := range listed {
		require.Error(t, h.startErr(connection.ID))
	}
	_, connections := startFailureCount(h.ctrl)
	require.Equal(t, len(listed), connections, "the premise: every failure is kept while the plugin is loaded")

	require.NoError(t, h.ctrl.OnPluginStop(failurePlugin, defaultMeta()))

	requireNoStartFailures(t, h.ctrl, "after the plugin was unloaded")
}

// ============================================================================
// Forced orders
// ============================================================================

// The provider answers after the plugin was unloaded, and after a new generation of it listed the
// same connection again. The answer belongs to the generation that asked: it publishes nothing and
// the new generation's connection is not failed by it.
func TestAFailureThatArrivesAfterTheGenerationWasRetiredIsNeitherEmittedNorKept(t *testing.T) {
	c1 := listedConnection("c1", "Prod cluster", "https://prod")
	h := newFailureHarness(t, c1)
	entered, release := make(chan struct{}), make(chan struct{})
	h.setStart(func(context.Context, string) (types.ConnectionStatus, error) {
		close(entered)
		<-release
		return types.ConnectionStatus{}, errors.New("refused")
	})
	answered := make(chan error, 1)
	go func() { answered <- h.startErr("c1") }()
	<-entered

	require.NoError(t, h.ctrl.OnPluginStop(failurePlugin, defaultMeta()))
	h.setStart(nil)
	h.register()
	// A profile transaction waits for the start that is in flight, so the new generation's list is set as its discovery would.
	h.ctrl.connsMu.Lock()
	h.ctrl.connections[failurePlugin] = []types.Connection{c1}
	h.ctrl.connsMu.Unlock()
	close(release)
	err := <-answered

	require.Error(t, err, "the caller is still told that its start failed")
	assert.Empty(t, h.statusEvents(), "the retired generation's failure is not published")
	requireNoStartFailures(t, h.ctrl, "after the old generation answered")
	h.requireReads("c1", types.ConnectionStatusDisconnected)

	// The guard did not make the plugin deaf: the new generation's own failure is published and kept.
	h.failWith(errors.New("refused"))
	require.Error(t, h.startErr("c1"))
	assert.Len(t, h.statusEvents(), 1)
	assert.Equal(t, types.ConnectionStatusFailed, h.state("c1").Readiness)
}

// The provider answers a failure status after the plugin was unloaded, and after a new generation of it listed
// the same connection again. The answer belongs to the generation that asked: the host refuses it, it publishes
// nothing and the new generation's connection is not failed by it.
func TestAnAnsweredFailureThatArrivesAfterTheGenerationWasRetiredIsNeitherEmittedNorKept(t *testing.T) {
	c1 := listedConnection("c1", "Prod cluster", "https://prod")
	h := newFailureHarness(t, c1)
	entered, release := make(chan struct{}), make(chan struct{})
	h.setStart(func(context.Context, string) (types.ConnectionStatus, error) {
		close(entered)
		<-release
		return types.ConnectionStatus{Status: types.ConnectionStatusUnauthorized}, nil
	})
	answered := make(chan error, 1)
	go func() { answered <- h.startErr("c1") }()
	<-entered

	require.NoError(t, h.ctrl.OnPluginStop(failurePlugin, defaultMeta()))
	h.setStart(nil)
	h.register()
	h.ctrl.connsMu.Lock()
	h.ctrl.connections[failurePlugin] = []types.Connection{c1}
	h.ctrl.connsMu.Unlock()
	close(release)
	err := <-answered

	require.Error(t, err, "the host refuses the answer of the generation that was retired")
	assert.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	assert.Empty(t, h.statusEvents(), "the retired generation's failure is not published")
	requireNoStartFailures(t, h.ctrl, "after the old generation answered")
	h.requireReads("c1", types.ConnectionStatusDisconnected)

	// The guard did not make the plugin deaf: the new generation's own answered failure is published and kept.
	h.answers(types.ConnectionStatusForbidden)
	require.NoError(t, h.startErr("c1"))
	assert.Len(t, h.statusEvents(), 1)
	assert.Equal(t, types.ConnectionStatusFailed, h.state("c1").Readiness)
}

// The failure is kept before it is announced, so a window that reads the list on the event finds it.
func TestTheFailureIsKeptBeforeTheEventIsEmitted(t *testing.T) {
	for _, kind := range failureKinds() {
		t.Run(kind.name, func(t *testing.T) {
			h := newFailureHarness(t, listedConnection("c1", "Prod cluster", "https://prod"))
			kind.set(h)
			var shown atomic.Value
			h.ctrl.emitter = emitterFunc(func(key string, _ ...any) {
				if key != EventConnectionStatus {
					return
				}
				all, err := h.ctrl.GetAllConnectionStates(testInvocationContext())
				if err == nil && len(all[failurePlugin]) == 1 {
					shown.Store(all[failurePlugin][0])
				}
			})

			kind.start(t, h, "c1")

			state, ok := shown.Load().(ConnectionState)
			require.True(t, ok, "the event was emitted")
			assert.Equal(t, types.ConnectionStatusFailed, state.Readiness, "the list read from inside the event already says FAILED")
			assert.NotNil(t, state.ReadinessError)
		})
	}
}

// emitterFunc is an EventEmitter that runs a function.
type emitterFunc func(key string, data ...any)

func (f emitterFunc) Emit(key string, data ...any) { f(key, data...) }

// ============================================================================
// Overlapping operations
// ============================================================================

// Starts that fail or succeed, stops, syncs and reads run together. Whatever order they take, the
// failures kept are those of connections that are still listed.
func TestFailuresKeptStayWithinTheListUnderOverlappingStartsStopsSyncsAndReads(t *testing.T) {
	const connections, rounds = 6, 12
	listed := make([]types.Connection, connections)
	for i := range listed {
		listed[i] = listedConnection("c"+strconv.Itoa(i), "c"+strconv.Itoa(i), "https://prod")
	}
	h := newFailureHarness(t, listed...)
	var answers atomic.Int32
	h.setStart(func(_ context.Context, id string) (types.ConnectionStatus, error) {
		switch answers.Add(1) % 4 {
		case 0:
			return types.ConnectionStatus{}, errors.New("refused")
		case 2:
			return types.ConnectionStatus{Status: types.ConnectionStatusUnauthorized}, nil
		default:
			return h.connected(id), nil
		}
	})

	var wg sync.WaitGroup
	for _, connection := range listed {
		wg.Go(func() {
			for range rounds {
				_, _ = h.ctrl.StartConnection(testInvocationContext(), failurePlugin, connection.ID)
				_, _ = h.ctrl.StopConnection(testInvocationContext(), failurePlugin, connection.ID)
				_, _ = h.ctrl.StartConnection(testInvocationContext(), failurePlugin, connection.ID)
			}
		})
	}
	wg.Go(func() {
		for round := range rounds {
			h.setList(listed[round%connections:]...)
			_, _ = h.ctrl.LoadConnections(testInvocationContext(), failurePlugin)
		}
	})
	wg.Go(func() {
		for range rounds * 2 {
			_, _ = h.ctrl.GetAllConnectionStates(testInvocationContext())
		}
	})
	wg.Wait()

	requireFailuresWithinTheList(t, h.ctrl)

	// Whatever the overlap left behind, a listed connection fails and is kept as usual.
	h.setList(listed...)
	h.load()
	h.failWith(errors.New("refused"))
	for _, connection := range listed {
		require.Error(t, h.startErr(connection.ID))
	}
	_, kept := startFailureCount(h.ctrl)
	require.Equal(t, connections, kept, "after the overlap every listed connection can fail and be kept")
}

// requireFailuresWithinTheList says every failure kept is one of a connection the plugin lists.
func requireFailuresWithinTheList(t *testing.T, ctrl *controller) {
	t.Helper()
	ctrl.connsMu.RLock()
	defer ctrl.connsMu.RUnlock()
	inList := make(map[string]bool)
	for _, connection := range ctrl.connections[failurePlugin] {
		inList[connection.ID] = true
	}
	for id := range ctrl.startFailures[failurePlugin] {
		assert.True(t, inList[id], "a failure is kept for %s, which the plugin no longer lists", id)
	}
	assert.LessOrEqual(t, len(ctrl.startFailures[failurePlugin]), len(inList))
}
