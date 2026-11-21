package resource

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// The helpers in this file are the only test code that looks inside the
// registry of connection calls.

// transactionsWaiting is how many profile transactions wait for plugin to go
// quiet.
func transactionsWaiting(ctrl *controller, plugin string) int {
	ctrl.calls.mu.Lock()
	defer ctrl.calls.mu.Unlock()
	return len(ctrl.calls.waiting[plugin])
}

// awaitTransactionsWaiting blocks until at least n profile transactions wait
// for plugin. Every change of the line wakes it, so it neither polls nor
// sleeps.
func awaitTransactionsWaiting(t *testing.T, ctrl *controller, plugin string, n int) {
	t.Helper()
	deadline := time.NewTimer(callTimeout)
	defer deadline.Stop()
	for {
		ctrl.calls.mu.Lock()
		waiting, changed := len(ctrl.calls.waiting[plugin]), ctrl.calls.endedLocked()
		ctrl.calls.mu.Unlock()
		if waiting >= n {
			return
		}
		select {
		case <-changed:
		case <-deadline.C:
			t.Fatalf("%d profile transactions wait for %s after %s, want %d", waiting, plugin, callTimeout, n)
		}
	}
}

// requireRegistryIdle fails when a call is still registered or a transaction
// still has a place in line, although every operation of the test has returned.
func requireRegistryIdle(t *testing.T, ctrl *controller) {
	t.Helper()
	ctrl.calls.mu.Lock()
	defer ctrl.calls.mu.Unlock()
	require.Empty(t, ctrl.calls.active, "a connection call is still registered")
	require.Empty(t, ctrl.calls.waiting, "a profile transaction still has a place in line")
}
