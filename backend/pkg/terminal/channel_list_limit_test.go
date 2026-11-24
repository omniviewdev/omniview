package terminal

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The list of capabilities that a page may give is bound by the same number on every platform: a request that is invalid is invalid
// on Windows as well, where no terminal can exist and the answer is an empty list for a request that is not.
func TestTheListOfCapabilitiesHasTheSameLimitOnEveryPlatform(t *testing.T) {
	require.NoError(t, checkListedCaps(0))
	require.NoError(t, checkListedCaps(MaxListedCaps))
	err := checkListedCaps(MaxListedCaps + 1)
	require.Error(t, err, "a list of more capabilities than a page holds is refused")
	assert.ErrorIs(t, err, ErrInvalid)
}
