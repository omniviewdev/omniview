package devsession

import (
	"errors"
	"os"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// A filename or PID-only comparison would accept every mutated record below.
func TestOwnedProcessRejectsPIDReuseExecutableAndOwnerMismatch(t *testing.T) {
	owner := ProcessOwner{WorkspaceID: fixtureWorkspace, Generation: "owned-generation", Role: "plugin", Source: "/fixture/source"}
	identity, err := CaptureProcess(os.Getpid(), owner)
	if err != nil {
		t.Fatal(err)
	}
	if identity.StartIdentity == "" || identity.Executable == "" || identity.PID != os.Getpid() {
		t.Fatalf("incomplete OS identity: %+v", identity)
	}
	if err := VerifyOwnedProcess(identity, owner); err != nil {
		t.Fatalf("own process rejected: %v", err)
	}
	cases := map[string]func(*devcontract.ProcessIdentity){
		"reused PID":    func(p *devcontract.ProcessIdentity) { p.StartIdentity = "different-kernel-start" },
		"executable":    func(p *devcontract.ProcessIdentity) { p.Executable = "/not-the-running-executable" },
		"workspace":     func(p *devcontract.ProcessIdentity) { p.WorkspaceID = secondWorkspace },
		"generation":    func(p *devcontract.ProcessIdentity) { p.Generation = "foreign" },
		"role":          func(p *devcontract.ProcessIdentity) { p.Role = "foreign" },
		"source":        func(p *devcontract.ProcessIdentity) { p.Source = "/fixture/foreign" },
		"missing start": func(p *devcontract.ProcessIdentity) { p.StartIdentity = "" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			changed := identity
			mutate(&changed)
			if err := VerifyOwnedProcess(changed, owner); !errors.Is(err, ErrOwnership) {
				t.Fatalf("foreign process accepted: %v", err)
			}
			// Every case must refuse before reaching a platform signal operation.
			if err := TerminateOwnedProcess(changed, owner); !errors.Is(err, ErrOwnership) {
				t.Fatalf("unsafe termination accepted: %v", err)
			}
		})
	}
}

func TestInvalidProcessIdentityCannotBeCapturedOrTerminated(t *testing.T) {
	owner := ProcessOwner{WorkspaceID: fixtureWorkspace, Generation: "generation", Role: "host", Source: "/fixture/host"}
	if _, err := CaptureProcess(0, owner); !errors.Is(err, ErrOwnership) {
		t.Fatalf("PID zero accepted: %v", err)
	}
	if _, err := CaptureProcess(-1, owner); !errors.Is(err, ErrOwnership) {
		t.Fatalf("negative PID accepted: %v", err)
	}
	if err := TerminateOwnedProcess(devcontract.ProcessIdentity{PID: os.Getpid()}, owner); !errors.Is(err, ErrOwnership) {
		t.Fatalf("numeric PID authorized termination: %v", err)
	}
}
