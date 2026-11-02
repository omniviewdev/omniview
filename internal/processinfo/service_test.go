package processinfo

import (
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type processProviderFunc func() []plugin.PluginProcessInfo

func (f processProviderFunc) GetPluginProcesses() []plugin.PluginProcessInfo { return f() }

func testService() *Service {
	identity := devsession.ProcessObservation{PID: 42, StartIdentity: "start:1", Executable: "/host"}
	return &Service{
		host:    identity,
		observe: func(int) (devsession.ProcessObservation, error) { return identity, nil },
		windows: func() []Window { return []Window{{Name: "main", ID: 8, NativeID: 1234, Ownership: "verified"}} },
	}
}

func TestHostLifetimeChangesDuringWindowCollection(t *testing.T) {
	s := testService()
	original := s.host
	s.windows = func() []Window {
		s.observe = func(int) (devsession.ProcessObservation, error) {
			changed := original
			changed.StartIdentity = "start:2"
			return changed, nil
		}
		return []Window{{Name: "main", ID: 8, NativeID: 1234, Ownership: "verified"}}
	}
	s.plugins = processProviderFunc(func() []plugin.PluginProcessInfo {
		return []plugin.PluginProcessInfo{{PluginID: "embedded", Ownership: "shared"}}
	})
	snapshot := s.GetSnapshot()
	for _, process := range snapshot.Processes {
		if process.Identity != nil || process.Ownership != "unverified" {
			t.Fatalf("identity escaped changed host lifetime: %+v", process)
		}
	}
	window := snapshot.Processes[0].Windows[0]
	if window.NativeID != 0 || window.Ownership != "unverified" || window.Error == "" || window.ID != 8 {
		t.Fatalf("stale native association survived: %+v", window)
	}
}

func TestUnavailableInitialHostIdentityNeverRecaptured(t *testing.T) {
	s := testService()
	s.hostError = "initial lookup failed"
	s.observe = func(int) (devsession.ProcessObservation, error) {
		t.Fatal("unavailable initial identity must not adopt a new lifetime")
		return devsession.ProcessObservation{}, errors.New("unreachable")
	}
	if host := s.GetSnapshot().Processes[0]; host.Identity != nil || host.Error != s.hostError {
		t.Fatalf("unexpected host: %+v", host)
	}
}

func TestUnverifiedWindowDoesNotDiscardVerifiedHostAndSharedPlugin(t *testing.T) {
	s := testService()
	s.windows = func() []Window {
		return []Window{{Name: "not-native", ID: 7, Ownership: "unverified", Error: "No native window"}}
	}
	s.plugins = processProviderFunc(func() []plugin.PluginProcessInfo {
		return []plugin.PluginProcessInfo{{PluginID: "embedded", Ownership: "shared"}}
	})
	snapshot := s.GetSnapshot()
	if host := snapshot.Processes[0]; host.Ownership != "verified" || host.WindowAssociation != "unverified" || host.Windows[0].NativeID != 0 {
		t.Fatalf("unknown window misrepresented: %+v", host)
	}
	if embedded := snapshot.Processes[1]; embedded.Ownership != "shared" || embedded.Identity == nil || *embedded.Identity != s.host {
		t.Fatalf("verified in-process identity missing: %+v", embedded)
	}
}

func TestProviderErrorOrMissingIdentityCannotDisclosePID(t *testing.T) {
	s := testService()
	s.plugins = processProviderFunc(func() []plugin.PluginProcessInfo {
		return []plugin.PluginProcessInfo{
			{PluginID: "stale", Ownership: "verified", Identity: &s.host, Error: "backend displaced"},
			{PluginID: "missing", Ownership: "verified"},
			{PluginID: "unknown", Ownership: "unverified", Identity: &s.host},
		}
	})
	snapshot := s.GetSnapshot()
	for _, row := range snapshot.Processes[1:] {
		if row.Identity != nil || row.Ownership != "unverified" || row.Error == "" {
			t.Fatalf("unverified identity escaped: %+v", row)
		}
	}
}

func TestHostExecutableChangeInvalidatesIdentity(t *testing.T) {
	s := testService()
	s.observe = func(int) (devsession.ProcessObservation, error) {
		changed := s.host
		changed.Executable = "/replacement"
		return changed, nil
	}
	if host := s.GetSnapshot().Processes[0]; host.Identity != nil || host.Ownership != "unverified" {
		t.Fatalf("executable replacement retained identity: %+v", host)
	}
}
