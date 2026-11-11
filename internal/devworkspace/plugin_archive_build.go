package devworkspace

import (
	"context"
	"fmt"
	"io"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

// BuildPluginArchive builds one plugin's JavaScript and native backend closure,
// then invokes the canonical owned-output archive writer. Checked-in bindings
// remain JavaScript inputs. It never builds or launches the host, installs the
// archive, or claims that a native connection negotiated successfully.
func (m *Manager) BuildPluginArchive(ctx context.Context, name, pluginID string, output io.Writer) (string, ArchivePluginStatus, error) {
	var receipt ArchivePluginStatus
	w, unlock, err := m.linkWorkspace(ctx, name)
	if err != nil {
		return "", receipt, err
	}
	defer func() {
		if unlock != nil {
			unlock()
		}
	}()
	j, err := loadLinkJournal(w)
	if err != nil {
		return "", receipt, err
	}
	if j.Phase != "linked" || !sameManifest(j.Manifest, w.Manifest) || j.Plan.Composition == nil {
		return "", receipt, fmt.Errorf("plugin archive build requires a successfully linked source composition")
	}
	if err = j.Evidence.validateRoots(j.Plan.Roots); err != nil {
		return "", receipt, err
	}
	var plugin devcontract.Plugin
	for _, selected := range w.Manifest.Plugins {
		if selected.ID == pluginID {
			plugin = selected
			break
		}
	}
	if plugin.ID == "" {
		return "", receipt, fmt.Errorf("plugin %s is not selected", pluginID)
	}
	nodes, err := planBuildNodes(w)
	if err != nil {
		return "", receipt, err
	}
	nodes, err = pluginArchiveNodes(nodes, pluginID)
	if err != nil {
		return "", receipt, err
	}
	frontend, err := pluginUINodes(nodes, pluginID)
	if err != nil {
		return "", receipt, err
	}
	var backend BuildNode
	for _, node := range nodes {
		if node.ID == "plugin-backend:"+pluginID {
			backend = node
		}
	}
	generation := uuid.NewString()
	g := &BuildGraph{workspace: w, plan: j.Plan, Nodes: nodes, manager: m, options: BuildOptions{
		Generation: generation, VerifySDK: devsdk.NewVerifier(m.options.SDKPolicy),
	}}
	if output != nil {
		g.options.Output = &lockedWriter{writer: output}
	}
	g.run, g.runProducer = g.command, g.commandWithEnvironment
	if err = g.withBuildLock(ctx, func() error {
		if err := g.auditComposition(ctx); err != nil {
			return err
		}
		cache, err := prepareWorkspaceBuildCacheLocked(w, m.options.Home, generation)
		if err != nil {
			return err
		}
		g.options.GoBuildCacheDirectory = cache
		if err = g.execute(ctx, frontend, nil); err != nil {
			return err
		}
		for _, resolution := range inspectJavaScriptLinks(ctx, j).Resolutions {
			if resolution.Problem != "" {
				return fmt.Errorf("plugin archive dependency unresolved for %s in %s: %s", resolution.Package, resolution.Consumer, resolution.Problem)
			}
		}
		binary, identity, err := g.buildPluginBackendOutput(ctx, backend)
		if err != nil {
			return g.downgradeOnError(backend.Directory, err)
		}
		if err = g.auditComposition(ctx); err != nil {
			return err
		}
		// No producer is alive across this boundary. The real artifact writer
		// must acquire the stable UUID guard itself, not borrow or bypass it.
		// Keep the graph lock; publication below reacquires every stopped guard
		// and rejects a removed, replaced or edited workspace and stale outputs.
		unlock()
		unlock = nil
		if err = g.recordArtifact(pluginID, binary, identity); err != nil {
			return err
		}
		current, relock, err := m.linkWorkspace(ctx, name)
		if err != nil {
			return err
		}
		unlock = relock
		if current.Root != w.Root || current.StateRoot != w.StateRoot || !sameManifest(current.Manifest, w.Manifest) {
			return fmt.Errorf("plugin archive workspace changed before publication")
		}
		if err = g.auditComposition(ctx); err != nil {
			return err
		}
		g.recordBuilt(backend.ID, identity)
		_, receipt, err = g.PublishPluginArchive(ctx, plugin)
		return err
	}); err != nil {
		return "", ArchivePluginStatus{}, err
	}
	return receipt.Archive, receipt, nil
}

// pluginArchiveNodes extends the existing UI-only closure by exactly its own
// backend. Native host nodes and unrelated plugins cannot enter this subgraph.
func pluginArchiveNodes(nodes []BuildNode, pluginID string) ([]BuildNode, error) {
	frontend, err := pluginUINodes(nodes, pluginID)
	if err != nil {
		return nil, err
	}
	wanted := make(map[string]bool, len(frontend)+1)
	for _, node := range frontend {
		wanted[node.ID] = true
	}
	backend := "plugin-backend:" + pluginID
	found := false
	for _, node := range nodes {
		if node.ID != backend {
			continue
		}
		if node.Kind != "plugin-backend" || node.PluginID != pluginID {
			return nil, fmt.Errorf("plugin archive backend %s has a different producer", backend)
		}
		for _, dependency := range node.Dependencies {
			if !wanted[dependency] {
				return nil, fmt.Errorf("plugin archive backend %s has an unselected dependency %s", backend, dependency)
			}
		}
		wanted[backend], found = true, true
	}
	if !found {
		return nil, fmt.Errorf("plugin archive requires a selected backend for %s", pluginID)
	}
	selected := make([]BuildNode, 0, len(wanted))
	for _, node := range nodes {
		if wanted[node.ID] {
			selected = append(selected, node)
		}
	}
	return selected, nil
}
