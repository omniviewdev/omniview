package resource

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// graphFailure opens one observation on a provider whose GetRelationships fails with failure,
// served over gRPC so that the SDK client restores the sentence as it does in a plugin, and
// returns the first failed snapshot with the JSON the Wails event carries to the page.
func graphFailure(t *testing.T, failure func() error) (HostGraphObservationSnapshot, string) {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.RelationshipDescriptor, error) {
		return nil, failure()
	}
	registerMockPlugin(ctrl, "p1", setupGRPCProvider(t, provider))
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := demandRecord(t, target.Target, "pod", "peer")

	service := NewGraphService(ctrl, nil, nil)
	failed := make(chan HostGraphObservationSnapshot, 8)
	request := HostGraphObservationRequest{ClientToken: uuid.NewString(), PluginID: "p1", Route: target.Target.Route, Reference: record.Reference, Kind: "related", Direction: "outgoing"}
	opened, err := service.openObservation(testInvocationContext(), context.Background(), request, func(snapshot HostGraphObservationSnapshot) {
		if snapshot.State == "failed" {
			select {
			case failed <- snapshot:
			default:
			}
		}
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = service.closeObservation(testInvocationContext(), opened.ObservationID) })
	require.NoError(t, service.syncObservation(testInvocationContext(), opened.ObservationID))

	select {
	case snapshot := <-failed:
		wire, marshalErr := json.Marshal(snapshot)
		require.NoError(t, marshalErr)
		return snapshot, string(wire)
	case <-time.After(20 * time.Second):
		t.Fatal("the observation reported no failure")
		return HostGraphObservationSnapshot{}, ""
	}
}

// The failure a graph observation reports to the page is the one every other call reports:
// the class, and the plugin's sentence only after the gate has cleaned it or refused it.
// It was the one place that copied the restored error as it came (Message included), so a
// sentence with escape bytes, a credential-shaped pair or a path into a user's home reached
// the page as the plugin wrote it.
func TestGraphObservationFailureDeliversTheGatedSentence(t *testing.T) {
	classText := func(class string) (string, string) {
		app := apperror.ForResource(resourcev2.NewError(class, ""), "")
		return app.Title, app.Detail
	}
	for name, tc := range map[string]struct {
		class, sentence string
		// message is what the page may read; empty means the class's own sentence.
		message string
	}{
		"a sentence with escape bytes, a credential pair and a home path": {class: "NOT_FOUND", sentence: sinkHostile},
		"the same on another class":                                       {class: "TIMEOUT", sentence: sinkHostile},
		"escape bytes alone are cleaned":                                  {class: "NOT_FOUND", sentence: "\x1b[31mred alert\x1b[0m done", message: "red alert done"},
		"a credential-shaped pair":                                        {class: "UNAVAILABLE", sentence: "gave up: token=abc123def456"},
		"a path into a home":                                              {class: "NOT_FOUND", sentence: "cannot read /Users/someone/.kube/config"},
		"an honest sentence is delivered":                                 {class: "NOT_FOUND", sentence: sinkBenign, message: sinkBenign},
		"a class the host words itself":                                   {class: "FORBIDDEN", sentence: sinkBenign},
	} {
		t.Run(name, func(t *testing.T) {
			snapshot, wire := graphFailure(t, providerFailure(tc.class, tc.sentence))
			title, detail := classText(tc.class)
			want := tc.message
			if want == "" {
				want = detail
			}
			require.NotNil(t, snapshot.Error)
			require.Equal(t, tc.class, snapshot.Error.Code)
			require.Equal(t, title, snapshot.Error.Title, "the class is the title; the plugin's title does not cross")
			require.Equal(t, want, snapshot.Error.Message, wire)
			require.False(t, ungated(wire), "the page receives: %s", wire)
		})
	}
}

// finishResource wraps the provider's error in an AppError whose Unwrap is the raw error, and
// the evaluation of a graph returns it that way when the admission of a reference fails. The
// failure reported for it is the AppError's text, not the raw error's under it.
func TestGraphObservationFailureKeepsTheGateOfAnErrorThatIsAlreadyGated(t *testing.T) {
	raw := &resourcev2.ResourceOperationError{Code: "NOT_FOUND", Message: sinkHostile}
	gated := apperror.ForResource(raw, "req-1")
	require.False(t, ungated(gated.Detail), "the premise: the gate refuses the sentence")

	snapshot := graphObservationFailure(gated)
	wire, err := json.Marshal(snapshot)
	require.NoError(t, err)

	require.NotNil(t, snapshot.Error)
	require.Equal(t, gated.Detail, snapshot.Error.Message)
	require.False(t, ungated(string(wire)), "the page receives: %s", wire)
}

// An error that is no ResourceOperationError carries nothing of a provider: the host's sentence.
func TestGraphObservationFailureOfAnotherErrorIsTheHostsSentence(t *testing.T) {
	snapshot := graphObservationFailure(context.DeadlineExceeded)

	require.NotNil(t, snapshot.Error)
	require.Equal(t, "Graph observation is unavailable.", snapshot.Error.Message)
}
