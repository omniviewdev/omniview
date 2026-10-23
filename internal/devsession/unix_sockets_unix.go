//go:build darwin || linux

package devsession

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

const socketOwnerMarker = ".owner.json"

type unixSocketRecord struct {
	SchemaVersion int                         `json:"schemaVersion"`
	Phase         string                      `json:"phase"`
	Root          string                      `json:"root"`
	Nonce         string                      `json:"nonce"`
	UID           uint32                      `json:"uid"`
	Device        uint64                      `json:"device"`
	Inode         uint64                      `json:"inode"`
	Owner         devcontract.ProcessIdentity `json:"owner"`
}

// UnixSocketDirectory belongs to one captured supervisor lifetime. Close must
// only be called after that supervisor has disposed all owned descendant groups.
// Retain the handle on failure so the same owner can retry cleanup.
type UnixSocketDirectory struct {
	mu            sync.Mutex
	record        unixSocketRecord
	recordPath    string
	closed        bool
	recordRemoved bool
}

func socketRecordPath(runtimeRoot, generation string) string {
	return filepath.Join(runtimeRoot, "unix-sockets-"+generation+".json")
}

func socketRecordMatches(a, b unixSocketRecord) bool {
	a.Phase, b.Phase = "", ""
	return a == b
}

func validateSocketOwner(owner devcontract.ProcessIdentity) error {
	if !validWorkspace(owner.Generation) || owner.Role != "supervisor" || !filepath.IsAbs(owner.Source) {
		return fmt.Errorf("%w: Unix socket owner must be a captured supervisor generation", ErrOwnership)
	}
	return VerifyOwnedProcess(owner, ownerOf(owner))
}

func exclusiveSocketRecord(path string, record unixSocketRecord) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("%w: Unix socket record cannot be adopted: %v", ErrOwnership, err)
	}
	defer file.Close()
	if err := json.NewEncoder(file).Encode(record); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return syncPrivateDirectory(filepath.Dir(path))
}

// CreateUnixSocketDirectory publishes an intent before creating its exclusive
// namespace. A crash cannot leave an external path without a durable reference;
// incomplete intents are conflicts, never permission to adopt a directory.
func CreateUnixSocketDirectory(runtimeRoot string, owner devcontract.ProcessIdentity) (*UnixSocketDirectory, error) {
	if err := validateSocketOwner(owner); err != nil {
		return nil, err
	}
	if owner.PID != os.Getpid() {
		return nil, fmt.Errorf("%w: only the captured supervisor may create its socket directory", ErrOwnership)
	}
	if err := ValidatePrivateDirectory(runtimeRoot); err != nil {
		return nil, err
	}
	nonce := uuid.NewString()
	var root string
	for _, candidate := range []string{os.TempDir(), "/tmp"} {
		base, err := devcontract.CanonicalPath(candidate)
		if err != nil {
			return nil, err
		}
		path := filepath.Join(base, ".ov-sock-"+strings.ReplaceAll(nonce, "-", ""))
		// Darwin sun_path has 104 bytes including NUL. Keep room for the
		// actual go-plugin CreateTemp leaf, also when Linux hosts the feature.
		if len(path)+len("/plugin4294967295") > 103 {
			continue
		}
		info, err := os.Stat(base)
		if err != nil || !info.IsDir() {
			if err == nil {
				err = fmt.Errorf("socket base is not a directory")
			}
			return nil, err
		}
		root = path
		break
	}
	if root == "" {
		return nil, fmt.Errorf("%w: no supported short Unix socket namespace", ErrOwnership)
	}
	record := unixSocketRecord{SchemaVersion: 1, Phase: "creating", Root: root, Nonce: nonce, UID: uint32(os.Geteuid()), Owner: owner}
	path := socketRecordPath(runtimeRoot, owner.Generation)
	if err := exclusiveSocketRecord(path, record); err != nil {
		return nil, err
	}
	directory := &UnixSocketDirectory{record: record, recordPath: path}
	if err := os.Mkdir(root, 0700); err != nil {
		return directory, fmt.Errorf("%w: refusing existing or unavailable Unix socket namespace: %v", ErrOwnership, err)
	}
	info, err := os.Lstat(root)
	if err != nil {
		return directory, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return directory, ErrUnsupportedIdentity
	}
	record.Device, record.Inode, record.Phase = uint64(stat.Dev), uint64(stat.Ino), "ready"
	if err := ValidatePrivateDirectory(root); err != nil {
		return directory, err
	}
	if err := WritePrivateJSON(filepath.Join(root, socketOwnerMarker), record); err != nil {
		return directory, err
	}
	if err := syncPrivateDirectory(filepath.Dir(root)); err != nil {
		return directory, err
	}
	directory.record = record
	if err := WritePrivateJSON(path, record); err != nil {
		return directory, err
	}
	return directory, nil
}

func readSocketRecord(runtimeRoot, generation string) (unixSocketRecord, error) {
	var record unixSocketRecord
	if !validWorkspace(generation) {
		return record, fmt.Errorf("%w: invalid Unix socket generation", ErrOwnership)
	}
	if err := ValidatePrivateDirectory(runtimeRoot); err != nil {
		return record, err
	}
	if err := ReadPrivateJSON(socketRecordPath(runtimeRoot, generation), &record); err != nil {
		return record, err
	}
	if record.SchemaVersion != 1 || record.Owner.Generation != generation || record.UID != uint32(os.Geteuid()) || !validWorkspace(record.Nonce) || !filepath.IsAbs(record.Root) || filepath.Base(record.Root) != ".ov-sock-"+strings.ReplaceAll(record.Nonce, "-", "") {
		return record, fmt.Errorf("%w: malformed Unix socket ownership", ErrOwnership)
	}
	return record, nil
}

func openSocketRoot(record unixSocketRecord) (*os.Root, error) {
	if err := ValidatePrivateDirectory(record.Root); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(record.Root)
	if err != nil {
		return nil, err
	}
	info, err := root.Lstat(".")
	if err == nil {
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || uint64(stat.Dev) != record.Device || uint64(stat.Ino) != record.Inode || stat.Uid != record.UID {
			err = fmt.Errorf("%w: Unix socket directory inode changed", ErrOwnership)
		}
	}
	if err != nil {
		root.Close()
		return nil, err
	}
	return root, nil
}

func socketMarker(root *os.Root, record unixSocketRecord) error {
	info, err := root.Lstat(socketOwnerMarker)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%w: Unix socket owner marker is not a private file", ErrOwnership)
	}
	if err := checkPrivatePath("", info); err != nil {
		return err
	}
	file, err := root.Open(socketOwnerMarker)
	if err != nil {
		return err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(info, opened) {
		return fmt.Errorf("%w: Unix socket marker inode changed", ErrOwnership)
	}
	var marker unixSocketRecord
	decoder := json.NewDecoder(io.LimitReader(file, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&marker); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("%w: trailing socket marker data", ErrOwnership)
	}
	if marker.Phase != "ready" || !socketRecordMatches(record, marker) {
		return fmt.Errorf("%w: Unix socket owner marker changed", ErrOwnership)
	}
	return nil
}

// ReadUnixSocketDirectory authorizes only the exact selected workspace and live
// supervisor generation. The caller must derive runtimeRoot from its profile,
// not from an inherited socket-directory environment variable.
func ReadUnixSocketDirectory(runtimeRoot, workspaceID, generation, source string) (string, error) {
	record, err := readSocketRecord(runtimeRoot, generation)
	if err != nil {
		return "", err
	}
	if record.Phase != "ready" || record.Owner.WorkspaceID != workspaceID || record.Owner.Source != source {
		return "", fmt.Errorf("%w: Unix socket record is not the selected ready generation", ErrOwnership)
	}
	if err := validateSocketOwner(record.Owner); err != nil {
		return "", err
	}
	root, err := openSocketRoot(record)
	if err != nil {
		return "", err
	}
	defer root.Close()
	if err := socketMarker(root, record); err != nil {
		return "", err
	}
	return record.Root, nil
}

func socketEntries(root *os.Root, record unixSocketRecord) (map[string]os.FileInfo, error) {
	file, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	defer file.Close()
	entries, err := file.ReadDir(-1)
	if err != nil {
		return nil, err
	}
	owned := make(map[string]os.FileInfo, len(entries))
	for _, entry := range entries {
		if entry.Name() == socketOwnerMarker {
			continue
		}
		suffix := strings.TrimPrefix(entry.Name(), "plugin")
		valid := suffix != entry.Name() && suffix != ""
		for _, character := range suffix {
			valid = valid && character >= '0' && character <= '9'
		}
		info, err := root.Lstat(entry.Name())
		if err != nil {
			return nil, err
		}
		if !valid || info.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("%w: unrecorded content in Unix socket namespace", ErrOwnership)
		}
		if err := checkPathOwner(info); err != nil {
			return nil, err
		}
		owned[entry.Name()] = info
	}
	if err := socketMarker(root, record); err != nil {
		if !errors.Is(err, os.ErrNotExist) || record.Phase != "removing" || len(entries) != 0 {
			return nil, err
		}
	}
	return owned, nil
}

func (d *UnixSocketDirectory) Close() error {
	if d == nil {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return nil
	}
	if d.recordRemoved {
		return d.finishRemoval()
	}
	current, err := readSocketRecord(filepath.Dir(d.recordPath), d.record.Owner.Generation)
	if err != nil {
		return err
	}
	if !socketRecordMatches(current, d.record) || (current.Phase != "ready" && current.Phase != "removing") {
		return fmt.Errorf("%w: Unix socket ownership changed or creation was interrupted", ErrOwnership)
	}
	d.record = current
	root, err := openSocketRoot(current)
	if errors.Is(err, os.ErrNotExist) && current.Phase == "removing" {
		if err := syncPrivateDirectory(filepath.Dir(current.Root)); err != nil {
			return err
		}
		return d.finishRemoval()
	}
	if err != nil {
		return err
	}
	defer root.Close()
	entries, err := socketEntries(root, current)
	if err != nil {
		return err
	}
	if current.Phase == "ready" {
		current.Phase = "removing"
		if err := WritePrivateJSON(d.recordPath, current); err != nil {
			return err
		}
		d.record = current
	}
	for name, expected := range entries {
		actual, err := root.Lstat(name)
		if err != nil {
			return err
		}
		if !os.SameFile(actual, expected) {
			return fmt.Errorf("%w: Unix socket inode changed during cleanup", ErrOwnership)
		}
		if err := root.Remove(name); err != nil {
			return err
		}
	}
	if err := root.Remove(socketOwnerMarker); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// Revalidate the pathname before deleting the directory entry; child
	// removals above are anchored to the verified open directory, not aliases.
	verified, err := openSocketRoot(current)
	if err != nil {
		return err
	}
	verified.Close()
	if err := os.Remove(current.Root); err != nil {
		return err
	}
	if err := syncPrivateDirectory(filepath.Dir(current.Root)); err != nil {
		return err
	}
	return d.finishRemoval()
}

func (d *UnixSocketDirectory) finishRemoval() error {
	if !d.recordRemoved {
		current, err := readSocketRecord(filepath.Dir(d.recordPath), d.record.Owner.Generation)
		if err != nil {
			return err
		}
		if current != d.record || current.Phase != "removing" {
			return fmt.Errorf("%w: Unix socket retirement record changed", ErrOwnership)
		}
		if err := os.Remove(d.recordPath); err != nil {
			return err
		}
		d.recordRemoved = true
	}
	if err := syncPrivateDirectory(filepath.Dir(d.recordPath)); err != nil {
		return err
	}
	d.closed = true
	return nil
}
