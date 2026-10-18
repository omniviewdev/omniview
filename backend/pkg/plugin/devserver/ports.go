package devserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"sync"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

const (
	PortRangeStart       = 15173
	PortRangeEnd         = 15273
	devserverPIDFileName = "devserver_pids.json"
)

// PortAllocator uses shared sticky leases in workspaces. Production's legacy
// managed tools may allocate locally, but never persist numeric kill authority.
type PortAllocator struct {
	mu         sync.Mutex
	assigned   map[int]string
	pids       map[int]devcontract.ProcessIdentity
	stateRoot  *appstate.ScopedRoot
	registry   *devsession.Registry
	owner      devcontract.ProcessIdentity
	leases     map[string]devsession.Lease
	sources    map[string]string
	portPolicy devcontract.PortPolicy
	supervised bool
}

func NewPortAllocator(root *appstate.ScopedRoot) *PortAllocator {
	return &PortAllocator{assigned: map[int]string{}, pids: map[int]devcontract.ProcessIdentity{}, stateRoot: root, leases: map[string]devsession.Lease{}, sources: map[string]string{}}
}

func (pa *PortAllocator) Allocate(id string) (int, error) {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	if pa.registry != nil {
		lease, err := pa.registry.Reserve(context.Background(), devsession.LeaseRequest{Key: devsession.ServiceKey{WorkspaceID: pa.owner.WorkspaceID, Role: "plugin-vite", PluginID: id}, Owner: pa.owner, Strict: pa.portPolicy.Policy == "strict", Override: pa.portPolicy.Overrides["plugin-vite:"+id]})
		if err != nil {
			return 0, err
		}
		pa.leases[id] = lease
		pa.assigned[lease.Port] = id
		return lease.Port, nil
	}
	for port := PortRangeStart; port < PortRangeEnd; port++ {
		if _, ok := pa.assigned[port]; !ok && isPortFree(port) {
			pa.assigned[port] = id
			return port, nil
		}
	}
	return 0, fmt.Errorf("no free managed Vite port in %d-%d", PortRangeStart, PortRangeEnd-1)
}

// RecordProcess accepts a verified actual child identity, never a numeric PID
// recovered or adopted from a status record. The local Cmd or retained outer
// supervisor captures this identity immediately after its own successful Start.
func (pa *PortAllocator) RecordProcess(port int, record devcontract.ProcessIdentity) error {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	id := pa.assigned[port]
	if pa.registry == nil {
		return nil
	}
	if id == "" {
		return fmt.Errorf("Vite port has no owner")
	}
	owner := devsession.ProcessOwner{WorkspaceID: pa.owner.WorkspaceID, Generation: pa.owner.Generation, Role: "plugin-vite", Source: pa.sources[id]}
	if err := devsession.VerifyOwnedProcess(record, owner); err != nil {
		return err
	}
	if data, readErr := pa.stateRoot.ReadFile(devserverPIDFileName); readErr == nil {
		var saved map[string]json.RawMessage
		if err := json.Unmarshal(data, &saved); err != nil {
			return err
		}
		if raw, exists := saved[strconv.Itoa(port)]; exists {
			var old devcontract.ProcessIdentity
			if err := json.Unmarshal(raw, &old); err != nil {
				return fmt.Errorf("unowned Vite recovery record retained: %w", err)
			}
			if old != record {
				expected := devsession.ProcessOwner{WorkspaceID: owner.WorkspaceID, Generation: old.Generation, Role: "plugin-vite", Source: old.Source}
				if err := devsession.VerifyOwnedProcess(old, expected); !errors.Is(err, devsession.ErrProcessGone) {
					return fmt.Errorf("unresolved Vite recovery ownership conflict for port %d: %v", port, err)
				}
			}
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return readErr
	}
	pa.pids[port] = record
	return nil
}

func (pa *PortAllocator) ConfirmBound(id string) error {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	if pa.registry == nil {
		return nil
	}
	lease, ok := pa.leases[id]
	if !ok {
		return fmt.Errorf("Vite lease missing")
	}
	record, ok := pa.pids[lease.Port]
	if !ok {
		return fmt.Errorf("Vite process identity not captured")
	}
	return pa.registry.ConfirmBound(context.Background(), lease.Key, lease.Generation, lease.Port, record)
}

func (pa *PortAllocator) BindFailed(id string) error {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	lease, ok := pa.leases[id]
	if !ok {
		return nil
	}
	return pa.registry.BindFailed(context.Background(), lease.Key, lease.Generation, lease.Port)
}

func (pa *PortAllocator) Release(port int) {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	id := pa.assigned[port]
	if lease, ok := pa.leases[id]; ok {
		if err := pa.registry.Release(context.Background(), lease.Key, lease.Generation); err != nil {
			return
		}
		delete(pa.leases, id)
	}
	delete(pa.assigned, port)
	delete(pa.pids, port)
	delete(pa.sources, id)
}
func (pa *PortAllocator) ReleaseByPlugin(id string) int {
	port := pa.GetPort(id)
	if port != 0 {
		pa.Release(port)
	}
	return port
}
func (pa *PortAllocator) GetPort(id string) int {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	for port, value := range pa.assigned {
		if value == id {
			return port
		}
	}
	return 0
}

// SavePIDs retains rejected records. A stale/foreign record is not erased simply
// because the next supervisor could not safely terminate it (notably Darwin).
func (pa *PortAllocator) SavePIDs() error {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	data := map[string]json.RawMessage{}
	if b, err := pa.stateRoot.ReadFile(devserverPIDFileName); err == nil {
		if err = json.Unmarshal(b, &data); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for port, record := range pa.pids {
		b, err := json.Marshal(record)
		if err != nil {
			return err
		}
		data[strconv.Itoa(port)] = b
	}
	// Cleanly stopped records for this supervisor may be removed; rejected foreign
	// and legacy numeric records remain as explicit recovery evidence.
	for key, raw := range data {
		var record devcontract.ProcessIdentity
		if json.Unmarshal(raw, &record) != nil || record.WorkspaceID != pa.owner.WorkspaceID || record.Generation != pa.owner.Generation {
			continue
		}
		port, _ := strconv.Atoi(key)
		if _, ok := pa.pids[port]; ok {
			continue
		}
		expected := devsession.ProcessOwner{WorkspaceID: record.WorkspaceID, Generation: record.Generation, Role: "plugin-vite", Source: record.Source}
		if errors.Is(devsession.VerifyOwnedProcess(record, expected), devsession.ErrProcessGone) {
			delete(data, key)
		}
	}
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return pa.writeOwnershipFile(b)
}

func (pa *PortAllocator) CleanupStaleProcesses(ctx context.Context, logger logging.Logger) {
	b, err := pa.stateRoot.ReadFile(devserverPIDFileName)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		logger.Warnw(ctx, "cannot read Vite ownership records", "error", err)
		return
	}
	var data map[string]json.RawMessage
	if err = json.Unmarshal(b, &data); err != nil {
		logger.Warnw(ctx, "invalid Vite ownership records retained", "error", err)
		return
	}
	for key, raw := range data {
		var record devcontract.ProcessIdentity
		if err = json.Unmarshal(raw, &record); err != nil || pa.owner.WorkspaceID == "" || record.WorkspaceID != pa.owner.WorkspaceID || record.Role != "plugin-vite" {
			logger.Warnw(ctx, "unowned Vite recovery record retained", "port", key)
			continue
		}
		expected := devsession.ProcessOwner{WorkspaceID: pa.owner.WorkspaceID, Generation: record.Generation, Role: "plugin-vite", Source: record.Source}
		if !pa.supervised {
			if err = devsession.TerminateOwnedProcess(record, expected); err != nil {
				logger.Warnw(ctx, "Vite recovery unsupported or ownership rejected; record retained", "port", key, "error", err)
				continue
			}
		}
		if exitErr := devsession.VerifyOwnedProcess(record, expected); !errors.Is(exitErr, devsession.ErrProcessGone) {
			logger.Warnw(ctx, "Vite termination delivered but exit is unconfirmed; record retained", "port", key, "error", exitErr)
			continue
		}
		delete(data, key)
	}
	if b, err = json.Marshal(data); err == nil {
		if err = pa.writeOwnershipFile(b); err != nil {
			logger.Warnw(ctx, "persist retained Vite ownership records", "error", err)
		}
	}
}

func isPortFree(port int) bool {
	listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}

func (pa *PortAllocator) writeOwnershipFile(data []byte) error {
	name := devserverPIDFileName + "." + uuid.NewString() + ".tmp"
	file, err := pa.stateRoot.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer pa.stateRoot.Remove(name)
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return err
	}
	return pa.stateRoot.Rename(name, devserverPIDFileName)
}
