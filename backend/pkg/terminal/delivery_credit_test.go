//go:build !windows

package terminal

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// The credit of a closed session never reaches a new session that took its id: the id is reused 1,000 times and
// after each reuse a late callback of the session before it comes in.
func TestALateCreditOfAClosedSessionNeverReachesTheSessionThatReusedItsId(t *testing.T) {
	m, _ := newTestManager(t)
	const reuses = 1000
	const debt = 4096
	for i := range reuses {
		first, err := m.Start(Options{ID: "reused", Command: []string{sh(t), "-c", "sleep 600"}}, nil)
		require.NoError(t, err, "reuse %d", i)
		late := creditFor(m, first.ID)
		require.NoError(t, m.CloseSession(first.ID))
		second, err := m.Start(Options{ID: "reused", Command: []string{sh(t), "-c", "sleep 600"}}, nil)
		require.NoError(t, err, "reuse %d", i)
		s := m.session(t, second.ID)
		s.flow.sent(debt)
		late(debt)
		s.flow.mu.Lock()
		owed := s.flow.unacked
		s.flow.mu.Unlock()
		require.Equal(t, debt, owed, "reuse %d: the late credit of the closed session reached the new one", i)
		require.NoError(t, m.CloseSession(second.ID))
	}
}

// creditFor is how the sink of a session reports what the transport took: what Output was handed to.
func creditFor(m *Manager, id string) func(int) {
	return func(n int) { m.Delivered(id, n) }
}
