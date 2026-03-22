package appstate

import "testing"

// NewTestService creates a Service backed by a temporary directory for use in tests.
// The service is automatically cleaned up when the test finishes.
func NewTestService(t testing.TB) *Service {
	t.Helper()
	dir := t.TempDir()
	svc, err := New(WithRoot(dir), WithFlock(false))
	if err != nil {
		t.Fatalf("appstate.NewTestService: %v", err)
	}
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Errorf("appstate.NewTestService cleanup: %v", err)
		}
	})
	return svc
}
