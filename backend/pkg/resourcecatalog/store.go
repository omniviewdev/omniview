package resourcecatalog

import (
	"fmt"
	"sync"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"golang.org/x/sync/singleflight"
)

// store retains immutable normalized documents by content digest with a
// reference count per document. Documents in use are never evicted; a
// document is freed when its last reference is released.
type store struct {
	mu            sync.Mutex
	documents     map[[32]byte]*storedDocument
	retainedBytes int64
	normalizing   singleflight.Group
}

type storedDocument struct {
	document         *Document
	references       int
	maxRetainedBytes int64
}

func newStore() *store { return &store{documents: map[[32]byte]*storedDocument{}} }

// acquire returns a referenced document for raw bytes under dialect,
// normalizing at most once per digest across concurrent callers. The caller
// owns one reference and must release it.
func (s *store) acquire(dialect string, raw []byte, policy Policy) (*Document, error) {
	digest := documentDigest(dialect, raw)
	if d := s.retain(digest); d != nil {
		return d, nil
	}
	result, err, _ := s.normalizing.Do(string(digest[:]), func() (any, error) {
		d, err := normalizeDocument(dialect, raw, policy)
		if err != nil {
			return nil, err
		}
		d.store = s
		return d, nil
	})
	if err != nil {
		return nil, err
	}
	normalized := result.(*Document)
	s.mu.Lock()
	defer s.mu.Unlock()
	if stored, ok := s.documents[digest]; ok {
		stored.references++
		return stored.document, nil
	}
	if len(s.documents)+1 > policy.MaxRetainedDocuments {
		return nil, resourcev2.NewError(codeResourceLimit, fmt.Sprintf("schema catalog exceeds MaxRetainedDocuments (%d)", policy.MaxRetainedDocuments))
	}
	if normalized.retainedBytes > policy.MaxRetainedBytes-s.retainedBytes {
		return nil, resourcev2.NewError(codeResourceLimit, fmt.Sprintf("schema catalog exceeds MaxRetainedBytes (%d)", policy.MaxRetainedBytes))
	}
	s.documents[digest] = &storedDocument{document: normalized, references: 1, maxRetainedBytes: policy.MaxRetainedBytes}
	s.retainedBytes += normalized.retainedBytes
	return normalized, nil
}

func (s *store) retain(digest [32]byte) *Document {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.documents[digest]
	if !ok {
		return nil
	}
	stored.references++
	return stored.document
}

// release drops one reference; the last release frees the document.
func (s *store) release(d *Document) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.documents[d.Digest]
	if !ok || stored.document != d {
		panic("resourcecatalog: release of a document the store does not retain")
	}
	stored.references--
	if stored.references == 0 {
		delete(s.documents, d.Digest)
		s.retainedBytes -= d.retainedBytes
	}
}

// addRetainedBytes charges bytes derived from the document after
// normalization (rendered editor JSON) to the document and, while the
// document is retained, to the store total.
func (d *Document) addRetainedBytes(n int64) error {
	s := d.store
	s.mu.Lock()
	defer s.mu.Unlock()
	if stored, ok := s.documents[d.Digest]; ok && stored.document == d {
		if n > stored.maxRetainedBytes-s.retainedBytes {
			return resourcev2.NewError(codeResourceLimit, fmt.Sprintf("schema catalog exceeds MaxRetainedBytes (%d)", stored.maxRetainedBytes))
		}
		s.retainedBytes += n
	}
	d.retainedBytes += n
	return nil
}

type storeStats struct {
	documents     int
	retainedBytes int64
	branchViews   int
	celProviders  int
}

func (s *store) stats() storeStats {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := storeStats{documents: len(s.documents), retainedBytes: s.retainedBytes}
	for _, stored := range s.documents {
		out.branchViews += stored.document.views.built()
		if stored.document.celProvider.built.Load() {
			out.celProviders++
		}
	}
	return out
}
