package devworkspace

import (
	"context"
	"fmt"
	"io"
	"path/filepath"

	"github.com/google/uuid"
)

// BuildPluginUI builds only a real plugin's JavaScript dependency closure in an
// already-linked workspace. Checked-in Wails bindings are source inputs, as for
// task packages. This never builds native binaries, launches the app or attests
// actual IPC. It shares native pnpm, peer audits, shim ordering and repository
// output ownership with the full workspace graph.
func (m *Manager) BuildPluginUI(ctx context.Context, name, pluginID string, output io.Writer) (string, error) {
	w, unlock, err := m.linkWorkspace(ctx, name)
	if err != nil {
		return "", err
	}
	defer unlock()
	j, err := loadLinkJournal(w)
	if err != nil {
		return "", err
	}
	if j.Phase != "linked" || !sameManifest(j.Manifest, w.Manifest) || j.Plan.Composition == nil {
		return "", fmt.Errorf("plugin UI build requires a successfully linked source composition")
	}
	if err = j.Evidence.validateRoots(j.Plan.Roots); err != nil {
		return "", err
	}
	nodes, err := planBuildNodes(w)
	if err != nil {
		return "", err
	}
	nodes, err = pluginUINodes(nodes, pluginID)
	if err != nil {
		return "", err
	}
	g := &BuildGraph{workspace: w, plan: j.Plan, Nodes: nodes, options: BuildOptions{Generation: uuid.NewString(), Output: output}}
	g.run = g.command
	g.runProducer = g.commandWithEnvironment
	if err = g.withBuildLock(ctx, func() error {
		if err := g.auditComposition(ctx); err != nil {
			return err
		}
		if err := g.execute(ctx, nodes); err != nil {
			return err
		}
		// Resolve actual public JS exports after publication, just as Bootstrap
		// does. SDK identity is outside this JavaScript-only build contract.
		jsJournal := *j
		jsJournal.Plan.SDK = ""
		for _, resolution := range inspectLinkPlan(ctx, &jsJournal).Resolutions {
			if resolution.Problem != "" {
				return fmt.Errorf("plugin UI dependency unresolved for %s in %s: %s", resolution.Package, resolution.Consumer, resolution.Problem)
			}
		}
		return g.auditComposition(ctx)
	}); err != nil {
		return "", err
	}
	assets := filepath.Join(nodes[len(nodes)-1].Directory, "dist", "assets")
	if err = requireProducerFile(filepath.Join(assets, "entry.js")); err != nil {
		return "", err
	}
	return assets, nil
}

func pluginUINodes(nodes []BuildNode, pluginID string) ([]BuildNode, error) {
	byID := make(map[string]*BuildNode, len(nodes))
	for index := range nodes {
		node := &nodes[index]
		if _, exists := byID[node.ID]; exists {
			return nil, fmt.Errorf("duplicate build node %s", node.ID)
		}
		byID[node.ID] = node
	}
	wanted, visiting := map[string]bool{}, map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if visiting[id] {
			return fmt.Errorf("cyclic plugin UI build dependency %s", id)
		}
		if wanted[id] {
			return nil
		}
		node, exists := byID[id]
		if !exists {
			return fmt.Errorf("missing plugin UI build dependency %s", id)
		}
		if id == "bindings" && node.Kind == "bindings" {
			return nil // checked-in bindings are inputs to the JavaScript compiler
		}
		if node.Kind != "javascript" {
			return fmt.Errorf("plugin UI cannot depend on native build node %s", id)
		}
		visiting[id] = true
		for _, dependency := range node.Dependencies {
			if err := visit(dependency); err != nil {
				return err
			}
		}
		delete(visiting, id)
		wanted[id] = true
		return nil
	}
	if err := visit("plugin-ui:" + pluginID); err != nil {
		return nil, err
	}
	selected := make([]BuildNode, 0, len(wanted))
	for index := range nodes {
		if wanted[nodes[index].ID] {
			selected = append(selected, nodes[index])
		}
	}
	return selected, nil
}
