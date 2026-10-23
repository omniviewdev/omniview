package devserver

import (
	"fmt"
	"os"

	"github.com/omniviewdev/omniview/internal/devsession"
)

// ConfigureProcessSupervisor enables the outer workspace supervisor's retained
// frontend Cmd ownership. It is explicit and startup-only; absence keeps the
// local retained runner, never an error-triggered remote-to-local fallback.
func (m *DevServerManager) ConfigureProcessSupervisor(config devsession.ProcessBridgeConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.instances) != 0 {
		return fmt.Errorf("configure process supervisor before starting managed plugins")
	}
	if m.workspace == nil || m.ports.registry == nil {
		return fmt.Errorf("configure the resolved workspace before its process supervisor")
	}
	owner := m.ports.owner
	if config.WorkspaceFile != m.workspace.ManifestPath || config.WorkspaceID != owner.WorkspaceID || config.Generation != owner.Generation || config.Host.PID != os.Getpid() || config.Host.PID != owner.PID || config.Host.StartIdentity != owner.StartIdentity || config.Host.Executable != owner.Executable || config.Host.Role != owner.Role {
		return fmt.Errorf("process supervisor must target this exact configured workspace host")
	}
	// The client verifies the captured host's selected repository source. The
	// shared Vite lease deliberately retains the independently checked manifest
	// source, rather than rewriting its established A06 ownership contract.
	client, err := devsession.NewProcessBridgeClient(config)
	if err != nil {
		return err
	}
	if m.processSupervisor != nil {
		m.processSupervisor.Close()
	}
	m.processSupervisor = client
	m.ports.mu.Lock()
	m.ports.supervised = true
	m.ports.mu.Unlock()
	return nil
}

// SupervisorOwnsStartup reports whether this host's validated workspace
// supervisor owns initial selected-source linking. A workspace configured
// without that process capability retains standalone dev-plugin restoration.
func (m *DevServerManager) SupervisorOwnsStartup() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.workspace != nil && m.processSupervisor != nil
}
