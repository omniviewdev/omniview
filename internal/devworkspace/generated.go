package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type generatedEntry struct {
	Kind   string `json:"kind"`
	SHA256 string `json:"sha256,omitempty"`
}
type generatedPending struct {
	Generation    string                    `json:"generation"`
	Nonce         string                    `json:"nonce"`
	Stage         string                    `json:"stage"`
	Phase         string                    `json:"phase"`
	Before        map[string]generatedEntry `json:"before,omitempty"`
	After         map[string]generatedEntry `json:"after,omitempty"`
	StageIdentity *generatedFileIdentity    `json:"stageIdentity,omitempty"`
}
type generatedLedger struct {
	SchemaVersion int                         `json:"schemaVersion"`
	WorkspaceID   string                      `json:"workspaceID"`
	Root          string                      `json:"root"`
	Entries       map[string]generatedEntry   `json:"entries"`
	Pending       map[string]generatedPending `json:"pending"`
	Cleanup       *generatedCleanup           `json:"cleanup,omitempty"`
}

// GeneratedTree is an unforgeable in-process preparation capability. Producers
// write ONLY Directory, a newly created private staging tree, never Destination.
// Record publishes that tree only if the old destination remains unchanged.
type GeneratedTree struct {
	Directory                   string
	Destination                 string
	workspace                   Workspace
	relative, generation, nonce string
	before                      map[string]generatedEntry
	missingParents              []string
	stageFile                   *os.File
	stageIdentity               generatedFileIdentity
}

func generatedCollection(w Workspace) (string, error) {
	id, err := uuid.Parse(w.Manifest.WorkspaceID)
	if err != nil || id == uuid.Nil || id.String() != w.Manifest.WorkspaceID {
		return "", devcontract.Fail(4, "generated_conflict", "generated resources require an exact workspace UUID")
	}
	root, err := devcontract.CanonicalPath(w.Root)
	if err != nil {
		return "", err
	}
	if root != w.Root {
		return "", devcontract.Fail(4, "generated_conflict", "workspace root is redirected")
	}
	collection := filepath.Dir(filepath.Dir(root))
	if filepath.Dir(root) != filepath.Join(collection, "workspaces") {
		return "", devcontract.Fail(4, "generated_conflict", "generated resources require a registered workspaces collection")
	}
	return collection, nil
}
func GeneratedLockPath(w Workspace, name string) (string, error) {
	switch name {
	case "buildgraph", "watchgraph", "supervisor", "operation", "generated":
	default:
		return "", fmt.Errorf("invalid generated lock role")
	}
	collection, err := generatedCollection(w)
	if err != nil {
		return "", err
	}
	directory := filepath.Join(collection, ".omniview-dev", "operations")
	if err = privateGeneratedDirectory(directory); err != nil {
		return "", err
	}
	path := filepath.Join(directory, w.Manifest.WorkspaceID+"-"+name+".lock")
	if err := devsession.ValidatePrivateFile(path); err != nil && !os.IsNotExist(err) {
		return "", err
	}
	return path, nil
}
func privateGeneratedDirectory(path string) error {
	canonical, err := devsession.EnsurePrivateDirectory(path)
	if err != nil {
		return err
	}
	if canonical != path {
		return devcontract.Fail(4, "generated_conflict", "generated metadata directory is redirected")
	}
	return nil
}
func lockGenerated(w Workspace) (generatedLedger, func(), string, error) {
	var ledger generatedLedger
	lockPath, err := GeneratedLockPath(w, "generated")
	if err != nil {
		return ledger, nil, "", err
	}
	lock, err := devsession.AcquirePrivateLock(context.Background(), filepath.Dir(lockPath), filepath.Base(lockPath))
	if err != nil {
		return ledger, nil, "", err
	}
	unlock := func() { _ = lock.Unlock() }
	collection, _ := generatedCollection(w)
	path := filepath.Join(collection, ".omniview-dev", "generated", w.Manifest.WorkspaceID+".json")
	if err = privateGeneratedDirectory(filepath.Dir(path)); err != nil {
		unlock()
		return ledger, nil, "", err
	}
	err = readLaunchJSON(path, &ledger)
	if os.IsNotExist(err) {
		ledger = generatedLedger{SchemaVersion: 1, WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Entries: map[string]generatedEntry{}, Pending: map[string]generatedPending{}}
	} else if err != nil {
		unlock()
		return ledger, nil, "", err
	}
	if ledger.SchemaVersion != 1 || ledger.WorkspaceID != w.Manifest.WorkspaceID || ledger.Root != w.Root || ledger.Entries == nil || ledger.Pending == nil {
		unlock()
		return ledger, nil, "", devcontract.Fail(4, "generated_conflict", "generated resource ledger identity differs")
	}
	return ledger, unlock, path, nil
}
func generatedPath(w Workspace, relative string) (string, error) {
	if relative == "" || filepath.IsAbs(relative) || filepath.Clean(relative) != relative || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", devcontract.Fail(4, "generated_conflict", "generated path escapes workspace metadata")
	}
	path := filepath.Join(w.Root, ".local", relative)
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return "", err
	}
	if canonical != path {
		return "", devcontract.Fail(4, "generated_conflict", "generated path is redirected through a symlink")
	}
	return path, nil
}
func digestGenerated(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func inspectGenerated(path string) (generatedEntry, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return generatedEntry{}, err
	}
	if info.IsDir() {
		return generatedEntry{Kind: "directory"}, nil
	}
	if !info.Mode().IsRegular() {
		return generatedEntry{}, devcontract.Fail(4, "generated_conflict", "generated resource is not a regular file/directory")
	}
	file, err := os.Open(path)
	if err != nil {
		return generatedEntry{}, err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return generatedEntry{}, err
	}
	after, err := os.Lstat(path)
	if err != nil {
		return generatedEntry{}, err
	}
	if !os.SameFile(info, after) || info.Size() != after.Size() || info.ModTime() != after.ModTime() {
		return generatedEntry{}, devcontract.Fail(4, "generated_conflict", "generated resource changed during verification")
	}
	return generatedEntry{Kind: "file", SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}
func checkGeneratedEntry(path string, expected generatedEntry) error {
	actual, err := inspectGenerated(path)
	if err != nil {
		return err
	}
	if actual != expected {
		return devcontract.Fail(4, "generated_conflict", "generated resource was modified outside its recorded writer: "+path)
	}
	return nil
}
func scanGenerated(w Workspace, relative string) (map[string]generatedEntry, error) {
	root, err := generatedPath(w, relative)
	if err != nil {
		return nil, err
	}
	result := map[string]generatedEntry{}
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if os.IsNotExist(walkErr) && path == root {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(filepath.Join(w.Root, ".local"), path)
		if err != nil {
			return err
		}
		actual, err := inspectGenerated(path)
		if err != nil {
			return err
		}
		result[rel] = actual
		return nil
	})
	return result, err
}
func sameGenerated(actual, expected map[string]generatedEntry) bool {
	if len(actual) != len(expected) {
		return false
	}
	for path, item := range actual {
		if expected[path] != item {
			return false
		}
	}
	return true
}
func selectedGenerated(entries map[string]generatedEntry, relative string) map[string]generatedEntry {
	result := map[string]generatedEntry{}
	for path, entry := range entries {
		if path == relative || strings.HasPrefix(path, relative+string(filepath.Separator)) {
			result[path] = entry
		}
	}
	return result
}

// PrepareGeneratedTree never adopts an existing unrecorded output. A private
// staging directory prevents concurrent editor changes to final output being
// mistaken for bytes authored by an external compiler/task.
func PrepareGeneratedTree(w Workspace, relative, generation string) (*GeneratedTree, error) {
	if generation == "" {
		return nil, devcontract.Fail(4, "generated_conflict", "generated build requires an explicit supervisor generation")
	}
	ledger, unlock, path, err := lockGenerated(w)
	if err != nil {
		return nil, err
	}
	defer unlock()
	if err = generatedWritable(ledger); err != nil {
		return nil, err
	}
	destination, err := generatedPath(w, relative)
	if err != nil {
		return nil, err
	}
	if _, exists := ledger.Pending[relative]; exists {
		return nil, devcontract.Fail(4, "generated_pending", "interrupted generated output requires explicit resume/ownership inspection before rebuilding")
	}
	before, err := scanGenerated(w, relative)
	if err != nil {
		return nil, err
	}
	expected := selectedGenerated(ledger.Entries, relative)
	if !sameGenerated(before, expected) {
		return nil, devcontract.Fail(4, "generated_conflict", "generated build destination contains changed or unrecorded files")
	}
	missingParents := []string{}
	for parent := filepath.Dir(relative); parent != "."; parent = filepath.Dir(parent) {
		parentPath, err := generatedPath(w, parent)
		if err != nil {
			return nil, err
		}
		actual, err := inspectGenerated(parentPath)
		if os.IsNotExist(err) {
			missingParents = append(missingParents, parent)
			continue
		}
		if err != nil {
			return nil, err
		}
		if ledger.Entries[parent] != actual || actual.Kind != "directory" {
			return nil, devcontract.Fail(4, "generated_conflict", "generated output parent is not an owned directory")
		}
	}
	// Staging owns its metadata scaffold; do not depend on an installer/compiler
	// incidentally creating .local (compiler caches live outside the worktree).
	if err = privateGeneratedDirectory(filepath.Join(w.Root, ".local")); err != nil {
		return nil, err
	}
	nonce := uuid.NewString()
	stageRelative := ".generated-stage-" + nonce
	stage, err := generatedPath(w, stageRelative)
	if err != nil {
		return nil, err
	}
	ledger.Pending[relative] = generatedPending{Generation: generation, Nonce: nonce, Stage: stageRelative, Phase: "prepared", Before: before}
	if err = rawSaveLaunchJSON(path, ledger); err != nil {
		return nil, err
	}
	if err = os.Mkdir(stage, 0700); err != nil {
		return nil, err
	}
	stageFile, err := os.Open(stage)
	if err != nil {
		return nil, err
	}
	identity, err := generatedDirectoryIdentity(stageFile)
	if err != nil {
		stageFile.Close()
		return nil, err
	}
	pending := ledger.Pending[relative]
	pending.StageIdentity = &identity
	ledger.Pending[relative] = pending
	if err = rawSaveLaunchJSON(path, ledger); err != nil {
		stageFile.Close()
		return nil, err
	}
	return &GeneratedTree{Directory: stage, Destination: destination, workspace: w, relative: relative, generation: generation, nonce: nonce, before: before, missingParents: missingParents, stageFile: stageFile, stageIdentity: identity}, nil
}

// RecordGeneratedTree is also required after a failed controlled build, so its
// partial outputs remain owned and recoverable instead of becoming foreign data.
func RecordGeneratedTree(prepared *GeneratedTree) error {
	if prepared == nil || prepared.nonce == "" {
		return devcontract.Fail(4, "generated_conflict", "a live prepared build capability is required")
	}
	if prepared.stageFile == nil {
		return devcontract.Fail(4, "generated_conflict", "prepared staging handle is missing")
	}
	defer prepared.stageFile.Close()
	w := prepared.workspace
	ledger, unlock, path, err := lockGenerated(w)
	if err != nil {
		return err
	}
	defer unlock()
	if err = generatedWritable(ledger); err != nil {
		return err
	}
	pending, ok := ledger.Pending[prepared.relative]
	if !ok || pending.Nonce != prepared.nonce || pending.Generation != prepared.generation || pending.Phase != "prepared" {
		return devcontract.Fail(4, "generated_conflict", "generated preparation capability is stale")
	}
	if pending.StageIdentity == nil || *pending.StageIdentity != prepared.stageIdentity {
		return devcontract.Fail(4, "generated_conflict", "prepared staging identity differs from durable intent")
	}
	if err = validatePreparedDirectory(prepared); err != nil {
		return err
	}
	old, err := scanGenerated(w, prepared.relative)
	if err != nil {
		return err
	}
	if !sameGenerated(old, prepared.before) {
		return devcontract.Fail(4, "generated_conflict", "generated destination changed while controlled build was running")
	}
	staged, err := scanGenerated(w, pending.Stage)
	if err != nil {
		return err
	}
	if len(staged) == 0 {
		return devcontract.Fail(4, "generated_conflict", "prepared staging output disappeared")
	}
	published := map[string]generatedEntry{}
	for relative, entry := range staged {
		suffix := strings.TrimPrefix(relative, pending.Stage)
		published[prepared.relative+suffix] = entry
	}
	pending.Phase = "publishing"
	pending.Before = old
	pending.After = published
	ledger.Pending[prepared.relative] = pending
	if err = rawSaveLaunchJSON(path, ledger); err != nil {
		return err
	}
	backup := filepath.Join(w.Root, ".local", ".generated-old-"+prepared.nonce)
	if len(old) > 0 {
		if err = os.Rename(prepared.Destination, backup); err != nil {
			return err
		}
	}
	for i := len(prepared.missingParents) - 1; i >= 0; i-- {
		parent := prepared.missingParents[i]
		parentPath, err := generatedPath(w, parent)
		if err != nil {
			return err
		}
		if err = os.Mkdir(parentPath, 0700); err != nil {
			return err
		}
		ledger.Entries[parent] = generatedEntry{Kind: "directory"}
	}
	if err = validatePreparedDirectory(prepared); err != nil {
		return err
	}
	if err = os.Rename(prepared.Directory, prepared.Destination); err != nil {
		return err
	}
	if err = validatePublishedDirectory(prepared.Destination, pending.StageIdentity); err != nil {
		return err
	}
	for relative := range selectedGenerated(ledger.Entries, prepared.relative) {
		delete(ledger.Entries, relative)
	}
	for relative, entry := range published {
		ledger.Entries[relative] = entry
	}
	backupRelative := ".generated-old-" + prepared.nonce
	for relative, entry := range old {
		ledger.Entries[backupRelative+strings.TrimPrefix(relative, prepared.relative)] = entry
	}
	delete(ledger.Pending, prepared.relative)
	if err = rawSaveLaunchJSON(path, ledger); err != nil {
		return err
	}
	prepared.nonce = ""
	if len(old) > 0 {
		if err = removeGeneratedSnapshot(backup, prepared.relative, old); err != nil {
			return err
		}
		for relative := range selectedGenerated(ledger.Entries, backupRelative) {
			delete(ledger.Entries, relative)
		}
		if err = rawSaveLaunchJSON(path, ledger); err != nil {
			return err
		}
	}
	return nil
}
func removeGeneratedSnapshot(root, relative string, entries map[string]generatedEntry) error {
	paths := make([]string, 0, len(entries))
	for path := range entries {
		paths = append(paths, path)
	}
	sort.Slice(paths, func(i, j int) bool { return len(paths[i]) > len(paths[j]) })
	for _, path := range paths {
		suffix := strings.TrimPrefix(path, relative)
		actual := root + suffix
		if err := checkGeneratedEntry(actual, entries[path]); err != nil {
			return err
		}
		if err := os.Remove(actual); err != nil {
			return err
		}
	}
	return nil
}

func saveOwnedGeneratedFile(w Workspace, relative string, data []byte, writer func(string) error) error {
	ledger, unlock, ledgerPath, err := lockGenerated(w)
	if err != nil {
		return err
	}
	defer unlock()
	if err = generatedWritable(ledger); err != nil {
		return err
	}
	path, err := generatedPath(w, relative)
	if err != nil {
		return err
	}
	if actual, err := inspectGenerated(path); err == nil {
		expected, ok := ledger.Entries[relative]
		if !ok || actual != expected {
			return devcontract.Fail(4, "generated_conflict", "refusing to overwrite an unrecorded or modified generated file")
		}
	} else if !os.IsNotExist(err) {
		return err
	} else if _, ok := ledger.Entries[relative]; ok {
		return devcontract.Fail(4, "generated_conflict", "recorded generated file was removed outside its owner")
	}
	if err = writer(path); err != nil {
		return err
	}
	expected := generatedEntry{Kind: "file", SHA256: digestGenerated(data)}
	if err = checkGeneratedEntry(path, expected); err != nil {
		return err
	}
	ledger.Entries[relative] = expected
	return rawSaveLaunchJSON(ledgerPath, ledger)
}
func generatedFileContext(path string) (Workspace, string, bool, error) {
	if filepath.Base(filepath.Dir(path)) != ".local" {
		return Workspace{}, "", false, nil
	}
	root := filepath.Dir(filepath.Dir(path))
	manifest, err := readManifest(root)
	if err != nil {
		return Workspace{}, "", false, err
	}
	return Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, ManifestPath: filepath.Join(root, "workspace.json"), Manifest: manifest}}, filepath.Base(path), true, nil
}
func saveLaunchJSON(path string, value any) error {
	w, relative, owned, err := generatedFileContext(path)
	if err != nil {
		return err
	}
	if !owned {
		return rawSaveLaunchJSON(path, value)
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return saveOwnedGeneratedFile(w, relative, data, func(path string) error { return rawSaveLaunchJSON(path, value) })
}
func writeOwnedLaunchSecret(path string, data []byte) error {
	w, relative, owned, err := generatedFileContext(path)
	if err != nil {
		return err
	}
	write := func(path string) error {
		if _, err := os.Lstat(path); err == nil {
			return os.ErrExist
		} else if !os.IsNotExist(err) {
			return err
		}
		return devsession.WritePrivateFile(path, data)
	}
	if !owned {
		return write(path)
	}
	return saveOwnedGeneratedFile(w, relative, data, write)
}

// generatedLog hashes bytes actually accepted from owned child pipes. A foreign
// append/edit cannot be adopted by hashing whatever happens to exist at close.
type generatedLog struct {
	mu        sync.Mutex
	file      *os.File
	hash      hash.Hash
	workspace Workspace
	relative  string
	closed    bool
}

func openGeneratedLog(w Workspace, relative string) (*generatedLog, error) {
	ledger, unlock, path, err := lockGenerated(w)
	if err != nil {
		return nil, err
	}
	defer unlock()
	if err = generatedWritable(ledger); err != nil {
		return nil, err
	}
	filePath, err := generatedPath(w, relative)
	if err != nil {
		return nil, err
	}
	hash := sha256.New()
	if err = privateGeneratedDirectory(filepath.Dir(filePath)); err != nil {
		return nil, err
	}
	if expected, ok := ledger.Entries[relative]; ok {
		if err = devsession.ValidatePrivateFile(filePath); err != nil {
			return nil, err
		}
		if err = checkGeneratedEntry(filePath, expected); err != nil {
			return nil, err
		}
		old, err := os.Open(filePath)
		if err != nil {
			return nil, err
		}
		_, err = io.Copy(hash, old)
		old.Close()
		if err != nil {
			return nil, err
		}
	} else {
		if _, err = os.Lstat(filePath); !os.IsNotExist(err) {
			return nil, devcontract.Fail(4, "generated_conflict", "log path already exists without authored ownership")
		}
		if err = devsession.WritePrivateFile(filePath, nil); err != nil {
			return nil, err
		}
	}
	before, err := os.Lstat(filePath)
	if err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filePath, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	opened, err := file.Stat()
	if err != nil || !os.SameFile(before, opened) {
		file.Close()
		return nil, devcontract.Fail(4, "generated_conflict", "log handle no longer names its validated file")
	}
	ledger.Entries[relative] = generatedEntry{Kind: "file", SHA256: hex.EncodeToString(hash.Sum(nil))}
	if err = rawSaveLaunchJSON(path, ledger); err != nil {
		file.Close()
		return nil, err
	}
	return &generatedLog{file: file, hash: hash, workspace: w, relative: relative}, nil
}
func (log *generatedLog) Write(data []byte) (int, error) {
	log.mu.Lock()
	defer log.mu.Unlock()
	if log.closed {
		return 0, os.ErrClosed
	}
	ledger, unlock, path, err := lockGenerated(log.workspace)
	if err != nil {
		return 0, err
	}
	defer unlock()
	if err = generatedWritable(ledger); err != nil {
		return 0, err
	}
	filePath, err := generatedPath(log.workspace, log.relative)
	if err != nil {
		return 0, err
	}
	if err = devsession.ValidatePrivateFile(filePath); err != nil {
		return 0, err
	}
	current, err := os.Lstat(filePath)
	if err != nil {
		return 0, err
	}
	opened, err := log.file.Stat()
	if err != nil {
		return 0, err
	}
	if !os.SameFile(current, opened) {
		return 0, devcontract.Fail(4, "generated_conflict", "log pathname no longer names the retained writer")
	}
	expected := generatedEntry{Kind: "file", SHA256: hex.EncodeToString(log.hash.Sum(nil))}
	if ledger.Entries[log.relative] != expected {
		return 0, devcontract.Fail(4, "generated_conflict", "log ledger changed outside its writer")
	}
	if err = checkGeneratedEntry(filePath, expected); err != nil {
		return 0, err
	}
	n, writeErr := log.file.Write(data)
	if n > 0 {
		log.hash.Write(data[:n])
	}
	after, err := os.Lstat(filePath)
	if err != nil {
		return n, err
	}
	if !os.SameFile(opened, after) {
		return n, devcontract.Fail(4, "generated_conflict", "log pathname changed during append")
	}
	ledger.Entries[log.relative] = generatedEntry{Kind: "file", SHA256: hex.EncodeToString(log.hash.Sum(nil))}
	if err = rawSaveLaunchJSON(path, ledger); err != nil {
		return n, err
	}
	return n, writeErr
}
func (log *generatedLog) Close() error {
	log.mu.Lock()
	defer log.mu.Unlock()
	if log.closed {
		return nil
	}
	log.closed = true
	syncErr := log.file.Sync()
	closeErr := log.file.Close()
	if syncErr != nil {
		return syncErr
	}
	return closeErr
}

// CleanGenerated requires the external operation lock and a stopped supervisor.
// All entries are checked before the first deletion; unknown .local resources
// remain untouched for their producer/lifecycle owner to handle explicitly.
func CleanGenerated(w Workspace) error { return cleanGenerated(w) }

func withWorkspaceOperation(ctx context.Context, w Workspace) (func(), error) {
	path, err := GeneratedLockPath(w, "operation")
	if err != nil {
		return nil, err
	}
	lock, err := devsession.AcquirePrivateLock(ctx, filepath.Dir(path), filepath.Base(path))
	if err != nil {
		return nil, err
	}
	return func() { _ = lock.Unlock() }, nil
}
