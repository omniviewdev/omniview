package resourcecatalog

// Stats reports live catalog retention. Every count returns to zero once all
// connections are dropped.
type Stats struct {
	// Connections counts live connection snapshots.
	Connections int
	// Entries counts representation and exact auxiliary target entries.
	Entries int
	// Documents counts retained normalized documents (shared by digest).
	Documents int
	// RetainedBytes sums the retention charge of retained documents.
	RetainedBytes int64
	// BranchViews counts built branch views across retained documents.
	BranchViews int
	// CELProviders counts built CEL type providers across retained documents.
	CELProviders int
}

// Stats returns a consistent snapshot of the catalog's retention counters.
func (c *Catalog) Stats() Stats {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := Stats{Connections: len(c.connections)}
	for _, snapshot := range c.connections {
		out.Entries += len(snapshot.entries) + len(snapshot.aux)
	}
	retained := c.store.stats()
	out.Documents = retained.documents
	out.RetainedBytes = retained.retainedBytes
	out.BranchViews = retained.branchViews
	out.CELProviders = retained.celProviders
	return out
}
