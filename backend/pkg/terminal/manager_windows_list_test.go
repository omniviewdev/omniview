//go:build windows

package terminal

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

// The Windows manager answers a list of capabilities as the others do: an empty list for a request that is valid, and the refusal of
// one that is longer than a page holds.
func TestTheWindowsManagerRefusesAListOfCapabilitiesThatIsTooLong(t *testing.T) {
	m := NewManager(context.Background(), logging.NewNop(), nil)
	_, err := m.ListChannels(make([]string, MaxListedCaps+1))
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrInvalid)
	listed, err := m.ListChannels(nil)
	require.NoError(t, err)
	assert.NotNil(t, listed, "an empty list and not none")
	assert.Empty(t, listed)
}
