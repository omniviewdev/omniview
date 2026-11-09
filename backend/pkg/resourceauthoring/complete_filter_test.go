package resourceauthoring

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// filter() returns the receiver's own elements, so the item type survives it; the
// other macros end a clause or yield an unrelated list and resolve nothing further.
func TestFilterKeepsTheReceiversItemType(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)

	kept := f.completeAt(`resource.tags.filter(t, t.key == "env")[0].` + cursorMark)
	assert.Equal(t, []string{"key", "value"}, labels(kept.Items))
	assert.Equal(t, []PathSegment{{Kind: "field", Name: "tags"}, {Kind: "item"}}, kept.Context.Path)

	size := f.completeAt(`resource.tags.filter(t, t.key == "env").` + cursorMark)
	assert.Equal(t, []string{"all", "exists", "exists_one", "size"}, sorted(labels(size.Items)), "a filtered list is still a list")

	mapped := f.completeAt(`resource.tags.map(t, t.key)[0].` + cursorMark)
	assert.Empty(t, mapped.Items, "map() yields a list the schema says nothing about")

	exists := f.completeAt(`resource.tags.exists(t, t.key == "env").` + cursorMark)
	assert.Empty(t, exists.Items, "exists() is a boolean and has no members")
}
