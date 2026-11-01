package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// Bootstrap reuses a node only when its input fingerprint equals the one
// recorded after its last successful build AND its owned outputs still match
// that build's recorded output digest. Inputs are the node's selected source
// files, its dependencies' output digests, the installed composition, the
// toolchains and this builder executable. Watch rebuilds never consult it.
type buildReuseRecord struct {
	Inputs  string `json:"inputs"`
	Outputs string `json:"outputs"`
}

type buildReuseState struct {
	SchemaVersion int                         `json:"schemaVersion"`
	WorkspaceID   string                      `json:"workspaceID"`
	Nodes         map[string]buildReuseRecord `json:"nodes"`
}

const buildReuseSchema = 1

// loadBuildReuse reads this workspace's reuse records. A missing, foreign or
// older-schema record yields an empty state, so every node rebuilds.
func (g *BuildGraph) loadBuildReuse() *buildReuseState {
	state := &buildReuseState{SchemaVersion: buildReuseSchema, WorkspaceID: g.workspace.Manifest.WorkspaceID, Nodes: map[string]buildReuseRecord{}}
	var stored buildReuseState
	err := devsession.ReadPrivateJSON(g.reusePath, &stored)
	switch {
	case err == nil && stored.SchemaVersion == buildReuseSchema && stored.WorkspaceID == state.WorkspaceID && stored.Nodes != nil:
		state.Nodes = stored.Nodes
	case err != nil && !os.IsNotExist(err):
		g.logf("build reuse: ignoring unreadable fingerprint record: %v", err)
	}
	return state
}

// setBuildReuse records (or, with an empty record, forgets) one node and
// persists the whole state. Forgetting precedes every rebuild, so an
// interrupted build never leaves a stale record that names its old outputs.
func (g *BuildGraph) setBuildReuse(state *buildReuseState, id string, record buildReuseRecord) error {
	g.reuseMu.Lock()
	defer g.reuseMu.Unlock()
	if record == (buildReuseRecord{}) {
		if _, ok := state.Nodes[id]; !ok {
			return nil
		}
		delete(state.Nodes, id)
	} else {
		state.Nodes[id] = record
	}
	return devsession.WritePrivateJSON(g.reusePath, state)
}

// recordOutput publishes a finished node's output digest to its dependents.
func (g *BuildGraph) recordOutput(id, digest string) {
	g.reuseMu.Lock()
	defer g.reuseMu.Unlock()
	if g.outputs == nil {
		g.outputs = map[string]string{}
	}
	g.outputs[id] = digest
}

// outputOf returns a finished node's output digest within this execution.
func (g *BuildGraph) outputOf(id string) (string, bool) {
	g.reuseMu.Lock()
	defer g.reuseMu.Unlock()
	digest, ok := g.outputs[id]
	return digest, ok
}

// logf writes one reuse diagnostic line to the producer output, if any.
func (g *BuildGraph) logf(format string, args ...any) {
	if g.options.Output != nil {
		_, _ = fmt.Fprintf(g.options.Output, format+"\n", args...)
	}
}

// produce builds one node, or with a reuse state reuses its unchanged outputs.
// Fingerprint failures never fail the build; they only disable reuse for the
// node. Output digests after a successful build are mandatory evidence.
func (g *BuildGraph) produce(ctx context.Context, n BuildNode, state *buildReuseState) error {
	if state == nil {
		return g.buildNode(ctx, n)
	}
	inputs, err := g.nodeInputs(ctx, n)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		g.logf("build reuse: %s: cannot fingerprint inputs, rebuilding: %v", n.ID, err)
		inputs = ""
	}
	g.reuseMu.Lock()
	previous, known := state.Nodes[n.ID]
	g.reuseMu.Unlock()
	if inputs != "" && known && previous.Inputs == inputs {
		outputs, err := g.reuseOutputs(ctx, n)
		if err == nil && outputs == previous.Outputs {
			g.recordOutput(n.ID, outputs)
			g.logf("build reuse: %s: inputs and outputs unchanged, skipped", n.ID)
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err == nil {
			err = errors.New("outputs differ from the recorded build")
		}
		g.logf("build reuse: %s: rebuilding, %v", n.ID, err)
	} else if known {
		g.logf("build reuse: %s: rebuilding, inputs changed", n.ID)
	}
	if err = g.setBuildReuse(state, n.ID, buildReuseRecord{}); err != nil {
		return err
	}
	if err = g.buildNode(ctx, n); err != nil {
		return err
	}
	outputs, err := g.outputDigest(ctx, n)
	if err != nil {
		return fmt.Errorf("built outputs of %s do not validate: %w", n.ID, err)
	}
	g.recordOutput(n.ID, outputs)
	if inputs == "" {
		return nil
	}
	return g.setBuildReuse(state, n.ID, buildReuseRecord{Inputs: inputs, Outputs: outputs})
}

// reuseOutputs validates a previous build's outputs for reuse, re-establishing
// any launch-time evidence the skipped build would have produced.
func (g *BuildGraph) reuseOutputs(ctx context.Context, n BuildNode) (string, error) {
	switch n.Kind {
	case "plugin-backend":
		digest, err := g.outputDigest(ctx, n)
		if err != nil {
			return "", err
		}
		identity, err := g.verifySDK(ctx, n.Directory)
		if err != nil {
			return "", err
		}
		destination, err := generatedPath(g.workspace, filepath.Join("build", n.PluginID))
		if err != nil {
			return "", err
		}
		if err = g.recordArtifact(n.PluginID, filepath.Join(destination, "plugin"), identity); err != nil {
			return "", err
		}
		return digest, nil
	case "host-backend":
		if g.options.ReuseHost == nil {
			return "", errors.New("host reuse is not supported by this builder")
		}
		digest, err := g.outputDigest(ctx, n)
		if err != nil {
			return "", err
		}
		return digest, g.options.ReuseHost(ctx)
	default:
		return g.outputDigest(ctx, n)
	}
}

// outputDigest returns a content digest of every owned output of a node, each
// verified unchanged since its controlled publication.
func (g *BuildGraph) outputDigest(ctx context.Context, n BuildNode) (string, error) {
	w := g.workspace.ResolvedWorkspace
	var parts []string
	add := func(directory string, kind devoutputs.Producer) error {
		digest, err := devoutputs.Published(ctx, w, directory, kind)
		parts = append(parts, string(kind)+"="+digest)
		return err
	}
	var err error
	switch n.Kind {
	case "bindings":
		err = add(n.Directory, devoutputs.Bindings)
	case "javascript":
		err = add(n.Directory, devoutputs.Distribution)
		if err == nil && n.ID == "vite-plugin" {
			err = add(n.Directory, devoutputs.Shims)
		}
		if err == nil && n.ID == "host-frontend" {
			err = add(n.Directory, devoutputs.YAMLWorker)
		}
	case "plugin-backend":
		var digest string
		digest, err = publishedGeneratedTree(g.workspace, filepath.Join("build", n.PluginID))
		parts = append(parts, digest)
	case "host-backend":
		if g.options.HostOutput == "" {
			return "", errors.New("host output location is unknown")
		}
		var digest string
		digest, err = publishedGeneratedTree(g.workspace, g.options.HostOutput)
		parts = append(parts, digest)
	default:
		err = fmt.Errorf("unknown build node kind %q", n.Kind)
	}
	if err != nil {
		return "", err
	}
	return strings.Join(parts, ";"), nil
}

// nodeInputs fingerprints everything a node's producer reads. It runs only
// after every dependency has finished, so dependency outputs are final.
func (g *BuildGraph) nodeInputs(ctx context.Context, n BuildNode) (string, error) {
	hash := sha256.New()
	builder, err := g.builderDigest()
	if err != nil {
		return "", err
	}
	fmt.Fprintf(hash, "omniview-build-inputs-v1\x00builder\x00%s\x00node\x00%s\x00%s\x00%s\x00%s\x00%s\x00", builder, n.ID, n.Kind, n.Directory, n.PNPMVersion, n.PluginID)
	dependencies := append([]string(nil), n.Dependencies...)
	sort.Strings(dependencies)
	for _, dependency := range dependencies {
		digest, ok := g.outputOf(dependency)
		if !ok {
			return "", fmt.Errorf("dependency %s has no verified output", dependency)
		}
		fmt.Fprintf(hash, "dependency\x00%s\x00%s\x00", dependency, digest)
	}
	tools, err := g.toolInputs(ctx, n)
	if err != nil {
		return "", err
	}
	fmt.Fprintf(hash, "tools\x00%s\x00", tools)
	if err = g.sourceInputs(ctx, n, hash); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// toolchainInputs identifies the toolchains and non-file settings a node's
// producer uses: Node, pinned pnpm and the installed composition for
// JavaScript; the Go toolchain, selected SDK identity and host variant for Go.
func (g *BuildGraph) toolchainInputs(ctx context.Context, n BuildNode) (string, error) {
	var b strings.Builder
	if n.Kind != "javascript" {
		identity, err := g.verifySDK(ctx, n.Directory)
		if err != nil {
			return "", err
		}
		version, err := goVersion(ctx, n.Directory)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "sdk\x00%s\x00%s\x00go\x00%s\x00variant\x00%s", identity.ReviewedRevision, identity.SourceDigest, version, g.options.HostVariant)
		return b.String(), nil
	}
	if g.plan.Composition == nil {
		return "", errors.New("selected dependency composition is absent")
	}
	composition, err := json.Marshal(g.plan.Composition)
	if err != nil {
		return "", err
	}
	tool, err := g.preparePNPMToolchain(ctx, devcompose.Version)
	if err != nil {
		return "", err
	}
	node, err := os.Stat(tool.node)
	if err != nil {
		return "", err
	}
	fmt.Fprintf(&b, "composition\x00%x\x00node\x00%s\x00%d\x00%d", sha256.Sum256(composition), tool.node, node.Size(), node.ModTime().UnixNano())
	for _, file := range tool.files {
		fmt.Fprintf(&b, "\x00launcher\x00%s\x00%o\x00%x", file.Name, file.Mode, sha256.Sum256(file.Data))
	}
	return b.String(), nil
}

// builderDigest hashes this builder executable once, so any builder change
// (commands, environment, ownership rules) invalidates every reuse record.
func (g *BuildGraph) builderDigest() (string, error) {
	g.builderOnce.Do(func() {
		executable, err := os.Executable()
		if err == nil {
			executable, err = filepath.EvalSymlinks(executable)
		}
		if err != nil {
			g.builderErr = err
			return
		}
		file, err := os.Open(executable)
		if err != nil {
			g.builderErr = err
			return
		}
		defer file.Close()
		hash := sha256.New()
		if _, err = io.Copy(hash, file); err != nil {
			g.builderErr = err
			return
		}
		g.builder = hex.EncodeToString(hash.Sum(nil))
	})
	return g.builder, g.builderErr
}

// goVersion reports the Go toolchain selected for directory, including any
// go.mod toolchain switch.
func goVersion(ctx context.Context, directory string) (string, error) {
	cmd := exec.CommandContext(ctx, "go", "env", "GOVERSION")
	cmd.Dir = directory
	cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=")
	raw, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("go toolchain version: %w", err)
	}
	return strings.TrimSpace(string(raw)), nil
}

var parentReference = regexp.MustCompile(`(?:^|[\s"'=])((?:\.\./)+[^\s"'&|;<>()]+)`)

// sourceInputs hashes the selected repository files a node reads: everything
// below its directory, files directly inside each ancestor up to the
// repository root (shared configs, manifests and lockfiles), and paths outside
// the package referenced by its package.json scripts. Sibling packages are
// covered by dependency output digests instead, and so are the files the
// graph itself writes into source trees (distributions such as the host's
// tracked dist/.gitkeep, bindings, shims, YAML worker, Vite config stamps):
// hashing those as source would make every producer that runs before them in
// a bootstrap look changed in the next one.
func (g *BuildGraph) sourceInputs(ctx context.Context, n BuildNode, hash io.Writer) error {
	repository := ""
	for _, r := range g.workspace.Manifest.Repositories {
		root := filepath.Join(g.workspace.Root, r.Directory)
		if (root == n.Directory || inside(root, n.Directory)) && len(root) > len(repository) {
			repository = root
		}
	}
	if repository == "" {
		return fmt.Errorf("node %s is outside every selected repository", n.ID)
	}
	directory, err := filepath.Rel(repository, n.Directory)
	if err != nil {
		return err
	}
	directory = filepath.ToSlash(directory)
	trees := []string{directory}
	if raw, err := os.ReadFile(filepath.Join(n.Directory, "package.json")); err == nil {
		var manifest struct {
			Scripts map[string]string `json:"scripts"`
		}
		if err = json.Unmarshal(raw, &manifest); err != nil {
			return err
		}
		for _, script := range manifest.Scripts {
			for _, match := range parentReference.FindAllStringSubmatch(script, -1) {
				target := filepath.Join(n.Directory, filepath.FromSlash(match[1]))
				if relative, err := filepath.Rel(repository, target); err == nil && inside(repository, target) {
					trees = append(trees, filepath.ToSlash(relative))
				}
			}
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	var outputs []string
	for _, node := range g.Nodes {
		if node.Kind == "javascript" {
			outputs = append(outputs, filepath.Join(node.Directory, "dist"))
		}
		if node.ID == "vite-plugin" {
			outputs = append(outputs, filepath.Join(node.Directory, "shims"))
		}
	}
	listing, err := git(ctx, repository, "", "ls-files", "--cached", "--others", "--exclude-standard", "-z")
	if err != nil {
		return err
	}
	names := strings.Split(listing, "\x00")
	sort.Strings(names)
	previous := ""
	var reader sourceInputReader
	for _, name := range names {
		if name == "" || name == previous {
			continue
		}
		previous = name
		if !selectedSource(name, directory, trees) {
			continue
		}
		path := filepath.Join(repository, filepath.FromSlash(name))
		if g.generatedSourceOutput(path) || slices.ContainsFunc(outputs, func(output string) bool { return inside(output, path) }) {
			continue
		}
		if err = reader.hashFile(hash, repository, name); err != nil {
			return err
		}
	}
	return nil
}

// underPath reports whether the slash path name is root or below it; "."
// contains everything.
func underPath(name, root string) bool {
	return root == "." || name == root || strings.HasPrefix(name, root+"/")
}

// selectedSource reports whether a repository file is a node input: under one
// of trees, or directly inside an ancestor of directory. Git, metadata and
// dependency directories never are.
func selectedSource(name, directory string, trees []string) bool {
	for _, part := range strings.Split(name, "/") {
		if part == ".git" || part == ".local" || part == "node_modules" {
			return false
		}
	}
	for _, tree := range trees {
		if underPath(name, tree) {
			return true
		}
	}
	// Files directly inside an ancestor of the node directory.
	parent := path.Dir(name)
	return parent == "." || underPath(directory, parent)
}

// Scratch belongs to one node fingerprint, never to a path or a prior build.
// Each call still reads the complete current file and checks for mutation.
type sourceInputReader struct {
	buffer []byte
	source struct{ io.Reader }
}

// hashFile writes one source entry: content for regular files, target for
// symlinks, type only for submodules and special files, and a deletion marker
// for tracked files that no longer exist.
func (reader *sourceInputReader) hashFile(hash io.Writer, repository, name string) error {
	path := filepath.Join(repository, filepath.FromSlash(name))
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		fmt.Fprintf(hash, "deleted\x00%s\x00", name)
		return nil
	}
	if err != nil {
		return err
	}
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		target, err := os.Readlink(path)
		if err != nil {
			return err
		}
		fmt.Fprintf(hash, "link\x00%s\x00%s\x00", name, target)
		return nil
	case !info.Mode().IsRegular():
		// Submodule gitlinks and special entries contribute only their type.
		fmt.Fprintf(hash, "other\x00%s\x00%s\x00", name, info.Mode().Type())
		return nil
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	fmt.Fprintf(hash, "file\x00%s\x00%o\x00%d\x00", name, info.Mode().Perm(), info.Size())
	if reader.buffer == nil {
		reader.buffer = make([]byte, 32*1024)
	}
	// Hide os.File.WriteTo so CopyBuffer uses this fingerprint's scratch.
	reader.source.Reader = file
	_, err = io.CopyBuffer(hash, &reader.source, reader.buffer)
	reader.source.Reader = nil
	if err != nil {
		return err
	}
	after, err := file.Stat()
	if err != nil {
		return err
	}
	if after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return fmt.Errorf("source changed while fingerprinting: %s", name)
	}
	return nil
}
