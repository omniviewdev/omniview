package processinfo

import (
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestNoNativeWindowsCannotClaimVerifiedAssociation(t *testing.T) {
	s := testService()
	s.windows = func() []Window { return []Window{} }
	host := s.GetSnapshot().Processes[0]
	if host.Identity == nil || host.Ownership != "verified" || host.WindowAssociation != "unverified" {
		t.Fatalf("missing window association was invented: %+v", host)
	}
}

func TestKernelReadFailureRemovesWindowIdentity(t *testing.T) {
	s := testService()
	s.observe = func(int) (devsession.ProcessObservation, error) {
		return devsession.ProcessObservation{}, errors.New("kernel identity unavailable")
	}
	host := s.GetSnapshot().Processes[0]
	if host.Identity != nil || host.Error != "kernel identity unavailable" || host.WindowAssociation != "unverified" {
		t.Fatalf("failed kernel read retained host identity: %+v", host)
	}
	if window := host.Windows[0]; window.NativeID != 0 || window.Ownership != "unverified" || window.Error == "" {
		t.Fatalf("failed kernel read retained native association: %+v", window)
	}
}
