package resource

import (
	"context"
	"sync"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type admissionBatchContextKey struct{}

type admissionBatchKey struct {
	plugin     string
	route      resourcev2.AccessRoute
	generation *pluginState
	epoch      sourceEpochSnapshot
	typ        string
}

type admissionBatchEntry struct {
	catalog   resourcev2.Catalog
	authority AuthorityResolution
}

type admissionBatch struct {
	mu      sync.Mutex
	entries map[admissionBatchKey]admissionBatchEntry
}

func (b *admissionBatch) lookup(key admissionBatchKey) (admissionBatchEntry, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	entry, ok := b.entries[key]
	return entry, ok
}

func (b *admissionBatch) store(key admissionBatchKey, entry admissionBatchEntry) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.entries == nil {
		b.entries = make(map[admissionBatchKey]admissionBatchEntry)
	}
	b.entries[key] = entry
}

func admissionBatchFrom(ctx context.Context) *admissionBatch {
	batch, _ := ctx.Value(admissionBatchContextKey{}).(*admissionBatch)
	return batch
}

// WithAdmissionBatch scopes reference admissions made with the returned context
// to one sequential admission pass: the route catalog, its validation and the
// authority resolution for a resource type are acquired once and shared by the
// admissions that follow. Every reference is still individually authorized,
// address-checked and generation-fenced.
// The batch does not coordinate overlapping admissions, so never share it between
// goroutines. Discard the context when the pass completes; never retain it
// across deliveries, where a catalog or authority may have changed.
func WithAdmissionBatch(ctx context.Context) context.Context {
	if admissionBatchFrom(ctx) != nil {
		return ctx
	}
	return context.WithValue(ctx, admissionBatchContextKey{}, &admissionBatch{})
}
