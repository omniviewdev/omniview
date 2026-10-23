package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"sync"

	"strings"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

const pluginPIDFileName = "plugin_pids.json"

// PIDTracker persists kernel process identity plus supervisor provenance. Numeric
// legacy PIDs are retained as rejected recovery evidence, never kill authority.
// Live children remain owned by go-plugin Client.Kill, including on Darwin.
type PIDTracker struct {
	mu        sync.Mutex
	pids      map[string]devcontract.ProcessIdentity
	removed   map[string]bool
	stateRoot *appstate.ScopedRoot
}

func NewPIDTracker(root *appstate.ScopedRoot) *PIDTracker {
	return &PIDTracker{pids: map[string]devcontract.ProcessIdentity{}, removed: map[string]bool{}, stateRoot: root}
}

func (t *PIDTracker) RecordOwned(id string, pid int, owner devsession.ProcessOwner) error {
	if owner.Role != "plugin-backend" {
		return fmt.Errorf("invalid backend process role")
	}
	record, err := devsession.CaptureProcess(pid, owner)
	if err != nil {
		return err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if data, readErr := t.stateRoot.ReadFile(pluginPIDFileName); readErr == nil {
		var saved map[string]json.RawMessage
		if err = json.Unmarshal(data, &saved); err != nil {
			return err
		}
		if raw, exists := saved[id]; exists && !t.removed[id] {
			var old devcontract.ProcessIdentity
			if err = json.Unmarshal(raw, &old); err != nil {
				return fmt.Errorf("unowned backend recovery record retained: %w", err)
			}
			if old != record {
				expected := devsession.ProcessOwner{WorkspaceID: owner.WorkspaceID, Generation: old.Generation, Role: "plugin-backend", Source: old.Source}
				if err := devsession.VerifyOwnedProcess(old, expected); !errors.Is(err, devsession.ErrProcessGone) {
					return fmt.Errorf("unresolved backend recovery ownership conflict for %s: %v", id, err)
				}
			}
		}
	} else if !errors.Is(readErr, fs.ErrNotExist) {
		return readErr
	}
	t.pids[id] = record
	delete(t.removed, id)
	return nil
}
func (t *PIDTracker) Remove(id string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.pids[id]; ok {
		delete(t.pids, id)
		t.removed[id] = true
	}
}

func (t *PIDTracker) Save() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	data := map[string]json.RawMessage{}
	if b, err := t.stateRoot.ReadFile(pluginPIDFileName); err == nil {
		if err = json.Unmarshal(b, &data); err != nil {
			return err
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	for id := range t.removed {
		delete(data, id)
	}
	for id, record := range t.pids {
		b, err := json.Marshal(record)
		if err != nil {
			return err
		}
		data[id] = b
	}
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return t.writeOwnershipFile(b)
}

func (t *PIDTracker) CleanupStale(logger logging.Logger) {
	b, err := t.stateRoot.ReadFile(pluginPIDFileName)
	if errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err != nil {
		logger.Warnw(context.Background(), "read plugin recovery records", "error", err)
		return
	}
	var data map[string]json.RawMessage
	if err = json.Unmarshal(b, &data); err != nil {
		logger.Warnw(context.Background(), "invalid plugin recovery records retained", "error", err)
		return
	}
	environment, envErr := instance.PluginEnvironment(t.stateRoot.ResolvePath(""), "", os.Environ())
	if envErr != nil {
		logger.Warnw(context.Background(), "cannot resolve plugin recovery workspace; records retained", "error", envErr)
		return
	}
	workspace := ""
	for _, entry := range environment {
		if strings.HasPrefix(entry, "OMNIVIEW_WORKSPACE_ID=") {
			workspace = strings.TrimPrefix(entry, "OMNIVIEW_WORKSPACE_ID=")
		}
	}
	for id, raw := range data {
		var record devcontract.ProcessIdentity
		if err = json.Unmarshal(raw, &record); err != nil || workspace == "" || record.WorkspaceID != workspace || record.Role != "plugin-backend" {
			logger.Warnw(context.Background(), "unowned plugin recovery record retained", "pluginID", id)
			continue
		}
		expected := devsession.ProcessOwner{WorkspaceID: workspace, Generation: record.Generation, Role: "plugin-backend", Source: record.Source}
		if err = devsession.TerminateOwnedProcess(record, expected); err != nil {
			logger.Warnw(context.Background(), "plugin recovery unsupported or ownership rejected; record retained", "pluginID", id, "error", err)
			continue
		}
		if exitErr := devsession.VerifyOwnedProcess(record, expected); !errors.Is(exitErr, devsession.ErrProcessGone) {
			logger.Warnw(context.Background(), "plugin termination delivered but exit is unconfirmed; record retained", "pluginID", id, "error", exitErr)
			continue
		}
		delete(data, id)
	}
	if b, err = json.Marshal(data); err == nil {
		if err = t.writeOwnershipFile(b); err != nil {
			logger.Warnw(context.Background(), "persist retained plugin ownership records", "error", err)
		}
	}
}

func (t *PIDTracker) writeOwnershipFile(data []byte) error {
	name := pluginPIDFileName + "." + uuid.NewString() + ".tmp"
	file, err := t.stateRoot.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer t.stateRoot.Remove(name)
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return err
	}
	return t.stateRoot.Rename(name, pluginPIDFileName)
}

// CheckAvailable runs before exec: unresolved recovery evidence must block a
// second backend, not merely reject recording it after its startup side effects.
func (t *PIDTracker) CheckAvailable(id, workspaceID string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	data, err := t.stateRoot.ReadFile(pluginPIDFileName)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var records map[string]json.RawMessage
	if err = json.Unmarshal(data, &records); err != nil {
		return err
	}
	raw, exists := records[id]
	if !exists {
		return nil
	}
	var record devcontract.ProcessIdentity
	if err = json.Unmarshal(raw, &record); err != nil {
		return fmt.Errorf("unowned backend recovery record retained for %s: %w", id, err)
	}
	owner := devsession.ProcessOwner{WorkspaceID: workspaceID, Generation: record.Generation, Role: "plugin-backend", Source: record.Source}
	if err = devsession.VerifyOwnedProcess(record, owner); errors.Is(err, devsession.ErrProcessGone) {
		return nil
	}
	return fmt.Errorf("backend recovery is incomplete for %s; ownership record retained: %v", id, err)
}
