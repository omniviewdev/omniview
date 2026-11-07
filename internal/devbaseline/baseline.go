// Package devbaseline exports offline, explicitly allowlisted preferences and an
// inactive installation inventory. It never copies a profile tree or executable.
package devbaseline

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
)

const Policy = "safe-preferences-and-inactive-inventory-v1"

var ErrSourceBusy = errors.New("baseline source is running: stop the source instance before taking a snapshot")
var ErrDestinationExists = errors.New("baseline destination must be a new stopped development profile")

// Source contains no source filesystem paths, endpoints or private values.
type Source struct {
	RootID      string   `json:"rootID"`
	Version     string   `json:"version,omitempty"`
	AncestorIDs []string `json:"ancestorIDs"`
	LockMarker  string   `json:"lockMarker"`
}

type Plugin struct {
	ID         string `json:"id"`
	Version    string `json:"version,omitempty"`
	Status     string `json:"status"`
	Provenance string `json:"provenance"`
}

// Baseline is a portable logical snapshot, not a runnable plugin installation.
// Import treats every field as untrusted and reapplies the current copy policy.
type Baseline struct {
	SchemaVersion int                       `json:"schemaVersion"`
	Policy        string                    `json:"policy"`
	CreatedAt     time.Time                 `json:"createdAt"`
	Source        Source                    `json:"source"`
	Preferences   map[string]map[string]any `json:"preferences"`
	Plugins       []Plugin                  `json:"plugins"`
	Exclusions    []string                  `json:"exclusions"`
}

type SnapshotOptions struct {
	SourceRoot string
	// SourceVersion is a nonsecret build version, never an arbitrary label/path.
	SourceVersion string
	// TemporaryRoot optionally places private legacy staging in a fixture root.
	TemporaryRoot string
}

type ImportOptions struct {
	// Destination must be resolved by instance.Resolve, not a root from the environment.
	Destination instance.Profile
	Home        string
}

type Result struct {
	StateRoot    string   `json:"stateRoot"`
	ManifestPath string   `json:"manifestPath"`
	Plugins      []Plugin `json:"plugins"`
	Policy       string   `json:"policy"`
	CopiedScope  []string `json:"copiedScope"`
	Exclusions   []string `json:"exclusions"`
}

func exclusions() []string {
	return []string{"unknown-setting-keys", "sensitive-settings", "plugin-settings-and-data", "credentials", "connections-and-autoconnect", "grafana-connections-and-credentials", "metric-bindings-and-configuration", "sessions-and-terminals", "telemetry-enablement-auth-and-export", "runtime-locks-pids-pgids", "devinfo-discovery-control-and-tokens", "logs-caches-and-temporary-files", "native-and-browser-storage", "source-dev-paths", "executables-and-artifacts"}
}

var inventoryID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
var versionID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$`)
var rootID = regexp.MustCompile(`^[0-9a-f]{64}$`)

func normalize(b *Baseline) (*Baseline, error) {
	if b == nil || b.SchemaVersion != 1 || b.Policy != Policy {
		return nil, fmt.Errorf("baseline: unsupported snapshot schema or policy")
	}
	if !rootID.MatchString(b.Source.RootID) || (b.Source.Version != "" && !versionID.MatchString(b.Source.Version)) {
		return nil, fmt.Errorf("baseline: invalid source provenance")
	}
	if len(b.Source.AncestorIDs) == 0 || len(b.Source.AncestorIDs) > 256 || b.Source.AncestorIDs[0] != b.Source.RootID {
		return nil, fmt.Errorf("baseline: invalid source ancestry")
	}
	for _, id := range b.Source.AncestorIDs {
		if !rootID.MatchString(id) {
			return nil, fmt.Errorf("baseline: invalid source ancestry")
		}
	}
	if b.Source.LockMarker != "existing" && b.Source.LockMarker != "created-for-offline-lock" {
		return nil, fmt.Errorf("baseline: invalid source lock provenance")
	}
	preferences, err := safePreferences(b.Preferences)
	if err != nil {
		return nil, err
	}
	source := b.Source
	source.AncestorIDs = append([]string(nil), source.AncestorIDs...)
	result := &Baseline{SchemaVersion: 1, Policy: Policy, CreatedAt: b.CreatedAt, Source: source, Preferences: preferences, Exclusions: exclusions()}
	seen := make(map[string]bool, len(b.Plugins))
	for _, p := range b.Plugins {
		if !inventoryID.MatchString(p.ID) || p.ID == "." || p.ID == ".." || (p.Version != "" && !versionID.MatchString(p.Version)) || seen[p.ID] {
			return nil, fmt.Errorf("baseline: invalid or duplicate plugin inventory entry")
		}
		seen[p.ID] = true
		result.Plugins = append(result.Plugins, Plugin{ID: p.ID, Version: p.Version, Status: "inactive", Provenance: "unverified-source-inventory"})
	}
	sort.Slice(result.Plugins, func(i, j int) bool { return result.Plugins[i].ID < result.Plugins[j].ID })
	return result, nil
}

// Seed is the CLI integration entrypoint: validate target, snapshot a stopped
// source, then import. No host or plugin is launched. A16 owns command wiring.
func Seed(ctx context.Context, source SnapshotOptions, target ImportOptions) (Result, error) {
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if err := checkPlatform(); err != nil {
		return Result{}, err
	}
	root, home, err := resolveDestination(target)
	if err != nil {
		return Result{}, err
	}
	sourceRoot, err := strictPath(source.SourceRoot)
	if err != nil {
		return Result{}, err
	}
	ids := ancestorIDs(sourceRoot)
	if overlaps(sourceRoot, root) || fingerprintOverlap(Source{RootID: ids[0], AncestorIDs: ids}, root) {
		return Result{}, fmt.Errorf("baseline: source and destination overlap")
	}
	release, err := devcontract.LockProfile(ctx, home, target.Destination.Descriptor.WorkspaceID)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = release() }()
	if _, err := validateDestination(target); err != nil {
		return Result{}, err
	}
	b, err := Snapshot(ctx, source)
	if err != nil {
		return Result{}, err
	}
	return importLocked(ctx, b, target, home)
}

// Import atomically publishes independent settings and baseline.json into a new
// stopped development profile. Inventory never becomes plugin_state.json and
// cannot trigger manager startup. Verified reinstallation uses existing manager
// install/link operations after the destination has been launched independently.
func Import(ctx context.Context, b *Baseline, opts ImportOptions) (Result, error) {
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if err := checkPlatform(); err != nil {
		return Result{}, err
	}
	destination, home, err := resolveDestination(opts)
	if err != nil {
		return Result{}, err
	}
	clean, err := normalize(b)
	if err != nil {
		return Result{}, err
	}
	if fingerprintOverlap(clean.Source, destination) {
		return Result{}, fmt.Errorf("baseline: source and destination overlap")
	}
	release, err := devcontract.LockProfile(ctx, home, opts.Destination.Descriptor.WorkspaceID)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = release() }()
	return importLocked(ctx, clean, opts, home)
}

// importLocked requires the stable profile guard, held once by Seed or Import.
func importLocked(ctx context.Context, clean *Baseline, opts ImportOptions, home string) (Result, error) {
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	destination, err := validateDestination(opts)
	if err != nil {
		return Result{}, err
	}
	if fingerprintOverlap(clean.Source, destination) {
		return Result{}, fmt.Errorf("baseline: source and destination overlap")
	}
	defaultRoot, err := devcontract.CanonicalPath(filepath.Join(home, ".omniview-dev", "profiles", opts.Destination.Descriptor.WorkspaceID, "state"))
	if err != nil {
		return Result{}, err
	}
	if destination == defaultRoot {
		if err := devcontract.EnsureDefaultProfileOwnership(home, opts.Destination.Descriptor.WorkspaceID); err != nil {
			return Result{}, err
		}
	}
	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0700); err != nil {
		return Result{}, err
	}
	if _, err := strictPath(parent); err != nil {
		return Result{}, err
	}
	stage, err := newOwnedStage(parent, ".baseline-stage-")
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = stage.cleanup() }()
	s, err := settingsstore.Open(filepath.Join(stage.path, "settings.db"))
	if err != nil {
		return Result{}, err
	}
	for category, values := range clean.Preferences {
		if err := s.SaveCategory(category, values); err != nil {
			_ = s.Close()
			return Result{}, err
		}
	}
	if err := s.Close(); err != nil {
		return Result{}, err
	}
	data, err := json.MarshalIndent(clean, "", "  ")
	if err != nil {
		return Result{}, fmt.Errorf("baseline: encode sanitized manifest")
	}
	if err := writePrivate(filepath.Join(stage.path, "baseline.json"), append(data, '\n')); err != nil {
		return Result{}, err
	}
	// Check the staged database using the same read-only exporter before publication.
	staged, err := readDatabase(ctx, filepath.Join(stage.path, "settings.db"))
	if err != nil {
		return Result{}, err
	}
	if _, err := safePreferences(staged); err != nil {
		return Result{}, err
	}
	if err := syncDirectory(stage.path); err != nil {
		return Result{}, err
	}
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if _, err := validateDestination(opts); err != nil {
		return Result{}, err
	}
	// Platform no-replace rename prevents a racing host or importer from losing an
	// already-created destination (plain os.Rename may replace an empty directory).
	if err := finalize(stage.path, destination); err != nil {
		return Result{}, fmt.Errorf("baseline: finalize new profile: %w", err)
	}
	stage.disarm()
	if err := syncDirectory(parent); err != nil {
		return importResult(destination, clean), fmt.Errorf("baseline: profile published but directory sync failed: %w", err)
	}
	return importResult(destination, clean), nil
}

func importResult(destination string, clean *Baseline) Result {
	return Result{StateRoot: destination, ManifestPath: filepath.Join(destination, "baseline.json"), Plugins: clean.Plugins, Policy: Policy, CopiedScope: []string{"allowlisted-safe-preferences", "inactive-unverified-plugin-inventory"}, Exclusions: exclusions()}
}

// InspectImport validates the published import receipt and readable settings.
// It does not claim that integrations or plugins are configured or runnable.
func InspectImport(ctx context.Context, destination string, initial bool) (Result, error) {
	path := filepath.Join(destination, "baseline.json")
	info, err := os.Lstat(path)
	if err != nil {
		return Result{}, err
	}
	if !info.Mode().IsRegular() {
		return Result{}, fmt.Errorf("baseline: import receipt is not a regular file")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Result{}, err
	}
	var saved Baseline
	if err := json.Unmarshal(raw, &saved); err != nil {
		return Result{}, err
	}
	clean, err := normalize(&saved)
	if err != nil {
		return Result{}, err
	}
	// Explanatory labels may grow without changing the copy policy. Validate
	// imported content, but derive disclosure from today's canonical labels.
	saved.Exclusions = clean.Exclusions
	actual, err := json.Marshal(saved)
	if err != nil {
		return Result{}, err
	}
	expected, err := json.Marshal(clean)
	if err != nil || string(actual) != string(expected) {
		return Result{}, fmt.Errorf("baseline: import receipt does not match current policy")
	}
	values, err := readDatabase(ctx, filepath.Join(destination, "settings.db"))
	if err != nil {
		return Result{}, err
	}
	if initial {
		actual, err := json.Marshal(values)
		if err != nil {
			return Result{}, err
		}
		expected, err := json.Marshal(clean.Preferences)
		if err != nil || string(actual) != string(expected) {
			return Result{}, fmt.Errorf("baseline: published settings do not match import receipt")
		}
	}
	return importResult(destination, clean), nil
}

func writePrivate(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func pathID(path string) string {
	// Conservative case folding protects case-insensitive macOS/Windows volumes
	// even when EvalSymlinks preserves the spelling of an existing alias.
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	sum := sha256.Sum256([]byte(path))
	return hex.EncodeToString(sum[:])
}

func ancestorIDs(path string) []string {
	var ids []string
	for {
		ids = append(ids, pathID(path))
		parent := filepath.Dir(path)
		if parent == path {
			return ids
		}
		path = parent
	}
}

func fingerprintOverlap(source Source, destination string) bool {
	destinationID := pathID(destination)
	for _, id := range source.AncestorIDs {
		if id == destinationID {
			return true
		}
	}
	for _, id := range ancestorIDs(destination) {
		if id == source.RootID {
			return true
		}
	}
	return false
}

func checkPlatform() error {
	switch runtime.GOOS {
	case "darwin", "linux", "windows":
		return nil
	default:
		return fmt.Errorf("baseline: atomic import is unsupported on %s", runtime.GOOS)
	}
}
