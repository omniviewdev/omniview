package devoutputs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// Published returns the content digest of a staged producer output that still
// exactly matches its last controlled publication, including directory
// identities. It refuses outputs that were never published by a controlled
// producer, have a live/unfinished writer or interrupted recovery, or changed
// since publication. The digest omits directory identities, so an identical
// republished tree has the same digest; it is not reuse authority by itself.
func Published(ctx context.Context, w devcontract.ResolvedWorkspace, consumer string, kind Producer) (string, error) {
	if kind != Distribution && kind != Bindings && kind != Shims && kind != YAMLWorker {
		return "", fmt.Errorf("producer is not a staged repository output")
	}
	s, err := newScope(w)
	if err != nil {
		return "", err
	}
	spec, err := s.spec(consumer, kind)
	if err != nil {
		return "", err
	}
	var digest string
	err = locked(ctx, s, func(j *journal) error {
		if j.Restoring {
			return fmt.Errorf("repository output restoration is incomplete")
		}
		entry := j.Entries[keyOf(spec)]
		if entry == nil {
			return fmt.Errorf("repository output has no controlled publication: %s", spec.Target)
		}
		if len(entry.Live) > 0 || entry.Pending != nil || entry.Cleanup != nil {
			return fmt.Errorf("repository output has an unfinished writer: %s", spec.Target)
		}
		actual, err := snapshotPath(entry.Spec, entry.Exclude)
		if err != nil {
			return err
		}
		if len(actual) == 0 || !sameSnapshot(actual, physical(entry.Expected)) {
			return fmt.Errorf("repository output changed since its controlled publication: %s", spec.Target)
		}
		digest = contentDigest(actual)
		return nil
	})
	return digest, err
}

// contentDigest hashes a snapshot's paths, kinds, content hashes, link
// targets and modes, but not directory identities.
func contentDigest(values snapshot) string {
	paths := make([]string, 0, len(values))
	for path := range values {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	digest := sha256.New()
	for _, path := range paths {
		value := values[path]
		fmt.Fprintf(digest, "%q %s %s %q %o\n", path, value.Kind, value.Hash, value.Link, value.Mode)
	}
	return hex.EncodeToString(digest.Sum(nil))
}
