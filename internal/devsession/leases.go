package devsession

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

var (
	ErrPortConflict      = errors.New("devsession: port conflict")
	ErrInvalidTransition = errors.New("devsession: invalid lease transition")
	ErrAttemptsExhausted = errors.New("devsession: bind allocation attempts exhausted")
)

const (
	LeaseReserved   = "reserved"
	LeaseBound      = "bound"
	LeaseBindFailed = "bind-failed"
	LeaseReleased   = "released"
)

// ServiceKey never depends on plugin selection order or a workspace slug.
type ServiceKey struct {
	WorkspaceID string `json:"workspaceID"`
	Role        string `json:"role"`
	PluginID    string `json:"pluginID,omitempty"`
}

func (key ServiceKey) validate() error {
	if !validWorkspace(key.WorkspaceID) || !validLabel(key.Role) || strings.ContainsAny(key.PluginID, "\x00\r\n") {
		return fmt.Errorf("%w: invalid service identity", ErrOwnership)
	}
	return nil
}

func (key ServiceKey) registryKey() string {
	return key.WorkspaceID + "\x00" + key.Role + "\x00" + key.PluginID
}

type RegistryOptions struct {
	// Zero range adopts an existing registry's range, or 20000–44999 for a new registry.
	MinPort int
	MaxPort int
	// MaxAttempts includes the initial assignment; zero defaults to eight.
	MaxAttempts int
}

type LeaseRequest struct {
	Key ServiceKey
	// Owner is the supervisor's captured identity, not the future listener PID.
	Owner  devcontract.ProcessIdentity
	Strict bool
	// A nonzero explicit override is always strict, even outside the managed range.
	Override int
}

// Lease is a cooperating reservation, NOT an OS socket reservation or readiness
// claim. Bound means the caller acknowledged this exact port for Process after
// independently verifying the endpoint; it does not mean RPC/controllers ready.
type Lease struct {
	Key         ServiceKey                   `json:"key"`
	Port        int                          `json:"port"`
	Generation  string                       `json:"generation"`
	Owner       devcontract.ProcessIdentity  `json:"owner"`
	Process     *devcontract.ProcessIdentity `json:"process,omitempty"`
	State       string                       `json:"state"`
	Strict      bool                         `json:"strict"`
	Attempt     int                          `json:"attempt"`
	MaxAttempts int                          `json:"maxAttempts"`
	FailedPorts []int                        `json:"failedPorts,omitempty"`
}

type registryState struct {
	SchemaVersion int              `json:"schemaVersion"`
	MinPort       int              `json:"minPort"`
	MaxPort       int              `json:"maxPort"`
	Leases        map[string]Lease `json:"leases"`
}

type Registry struct {
	root        string
	maxAttempts int
}

// OpenRegistry uses one dedicated, private root shared by all cooperating
// workspaces. Canonical paths share the same OS lock, including across processes.
func OpenRegistry(root string, options RegistryOptions) (*Registry, error) {
	if options.MinPort == 0 && options.MaxPort != 0 || options.MinPort != 0 && options.MaxPort == 0 || options.MinPort < 0 || options.MaxPort > 65535 || options.MinPort > options.MaxPort || options.MaxAttempts < 0 {
		return nil, fmt.Errorf("%w: invalid managed range or attempt limit", ErrPortConflict)
	}
	if options.MaxAttempts == 0 {
		options.MaxAttempts = 8
	}
	root, err := EnsurePrivateDirectory(root)
	if err != nil {
		return nil, err
	}
	r := &Registry{root: root, maxAttempts: options.MaxAttempts}
	lock, err := AcquirePrivateLock(context.Background(), root, "leases.lock")
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	state, err := r.readState()
	if errors.Is(err, os.ErrNotExist) {
		minimum, maximum := options.MinPort, options.MaxPort
		if minimum == 0 {
			minimum, maximum = 20000, 44999
		}
		state = registryState{SchemaVersion: 1, MinPort: minimum, MaxPort: maximum, Leases: map[string]Lease{}}
		if err := r.writeState(state); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	if options.MinPort != 0 && (state.MinPort != options.MinPort || state.MaxPort != options.MaxPort) {
		return nil, fmt.Errorf("%w: managed range differs from the persisted registry", ErrPortConflict)
	}
	return r, nil
}

func (r *Registry) readState() (registryState, error) {
	var state registryState
	if err := ReadPrivateJSON(filepath.Join(r.root, "leases.json"), &state); err != nil {
		return state, err
	}
	if state.SchemaVersion != 1 || state.MinPort < 1 || state.MaxPort > 65535 || state.MinPort > state.MaxPort || state.Leases == nil {
		return state, fmt.Errorf("%w: unsupported or corrupt lease registry", ErrOwnership)
	}
	ports := make(map[int]bool, len(state.Leases))
	for key, lease := range state.Leases {
		if err := lease.Key.validate(); err != nil {
			return state, err
		}
		if key != lease.Key.registryKey() || lease.Port < 1 || lease.Port > 65535 || ports[lease.Port] || lease.Generation != lease.Owner.Generation || lease.Key.WorkspaceID != lease.Owner.WorkspaceID || lease.Attempt < 1 || lease.MaxAttempts < lease.Attempt {
			return state, fmt.Errorf("%w: inconsistent lease record", ErrOwnership)
		}
		if !lease.Strict && (lease.Port < state.MinPort || lease.Port > state.MaxPort) {
			return state, fmt.Errorf("%w: automatic lease port is outside the managed range", ErrOwnership)
		}
		if err := validateOwnedRecord(lease.Owner, ownerOf(lease.Owner)); err != nil {
			return state, err
		}
		if lease.Process != nil {
			process := *lease.Process
			if process.WorkspaceID != lease.Key.WorkspaceID || process.Generation != lease.Generation || process.Role != lease.Key.Role {
				return state, fmt.Errorf("%w: inconsistent service process", ErrOwnership)
			}
			if err := validateOwnedRecord(process, ownerOf(process)); err != nil {
				return state, err
			}
		}
		if lease.State == LeaseBound && lease.Process == nil {
			return state, fmt.Errorf("%w: bound lease is missing process provenance", ErrOwnership)
		}
		switch lease.State {
		case LeaseReserved, LeaseBound, LeaseBindFailed, LeaseReleased:
		default:
			return state, fmt.Errorf("%w: unknown lease state", ErrOwnership)
		}
		ports[lease.Port] = true
	}
	return state, nil
}

func (r *Registry) writeState(state registryState) error {
	return WritePrivateJSON(filepath.Join(r.root, "leases.json"), state)
}

func portAvailable(port int) bool {
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return false
	}
	return listener.Close() == nil
}

func preferredPort(key ServiceKey, state registryState) int {
	hash := sha256.Sum256([]byte(key.registryKey()))
	return state.MinPort + int(binary.BigEndian.Uint64(hash[:8])%uint64(state.MaxPort-state.MinPort+1))
}

func selectPort(state registryState, key ServiceKey, preferred int, strict bool, failed []int) (int, error) {
	blocked := make(map[int]bool, len(state.Leases)+len(failed))
	for _, lease := range state.Leases {
		// Retained assignments remain sticky even while released or stale.
		if lease.Key != key {
			blocked[lease.Port] = true
		}
	}
	for _, port := range failed {
		blocked[port] = true
	}
	if strict {
		if !blocked[preferred] && portAvailable(preferred) {
			return preferred, nil
		}
		return 0, fmt.Errorf("%w: strict port %d is occupied or assigned", ErrPortConflict, preferred)
	}
	span := state.MaxPort - state.MinPort + 1
	for offset := range span {
		port := state.MinPort + (preferred-state.MinPort+offset)%span
		if !blocked[port] && portAvailable(port) {
			return port, nil
		}
	}
	return 0, fmt.Errorf("%w: managed port range exhausted", ErrPortConflict)
}

func leaseLive(lease Lease) (bool, error) {
	live, err := processRecordLive(lease.Owner)
	if err != nil || live {
		return live, err
	}
	if lease.Process != nil {
		return processRecordLive(*lease.Process)
	}
	return false, nil
}

// Reserve persists the exact assignment before returning it. An existing live
// generation cannot be adopted. Explicit overrides never silently increment.
func (r *Registry) Reserve(ctx context.Context, request LeaseRequest) (Lease, error) {
	if err := request.Key.validate(); err != nil {
		return Lease{}, err
	}
	if request.Owner.WorkspaceID != request.Key.WorkspaceID {
		return Lease{}, ErrOwnership
	}
	if err := VerifyOwnedProcess(request.Owner, ownerOf(request.Owner)); err != nil {
		return Lease{}, err
	}
	if request.Override < 0 || request.Override > 65535 {
		return Lease{}, ErrPortConflict
	}
	lock, err := AcquirePrivateLock(ctx, r.root, "leases.lock")
	if err != nil {
		return Lease{}, err
	}
	defer lock.Close()
	state, err := r.readState()
	if err != nil {
		return Lease{}, err
	}
	previous, exists := state.Leases[request.Key.registryKey()]
	strict := request.Strict || request.Override != 0
	if exists && previous.State != LeaseReleased {
		if previous.Generation == request.Owner.Generation {
			if previous.Owner != request.Owner {
				return Lease{}, ErrOwnership
			}
			if previous.Strict != strict || request.Override != 0 && previous.Port != request.Override {
				return Lease{}, ErrInvalidTransition
			}
			return previous, nil
		}
		live, err := leaseLive(previous)
		if err != nil {
			return Lease{}, err
		}
		if live {
			return Lease{}, fmt.Errorf("%w: service belongs to a live generation", ErrOwnership)
		}
	}
	preferred := preferredPort(request.Key, state)
	if exists && previous.Port >= state.MinPort && previous.Port <= state.MaxPort {
		preferred = previous.Port
	}
	if request.Override != 0 {
		preferred = request.Override
	}
	port, err := selectPort(state, request.Key, preferred, strict, nil)
	if err != nil {
		return Lease{}, err
	}
	lease := Lease{Key: request.Key, Port: port, Generation: request.Owner.Generation, Owner: request.Owner, State: LeaseReserved, Strict: strict, Attempt: 1, MaxAttempts: r.maxAttempts}
	state.Leases[request.Key.registryKey()] = lease
	if err := r.writeState(state); err != nil {
		return Lease{}, err
	}
	return lease, nil
}

func matchingLease(state registryState, key ServiceKey, generation string) (Lease, error) {
	if err := key.validate(); err != nil {
		return Lease{}, err
	}
	if !validLabel(generation) {
		return Lease{}, ErrOwnership
	}
	lease, ok := state.Leases[key.registryKey()]
	if !ok {
		return Lease{}, os.ErrNotExist
	}
	if lease.Generation != generation {
		return Lease{}, ErrOwnership
	}
	return lease, nil
}

// BindFailed records an observed strict-child bind failure. It does not retry or
// terminate anything. The caller must reap its failed child before Reallocate.
func (r *Registry) BindFailed(ctx context.Context, key ServiceKey, generation string, port int) error {
	return r.change(ctx, key, generation, func(lease *Lease, _ registryState) error {
		if lease.Port != port {
			return ErrPortConflict
		}
		if lease.State == LeaseBindFailed {
			return nil
		}
		if lease.State != LeaseReserved {
			return ErrInvalidTransition
		}
		lease.State = LeaseBindFailed
		lease.FailedPorts = append(lease.FailedPorts, port)
		return nil
	})
}

// Reallocate is the only automatic bind-race retry. Each returned assignment is
// recorded, skips this generation's failed ports, and consumes a bounded attempt.
func (r *Registry) Reallocate(ctx context.Context, key ServiceKey, generation string) (Lease, error) {
	var next Lease
	err := r.change(ctx, key, generation, func(lease *Lease, state registryState) error {
		if lease.State != LeaseBindFailed {
			return ErrInvalidTransition
		}
		if lease.Strict {
			return ErrPortConflict
		}
		if lease.Attempt >= lease.MaxAttempts {
			return ErrAttemptsExhausted
		}
		if err := VerifyOwnedProcess(lease.Owner, ownerOf(lease.Owner)); err != nil {
			return err
		}
		preferred := lease.Port + 1
		if preferred > state.MaxPort {
			preferred = state.MinPort
		}
		port, err := selectPort(state, key, preferred, false, lease.FailedPorts)
		if err != nil {
			return err
		}
		lease.Port, lease.State, lease.Attempt = port, LeaseReserved, lease.Attempt+1
		next = *lease
		return nil
	})
	return next, err
}

// ConfirmBound rejects a child's hidden port increment and verifies its captured
// process identity. Callers must independently verify endpoint workspace and
// generation plus service-specific readiness before advertising a ready service.
func (r *Registry) ConfirmBound(ctx context.Context, key ServiceKey, generation string, actualPort int, process devcontract.ProcessIdentity) error {
	return r.change(ctx, key, generation, func(lease *Lease, _ registryState) error {
		if actualPort != lease.Port {
			return ErrPortConflict
		}
		if process.WorkspaceID != key.WorkspaceID || process.Generation != generation || process.Role != key.Role {
			return ErrOwnership
		}
		if err := VerifyOwnedProcess(process, ownerOf(process)); err != nil {
			return err
		}
		if lease.State == LeaseBound && lease.Process != nil && *lease.Process == process {
			return nil
		}
		if lease.State != LeaseReserved {
			return ErrInvalidTransition
		}
		lease.State, lease.Process = LeaseBound, &process
		return nil
	})
}

// Release ends only this generation's cooperating reservation. It never closes a
// socket or kills a child, and retains the sticky assignment across restarts.
func (r *Registry) Release(ctx context.Context, key ServiceKey, generation string) error {
	err := r.change(ctx, key, generation, func(lease *Lease, _ registryState) error { lease.State = LeaseReleased; return nil })
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (r *Registry) change(ctx context.Context, key ServiceKey, generation string, update func(*Lease, registryState) error) error {
	lock, err := AcquirePrivateLock(ctx, r.root, "leases.lock")
	if err != nil {
		return err
	}
	defer lock.Close()
	state, err := r.readState()
	if err != nil {
		return err
	}
	lease, err := matchingLease(state, key, generation)
	if err != nil {
		return err
	}
	if err := update(&lease, state); err != nil {
		return err
	}
	state.Leases[key.registryKey()] = lease
	return r.writeState(state)
}

// List returns persisted assignments, including released/stale generations, for
// an explicit workspace. It makes no liveness or readiness claim.
func (r *Registry) List(ctx context.Context, workspaceID string) ([]Lease, error) {
	if !validWorkspace(workspaceID) {
		return nil, ErrOwnership
	}
	lock, err := AcquirePrivateLock(ctx, r.root, "leases.lock")
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	state, err := r.readState()
	if err != nil {
		return nil, err
	}
	leases := make([]Lease, 0)
	for _, lease := range state.Leases {
		if lease.Key.WorkspaceID == workspaceID {
			leases = append(leases, lease)
		}
	}
	sort.Slice(leases, func(i, j int) bool { return leases[i].Key.registryKey() < leases[j].Key.registryKey() })
	return leases, nil
}
