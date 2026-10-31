package settings

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCommitErrorClassifiesValidationWithoutPublishing(t *testing.T) {
	store := openStore(t)
	service, err := Initialize(Options{Store: store, Categories: definitions()})
	require.NoError(t, err)
	_, err = service.Commit(Scope{Kind: "host"}, map[string]any{"core.unknown": "private proposal"})
	var rejected *CommitError
	require.ErrorAs(t, err, &rejected)
	require.True(t, rejected.Validation)
	require.NotContains(t, err.Error(), "private proposal")
	values, err := store.LoadCategory("core")
	require.NoError(t, err)
	require.Empty(t, values)
	require.NoError(t, store.Close())
	_, err = service.Commit(Scope{Kind: "host"}, map[string]any{"core.name": "valid"})
	rejected = nil
	require.ErrorAs(t, err, &rejected)
	require.False(t, rejected.Validation)
	value, err := service.Provider().GetString("core.name")
	require.NoError(t, err)
	require.Equal(t, "initial", value)
}
