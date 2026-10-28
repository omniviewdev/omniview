package devoutputs

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
)

type item struct {
	Kind, Hash, Link, Identity string
	Mode                       os.FileMode
}
type snapshot map[string]item

// Scratch belongs to one observation, never to a path or a prior snapshot.
type snapshotReader struct {
	digest hash.Hash
	buffer []byte
	sum    [sha256.Size]byte
	source struct{ io.Reader }
}

func snapshotPath(spec specification, exclude []string) (snapshot, error) {
	result := snapshot{}
	var reader snapshotReader
	info, err := os.Lstat(spec.Target)
	if os.IsNotExist(err) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	if spec.Mode == "file" {
		value, err := reader.item(spec.Target, info, false)
		if err != nil {
			return nil, err
		}
		result["."] = value
		return result, nil
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("producer directory was replaced: %s", spec.Target)
	}
	// File observations are independent. Join bounded readers before returning
	// an image; mutation admission and per-leaf deletion checks remain separate.
	type fileRead struct {
		path, relative string
		info           os.FileInfo
	}
	workers := min(4, runtime.GOMAXPROCS(0))
	var files chan fileRead
	var readErrors chan error
	var readers sync.WaitGroup
	var resultMu sync.Mutex
	err = filepath.WalkDir(spec.Target, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(spec.Target, path)
		if err != nil {
			return err
		}
		for _, skip := range exclude {
			if relative == skip || strings.HasPrefix(relative, skip+string(filepath.Separator)) {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
		}
		if spec.Mode == "filter" && relative != "." {
			if entry.IsDir() {
				if IsViteConfigTemporaryFile(entry.Name()) {
					return fmt.Errorf("config-loader artifact was replaced by a directory")
				}
				return filepath.SkipDir
			}
			if !IsViteConfigTemporaryFile(entry.Name()) {
				return nil
			}
		}
		for _, part := range strings.Split(filepath.ToSlash(relative), "/") {
			if part == ".git" {
				return fmt.Errorf("producer output overlaps Git metadata")
			}
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if workers > 1 && spec.Mode != "filter" && info.Mode().IsRegular() {
			if files == nil {
				files = make(chan fileRead, workers*2)
				readErrors = make(chan error, workers)
				for range workers {
					readers.Add(1)
					go func() {
						defer readers.Done()
						var reader snapshotReader
						for file := range files {
							value, readErr := reader.item(file.path, file.info, false)
							if readErr != nil {
								readErrors <- readErr
								return
							}
							resultMu.Lock()
							result[file.relative] = value
							resultMu.Unlock()
						}
					}()
				}
			}
			select {
			case files <- fileRead{path: path, relative: relative, info: info}:
				return nil
			case readErr := <-readErrors:
				return readErr
			}
		}
		value, err := reader.item(path, info, spec.Kind == modules)
		if err != nil {
			return err
		}
		if files == nil {
			result[relative] = value
		} else {
			resultMu.Lock()
			result[relative] = value
			resultMu.Unlock()
		}
		return nil
	})
	if files != nil {
		close(files)
		readers.Wait()
		if err == nil {
			select {
			case err = <-readErrors:
			default:
			}
		}
	}
	return result, err
}
func (reader *snapshotReader) item(path string, info os.FileInfo, allowLinks bool) (item, error) {
	result := item{Mode: info.Mode().Perm()}
	switch {
	case info.IsDir():
		result.Kind = "directory"
		id, err := directoryIdentity(path)
		result.Identity = id
		return result, err
	case info.Mode()&os.ModeSymlink != 0:
		if !allowLinks {
			return result, fmt.Errorf("producer source/output contains a symlink: %s", path)
		}
		result.Kind = "link"
		target, err := os.Readlink(path)
		result.Link = target
		return result, err
	case info.Mode().IsRegular():
		result.Kind = "file"
		stream, err := os.Open(path)
		if err != nil {
			return result, err
		}
		if reader.digest == nil {
			reader.digest = sha256.New()
			reader.buffer = make([]byte, 32*1024)
		}
		reader.digest.Reset()
		// Expose only Read: os.File.WriteTo would bypass CopyBuffer's scratch.
		reader.source.Reader = stream
		_, copyErr := io.CopyBuffer(reader.digest, &reader.source, reader.buffer)
		reader.source.Reader = nil
		closeErr := stream.Close()
		if copyErr != nil {
			return result, copyErr
		}
		if closeErr != nil {
			return result, closeErr
		}
		after, err := os.Lstat(path)
		if err != nil {
			return result, err
		}
		if !os.SameFile(info, after) || info.Size() != after.Size() || info.ModTime() != after.ModTime() {
			return result, fmt.Errorf("producer output changed during snapshot: %s", path)
		}
		result.Hash = hex.EncodeToString(reader.digest.Sum(reader.sum[:0]))
		return result, nil
	default:
		return result, fmt.Errorf("producer output contains a special file: %s", path)
	}
}
func sameSnapshot(left, right snapshot) bool {
	if len(left) != len(right) {
		return false
	}
	for path, value := range left {
		if right[path] != value {
			return false
		}
	}
	return true
}
func baselineSnapshot(files map[string]committedFile) snapshot {
	result := snapshot{}
	for path, file := range files {
		sum := sha256.Sum256(file.Data)
		result[path] = item{Kind: "file", Hash: hex.EncodeToString(sum[:]), Mode: file.Mode}
		if path != "." {
			for directory := filepath.Dir(path); ; directory = filepath.Dir(directory) {
				result[directory] = item{Kind: "directory", Mode: 0755}
				if directory == "." {
					break
				}
			}
		}
	}
	return result
}
func equalCommitted(actual item, exists bool, committed item, tracked bool) bool {
	if exists != tracked {
		return false
	}
	if !exists {
		return true
	}
	if actual.Kind != committed.Kind {
		return false
	}
	if actual.Kind == "directory" {
		return true
	}
	return actual.Kind == "file" && actual.Hash == committed.Hash && (actual.Mode&0111 != 0) == (committed.Mode&0111 != 0)
}
func matchesOwnedOrCommitted(actual, expected, baseline snapshot) error {
	paths := map[string]bool{}
	for path := range actual {
		paths[path] = true
	}
	for path := range expected {
		paths[path] = true
	}
	for path := range baseline {
		paths[path] = true
	}
	for path := range paths {
		value, present := actual[path]
		owned, wasOwned := expected[path]
		if owned.Kind == "absent" {
			if !present {
				continue
			}
			wasOwned = false
		}
		if present && wasOwned && value.Kind == "directory" && owned.Kind == "directory" && (value.Identity != owned.Identity || value.Mode != owned.Mode) {
			return fmt.Errorf("owned producer directory was replaced or changed: %s", path)
		}
		if present && wasOwned && value == owned {
			continue
		}
		if !present && !wasOwned {
			if _, tracked := baseline[path]; !tracked {
				continue
			}
		}
		committed, isTracked := baseline[path]
		if !equalCommitted(value, present, committed, isTracked) {
			return fmt.Errorf("producer path has unknown or uncommitted user changes: %s", path)
		}
	}
	return nil
}
func requireBaseline(actual snapshot, baseline snapshot) error {
	for path, value := range actual {
		committed, ok := baseline[path]
		if !equalCommitted(value, true, committed, ok) {
			return fmt.Errorf("preexisting producer output is not a clean tracked baseline: %s", path)
		}
	}
	for path, value := range baseline {
		current, ok := actual[path]
		if !equalCommitted(current, ok, value, true) {
			return fmt.Errorf("tracked producer baseline was edited or removed: %s", path)
		}
	}
	return nil
}
func removeSnapshot(spec specification, expected snapshot) error {
	actual, err := snapshotPath(spec, nil)
	if err != nil {
		return err
	}
	for path, value := range actual {
		if expected[path] != value {
			return fmt.Errorf("producer cleanup snapshot changed: %s", path)
		}
	}
	return removeSnapshotLeaves(spec, expected)
}

// The caller must freshly admit the complete tree immediately before this call,
// with no intervening checkpoint or mutation. Rehash every leaf before removal.
func removeSnapshotLeaves(spec specification, expected snapshot) error {
	paths := make([]string, 0, len(expected))
	for path := range expected {
		paths = append(paths, path)
	}
	sort.Slice(paths, func(i, j int) bool { return len(paths[i]) > len(paths[j]) })
	var reader snapshotReader
	for _, relative := range paths {
		if spec.Mode == "filter" && relative == "." {
			continue
		}
		path := spec.Target
		if relative != "." {
			path = filepath.Join(path, relative)
		}
		current, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		value, err := reader.item(path, current, spec.Kind == modules)
		if err != nil {
			return err
		}
		if value != expected[relative] {
			return fmt.Errorf("producer cleanup path changed")
		}
		if err = os.Remove(path); err != nil {
			return err
		}
	}
	return nil
}
