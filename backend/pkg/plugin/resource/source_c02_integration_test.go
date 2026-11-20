package resource

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

const sourceFileType = "proof::v1::File"

type sourceFileClient struct{ path string }

func sourceFileRecord(client *sourceFileClient, target resourcev2.ReadTarget) (resourcev2.Record, error) {
	body, err := os.ReadFile(client.path)
	if err != nil {
		return resourcev2.Record{}, err
	}
	record := canonicalTestRecord(target.Provider, target.Authority, target.Type, "watched/opaque:%2F")
	record.Body.Map["value"] = resourcev2.Value{Kind: "string", String: string(body)}
	return record, nil
}

func sourceFileObservation(client *sourceFileClient, target resourcev2.ReadTarget) (resourcev2.SourceObservation, error) {
	record, err := sourceFileRecord(client, target)
	if err != nil {
		return resourcev2.SourceObservation{}, err
	}
	value := record.Body.Map["value"].String
	return resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record), Metadata: &resourcev2.ResourceMetadata{Labels: map[string]string{"value": value}}}, nil
}

// TestC02SourceViewLifecycle follows a native file source through a source view: snapshot, one change, close.
//
// A client attaches to a view and then syncs it (packages/omniviewdev-runtime/src/resource/v2/sourceView.ts), and it cannot know
// whether the source session already holds its first snapshot when the sync arrives. Both orders are legal and the host answers
// them differently. Before the snapshot, the sync has nothing to send and the snapshot starts the view's only generation. After
// it, the session has already pushed that snapshot to the view, so the sync resets the view and starts a second generation, and
// a change carries that one. The test used to leave the order to a race between its own goroutine and the source stream; on a
// loaded runner it lost, and the change carried the second generation while the test still held the first. The provider now
// holds its first snapshot until the test lets it go, so each order runs on purpose.
func TestC02SourceViewLifecycle(t *testing.T) {
	t.Run("sync before the first snapshot", func(t *testing.T) { runC02SourceViewLifecycle(t, false) })
	t.Run("sync after the first snapshot", func(t *testing.T) { runC02SourceViewLifecycle(t, true) })
}

func runC02SourceViewLifecycle(t *testing.T, syncAfterSnapshot bool) {
	ctx := testInvocationContext()
	path := filepath.Join(t.TempDir(), "native.txt")
	writeFile := func(value string) {
		t.Helper()
		stage := path + ".next"
		require.NoError(t, os.WriteFile(stage, []byte(value), 0600))
		require.NoError(t, os.Rename(stage, path))
	}
	writeFile("first")
	stopped := make(chan struct{})
	publish := make(chan struct{})
	provider, err := resourcev2.NewController(resourcev2.Config[sourceFileClient]{
		Catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			catalog := canonicalTestCatalog("proof", sourceFileType)
			catalog.Types[0].Capabilities = []resourcev2.Capability{
				{Operation: resourcev2.OperationEnumerate, Scope: resourcev2.QueryScope{}},
				{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort},
			}
			return catalog, nil
		},
		Lifecycle: &resourcev2.Lifecycle[sourceFileClient]{
			LoadConnections: func(context.Context) ([]types.Connection, error) {
				return []types.Connection{{ID: "local", Data: map[string]interface{}{"path": path}}}, nil
			},
			CreateClient: func(_ context.Context, connection types.Connection) (*sourceFileClient, error) {
				return &sourceFileClient{path: connection.Data["path"].(string)}, nil
			},
			DestroyClient: func(context.Context, *sourceFileClient) error { return nil },
			CheckConnection: func(_ context.Context, connection types.Connection, _ *sourceFileClient) (types.ConnectionStatus, error) {
				return types.ConnectionStatus{Connection: &connection, Status: types.ConnectionStatusConnected}, nil
			},
		},
		Registrations: []resourcev2.Registration[sourceFileClient]{{
			Type: sourceFileType, Scope: resourcev2.QueryScope{},
			Enumerate: func(_ context.Context, client *sourceFileClient, request resourcev2.EnumerateRequest) (resourcev2.SourcePage, error) {
				record, err := sourceFileRecord(client, request.Target)
				if err != nil {
					return resourcev2.SourcePage{}, err
				}

				return resourcev2.SourcePage{Records: []resourcev2.Record{record}, Count: resourcev2.Count{Kind: "unknown"}, Coverage: resourcev2.Coverage{Kind: "complete"}, Consistency: resourcev2.ConsistencyBestEffort}, nil
			},
			Source: func(ctx context.Context, client *sourceFileClient, request resourcev2.SourceRequest, emitter resourcev2.SourceEmitter) error {
				defer close(stopped)
				select {
				case <-publish:
				case <-ctx.Done():
					return ctx.Err()
				}
				observation, err := sourceFileObservation(client, request.Target)
				if err != nil {
					return err
				}
				if err = emitter.Snapshot(ctx, []resourcev2.SourceObservation{observation}); err != nil {
					return err
				}
				if err = emitter.EndSnapshot(ctx, resourcev2.SourceCoverage{Enumeration: resourcev2.EnumerationExhausted, Consistency: resourcev2.ConsistencyBestEffort}, resourcev2.ContinuityBestEffort); err != nil {
					return err
				}
				previous := observation.Record.Body.Map["value"].String
				ticker := time.NewTicker(10 * time.Millisecond)
				defer ticker.Stop()
				for {
					select {
					case <-ctx.Done():
						return ctx.Err()
					case <-ticker.C:
						observation, err = sourceFileObservation(client, request.Target)
						if err != nil {
							return err
						}
						value := observation.Record.Body.Map["value"].String
						if value != previous {
							if err = emitter.Changes(ctx, []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &observation}}, nil); err != nil {
								return err
							}
							previous = value
						}
					}
				}
			},
		}},
	})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, provider.Close()) })
	transport := setupGRPCProvider(t, provider)
	ctrl, emitter := newTestControllerWithEmitter(t)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"resource": transport}})
	require.NoError(t, ctrl.OnPluginStart("proof", defaultMeta(), backend))
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginShutdown("proof", defaultMeta())) })
	_, err = ctrl.StartConnection(ctx, "proof", "local")
	require.NoError(t, err)
	resolved := admittedReadTarget(t, ctrl, "proof", "local", sourceFileType)
	opened, err := ctrl.OpenSourceView(ctx, "proof", HostSourceViewRequest{TargetID: resolved.TargetID, Target: resolved.Target, Updates: "ifSupported"})
	require.NoError(t, err)
	require.Equal(t, resourcev2.SourceModeSnapshotAndUpdates, opened.Mode)
	if !syncAfterSnapshot {
		// The source has not published, so the session holds no snapshot: this sync sends nothing, and the snapshot that follows
		// starts the view's one generation.
		require.NoError(t, ctrl.SyncSourceView(ctx, "proof", opened.ViewID))
	}
	close(publish)
	initial := waitSourceView(t, emitter, opened.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshot" && len(event.Records) != 0 })
	require.Equal(t, "first", initial.Records[0].Record.Body.Map["value"].String)
	end := waitSourceView(t, emitter, opened.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == "following"
	})
	require.Equal(t, initial.ViewGeneration, end.ViewGeneration)
	live := end
	if syncAfterSnapshot {
		// The session pushed its snapshot to the view before this sync arrived. The host resets the view, naming the generation that
		// ends, and sends the snapshot again under a new one: the generation that a change belongs to.
		require.NoError(t, ctrl.SyncSourceView(ctx, "proof", opened.ViewID))
		reset := waitSourceView(t, emitter, opened.Topic, func(event HostSourceViewEvent) bool {
			return event.Kind == "reset" && event.Reset != nil && event.Reset.Reason == "resync"
		})
		require.Equal(t, end.ViewGeneration, reset.ViewGeneration)
		again := waitSourceView(t, emitter, opened.Topic, func(event HostSourceViewEvent) bool {
			return event.Kind == "snapshot" && event.ViewGeneration != end.ViewGeneration && len(event.Records) != 0
		})
		require.Equal(t, "first", again.Records[0].Record.Body.Map["value"].String)
		live = waitSourceView(t, emitter, opened.Topic, func(event HostSourceViewEvent) bool {
			return event.Kind == "snapshotEnd" && event.ViewGeneration == again.ViewGeneration && event.Status != nil && event.Status.State == "following"
		})
	}
	writeFile("second")
	change := waitSourceView(t, emitter, opened.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "changes" && len(event.Upserts) != 0 })
	require.Equal(t, "second", change.Upserts[0].Record.Body.Map["value"].String)
	require.Equal(t, live.ViewGeneration, change.ViewGeneration)
	if !syncAfterSnapshot {
		require.Zero(t, sourceViewEventCount(emitter, opened.Topic, "reset"), "the one generation was never reset")
	}
	require.NoError(t, ctrl.CloseSourceView(ctx, "proof", opened.ViewID))
	require.NoError(t, ctrl.CloseSourceView(ctx, "proof", opened.ViewID))
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("source callback did not stop after view close")
	}
	_, err = ctrl.StopConnection(ctx, "proof", "local")
	require.NoError(t, err)
}

// sourceViewEventCount counts the events of one kind that a view has emitted so far.
func sourceViewEventCount(emitter *recordingEmitter, topic, kind string) int {
	count := 0
	for _, emitted := range emitter.EventsWithKey(topic) {
		if len(emitted.Data) != 1 {
			continue
		}
		if event, ok := emitted.Data[0].(HostSourceViewEvent); ok && event.Kind == kind {
			count++
		}
	}
	return count
}
