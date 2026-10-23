package devsession

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

const fixtureWorkspace = "f14566c4-5130-4e3f-aa09-3e49c63b29a6"
const secondWorkspace = "c540669f-1fdd-47e8-8115-446076f01d02"

func fixtureOwner(t *testing.T, workspace, generation string) devcontract.ProcessIdentity {
	t.Helper()
	owner, err := CaptureProcess(os.Getpid(), ProcessOwner{WorkspaceID: workspace, Generation: generation, Role: "supervisor", Source: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	return owner
}

func fixtureRegistry(t *testing.T, root string, options RegistryOptions) *Registry {
	t.Helper()
	r, err := OpenRegistry(root, options)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func reserve(t *testing.T, r *Registry, owner devcontract.ProcessIdentity, plugin string) Lease {
	t.Helper()
	l, err := r.Reserve(context.Background(), LeaseRequest{Key: ServiceKey{WorkspaceID: owner.WorkspaceID, Role: "plugin-vite", PluginID: plugin}, Owner: owner})
	if err != nil {
		t.Fatal(err)
	}
	return l
}

// Losing persisted assignments or indexing by plugin order changes these ports.
func TestStickyAssignmentsSurviveReorderingRestartAndAddition(t *testing.T) {
	root := t.TempDir()
	r := fixtureRegistry(t, root, RegistryOptions{})
	owner := fixtureOwner(t, fixtureWorkspace, "generation-one")
	a, b := reserve(t, r, owner, "alpha"), reserve(t, r, owner, "beta")
	if a.Port == b.Port || a.Port < 20000 || a.Port > 44999 {
		t.Fatalf("invalid assignments: %v %v", a, b)
	}
	for _, l := range []Lease{a, b} {
		if err := r.Release(context.Background(), l.Key, owner.Generation); err != nil {
			t.Fatal(err)
		}
	}
	r = fixtureRegistry(t, root, RegistryOptions{})
	owner = fixtureOwner(t, fixtureWorkspace, "generation-two")
	b2 := reserve(t, r, owner, "beta")
	_ = reserve(t, r, owner, "new-plugin")
	a2 := reserve(t, r, owner, "alpha")
	if a2.Port != a.Port || b2.Port != b.Port {
		t.Fatalf("sticky assignments moved: %d/%d -> %d/%d", a.Port, b.Port, a2.Port, b2.Port)
	}
}

// A mutex on a single Registry object cannot protect separately opened allocators.
func TestConcurrentRegistryHandlesDoNotAllocateDuplicatePorts(t *testing.T) {
	root := t.TempDir()
	owner := fixtureOwner(t, fixtureWorkspace, "concurrent")
	const count = 20
	results := make(chan Lease, count)
	errs := make(chan error, count)
	var group sync.WaitGroup
	for i := range count {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			r, err := OpenRegistry(root, RegistryOptions{})
			if err != nil {
				errs <- err
				return
			}
			lease, err := r.Reserve(context.Background(), LeaseRequest{Key: ServiceKey{WorkspaceID: fixtureWorkspace, Role: "vite", PluginID: strconv.Itoa(i)}, Owner: owner})
			if err != nil {
				errs <- err
				return
			}
			results <- lease
		}(i)
	}
	group.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	seen := map[int]bool{}
	for lease := range results {
		if seen[lease.Port] {
			t.Errorf("duplicate port %d", lease.Port)
		}
		seen[lease.Port] = true
	}
	if len(seen) != count {
		t.Fatalf("got %d assignments, want %d", len(seen), count)
	}
	stored, err := fixtureRegistry(t, root, RegistryOptions{}).List(context.Background(), fixtureWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored) != count {
		t.Fatalf("concurrent writes lost reservations: got %d, want %d", len(stored), count)
	}
}

func TestOccupiedStickyPortMovesButPinnedPortFailsWithoutTouchingListener(t *testing.T) {
	r := fixtureRegistry(t, t.TempDir(), RegistryOptions{})
	owner := fixtureOwner(t, fixtureWorkspace, "occupied-one")
	first := reserve(t, r, owner, "alpha")
	if err := r.Release(context.Background(), first.Key, owner.Generation); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(first.Port)))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	owner = fixtureOwner(t, fixtureWorkspace, "occupied-two")
	_, err = r.Reserve(context.Background(), LeaseRequest{Key: first.Key, Owner: owner, Strict: true})
	if !errors.Is(err, ErrPortConflict) {
		t.Fatalf("strict request = %v", err)
	}
	_, err = r.Reserve(context.Background(), LeaseRequest{Key: ServiceKey{WorkspaceID: fixtureWorkspace, Role: "pinned"}, Owner: owner, Override: first.Port})
	if !errors.Is(err, ErrPortConflict) {
		t.Fatalf("override request = %v", err)
	}
	moved := reserve(t, r, owner, "alpha")
	if moved.Port == first.Port || moved.State != LeaseReserved {
		t.Fatalf("occupied port was retained: %+v", moved)
	}
	conn, err := net.Dial("tcp4", listener.Addr().String())
	if err != nil {
		t.Fatalf("foreign listener was disrupted: %v", err)
	}
	conn.Close()
}

func TestReservationsAreNotSocketBindsAndBindRacesRequireExplicitReallocation(t *testing.T) {
	r := fixtureRegistry(t, t.TempDir(), RegistryOptions{MaxAttempts: 2})
	owner := fixtureOwner(t, fixtureWorkspace, "race")
	lease := reserve(t, r, owner, "alpha")
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(lease.Port)))
	if err != nil {
		t.Fatalf("registry unexpectedly reserved an OS socket: %v", err)
	}
	defer listener.Close()
	if _, err := r.Reallocate(context.Background(), lease.Key, owner.Generation); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("unreported race reallocated: %v", err)
	}
	if err := r.ConfirmBound(context.Background(), lease.Key, owner.Generation, lease.Port+1, owner); !errors.Is(err, ErrPortConflict) {
		t.Fatalf("invisible child increment accepted: %v", err)
	}
	if err := r.BindFailed(context.Background(), lease.Key, owner.Generation, lease.Port); err != nil {
		t.Fatal(err)
	}
	moved, err := r.Reallocate(context.Background(), lease.Key, owner.Generation)
	if err != nil {
		t.Fatal(err)
	}
	if moved.Port == lease.Port || moved.Attempt != 2 {
		t.Fatalf("race was not recorded: %+v", moved)
	}
	if err := r.BindFailed(context.Background(), moved.Key, owner.Generation, moved.Port); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reallocate(context.Background(), moved.Key, owner.Generation); !errors.Is(err, ErrAttemptsExhausted) {
		t.Fatalf("unbounded retry: %v", err)
	}
}

func TestBoundLeaseRequiresMatchingServiceProcessAndGeneration(t *testing.T) {
	r := fixtureRegistry(t, t.TempDir(), RegistryOptions{})
	owner := fixtureOwner(t, fixtureWorkspace, "bound")
	lease := reserve(t, r, owner, "alpha")
	process, err := CaptureProcess(os.Getpid(), ProcessOwner{WorkspaceID: fixtureWorkspace, Generation: owner.Generation, Role: "plugin-vite", Source: "/fixture/alpha"})
	if err != nil {
		t.Fatal(err)
	}
	wrong := process
	wrong.Generation = "foreign-generation"
	if err := r.ConfirmBound(context.Background(), lease.Key, owner.Generation, lease.Port, wrong); !errors.Is(err, ErrOwnership) {
		t.Fatalf("wrong generation bound: %v", err)
	}
	if err := r.ConfirmBound(context.Background(), lease.Key, owner.Generation, lease.Port, process); err != nil {
		t.Fatal(err)
	}
	if err := r.Release(context.Background(), lease.Key, "foreign-generation"); !errors.Is(err, ErrOwnership) {
		t.Fatalf("foreign generation released lease: %v", err)
	}
	if err := r.Release(context.Background(), lease.Key, owner.Generation); err != nil {
		t.Fatal(err)
	}
	if err := r.Release(context.Background(), lease.Key, owner.Generation); err != nil {
		t.Fatalf("release is not idempotent: %v", err)
	}
}

func TestLiveGenerationCannotBeStolenAndStalePIDCanBeReclaimed(t *testing.T) {
	root := t.TempDir()
	r := fixtureRegistry(t, root, RegistryOptions{})
	owner := fixtureOwner(t, fixtureWorkspace, "old")
	lease := reserve(t, r, owner, "alpha")
	newOwner := fixtureOwner(t, fixtureWorkspace, "new")
	if _, err := r.Reserve(context.Background(), LeaseRequest{Key: lease.Key, Owner: newOwner}); !errors.Is(err, ErrOwnership) {
		t.Fatalf("live generation stolen: %v", err)
	}
	// Model a persisted record whose numeric PID now refers to another process.
	state, err := r.readState()
	if err != nil {
		t.Fatal(err)
	}
	entry := state.Leases[lease.Key.registryKey()]
	entry.Owner.StartIdentity = "recycled-start-identity"
	state.Leases[lease.Key.registryKey()] = entry
	if err := r.writeState(state); err != nil {
		t.Fatal(err)
	}
	reclaimed, err := r.Reserve(context.Background(), LeaseRequest{Key: lease.Key, Owner: newOwner})
	if err != nil {
		t.Fatal(err)
	}
	if reclaimed.Generation != newOwner.Generation || reclaimed.Owner != newOwner || reclaimed.State != LeaseReserved {
		t.Fatalf("stale lease was not reclaimed by the new generation: %+v", reclaimed)
	}
	if _, err := r.Reserve(context.Background(), LeaseRequest{Key: lease.Key, Owner: owner}); !errors.Is(err, ErrOwnership) {
		t.Fatalf("old generation reclaimed the live replacement: %v", err)
	}
}

func TestStrictLeaseCannotReallocateAndCooperatingReservationsConflict(t *testing.T) {
	r := fixtureRegistry(t, t.TempDir(), RegistryOptions{})
	owner := fixtureOwner(t, fixtureWorkspace, "strict")
	first := reserve(t, r, owner, "alpha")
	otherOwner := fixtureOwner(t, secondWorkspace, "strict-other")
	_, err := r.Reserve(context.Background(), LeaseRequest{Key: ServiceKey{WorkspaceID: secondWorkspace, Role: "vite"}, Owner: otherOwner, Override: first.Port})
	if !errors.Is(err, ErrPortConflict) {
		t.Fatalf("reservation collision accepted: %v", err)
	}
	if err := r.Release(context.Background(), first.Key, owner.Generation); err != nil {
		t.Fatal(err)
	}
	pinned, err := r.Reserve(context.Background(), LeaseRequest{Key: first.Key, Owner: owner, Override: first.Port})
	if err != nil {
		t.Fatal(err)
	}
	if err := r.BindFailed(context.Background(), pinned.Key, owner.Generation, pinned.Port); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reallocate(context.Background(), pinned.Key, owner.Generation); !errors.Is(err, ErrPortConflict) {
		t.Fatalf("strict lease drifted: %v", err)
	}
}

func TestRegistryCrossProcessAllocator(t *testing.T) {
	if root := os.Getenv("OMNIVIEW_SESSION_TEST_ROOT"); root != "" {
		r := fixtureRegistry(t, root, RegistryOptions{})
		owner := fixtureOwner(t, fixtureWorkspace, os.Getenv("OMNIVIEW_SESSION_TEST_PLUGIN"))
		lease := reserve(t, r, owner, os.Getenv("OMNIVIEW_SESSION_TEST_PLUGIN"))
		if err := os.WriteFile(filepath.Join(root, owner.Generation+".result"), []byte(strconv.Itoa(lease.Port)), 0600); err != nil {
			t.Fatal(err)
		}
		return
	}
	root := t.TempDir()
	var commands []*exec.Cmd
	for _, plugin := range []string{"child-one", "child-two"} {
		cmd := exec.Command(os.Args[0], "-test.run=^TestRegistryCrossProcessAllocator$")
		cmd.Env = append(os.Environ(), "GOWORK=off", "OMNIVIEW_SESSION_TEST_ROOT="+root, "OMNIVIEW_SESSION_TEST_PLUGIN="+plugin)
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		commands = append(commands, cmd)
	}
	for _, cmd := range commands {
		if err := cmd.Wait(); err != nil {
			t.Fatal(err)
		}
	}
	one, err := os.ReadFile(filepath.Join(root, "child-one.result"))
	if err != nil {
		t.Fatal(err)
	}
	two, err := os.ReadFile(filepath.Join(root, "child-two.result"))
	if err != nil {
		t.Fatal(err)
	}
	if string(one) == string(two) {
		t.Fatalf("separate processes received duplicate port %s", one)
	}
	stored, err := fixtureRegistry(t, root, RegistryOptions{}).List(context.Background(), fixtureWorkspace)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored) != 2 {
		t.Fatalf("cross-process write lost a reservation: %+v", stored)
	}
}

func TestManagedRangeIsPersistedAndOverrideMayPinOutsideIt(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	occupied := listener.Addr().(*net.TCPAddr).Port
	defer listener.Close()
	root := t.TempDir()
	r := fixtureRegistry(t, root, RegistryOptions{MinPort: occupied, MaxPort: occupied})
	owner := fixtureOwner(t, fixtureWorkspace, "custom-range")
	key := ServiceKey{WorkspaceID: fixtureWorkspace, Role: "vite"}
	if _, err := r.Reserve(context.Background(), LeaseRequest{Key: key, Owner: owner}); !errors.Is(err, ErrPortConflict) {
		t.Fatalf("occupied range allocated: %v", err)
	}
	if _, err := OpenRegistry(root, RegistryOptions{MinPort: 1, MaxPort: 65535}); !errors.Is(err, ErrPortConflict) {
		t.Fatalf("persisted range silently changed: %v", err)
	}
	pinnedListener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	pinned := pinnedListener.Addr().(*net.TCPAddr).Port
	if err := pinnedListener.Close(); err != nil {
		t.Fatal(err)
	}
	r = fixtureRegistry(t, root, RegistryOptions{})
	lease, err := r.Reserve(context.Background(), LeaseRequest{Key: key, Owner: owner, Override: pinned})
	if err != nil {
		t.Fatal(err)
	}
	if lease.Port != pinned || !lease.Strict {
		t.Fatalf("override was not strictly pinned: %+v", lease)
	}
}

func TestStaleSupervisorDoesNotHideLiveOrphanChild(t *testing.T) {
	r := fixtureRegistry(t, t.TempDir(), RegistryOptions{})
	owner := fixtureOwner(t, fixtureWorkspace, "orphan-old")
	lease := reserve(t, r, owner, "alpha")
	process, err := CaptureProcess(os.Getpid(), ProcessOwner{WorkspaceID: fixtureWorkspace, Generation: owner.Generation, Role: lease.Key.Role, Source: "/fixture/alpha"})
	if err != nil {
		t.Fatal(err)
	}
	if err := r.ConfirmBound(context.Background(), lease.Key, owner.Generation, lease.Port, process); err != nil {
		t.Fatal(err)
	}
	state, err := r.readState()
	if err != nil {
		t.Fatal(err)
	}
	entry := state.Leases[lease.Key.registryKey()]
	entry.Owner.StartIdentity = "dead-supervisor"
	state.Leases[lease.Key.registryKey()] = entry
	if err := r.writeState(state); err != nil {
		t.Fatal(err)
	}
	newOwner := fixtureOwner(t, fixtureWorkspace, "orphan-new")
	if _, err := r.Reserve(context.Background(), LeaseRequest{Key: lease.Key, Owner: newOwner}); !errors.Is(err, ErrOwnership) {
		t.Fatalf("live orphan generation stolen: %v", err)
	}
}

func TestCorruptRegistryIsNotResetOrOverwritten(t *testing.T) {
	root := t.TempDir()
	r := fixtureRegistry(t, root, RegistryOptions{})
	owner := fixtureOwner(t, fixtureWorkspace, "corruption")
	corrupt := []byte(`{"schemaVersion":1,"leases":`)
	if err := os.WriteFile(filepath.Join(root, "leases.json"), corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Reserve(context.Background(), LeaseRequest{Key: ServiceKey{WorkspaceID: fixtureWorkspace, Role: "vite"}, Owner: owner}); err == nil {
		t.Fatal("corrupt registry was accepted")
	}
	if _, err := OpenRegistry(root, RegistryOptions{}); err == nil {
		t.Fatal("corrupt registry was silently reinitialized")
	}
	actual, err := os.ReadFile(filepath.Join(root, "leases.json"))
	if err != nil || string(actual) != string(corrupt) {
		t.Fatalf("corrupt registry was overwritten: %q %v", actual, err)
	}
}

func TestAutomaticOutOfRangeRegistryPortIsRejectedWithoutMutation(t *testing.T) {
	for _, port := range []int{19000, 45000} {
		t.Run(strconv.Itoa(port), func(t *testing.T) {
			root := t.TempDir()
			r := fixtureRegistry(t, root, RegistryOptions{})
			owner := fixtureOwner(t, fixtureWorkspace, "out-of-range")
			lease := reserve(t, r, owner, "alpha")
			state, err := r.readState()
			if err != nil {
				t.Fatal(err)
			}
			entry := state.Leases[lease.Key.registryKey()]
			entry.Port, entry.State, entry.FailedPorts = port, LeaseBindFailed, []int{port}
			state.Leases[lease.Key.registryKey()] = entry
			if err := r.writeState(state); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(filepath.Join(root, "leases.json"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := r.Reallocate(context.Background(), lease.Key, owner.Generation); !errors.Is(err, ErrOwnership) {
				t.Errorf("out-of-range automatic port reallocated: %v", err)
			}
			if _, err := OpenRegistry(root, RegistryOptions{}); !errors.Is(err, ErrOwnership) {
				t.Errorf("corrupt automatic assignment reopened: %v", err)
			}
			after, err := os.ReadFile(filepath.Join(root, "leases.json"))
			if err != nil || string(after) != string(before) {
				t.Fatalf("rejected registry was mutated: %v", err)
			}
		})
	}
}
