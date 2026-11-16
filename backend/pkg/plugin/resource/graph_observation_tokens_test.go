package resource

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// Every mounted Related or Graph view opens one observation token and closes it
// when its request changes or it unmounts. A closed token is remembered so a late
// open cannot resurrect it, but only for the short window in which that race can
// happen. Remembering every closed token for the life of the process turned the
// token budget into a lifetime cap on graph observations.
func TestGraphObservationClosedTokensNeverExhaustTokenBudget(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := sourceTestRecord(target.Target, "pod", "")
	service := NewGraphService(ctrl, nil, nil)
	open := func(token string) (HostGraphObservationOpened, error) {
		request := HostGraphObservationRequest{ClientToken: token, PluginID: "p1", Route: target.Target.Route, Reference: record.Reference, Kind: "related", Direction: "outgoing"}
		return service.openObservation(testInvocationContext(), context.Background(), request, func(HostGraphObservationSnapshot) {})
	}

	var last string
	for i := range 2 * maxGraphObservationTokens {
		last = uuid.NewString()
		opened, err := open(last)
		require.NoError(t, err, "open %d must not be refused because earlier tokens were closed", i)
		require.NoError(t, service.closeObservation(testInvocationContext(), opened.ObservationID), "close %d", i)
	}

	_, err := open(last)
	require.Error(t, err, "the token that was just closed must stay closed")
	require.Equal(t, "NOT_FOUND", requireAppError(t, err).Code)
	service.mu.Lock()
	require.Empty(t, service.observations)
	service.mu.Unlock()
	requireClosedTokensWithinBudget(t, ctrl, service)
}

// The UI closes a token that may not have been opened yet. Those closes must not
// consume the budget either, or enough of them refuse every later open.
func TestGraphObservationClosingUnknownTokensNeverExhaustsTokenBudget(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := sourceTestRecord(target.Target, "pod", "")
	service := NewGraphService(ctrl, nil, nil)

	var last string
	for i := range 2 * maxGraphObservationTokens {
		last = uuid.NewString()
		require.NoError(t, service.closeObservation(testInvocationContext(), last), "close %d", i)
	}

	request := HostGraphObservationRequest{ClientToken: uuid.NewString(), PluginID: "p1", Route: target.Target.Route, Reference: record.Reference, Kind: "related", Direction: "outgoing"}
	opened, err := service.openObservation(testInvocationContext(), context.Background(), request, func(HostGraphObservationSnapshot) {})
	require.NoError(t, err, "an unrelated open must still be admitted")
	require.NoError(t, service.closeObservation(testInvocationContext(), opened.ObservationID))

	request.ClientToken = last
	_, err = service.openObservation(testInvocationContext(), context.Background(), request, func(HostGraphObservationSnapshot) {})
	require.Error(t, err, "closing before opening must still keep the token closed")
	require.Equal(t, "NOT_FOUND", requireAppError(t, err).Code)
	requireClosedTokensWithinBudget(t, ctrl, service)
}

// Every remembered token holds exactly its proof bytes, so evicting one must
// release exactly that much and a full budget of tokens never exceeds it.
func requireClosedTokensWithinBudget(t *testing.T, ctrl *controller, service *GraphService) {
	t.Helper()
	service.mu.Lock()
	defer service.mu.Unlock()
	require.LessOrEqual(t, len(service.closed), maxGraphObservationTokens)
	require.Equal(t, len(service.closed)*graphObservationProofBytes, ctrl.graphMetadata.used)
}
