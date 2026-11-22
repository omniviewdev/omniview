package resource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Since plugin-sdk v0.21.0 the SDK carries the sentence of a provider's error across the
// gRPC transport and its client restores it into ResourceOperationError.Message; before it
// restored a placeholder. The rule the host keeps for that text: the user receives it only
// through apperror.ForResource, which cleans it (PublicText) or refuses it, and no log,
// event or other sink receives it in any other form. The tests below hold the rule at every
// place the controller hands a provider's error on, with a sentence the gate must refuse:
// escape bytes, a credential-shaped pair and a path into a user's home.

const (
	sinkHostile = "SINK-HOSTILE \x1b[31mlogin failed: password=hunter2 reading /Users/someone/.kube/config\x1b[0m"
	sinkBenign  = "SINK-BENIGN the cluster did not answer in time"
)

// ungated reports whether text still carries anything of sinkHostile: the marker, either half
// of what the gate refuses, or the escape byte (raw, or as JSON writes it).
func ungated(text string) bool {
	for _, part := range []string{"SINK-HOSTILE", "hunter2", "/Users/someone", "\x1b", `\u001b`} {
		if strings.Contains(text, part) {
			return true
		}
	}
	return false
}

// providerFailure is what a plugin's provider returns: a typed error whose Message is
// sentence, with a title, a suggestion and a native cause that never cross the transport.
func providerFailure(class, sentence string) func() error {
	return func() error {
		return &resourcev2.ResourceOperationError{
			Code: class, Title: "PLUGIN-TITLE", Message: sentence,
			Suggestions: []string{"PLUGIN-SUGGESTION"}, Err: errors.New("native secret"),
		}
	}
}

// newSinkController is newTestControllerWithEmitter with a logger that keeps every record.
func newSinkController(t *testing.T) (*controller, *recordingEmitter, *logtest.RecordingSink) {
	t.Helper()
	emitter := newRecordingEmitter()
	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{Name: "sinks", Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug)})
	ctrl, ok := NewController(logger, nil, appstate.NewTestService(t).PluginStore, nil).(*controller)
	require.True(t, ok, "NewController returns the resource controller")
	ctrl.emitter = emitter
	t.Cleanup(ctrl.actions.stopAll)
	t.Cleanup(func() {
		ctrl.pluginsMu.Lock()
		defer ctrl.pluginsMu.Unlock()
		for _, state := range ctrl.plugins {
			if state.cancel != nil {
				state.cancel()
			}
		}
	})
	return ctrl, emitter, sink
}

// failingProvider fails every operation after the catalog with fail().
func failingProvider(fail func() error) *mockProvider {
	return &mockProvider{
		CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			return canonicalTestCatalog("p1", "native::Pod"), nil
		},
		GetFunc: func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
			return resourcev2.Record{}, fail()
		},
		EnumerateFunc: func(context.Context, resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
			return resourcev2.SourcePage{}, fail()
		},
		NativeQueryFunc: func(context.Context, resourcev2.NativeQueryRequest) (resourcev2.SourcePage, error) {
			return resourcev2.SourcePage{}, fail()
		},
		MutateFunc: func(context.Context, resourcev2.MutationRequest) (resourcev2.Record, error) {
			return resourcev2.Record{}, fail()
		},
		ActionFunc: func(context.Context, resourcev2.ActionRequest) (resourcev2.Value, error) {
			return resourcev2.Value{}, fail()
		},
		StartConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{}, fail()
		},
		StopConnectionFunc: func(context.Context, string) (types.Connection, error) {
			return types.Connection{}, fail()
		},
		CheckConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{}, fail()
		},
		LoadConnectionsFunc: func(context.Context) ([]types.Connection, error) { return nil, fail() },
		ListConnectionsFunc: func(context.Context) ([]types.Connection, error) { return nil, fail() },
		GetConnectionFunc: func(context.Context, string) (types.Connection, error) {
			return types.Connection{}, fail()
		},
		WatchConnectionsFunc: func(context.Context, chan<- []types.Connection) error { return fail() },
		GetResourceGroupsFunc: func(context.Context, resourcev2.AccessRoute) ([]resourcev2.ResourceGroup, error) {
			return nil, fail()
		},
		GetResourceDefinitionFunc: func(context.Context, resourcev2.AccessRoute, string) (resourcev2.ResourceDefinition, error) {
			return resourcev2.ResourceDefinition{}, fail()
		},
		ScopeValuesFunc: func(context.Context, resourcev2.AccessRoute, string) ([]string, error) { return nil, fail() },
		GetActionsFunc: func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.ActionDescriptor, error) {
			return nil, fail()
		},
		StreamActionFunc: func(context.Context, resourcev2.ActionRequest, chan<- resourcev2.ActionEvent) error {
			return fail()
		},
		ResolveSchemaFunc: func(context.Context, resourcev2.SchemaRequest) (resourcev2.SchemaBinding, error) {
			return resourcev2.SchemaBinding{}, fail()
		},
		GetSchemaDocumentFunc: func(context.Context, resourcev2.AccessRoute, resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
			return resourcev2.SchemaDocument{}, fail()
		},
		GetRelationshipsFunc: func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.RelationshipDescriptor, error) {
			return nil, fail()
		},
		ResolveRelationshipsFunc: func(context.Context, resourcev2.RelationshipResolutionRequest) ([]resourcev2.ResolvedRelationship, error) {
			return nil, fail()
		},
		GetHealthFunc: func(context.Context, resourcev2.GetRequest, resourcev2.Value) (*resourcev2.ResourceHealth, error) {
			return nil, fail()
		},
		GetResourceEventsFunc: func(context.Context, resourcev2.GetRequest, uint32) ([]resourcev2.ResourceEvent, error) {
			return nil, fail()
		},
	}
}

// recordText is everything one log record holds, stringified.
func recordText(record logging.Record) string {
	var text strings.Builder
	text.WriteString(record.Message)
	for _, field := range record.Fields {
		fmt.Fprintf(&text, " %s=%v", field.Key, field.Value)
	}
	return text.String()
}

// ungatedSinks lists every event the controller emitted and every log record it wrote that
// still holds anything of sinkHostile.
func ungatedSinks(emitter *recordingEmitter, sink *logtest.RecordingSink) []string {
	var found []string
	for _, event := range emitter.Events() {
		encoded, err := json.Marshal(event.Data)
		if err != nil {
			encoded = []byte(fmt.Sprintf("%v", event.Data))
		}
		if ungated(string(encoded)) {
			found = append(found, "event "+event.Key+": "+string(encoded))
		}
	}
	for _, record := range sink.Records() {
		if text := recordText(record); ungated(text) {
			found = append(found, "log "+text)
		}
	}
	return found
}

// Every entry point of the controller that reaches the provider, driven with a provider
// that fails each operation with sinkHostile: the error each returns, the events the
// controller emits and the log records it writes hold none of the sentence. The same run with
// an honest sentence shows the scan is not blind: the caller receives it where the class
// may show it (Get).
func TestProviderSentenceReachesNoUngatedSink(t *testing.T) {
	for _, class := range []string{"NOT_FOUND", "TIMEOUT"} {
		t.Run(class, func(t *testing.T) {
			ctrl, emitter, sink := newSinkController(t)
			registerMockPlugin(ctrl, "p1", setupGRPCProvider(t, failingProvider(providerFailure(class, sinkHostile))))
			ctx := testInvocationContext()
			route := resourcev2.AccessRoute{Connection: "conn-1"}
			getRequest := admittedGetRequest(t, ctrl, "p1", "conn-1", "native::Pod", "pod-1")
			target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
			actionRequest := admittedActionRequest(t, ctrl, "p1", "conn-1", "native::Pod", "inspect")
			schemaRequest := targetedSchemaRequest("conn-1", "native::Pod")

			calls := map[string]func(context.Context) error{
				"Get": func(ctx context.Context) error { _, err := ctrl.Get(ctx, "p1", getRequest); return err },
				"Enumerate": func(ctx context.Context) error {
					_, err := ctrl.Enumerate(ctx, "p1", HostEnumerateRequest{TargetID: target.TargetID, Request: resourcev2.EnumerateRequest{Target: target.Target}})
					return err
				},
				"NativeQuery": func(ctx context.Context) error {
					_, err := ctrl.NativeQuery(ctx, "p1", HostNativeQueryRequest{TargetID: target.TargetID, Request: resourcev2.NativeQueryRequest{Target: target.Target, Language: "native", Query: resourcev2.Value{Kind: "null"}}})
					return err
				},
				"Mutate": func(ctx context.Context) error {
					_, err := ctrl.Mutate(ctx, "p1", resourcev2.MutationRequest{Route: route, Reference: getRequest.Request.Reference, Operation: "update", Input: resourcev2.Value{Kind: "null"}})
					return err
				},
				"Action": func(ctx context.Context) error { _, err := ctrl.Action(ctx, "p1", actionRequest); return err },
				"GetActions": func(ctx context.Context) error {
					_, err := ctrl.GetActions(ctx, "p1", route, "native::Pod")
					return err
				},
				"GetRelationships": func(ctx context.Context) error {
					_, err := ctrl.GetRelationships(ctx, "p1", route, "native::Pod")
					return err
				},
				"ResolveRelationships": func(ctx context.Context) error {
					_, err := ctrl.ResolveRelationships(ctx, "p1", getRequest.Request)
					return err
				},
				"GetHealth": func(ctx context.Context) error {
					_, err := ctrl.GetHealth(ctx, "p1", getRequest.Request, resourcev2.Value{Kind: "null"})
					return err
				},
				"GetResourceEvents": func(ctx context.Context) error {
					_, err := ctrl.GetResourceEvents(ctx, "p1", getRequest.Request, 10)
					return err
				},
				"GetResourceGroups": func(ctx context.Context) error { _, err := ctrl.GetResourceGroups(ctx, "p1", route); return err },
				"GetResourceDefinition": func(ctx context.Context) error {
					_, err := ctrl.GetResourceDefinition(ctx, "p1", route, "native::Pod")
					return err
				},
				"ScopeValues": func(ctx context.Context) error {
					catalog, err := ctrl.Catalog(ctx, "p1", resourcev2.CatalogRequest{Route: route})
					if err != nil {
						return err
					}
					_, err = ctrl.ScopeValues(resourcev2.WithCatalogRevision(ctx, catalog.Revision), "p1", route, "namespace")
					return err
				},
				"ResolveSchema": func(ctx context.Context) error { _, err := ctrl.ResolveSchema(ctx, "p1", schemaRequest); return err },
				"StreamAction":  func(ctx context.Context) error { _, err := ctrl.StreamAction(ctx, "p1", actionRequest); return err },
				"Features":      func(ctx context.Context) error { _, err := ctrl.Features(ctx, "p1"); return err },
				"StartConnection": func(ctx context.Context) error {
					_, err := ctrl.StartConnection(ctx, "p1", "conn-1")
					return err
				},
				"StopConnection": func(ctx context.Context) error {
					_, err := ctrl.StopConnection(ctx, "p1", "conn-1")
					return err
				},
				"CheckConnection": func(ctx context.Context) error {
					_, err := ctrl.CheckConnection(ctx, "p1", "conn-1")
					return err
				},
				"LoadConnections": func(ctx context.Context) error { _, err := ctrl.LoadConnections(ctx, "p1"); return err },
			}
			var leaks []string
			for name, call := range calls {
				callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
				err := call(callCtx)
				cancel()
				if err != nil && ungated(err.Error()) {
					leaks = append(leaks, "the error "+name+" returns: "+err.Error())
				}
			}
			time.Sleep(300 * time.Millisecond) // the action stream and the connection listeners publish on their own
			leaks = append(leaks, ungatedSinks(emitter, sink)...)
			require.Empty(t, leaks, "the provider's sentence reached these sinks without the gate")
		})
	}

	t.Run("the scan sees an honest sentence where it is delivered", func(t *testing.T) {
		ctrl, _, _ := newSinkController(t)
		registerMockPlugin(ctrl, "p1", setupGRPCProvider(t, failingProvider(providerFailure("NOT_FOUND", sinkBenign))))
		_, err := ctrl.Get(testInvocationContext(), "p1", admittedGetRequest(t, ctrl, "p1", "conn-1", "native::Pod", "pod-1"))
		require.Error(t, err)
		require.Contains(t, err.Error(), sinkBenign)
	})
}

// The two log sites that wrote the restored error, and with it the sentence as JSON, write the
// class the rest of the package logs: CheckConnection's "RPC failed" and the crash recovery
// that a connection error or a dead event stream triggers. The redaction of the log core
// reads plain text and misses a secret in quotes or JSON, so the sentence must not get there.
func TestRPCFailureLogsCarryTheClassNotTheProviderSentence(t *testing.T) {
	fieldOf := func(record logging.Record, key string) (any, bool) {
		for _, field := range record.Fields {
			if field.Key == key {
				return field.Value, true
			}
		}
		return nil, false
	}
	recordNamed := func(t *testing.T, sink *logtest.RecordingSink, prefix string) logging.Record {
		t.Helper()
		for _, record := range sink.Records() {
			if strings.HasPrefix(record.Message, prefix) {
				return record
			}
		}
		t.Fatalf("no log record starts with %q", prefix)
		return logging.Record{}
	}

	t.Run("CheckConnection", func(t *testing.T) {
		ctrl, _, sink := newSinkController(t)
		registerMockPlugin(ctrl, "p1", setupGRPCProvider(t, failingProvider(providerFailure("NOT_FOUND", sinkHostile))))
		_, err := ctrl.CheckConnection(testInvocationContext(), "p1", "conn-1")
		require.Error(t, err)

		record := recordNamed(t, sink, "RPC failed")
		class, ok := fieldOf(record, "errorClass")
		require.True(t, ok, "the record names the class: %s", recordText(record))
		require.Equal(t, "NOT_FOUND", class)
		_, hasError := fieldOf(record, "error")
		require.False(t, hasError, "the record carries the error itself: %s", recordText(record))
		require.False(t, ungated(recordText(record)), recordText(record))
	})

	t.Run("crash recovery", func(t *testing.T) {
		ctrl, _, sink := newSinkController(t)
		client := setupGRPCProvider(t, failingProvider(providerFailure("UNAVAILABLE", sinkHostile)))
		_, err := client.CheckConnection(testInvocationContext(), "conn-1")
		require.Error(t, err)
		var restored *resourcev2.ResourceOperationError
		require.ErrorAs(t, err, &restored)
		require.Equal(t, sinkHostile, restored.Message, "the premise: the SDK client restores the sentence")

		ctrl.triggerCrashRecovery("p1", err, "connection")

		record := recordNamed(t, sink, "plugin event stream died")
		class, ok := fieldOf(record, "errorClass")
		require.True(t, ok, "the record names the class: %s", recordText(record))
		require.Equal(t, "UNAVAILABLE", class)
		require.False(t, ungated(recordText(record)), recordText(record))
	})
}

// A failing source stream and a failing connection watch, the two listeners that publish on
// their own, hand the page host text and the log a class, never the sentence.
func TestProviderSentenceInASourceAndAWatchFailureReachesNoUngatedSink(t *testing.T) {
	ctrl, emitter, sink := newSinkController(t)
	provider := &failingSourceProvider{mockProvider: failingProvider(providerFailure("NOT_FOUND", sinkHostile))}
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := canonicalTestCatalog("p1", "native::Pod")
		for i := range catalog.Types {
			catalog.Types[i].DefaultRepresentation = "native"
			catalog.Types[i].Capabilities = append(catalog.Types[i].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
		}
		return catalog, nil
	}
	provider.fail = providerFailure("NOT_FOUND", sinkHostile)
	registerMockPlugin(ctrl, "p1", setupGRPCProvider(t, provider))
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")

	opened, err := ctrl.OpenSourceView(testInvocationContext(), "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "ifSupported"})
	require.NoError(t, err)
	require.NoError(t, ctrl.SyncSourceView(testInvocationContext(), "p1", opened.ViewID))

	ctrl.pluginsMu.RLock()
	state := ctrl.plugins["p1"]
	ctrl.pluginsMu.RUnlock()
	browser, ok := state.provider.(resourcev2.ConnectionBrowser)
	require.True(t, ok)
	go ctrl.listenForConnectionEvents(state.ctx, "p1", browser, state) // as OnPluginStart starts it

	require.Eventually(t, func() bool { return loggedRecord(sink, "plugin event stream died") }, 10*time.Second, 10*time.Millisecond,
		"the connection watch failed and its listener logged it")
	require.Eventually(t, func() bool { return loggedRecord(sink, "source session failed") }, 10*time.Second, 10*time.Millisecond,
		"the source session failed with the provider's typed error and logged it")
	time.Sleep(300 * time.Millisecond) // the source view's failure is published on its own
	require.Empty(t, ungatedSinks(emitter, sink), "the provider's sentence reached these sinks without the gate")
}

// failingSourceProvider fails the source stream, and says it has source sessions and a connection browser.
type failingSourceProvider struct {
	*mockProvider
	fail func() error
}

func (p *failingSourceProvider) Features(context.Context) (resourcev2.FeatureSet, error) {
	return resourcev2.FeatureSet{Traits: []resourcev2.Feature{resourcev2.FeatureConnections, resourcev2.FeatureSourceSessions, resourcev2.FeatureConnectionBrowser}}, nil
}

// OpenSource is what the SDK's server calls to serve a source session (the host-side
// OpenSourceStream is the client's, and a server never calls it): the provider fails before its
// first frame, and the client restores the error with its sentence.
func (p *failingSourceProvider) OpenSource(context.Context, resourcev2.SourceOpenRequest, resourcev2.SourceEmitter) error {
	return p.fail()
}

// loggedRecord reports whether the sink holds a record whose message starts with prefix.
func loggedRecord(sink *logtest.RecordingSink, prefix string) bool {
	for _, record := range sink.Records() {
		if strings.HasPrefix(record.Message, prefix) {
			return true
		}
	}
	return false
}

// An auto-connect attempt that fails logs StartConnection's own return, which is gated, and the
// goroutine that does it is the one no call of the sweep above runs.
func TestProviderSentenceInAnAutoConnectFailureReachesNoUngatedSink(t *testing.T) {
	ctrl, emitter, sink := newSinkController(t)
	registerMockPlugin(ctrl, "p1", setupGRPCProvider(t, failingProvider(providerFailure("NOT_FOUND", sinkHostile))))
	connection := types.Connection{ID: "conn-1", Lifecycle: types.ConnectionLifecycle{AutoConnect: &types.ConnectionAutoConnect{
		Enabled:  true,
		Triggers: []types.ConnectionAutoConnectTrigger{types.ConnectionAutoConnectTriggerPluginStart},
		Retry:    types.ConnectionAutoConnectRetryNone,
	}}}

	ctrl.scheduleAutoConnect("p1", []types.Connection{connection}, types.ConnectionAutoConnectTriggerPluginStart)

	require.Eventually(t, func() bool { return loggedRecord(sink, "auto-connect attempt failed") }, 10*time.Second, 10*time.Millisecond,
		"the attempt failed with the provider's typed error and logged it")
	require.Empty(t, ungatedSinks(emitter, sink), "the provider's sentence reached these sinks without the gate")
}

// failingAction serves a provider whose action is advertised on a lane and fails with a typed
// error carrying sinkHostile: the finite lane fails at once, the streaming lane after its
// stream is ready (a failure before that is the call's own error, which finishResource gates).
func failingAction(t *testing.T, streaming bool) (*controller, *recordingEmitter, *logtest.RecordingSink, resourcev2.ActionRequest) {
	t.Helper()
	ctrl, emitter, sink := newSinkController(t)
	descriptor := resourcev2.ActionDescriptor{ID: "inspect", Scope: resourcev2.ActionScopeInstance, Streaming: streaming}
	fail := providerFailure("NOT_FOUND", sinkHostile)
	provider := failingProvider(fail)
	provider.GetActionsFunc = func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.ActionDescriptor, error) {
		return []resourcev2.ActionDescriptor{descriptor}, nil
	}
	provider.StreamActionFunc = func(_ context.Context, _ resourcev2.ActionRequest, events chan<- resourcev2.ActionEvent) error {
		events <- resourcev2.ActionEvent{Type: "ready"}
		time.Sleep(100 * time.Millisecond) // the observer is attached before the stream fails
		return fail()
	}
	registerMockPlugin(ctrl, "p1", setupGRPCProvider(t, provider))
	request := admittedActionRequest(t, ctrl, "p1", "conn-1", "native::Pod", "inspect")
	request.ExpectedDescriptor = &descriptor
	return ctrl, emitter, sink, request
}

// observedOutcome is what an activity's observer is told: every snapshot as JSON, and the terminal one.
type observedOutcome struct {
	mu       sync.Mutex
	recorded []string
	terminal chan ActionSnapshot
}

func newObservedOutcome() *observedOutcome {
	return &observedOutcome{terminal: make(chan ActionSnapshot, 1)}
}

func (o *observedOutcome) observe(snapshot ActionSnapshot) {
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		encoded = []byte(fmt.Sprintf("%+v", snapshot))
	}
	o.mu.Lock()
	o.recorded = append(o.recorded, string(encoded))
	o.mu.Unlock()
	if snapshot.Terminal {
		select {
		case o.terminal <- snapshot:
		default:
		}
	}
}

func (o *observedOutcome) snapshots() []string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]string(nil), o.recorded...)
}

// An action that runs as an activity reports its outcome to an observer, which keeps it in the
// activity store the user reads. On the finite lane the outcome is the call's error, gated. On
// the streaming lane an observer that sees the stream end without a validated terminal event is
// told the host's own words, because that does not establish the outcome (action_service.go).
// Either way the record, the events and the logs of the run hold none of the plugin's sentence.
func TestProviderSentenceInAnActivityOutcomeReachesNoUngatedSink(t *testing.T) {
	for name, lane := range map[string]struct {
		streaming    bool
		code, detail string
	}{
		"an activity on the finite lane":    {streaming: false, code: "NOT_FOUND", detail: "The requested resource was not found."},
		"an activity on the streaming lane": {streaming: true, code: "ACTIVITY_OBSERVATION_LOST", detail: "The host can no longer observe the action outcome."},
	} {
		t.Run(name, func(t *testing.T) {
			ctrl, emitter, sink, request := failingAction(t, lane.streaming)
			outcome := newObservedOutcome()
			_, start, err := ctrl.PrepareActivityAction(testInvocationContext(), "p1", request, outcome.observe)
			require.NoError(t, err)
			if start != nil {
				start()
			}

			select {
			case snapshot := <-outcome.terminal:
				require.Equal(t, "error", snapshot.Event.Type)
				require.NotNil(t, snapshot.Event.Error)
				require.Equal(t, lane.code, snapshot.Event.Error.Code)
				require.Equal(t, lane.detail, snapshot.Event.Error.Detail, "the host's words: the plugin's sentence is not in the outcome")
			case <-time.After(15 * time.Second):
				t.Fatal("the action reported no outcome")
			}
			for _, snapshot := range outcome.snapshots() {
				require.False(t, ungated(snapshot), "the activity record carries the provider's sentence: %s", snapshot)
			}
			require.Empty(t, ungatedSinks(emitter, sink), "the provider's sentence reached these sinks without the gate")
		})
	}
}

// The Wails action stream reports a stream that fails after it is ready as an event of its own,
// with the error the gate words.
func TestProviderSentenceInTheActionStreamReachesNoUngatedSink(t *testing.T) {
	ctrl, emitter, sink, request := failingAction(t, true)
	id, err := ctrl.StreamAction(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	_, err = ctrl.AttachStreamAction(testInvocationContext(), id)
	require.NoError(t, err)

	data := emitter.WaitForEvent(t, "action/stream/"+id, 15*time.Second).Data

	require.NotEmpty(t, data)
	event, ok := data[0].(ActionSnapshot)
	require.True(t, ok, "the event carries an ActionSnapshot")
	require.True(t, event.Terminal)
	require.NotNil(t, event.Event.Error)
	require.Equal(t, "NOT_FOUND", event.Event.Error.Code)
	require.Equal(t, "The requested resource was not found.", event.Event.Error.Detail)
	require.Empty(t, ungatedSinks(emitter, sink), "the provider's sentence reached these sinks without the gate")
}
