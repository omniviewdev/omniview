package resourceauthoring

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// CEL selects from a typed object but cannot index it: resource["name"] is a
// type error for an object with declared properties, while a map, a dyn value
// and a union can be indexed. A name that is not a CEL identifier therefore needs
// a different syntax depending on the parent's CEL type, and an edit that picks
// the wrong one is not valid CEL. Every edit below is compiled with the
// production catalog-backed environment.
const typedNamesSchema = `{
	"$schema": "https://json-schema.org/draft/2020-12/schema",
	"type": "object",
	"properties": {
		"plain": {"type": "string"},
		"safe": {"type": "object", "properties": {"name": {"type": "string"}, "size": {"type": "integer"}}},
		"typed": {"type": "object", "properties": {"a-b": {"type": "string"}, "in": {"type": "integer"}}},
		"closed": {"type": "object", "additionalProperties": false, "properties": {"x y": {"type": "string"}}},
		"nullable": {"type": ["object", "null"], "properties": {"a-b": {"type": "string"}}},
		"open": {"type": "object", "additionalProperties": {"type": "string"}},
		"union": {"anyOf": [{"type": "object", "properties": {"x-y": {"type": "string"}}}, {"type": "string"}]}
	}
}`

func TestUnsafeNamesUseTheSyntaxTheParentTypeAllows(t *testing.T) {
	f := newFixture(t, "names", draft2020, typedNamesSchema)
	env := f.celEnv(nil)
	cases := []struct {
		marked   string
		label    string
		want     string
		checking string
	}{
		{"resource.typed." + cursorMark, "a-b", `dyn(resource.typed)["a-b"]`, "dynamic"},
		{"resource.typed." + cursorMark, "in", `dyn(resource.typed)["in"]`, "dynamic"},
		{"resource.closed." + cursorMark, "x y", `dyn(resource.closed)["x y"]`, "dynamic"},
		{"resource.nullable." + cursorMark, "a-b", `resource.nullable["a-b"]`, "dynamic"},
		{"resource.union." + cursorMark, "x-y", `resource.union["x-y"]`, "dynamic"},
		{"resource.safe." + cursorMark, "name", `resource.safe.name`, "static"},
		{`resource.safe["na` + cursorMark + `"]`, "name", `resource.safe.name`, "static"},
		{`resource.safe["` + cursorMark + `"]`, "size", `resource.safe.size`, "partial"},
		{`resource.typed["` + cursorMark + `"]`, "a-b", `dyn(resource.typed)["a-b"]`, "dynamic"},
		{`resource.nullable["` + cursorMark + `"]`, "a-b", `resource.nullable["a-b"]`, "dynamic"},
		{"typed." + cursorMark, "a-b", `dyn(resource.typed)["a-b"]`, "dynamic"},
		{"typed.in" + cursorMark, "in", `dyn(resource.typed)["in"]`, "dynamic"},
	}
	for _, tc := range cases {
		t.Run(tc.marked+" "+tc.label, func(t *testing.T) {
			source, _ := split(t, tc.marked)
			response := f.completeAt(tc.marked)
			item, ok := byLabel(response.Items)[tc.label]
			require.True(t, ok, "%q not among %v", tc.label, labels(response.Items))
			applied := mustApply(t, source, item.Edit)
			assert.Equal(t, tc.want, applied)
			_, valid := compiles(env, applied)
			assert.True(t, valid, "%s must check", applied)
			assert.Equal(t, tc.checking, item.Checking)
			seen, _ := observe(env, applied)
			if tc.checking == "dynamic" {
				assert.True(t, seen.dyn, "%s: the checker really types it dyn", applied)
			}
		})
	}
	assert.Empty(t, kindsOf(f.completeAt("resource.open."+cursorMark).Items, KindField), "a map names no keys")

	// A dyn root is indexable; a typed root is not.
	union := newFixture(t, "union", draft2020, `{"anyOf":[{"type":"object","properties":{"a-b":{"type":"string"}}},{"type":"object","properties":{"c":{"type":"string"}}}]}`)
	unionEnv := union.celEnv(nil)
	response := union.completeAt("resource." + cursorMark)
	item := byLabel(response.Items)["a-b"]
	applied := mustApply(t, "resource.", item.Edit)
	assert.Equal(t, `resource["a-b"]`, applied)
	_, valid := compiles(unionEnv, applied)
	assert.True(t, valid, applied)
	assert.Equal(t, "conditional", item.Applicability)
}

// An index key on a typed object is rewritten to the access that checks, taking
// the closing bracket with it; the surrounding text is untouched.
func TestIndexOnATypedObjectIsRewrittenToValidCEL(t *testing.T) {
	f := newFixture(t, "names", draft2020, typedNamesSchema)
	env := f.celEnv(nil)
	marked := `resource.safe["na` + cursorMark + `"] && resource.plain == "x"`
	source, _ := split(t, marked)
	response := f.completeAt(marked)
	require.Equal(t, []string{"name"}, labels(response.Items))
	edit := response.Items[0].Edit
	assert.Equal(t, 0, edit.Start)
	assert.Equal(t, `resource.safe.name && resource.plain == "x"`, mustApply(t, source, edit))
	_, valid := compiles(env, mustApply(t, source, edit))
	assert.False(t, valid, "the rewritten clause is a path, not a boolean: the checker agrees it is not a predicate")
	_, valid = compiles(env, `resource.safe.name == "x" && resource.plain == "x"`)
	assert.True(t, valid)
	// The original index form really is a checker error on a typed object.
	_, valid = compiles(env, `resource.safe["name"] == "x"`)
	assert.False(t, valid, "CEL cannot index a typed object")
}

// The document root: its CEL type decides how a name that cannot be selected is written.
func TestRootlessAndRootNamesFollowTheRootType(t *testing.T) {
	typed := newFixture(t, "names", draft2020, `{"type":"object","properties":{"top-level":{"type":"string"},"ok":{"type":"string"}}}`)
	env := typed.celEnv(nil)
	response := typed.completeAt("top" + cursorMark)
	item := byLabel(response.Items)["top-level"]
	assert.Equal(t, `dyn(resource)["top-level"]`, item.Edit.Text)
	assert.True(t, item.Rootless)
	_, valid := compiles(env, item.Edit.Text)
	assert.True(t, valid)
	plain := byLabel(typed.completeAt("o" + cursorMark).Items)["ok"]
	assert.Equal(t, "resource.ok", plain.Edit.Text)

	closed := newFixture(t, "closed", draft2020, `{"type":"object","additionalProperties":false,"properties":{"a b":{"type":"string"}}}`)
	assert.Equal(t, `dyn(resource)["a b"]`, byLabel(closed.completeAt("a" + cursorMark).Items)["a b"].Edit.Text)
	partial := newFixture(t, "partial", draft2020, `{"type":"object","properties":{"a b":{"type":"string"}}}`)
	assert.Equal(t, `dyn(resource)["a b"]`, byLabel(partial.completeAt("resource." + cursorMark).Items)["a b"].Edit.Text, "an open object with declared properties is a struct in CEL")
	open := newFixture(t, "open", draft2020, `{"type":"object","additionalProperties":{"type":"string"}}`)
	assert.Empty(t, open.completeAt("resource."+cursorMark).Items, "a map root names no fields")
}
