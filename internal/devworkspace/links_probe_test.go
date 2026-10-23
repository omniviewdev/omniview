package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

// TestLinkPinnedProtocolProbe uses registered disposable selected repositories
// and the actual native12 executable. Evidence is emitted only after all gates.
func TestLinkPinnedProtocolProbe(t *testing.T) {
	if os.Getenv("A11_PROTOCOL_PROBE") != "1" {
		t.Skip("barrier-only pinned pnpm protocol probe; set A11_PROTOCOL_PROBE=1")
	}
	version := "12.14.0"
	if !t.Run(version, func(t *testing.T) { probePinnedLinkProtocol(t, version) }) {
		return
	}
	evidence := LinkProtocolEvidence{Protocol: "workspace", Versions: []string{version}, AtomicDist: true, Peers: true, Runtime: true}
	require.NoError(t, evidence.validate())
	raw, err := json.MarshalIndent(evidence, "", "  ")
	require.NoError(t, err)
	t.Log("A11_PROTOCOL_EVIDENCE=" + string(raw))
	if report := os.Getenv("A11_PROTOCOL_REPORT"); report != "" {
		require.NoError(t, os.WriteFile(report, append(raw, '\n'), 0600))
	}
}

func probePinnedLinkProtocol(t *testing.T, version string) {
	t.Helper()
	collection := linkFixtureRoot(t)
	sources := []SourceSpec{}
	for _, source := range []struct{ name, plugin string }{{"omniview", ""}, {"plugin-sdk", ""}, {"ui", ""}, {"omniview-plugin-kubernetes", "kubernetes"}, {"omniview-plugin-probe", "probe"}} {
		fixtureRepo(t, collection, source.name, source.plugin)
		sources = append(sources, SourceSpec{ID: source.name, Path: filepath.Join(collection, source.name)})
	}
	_, err := Init(context.Background(), InitOptions{Root: collection, Sources: sources})
	require.NoError(t, err)
	manager, err := Open(collection, Options{Home: t.TempDir(), Stopped: func(context.Context, devcontract.ResolvedWorkspace) error { return nil }})
	require.NoError(t, err)
	w, err := manager.Create(context.Background(), CreateOptions{Slug: "protocol-fixture", Repositories: []string{"ui"}, Plugins: []string{"kubernetes", "probe"}})
	require.NoError(t, err)
	root := w.Root
	host, err := w.RepositoryPath("omniview")
	require.NoError(t, err)
	ui, err := w.RepositoryPath("ui")
	require.NoError(t, err)
	require.Len(t, w.Manifest.Plugins, 2)
	plugins := []string{}
	for _, selection := range w.Manifest.Plugins {
		source, err := w.RepositoryPath(selection.RepositoryID)
		require.NoError(t, err)
		plugins = append(plugins, filepath.Join(source, "ui"))
	}
	plugin := plugins[0]
	put := func(path string, value any) {
		t.Helper()
		raw, err := json.MarshalIndent(value, "", "  ")
		require.NoError(t, err)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
		require.NoError(t, os.WriteFile(path, append(raw, '\n'), 0600))
	}
	write := func(path, content string) {
		t.Helper()
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
		require.NoError(t, os.WriteFile(path, []byte(content), 0600))
	}
	targets := map[string]string{}
	for _, name := range []string{"base-ui", "ai-ui", "editors"} {
		targets["@omniviewdev/"+name] = filepath.Join(ui, "packages", name)
	}
	for _, name := range []string{"runtime", "providers", "vite-plugin"} {
		targets["@omniviewdev/"+name] = filepath.Join(host, "packages", "omniviewdev-"+name)
	}
	for name, path := range targets {
		deps := map[string]string{}
		if name != "@omniviewdev/base-ui" {
			deps["@omniviewdev/base-ui"] = "^0.0.1"
		}
		if name == "@omniviewdev/vite-plugin" {
			deps["@omniviewdev/runtime"] = "^0.0.1"
		}
		peers := map[string]string{"react": "^19.0.0", "react-dom": "^19.0.0"}
		devDeps := map[string]string{}
		if name == "@omniviewdev/ai-ui" || name == "@omniviewdev/editors" {
			delete(deps, "@omniviewdev/base-ui")
			peers["@omniviewdev/base-ui"] = "^0.0.1"
			devDeps["@omniviewdev/base-ui"] = "workspace:*"
		}
		if name == "@omniviewdev/runtime" {
			delete(deps, "@omniviewdev/base-ui")
			peers["@omniviewdev/base-ui"] = "^0.0.1"
			devDeps["@omniviewdev/base-ui"] = "workspace:*"
		}
		put(filepath.Join(path, "package.json"), map[string]any{"name": name, "version": "0.0.1", "main": "./dist/index.cjs", "types": "./dist/index.d.ts", "exports": map[string]any{".": map[string]string{"types": "./dist/index.d.ts", "import": "./dist/index.cjs"}, "./style.css": "./dist/style.css", "./types": "./dist/index.d.ts", "./api": "./dist/index.cjs", "./models": "./dist/index.cjs", "./runtime": "./dist/index.cjs"}, "dependencies": deps, "devDependencies": devDeps, "peerDependencies": peers})
		write(filepath.Join(path, "dist/index.cjs"), "module.exports={marker:'before',react:require('react')};\n")
		write(filepath.Join(path, "dist/index.d.ts"), "export declare const marker: 'before';\n")
		write(filepath.Join(path, "dist/style.css"), "@layer fixture { .before { color: red } }\n")
	}
	rootManifest := func(path, version string) {
		deps := map[string]string{"react": "19.0.0", "react-dom": "19.0.0"}
		for name := range targets {
			deps[name] = "^0.0.1"
		}
		name := "fixture-plugin"
		if path == host {
			name = "fixture-host"
		} else if path == ui {
			name = "fixture-ui"
		}
		put(filepath.Join(path, "package.json"), map[string]any{"name": name, "private": true, "version": "1.0.0", "packageManager": "pnpm@" + version, "dependencies": deps})
	}
	rootManifest(host, version)
	rootManifest(ui, version)
	for _, path := range plugins {
		rootManifest(path, version)
	}
	// Nearest-child YAML exists before the cold install; native12 must honor
	// the owned root context while scripts retain their actual package cwd.
	for _, path := range append([]string{host, ui}, plugins...) {
		write(filepath.Join(path, "pnpm-workspace.yaml"), "packages:\n  - packages/*\nminimumReleaseAge: 1440\nstrictPeerDependencies: true\n")
		write(filepath.Join(path, ".gitignore"), "node_modules/\ndist/\n")
	}
	plan, err := makeLinkPlan(w)
	require.NoError(t, err)
	graph := &BuildGraph{workspace: w, plan: plan, options: BuildOptions{Generation: "44444444-4444-4444-8444-444444444444"}}
	for _, file := range plan.Composition.Files {
		write(file.Path, string(file.Data))
	}
	ctx := context.WithValue(context.Background(), linkToolchainKey{}, graph)
	ctx = context.WithValue(ctx, linkCommandOwnerKey{}, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: graph.options.Generation, Role: "protocol-command", Source: root})
	privateHome := filepath.Join(root, ".local", "protocol-home")
	require.NoError(t, os.MkdirAll(privateHome, 0700))
	var lastOutput string
	runPNPM := func(args ...string) error {
		t.Helper()
		program, argv, err := graph.PNPMCommand(ctx, version, args...)
		require.NoError(t, err)
		command := exec.Command(program, argv...)
		command.Dir = root
		for _, entry := range os.Environ() {
			key, _, _ := strings.Cut(entry, "=")
			lower := strings.ToLower(key)
			if strings.HasPrefix(lower, "npm_config_") || strings.HasPrefix(lower, "pnpm_config_") {
				continue
			}
			switch key {
			case "HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "PNPM_HOME", "GOWORK", "GOFLAGS", "NODE_PATH", "OMNIVIEW_PNPM_NODE_PATH":
				continue
			}
			command.Env = append(command.Env, entry)
		}
		command.Env = append(command.Env, "GOWORK=off", "GOFLAGS=", "NODE_PATH=", "OMNIVIEW_PNPM_NODE_PATH=", "HOME="+privateHome, "USERPROFILE="+privateHome, "XDG_CONFIG_HOME="+filepath.Join(privateHome, "config"), "XDG_CACHE_HOME="+filepath.Join(privateHome, "cache"), "PNPM_HOME="+filepath.Join(privateHome, "pnpm"), "NPM_CONFIG_USERCONFIG="+os.DevNull, "NPM_CONFIG_GLOBALCONFIG="+os.DevNull)
		var stdout, stderr strings.Builder
		command.Stdout, command.Stderr = &stdout, &stderr
		err = RunRepositoryCommand(ctx, command, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: graph.options.Generation, Role: "protocol-command", Source: root})
		lastOutput = stdout.String()
		if err != nil {
			t.Logf("native12 private diagnostic summary: stdout=%s stderr=%s", protocolProbeStreamSummary(stdout.String()), protocolProbeStreamSummary(stderr.String()))
		}
		return err
	}
	assertReactMismatch := func() {
		t.Helper()
		var reports map[string]struct {
			Bad map[string][]struct {
				WantedRange  string                           `json:"wantedRange"`
				FoundVersion string                           `json:"foundVersion"`
				Parents      []struct{ Name, Version string } `json:"parents"`
			} `json:"bad"`
		}
		require.NoError(t, json.Unmarshal([]byte(lastOutput), &reports), "recursive peer audit must produce native JSON; raw output withheld")
		for _, consumer := range append([]string{host, ui}, plugins...) {
			relative, err := filepath.Rel(root, consumer)
			require.NoError(t, err)
			found := false
			for _, issue := range reports[filepath.ToSlash(relative)].Bad["react"] {
				if issue.WantedRange != "^18.0.0" || issue.FoundVersion != "19.0.0" {
					continue
				}
				for _, parent := range issue.Parents {
					if parent.Name == "@omniviewdev/base-ui" && parent.Version == "0.0.1" {
						found = true
					}
				}
			}
			require.True(t, found, "recursive audit omitted the controlled React18/19 peer mismatch for a selected consumer")
		}
	}
	install := func() error {
		writer, err := devoutputs.BeginCompositionInstall(ctx, w.ResolvedWorkspace, *plan.Composition)
		require.NoError(t, err)
		installErr := runPNPM("install", "--ignore-scripts", "--strict-peer-dependencies", "--no-frozen-lockfile", "--store-dir", filepath.Join(privateHome, "store"), "--registry", "https://registry.npmjs.org")
		if errors.Is(installErr, errOwnedCommandUncertain) {
			return installErr
		}
		if strings.Contains(lastOutput, "Ignoring broken lockfile") {
			installErr = errors.Join(installErr, errors.New("native pnpm discarded the selected seed as a broken lockfile"))
		}
		peerErr := runPNPM("-r", "peers", "check", "--json", "--lockfile-only")
		if errors.Is(peerErr, errOwnedCommandUncertain) {
			return peerErr
		}
		return errors.Join(installErr, peerErr, writer.Finish(context.WithoutCancel(ctx)))
	}
	require.NoError(t, install(), "native12 cold nested composition install; raw diagnostics withheld")
	consumers := append([]string{host, ui}, plugins...)
	for _, path := range targets {
		consumers = append(consumers, path)
	}
	// Validate all consumers both before and after *directory* replacement. New
	// Node processes also prevent module cache from disguising stale hardlinks.
	probe := `import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const [host,plugin,consumer,marker,encoded]=process.argv.slice(1),targets=JSON.parse(encoded);
const h=createRequire(path.join(host,'package.json')),r=createRequire(path.join(consumer,'package.json'));
const resolve=(from,specifier)=>fileURLToPath(import.meta.resolve(specifier,pathToFileURL(path.join(from,'package.json')).href));
const load=async(from,specifier)=>(await import(pathToFileURL(resolve(from,specifier)).href)).default;
if(r('react')!==h('react')||r('react-dom')!==h('react-dom'))throw Error('duplicate React peer instance');
if(await load(consumer,'@omniviewdev/runtime')!==await load(host,'@omniviewdev/runtime'))throw Error('duplicate runtime instance');
for(const [name,target]of Object.entries(targets)){
if(JSON.parse(fs.readFileSync(path.join(consumer,'package.json'))).name===name)continue;
const entry=resolve(consumer,name),actual=fs.realpathSync(path.dirname(path.dirname(entry)));
if(actual!==fs.realpathSync(target))throw Error('wrong effective path '+name+' '+actual);
const module=await load(consumer,name);
if(module.marker!==marker||module.react!==h('react'))throw Error('stale JS or peer mismatch '+name);
for(const suffix of ['/style.css','/types']){const text=fs.readFileSync(resolve(consumer,name+suffix),'utf8');if(!text.includes(marker))throw Error('stale CSS/types '+name);}
}
for(const subpath of ['api','models','runtime'])if(await load(consumer,'@omniviewdev/runtime/'+subpath)!==await load(host,'@omniviewdev/runtime'))throw Error('runtime subpath split');
console.log(JSON.stringify({consumer,marker,peers:true,runtime:true,atomicDist:true}));`
	encoded, err := json.Marshal(targets)
	require.NoError(t, err)
	check := func(marker string) {
		t.Helper()
		for _, consumer := range consumers {
			out, err := linkCommand(ctx, consumer, "node", "--experimental-import-meta-resolve", "--input-type=module", "-e", probe, host, plugin, consumer, marker, string(encoded))
			require.NoError(t, err, "consumer %s marker %s", consumer, marker)
			t.Log(string(out))
		}
	}
	check("before")
	for _, path := range targets {
		staging := filepath.Join(path, "dist-next")
		write(filepath.Join(staging, "index.cjs"), "module.exports={marker:'after',react:require('react')};\n")
		write(filepath.Join(staging, "index.d.ts"), "export declare const marker: 'after';\n")
		write(filepath.Join(staging, "style.css"), "@layer fixture { .after { color: blue } }\n")
		require.NoError(t, os.Rename(filepath.Join(path, "dist"), filepath.Join(path, "dist-old")))
		require.NoError(t, os.Rename(staging, filepath.Join(path, "dist")))
	}
	check("after")
	// Native12 defaults to installing before exec and continuing after an
	// install failure. Managed consumers must instead reject a stale graph.
	consumerArgs := []string{"exec", "node", "--experimental-import-meta-resolve", "--input-type=module", "-e", probe, host, plugin, host, "after", string(encoded)}
	require.NoError(t, runPNPM(consumerArgs...), "fresh graph must execute the real shared-package consumer")
	aggregatePath := filepath.Join(root, "package.json")
	aggregateBytes, err := os.ReadFile(aggregatePath)
	require.NoError(t, err)
	lockBeforeRun, err := os.ReadFile(filepath.Join(root, "pnpm-lock.yaml"))
	require.NoError(t, err)
	var staleAggregate map[string]any
	require.NoError(t, json.Unmarshal(aggregateBytes, &staleAggregate))
	staleAggregate["dependencies"].(map[string]any)["@omniviewdev/missing-workspace"] = "workspace:*"
	put(aggregatePath, staleAggregate)
	staleRunErr := runPNPM(consumerArgs...)
	lockAfterRun, lockReadErr := os.ReadFile(filepath.Join(root, "pnpm-lock.yaml"))
	require.NoError(t, os.WriteFile(aggregatePath, aggregateBytes, 0600))
	require.NoError(t, lockReadErr)
	require.Error(t, staleRunErr, "stale graph must not execute a consumer after an implicit installer fails")
	require.Equal(t, lockBeforeRun, lockAfterRun, "consumer startup must not install or rewrite the aggregate lock")
	// A warm peer-only edit must fail the explicit recursive audit even if
	// native install's up-to-date fast path exits successfully.
	bad := filepath.Join(targets["@omniviewdev/base-ui"], "package.json")
	good, err := os.ReadFile(bad)
	require.NoError(t, err)
	var invalid map[string]any
	require.NoError(t, json.Unmarshal(good, &invalid))
	invalid["peerDependencies"].(map[string]any)["react"] = "^18.0.0"
	put(bad, invalid)
	warmPlan, err := makeLinkPlan(w)
	require.NoError(t, err)
	plan, graph.plan = warmPlan, warmPlan
	warmErr := install()
	require.False(t, errors.Is(warmErr, errOwnedCommandUncertain), "warm installer subtree must actually terminate")
	require.Error(t, warmErr, "warm peer-only edit must not be accepted by the install/audit transaction")
	assertReactMismatch()
	require.NoError(t, os.WriteFile(bad, good, 0600))
	require.NoError(t, runPNPM("-r", "peers", "check", "--json", "--lockfile-only"))
	// Dispose only exact recorded module outputs, then repeat with invalid
	// peers from cold resolution rather than relying on warmed metadata.
	require.NoError(t, devoutputs.Restore(ctx, w.ResolvedWorkspace))
	require.NoError(t, os.Remove(filepath.Join(root, "pnpm-lock.yaml")))
	put(bad, invalid)
	invalidPlan, err := makeLinkPlan(w)
	require.NoError(t, err)
	plan = invalidPlan
	graph.plan = invalidPlan
	// Native12 overrides can rewrite install-time peer constraints; acceptance
	// is the entire install plus recursive inspection of original manifests.
	coldInstallErr := install()
	require.False(t, errors.Is(coldInstallErr, errOwnedCommandUncertain), "cold installer subtree must actually terminate")
	require.Error(t, coldInstallErr, "cold React18 peer must fail original-manifest audit")
	assertReactMismatch()
	require.NoError(t, os.WriteFile(bad, good, 0600))
}

// Only fixed fixture identifiers and pnpm's error-code grammar may leave the
// private capture. Reporter messages, URLs, registry hosts, headers and paths
// remain withheld, even when an error record embeds them in its message.
func protocolProbeDiagnostics(raw string) string {
	seen := map[string]bool{}
	for _, code := range regexp.MustCompile(`\bERR_PNPM_[A-Z0-9_]{1,96}\b`).FindAllString(raw, -1) {
		seen[code] = true
	}
	for _, identifier := range []string{
		"PnpmError", "TypeError", "SyntaxError", "RangeError",
		"strictPeerDependencies", "pmOnFail", "linkWorkspacePackages", "autoInstallPeers",
		"@omniviewdev/base-ui", "@omniviewdev/ai-ui", "@omniviewdev/editors",
		"@omniviewdev/runtime", "@omniviewdev/providers", "@omniviewdev/vite-plugin",
		"fixture-host", "fixture-ui", "fixture-plugin", "react-dom", "react",
	} {
		if strings.Contains(raw, identifier) {
			seen[identifier] = true
		}
	}
	identifiers := make([]string, 0, len(seen))
	for identifier := range seen {
		identifiers = append(identifiers, identifier)
	}
	sort.Strings(identifiers)
	if len(identifiers) == 0 {
		return "none recognized"
	}
	return strings.Join(identifiers, ", ")
}

func TestProtocolProbeDiagnosticsWithholdsUntrustedMessages(t *testing.T) {
	raw := `{"level":"error","code":"ERR_PNPM_PEER_DEP_ISSUES","err":{"name":"PnpmError","message":"@omniviewdev/base-ui from https://private.example.invalid/package?token=secret-token Authorization: Bearer private-credential"}}`
	require.Equal(t, "@omniviewdev/base-ui, ERR_PNPM_PEER_DEP_ISSUES, PnpmError", protocolProbeDiagnostics(raw))
	require.Equal(t, "none recognized", protocolProbeDiagnostics("https://registry.invalid/?token=secret-token"))
}

func protocolProbeStreamSummary(raw string) string {
	summary := struct {
		Bytes       int        `json:"bytes"`
		JSONRecords int        `json:"jsonRecords"`
		JSONKeys    []string   `json:"jsonKeys"`
		Identifiers string     `json:"identifiers"`
		Phrases     []string   `json:"phrases"`
		PeerDetails [][]string `json:"peerDetails"`
	}{Bytes: len(raw), Identifiers: protocolProbeDiagnostics(raw)}
	keys := map[string]bool{}
	var visit func(any)
	visit = func(value any) {
		switch value := value.(type) {
		case map[string]any:
			for key, child := range value {
				switch key {
				case "code", "errorCode", "err", "error", "message", "name", "level", "pkgsStack", "hint", "details", "stack":
					keys[key] = true
				}
				if key == "message" {
					if message, ok := child.(string); ok {
						summary.PeerDetails = append(summary.PeerDetails, protocolProbePeerDetails(message)...)
					}
				}
				visit(child)
			}
		case []any:
			for _, child := range value {
				visit(child)
			}
		}
	}
	for _, line := range strings.Split(raw, "\n") {
		var record map[string]any
		if json.Unmarshal([]byte(line), &record) == nil && record != nil {
			summary.JSONRecords++
			visit(record)
		}
	}
	for key := range keys {
		summary.JSONKeys = append(summary.JSONKeys, key)
	}
	sort.Strings(summary.JSONKeys)
	lower := strings.ToLower(raw)
	for _, phrase := range []struct{ text, label string }{
		{"unmet peer", "unmet-peer-message"},
		{"peer dependencies", "peer-dependencies-message"},
		{"workspace:", "mentions-workspace-protocol"},
		{"invalid semver", "invalid-semver-message"},
		{"invalid version", "invalid-version-message"},
		{"version range", "version-range-message"},
		{"unknown setting", "unknown-setting-message"},
		{"unknown option", "unknown-option-message"},
		{"unsupported protocol", "unsupported-protocol-message"},
		{"no matching version", "no-matching-version-message"},
		{"failed to parse", "parse-failure-message"},
		{"unexpected argument", "unexpected-argument-message"},
		{"minimum release age", "release-age-message"},
		{"enoent", "mentions-enoent"},
		{"eacces", "mentions-eacces"},
	} {
		if strings.Contains(lower, phrase.text) {
			summary.Phrases = append(summary.Phrases, phrase.label)
		}
	}
	encoded, _ := json.Marshal(summary)
	return string(encoded)
}

func TestProtocolProbeStreamSummaryExposesOnlySafeStructure(t *testing.T) {
	raw := `{"level":"error","err":{"message":"invalid version range workspace:* at https://private.example.invalid?token=secret-token","code":"ERR_PNPM_PEER_DEP_ISSUES"},"Authorization":"private-credential"}`
	summary := protocolProbeStreamSummary(raw)
	require.Contains(t, summary, `"jsonRecords":1`)
	require.Contains(t, summary, `"jsonKeys":["code","err","level","message"]`)
	require.Contains(t, summary, "ERR_PNPM_PEER_DEP_ISSUES")
	require.Contains(t, summary, "mentions-workspace-protocol")
	for _, private := range []string{"Authorization", "private-credential", "private.example.invalid", "secret-token", "https://"} {
		require.NotContains(t, summary, private)
	}
}

func protocolProbePeerDetails(message string) [][]string {
	// Preserve package/expected/found ordering, but never forward message text,
	// link paths, URLs, arbitrary package names, or registry values.
	tokens := regexp.MustCompile(`@omniviewdev/(?:base-ui|ai-ui|editors|runtime|providers|vite-plugin)\b|\breact-dom\b|\breact\b|\b(?i:unmet peer|missing peer|found|expected|wanted|installed|resolved|invalid)\b|workspace:\*|link:|[~^<>=]*\b[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b`)
	var details [][]string
	for _, line := range strings.Split(message, "\n") {
		if selected := tokens.FindAllString(line, -1); len(selected) > 0 {
			details = append(details, selected)
		}
	}
	return details
}

func TestProtocolProbePeerDetailsRetainsOnlyControlledRelationships(t *testing.T) {
	message := "@omniviewdev/ai-ui 0.0.1\nunmet peer @omniviewdev/base-ui@workspace:*: found 0.0.1 via link:/private/credential-bearing-path?token=secret-token"
	require.Equal(t, [][]string{
		{"@omniviewdev/ai-ui", "0.0.1"},
		{"unmet peer", "@omniviewdev/base-ui", "workspace:*", "found", "0.0.1", "link:"},
	}, protocolProbePeerDetails(message))
}

func TestProtocolProbePeerDetailsRetainsNativeRendererContinuations(t *testing.T) {
	message := "unmet peer react\n  Installed: link:/private/credential-bearing-path?token=secret-token\n  Wanted:\n    ^19.0.0:\n      @omniviewdev/base-ui@0.0.1"
	require.Equal(t, [][]string{
		{"unmet peer", "react"},
		{"Installed", "link:"},
		{"Wanted"},
		{"^19.0.0"},
		{"@omniviewdev/base-ui", "0.0.1"},
	}, protocolProbePeerDetails(message))
}
