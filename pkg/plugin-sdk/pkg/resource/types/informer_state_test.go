package types

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInformerSyncPolicy_Constants(t *testing.T) {
	// Verify iota ordering matches proto enum values (0, 1, 2)
	assert.Equal(t, InformerSyncPolicy(0), SyncOnConnect)
	assert.Equal(t, InformerSyncPolicy(1), SyncOnFirstQuery)
	assert.Equal(t, InformerSyncPolicy(2), SyncNever)
}

func TestInformerResourceState_Constants(t *testing.T) {
	// Verify iota ordering matches proto enum values (0-4)
	assert.Equal(t, InformerResourceState(0), InformerStatePending)
	assert.Equal(t, InformerResourceState(1), InformerStateSyncing)
	assert.Equal(t, InformerResourceState(2), InformerStateSynced)
	assert.Equal(t, InformerResourceState(3), InformerStateError)
	assert.Equal(t, InformerResourceState(4), InformerStateCancelled)
}

func TestInformerStateEvent_JSON(t *testing.T) {
	event := InformerStateEvent{
		PluginID:      "kubernetes",
		Connection:    "cluster-1",
		ResourceKey:   "core::v1::Pod",
		State:         InformerStateSynced,
		ResourceCount: 42,
		TotalCount:    42,
	}

	data, err := json.Marshal(event)
	require.NoError(t, err)

	var parsed InformerStateEvent
	require.NoError(t, json.Unmarshal(data, &parsed))

	assert.Equal(t, event.PluginID, parsed.PluginID)
	assert.Equal(t, event.Connection, parsed.Connection)
	assert.Equal(t, event.ResourceKey, parsed.ResourceKey)
	assert.Equal(t, event.State, parsed.State)
	assert.Equal(t, event.ResourceCount, parsed.ResourceCount)
	assert.Equal(t, event.TotalCount, parsed.TotalCount)
	assert.Nil(t, parsed.Error)
}

func TestInformerStateEvent_JSON_WithError(t *testing.T) {
	event := InformerStateEvent{
		Connection:  "cluster-1",
		ResourceKey: "core::v1::Pod",
		State:       InformerStateError,
		Error: &ResourceOperationError{
			Code:    "SYNC_TIMEOUT",
			Title:   "Sync timed out",
			Message: "Cache sync did not complete in time",
		},
	}

	data, err := json.Marshal(event)
	require.NoError(t, err)

	var parsed InformerStateEvent
	require.NoError(t, json.Unmarshal(data, &parsed))

	require.NotNil(t, parsed.Error)
	assert.Equal(t, "SYNC_TIMEOUT", parsed.Error.Code)
	assert.Equal(t, "Sync timed out", parsed.Error.Title)
}

func TestInformerStateEvent_JSON_NilError_Omitted(t *testing.T) {
	event := InformerStateEvent{
		Connection:  "cluster-1",
		ResourceKey: "core::v1::Pod",
		State:       InformerStateSynced,
	}

	data, err := json.Marshal(event)
	require.NoError(t, err)

	var raw map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &raw))
	_, hasError := raw["error"]
	assert.False(t, hasError, "nil error should be omitted from JSON")
}

func TestInformerConnectionSummary_JSON(t *testing.T) {
	summary := InformerConnectionSummary{
		Connection: "cluster-1",
		Resources: map[string]InformerResourceState{
			"core::v1::Pod":     InformerStateSynced,
			"core::v1::Service": InformerStateSyncing,
			"apps::v1::Deploy":  InformerStateError,
		},
		ResourceCounts: map[string]int{
			"core::v1::Pod":     50,
			"core::v1::Service": 0,
			"apps::v1::Deploy":  0,
		},
		TotalResources: 3,
		SyncedCount:    1,
		ErrorCount:     1,
	}

	data, err := json.Marshal(summary)
	require.NoError(t, err)

	var parsed InformerConnectionSummary
	require.NoError(t, json.Unmarshal(data, &parsed))

	assert.Equal(t, "cluster-1", parsed.Connection)
	assert.Equal(t, 3, parsed.TotalResources)
	assert.Equal(t, 1, parsed.SyncedCount)
	assert.Equal(t, 1, parsed.ErrorCount)
	assert.Equal(t, InformerStateSynced, parsed.Resources["core::v1::Pod"])
	assert.Equal(t, 50, parsed.ResourceCounts["core::v1::Pod"])
}

func TestResourceMetaFromString_RoundTrip(t *testing.T) {
	original := ResourceMeta{Group: "apps", Version: "v1", Kind: "Deployment"}
	key := original.String()
	assert.Equal(t, "apps::v1::Deployment", key)

	roundTripped := ResourceMetaFromString(key)
	assert.Equal(t, original.Group, roundTripped.Group)
	assert.Equal(t, original.Version, roundTripped.Version)
	assert.Equal(t, original.Kind, roundTripped.Kind)
}

func TestResourceMetaFromString_InvalidFormat(t *testing.T) {
	meta := ResourceMetaFromString("invalid")
	assert.Empty(t, meta.Group)
	assert.Empty(t, meta.Version)
	assert.Empty(t, meta.Kind)
}

func TestResourceMetaFromString_CoreGroup(t *testing.T) {
	meta := ResourceMetaFromString("core::v1::Pod")
	assert.Equal(t, "core", meta.Group)
	assert.Equal(t, "v1", meta.Version)
	assert.Equal(t, "Pod", meta.Kind)
}
