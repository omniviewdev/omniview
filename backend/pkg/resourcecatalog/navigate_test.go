package resourcecatalog

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// resolvedSchema resolves one inline document through a real catalog.
func resolvedSchema(t *testing.T, c *Catalog, connection, dialect, document, root string) *Schema {
	t.Helper()
	s := c.Observe(key(connection), catalogOf("c1", typeOf("t", inlineBinding(dialect, document, root))))
	return resolve(t, entry(t, s, "t", "r0"), nil)
}

func navigate(t *testing.T, schema *Schema, policy Policy, path ...PathSegment) Navigation {
	t.Helper()
	nav, err := Navigate(context.Background(), schema, path, policy)
	if err != nil {
		t.Fatalf("navigate %v: %v", path, err)
	}
	return nav
}

func field(name string) PathSegment { return PathSegment{Kind: SegmentField, Name: name} }

func fieldNames(nav Navigation) []string {
	var names []string
	for _, f := range nav.Fields {
		if f.Segment.Kind == SegmentField {
			names = append(names, f.Segment.Name)
		} else {
			names = append(names, "<"+f.Segment.Kind+">")
		}
	}
	return names
}

func fieldNamed(t *testing.T, nav Navigation, name string) FieldInfo {
	t.Helper()
	for _, f := range nav.Fields {
		if f.Segment.Name == name {
			return f
		}
	}
	t.Fatalf("field %q not listed in %v", name, fieldNames(nav))
	return FieldInfo{}
}

func TestNavigateAbsentSchemaIsEmpty(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	s := c.Observe(key("a"), catalogOf("c1", typeOf("t", resourcev2.SchemaBinding{State: "absent"})))
	e := entry(t, s, "t", "r0")
	schema, err := e.Resolve(context.Background(), nil)
	if schema != nil || err != nil {
		t.Fatalf("absent resolve = %v, %v", schema, err)
	}
	nav := navigate(t, schema, DefaultPolicy(), field("anything"))
	if nav.Fields != nil || nav.Truncated {
		t.Fatalf("absent navigation = %+v", nav)
	}
	if o := OverlayFor(e, schema, err); o.HostEvaluation != HostEvaluationDynamic || o.Validation != ValidationNone {
		t.Fatalf("absent overlay = %+v", o)
	}
}

func TestNavigateIsolatesConnectionsWithTheSameTypeName(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	a := resolvedSchema(t, c, "a", d2020, `{"type":"object","properties":{"image":{"type":"string"}}}`, "")
	b := resolvedSchema(t, c, "b", d2020, `{"type":"object","properties":{"replicas":{"type":"integer"}}}`, "")
	if got := fieldNames(navigate(t, a, DefaultPolicy())); !slices.Equal(got, []string{"image"}) {
		t.Fatalf("connection a fields = %v", got)
	}
	if got := fieldNames(navigate(t, b, DefaultPolicy())); !slices.Equal(got, []string{"replicas"}) {
		t.Fatalf("connection b fields = %v", got)
	}
}

func TestNavigateRecursiveRefThreeLevels(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", dDraft7, `{
		"$ref": "#/definitions/tree",
		"definitions": {"tree": {"type": "object", "required": ["name"], "properties": {"name": {"type": "string"}, "child": {"$ref": "#/definitions/tree"}}}}
	}`, "")
	nav := navigate(t, schema, DefaultPolicy(), field("child"), field("child"), field("child"))
	if got := fieldNames(nav); !slices.Equal(got, []string{"child", "name"}) {
		t.Fatalf("level 3 fields = %v", got)
	}
	if name := fieldNamed(t, nav, "name"); name.Presence != PresenceRequired || name.CELChecking != CELCheckingStatic {
		t.Fatalf("name = %+v", name)
	}
	if child := fieldNamed(t, nav, "child"); !child.HasChildren || child.Presence != PresenceOptional || !slices.Equal(child.Types, []string{"object"}) {
		t.Fatalf("child = %+v", child)
	}
}

func TestNavigateOpenAPINullableMapAndArray(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", dOAS30, `{"components":{"schemas":{"VM":{"type":"object","properties":{
		"note": {"type": "string", "nullable": true},
		"labels": {"type": "object", "additionalProperties": {"type": "string"}},
		"disks": {"type": "array", "items": {"type": "object", "properties": {"size": {"type": "integer", "format": "int64"}}}},
		"count": {"type": "integer"},
		"created": {"type": "string", "format": "date-time"}
	}}}}}`, "#/components/schemas/VM")
	root := navigate(t, schema, DefaultPolicy())
	note := fieldNamed(t, root, "note")
	if note.Nullable != NullableYes || !slices.Equal(note.Types, []string{"null", "string"}) || note.CELChecking != CELCheckingDynamic {
		t.Fatalf("note = %+v", note)
	}
	if f := fieldNamed(t, root, "labels"); f.Nullable != NullableNo || f.CELChecking != CELCheckingStatic || !f.HasChildren {
		t.Fatalf("labels = %+v", f)
	}
	if f := fieldNamed(t, root, "count"); f.CELChecking != CELCheckingPartial || f.NativeFilter != NativeFilterUnsupported {
		t.Fatalf("count = %+v", f)
	}
	if f := fieldNamed(t, root, "created"); f.CELChecking != CELCheckingPartial || f.Format != "date-time" {
		t.Fatalf("created = %+v", f)
	}

	labels := navigate(t, schema, DefaultPolicy(), field("labels"))
	if len(labels.Fields) != 1 || labels.Fields[0].Segment != (PathSegment{Kind: SegmentMapValue}) ||
		labels.Fields[0].Presence != PresenceUnknown || !slices.Equal(labels.Fields[0].Types, []string{"string"}) {
		t.Fatalf("labels children = %+v", labels.Fields)
	}
	disks := navigate(t, schema, DefaultPolicy(), field("disks"))
	if len(disks.Fields) != 1 || disks.Fields[0].Segment != (PathSegment{Kind: SegmentItem}) || !disks.Fields[0].HasChildren {
		t.Fatalf("disks children = %+v", disks.Fields)
	}
	size := fieldNamed(t, navigate(t, schema, DefaultPolicy(), field("disks"), PathSegment{Kind: SegmentItem}), "size")
	if size.CELChecking != CELCheckingStatic || size.Format != "int64" {
		t.Fatalf("size = %+v", size)
	}
	if nav := navigate(t, schema, DefaultPolicy(), field("labels"), PathSegment{Kind: SegmentMapValue}); len(nav.Fields) != 0 {
		t.Fatalf("string map value children = %+v", nav.Fields)
	}
	// An undeclared name on a map goes through the additional schema.
	if nav := navigate(t, schema, DefaultPolicy(), field("labels"), field("app")); len(nav.Fields) != 0 {
		t.Fatalf("labels.app children = %+v", nav.Fields)
	}
}

const overlappingUnion = `{
	"type": "object",
	"properties": {"kind": {"type": "string"}},
	"anyOf": [
		{"type": "object", "required": ["shared"], "properties": {"shared": {"type": "string"}, "a": {"type": "string", "enum": ["x"]},
			"spec": {"type": "object", "properties": {"inner": {"type": "boolean"}}}}},
		{"type": "object", "required": ["shared"], "properties": {"shared": {"type": "string"}, "a": {"type": "integer"}, "b": {"type": "integer"}, "kind": {"type": "string"}}}
	]
}`

func TestNavigateOverlappingAnyOfConditions(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, overlappingUnion, "")
	nav := navigate(t, schema, DefaultPolicy())
	// Own properties first, then branch fields; sorted within each group.
	if got := fieldNames(nav); !slices.Equal(got, []string{"kind", "a", "b", "shared", "spec"}) {
		t.Fatalf("fields = %v", got)
	}
	branch0 := BranchCondition{Pointer: "", Branch: 0, Combinator: "anyOf"}
	branch1 := BranchCondition{Pointer: "", Branch: 1, Combinator: "anyOf"}
	if kind := fieldNamed(t, nav, "kind"); kind.Applicability != ApplicabilityUnconditional || kind.Conditions != nil {
		t.Fatalf("own property redeclared in a branch = %+v", kind)
	}
	if shared := fieldNamed(t, nav, "shared"); shared.Applicability != ApplicabilityUnconditional || shared.Presence != PresenceRequired {
		t.Fatalf("shared = %+v", shared)
	}
	a := fieldNamed(t, nav, "a")
	if a.Applicability != ApplicabilityConditional || !slices.Equal(a.Conditions, []BranchCondition{branch0, branch1}) ||
		!slices.Equal(a.Types, []string{"integer", "string"}) || a.Enum != nil || a.CELChecking != CELCheckingDynamic {
		t.Fatalf("a = %+v", a)
	}
	if b := fieldNamed(t, nav, "b"); !slices.Equal(b.Conditions, []BranchCondition{branch1}) || b.Presence != PresenceOptional {
		t.Fatalf("b = %+v", b)
	}
	// Ancestor conditions propagate below a branch-local field.
	inner := fieldNamed(t, navigate(t, schema, DefaultPolicy(), field("spec")), "inner")
	if inner.Applicability != ApplicabilityConditional || !slices.Equal(inner.Conditions, []BranchCondition{branch0}) || inner.CELChecking != CELCheckingDynamic {
		t.Fatalf("inner = %+v", inner)
	}
}

func TestNavigateAllOfListsUnconditionalFields(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, `{"allOf":[
		{"type":"object","properties":{"x":{"type":"string"}}},
		{"type":"object","required":["x"],"properties":{"y":{"type":"string"}}}
	]}`, "")
	nav := navigate(t, schema, DefaultPolicy())
	if got := fieldNames(nav); !slices.Equal(got, []string{"x", "y"}) {
		t.Fatalf("fields = %v", got)
	}
	if x := fieldNamed(t, nav, "x"); x.Presence != PresenceRequired || x.Applicability != ApplicabilityUnconditional {
		t.Fatalf("x = %+v", x)
	}
}

func TestNavigateUnresolvablePath(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, podSchema, "")
	for _, path := range [][]PathSegment{
		{field("missing")},
		{field("spec"), PathSegment{Kind: SegmentItem}},
		{field("spec"), PathSegment{Kind: SegmentMapValue}},
		{field("spec"), field("image"), field("deeper")},
	} {
		_, err := Navigate(context.Background(), schema, path, DefaultPolicy())
		requireCode(t, err, codeInvalidRequest, "schema path does not resolve")
	}
	_, err := Navigate(context.Background(), schema, []PathSegment{{Kind: "bogus"}}, DefaultPolicy())
	requireCode(t, err, codeInvalidRequest, "bogus")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = Navigate(ctx, schema, nil, DefaultPolicy())
	requireCode(t, err, codeCancelled, "")
}

func TestNavigateFieldTruncationBoundary(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, `{"type":"object","properties":{"a":{},"b":{},"c":{}}}`, "")
	policy := DefaultPolicy()
	policy.MaxNavigationFields = 3
	if nav := navigate(t, schema, policy); nav.Truncated || len(nav.Fields) != 3 {
		t.Fatalf("at boundary = %+v", nav)
	}
	policy.MaxNavigationFields = 2
	nav := navigate(t, schema, policy)
	if !nav.Truncated || nav.TruncationReason != TruncatedFields || !slices.Equal(fieldNames(nav), []string{"a", "b"}) {
		t.Fatalf("over boundary = %+v", nav)
	}
}

func TestNavigateVisitTruncationBoundary(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	// Listing expands the root and its three allOf branches: 4 visits.
	schema := resolvedSchema(t, c, "a", d2020, `{"allOf":[
		{"properties":{"a":{}}},{"properties":{"b":{}}},{"properties":{"c":{}}}
	]}`, "")
	policy := DefaultPolicy()
	policy.MaxNavigationVisits = 4
	if nav := navigate(t, schema, policy); nav.Truncated || len(nav.Fields) != 3 {
		t.Fatalf("at boundary = %+v", nav)
	}
	policy.MaxNavigationVisits = 3
	nav := navigate(t, schema, policy)
	if !nav.Truncated || nav.TruncationReason != TruncatedVisits || !slices.Equal(fieldNames(nav), []string{"a", "b"}) {
		t.Fatalf("over boundary = %+v", nav)
	}
}

func TestNavigateSharedReferencesPreserveEveryBranch(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, `{
		"$defs":{"shared":{"properties":{"shared":{"type":"string"}}}},
		"anyOf":[
			{"$ref":"#/$defs/shared"},{"$ref":"#/$defs/shared"},
			{"$ref":"#/$defs/shared"},{"$ref":"#/$defs/shared"},
			{"$ref":"#/$defs/shared"},{"$ref":"#/$defs/shared"},
			{"$ref":"#/$defs/shared"},
			{"properties":{"last":{"properties":{"inner":{"type":"boolean"}}}}}
		]
	}`, "")
	for range 2 {
		nav := navigate(t, schema, DefaultPolicy())
		if nav.Truncated || !slices.Equal(fieldNames(nav), []string{"last", "shared"}) {
			t.Fatalf("shared-reference fields = %+v", nav)
		}
		var sharedConditions []BranchCondition
		for branch := range 7 {
			sharedConditions = append(sharedConditions, BranchCondition{Pointer: "", Branch: branch, Combinator: combinatorAnyOf})
		}
		shared := fieldNamed(t, nav, "shared")
		if shared.Applicability != ApplicabilityConditional || !slices.Equal(shared.Conditions, sharedConditions) {
			t.Fatalf("shared-reference conditions = %+v", shared)
		}
		lastCondition := []BranchCondition{{Pointer: "", Branch: 7, Combinator: combinatorAnyOf}}
		if last := fieldNamed(t, nav, "last"); !slices.Equal(last.Conditions, lastCondition) {
			t.Fatalf("last branch = %+v", last)
		}
		if inner := fieldNamed(t, navigate(t, schema, DefaultPolicy(), field("last")), "inner"); !slices.Equal(inner.Conditions, lastCondition) {
			t.Fatalf("last branch child = %+v", inner)
		}
	}
	view := schema.Document.branchView(schema.Root, func() bool { return true })
	if len(view.members) <= len(schema.Document.Nodes) {
		t.Fatalf("fixture did not exceed node count: %d members, %d nodes", len(view.members), len(schema.Document.Nodes))
	}
}

func TestNavigateSharedNestedUnionKeepsDistinctConditionPaths(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, `{
		"$defs":{"shared":{"oneOf":[
			{"properties":{"value":{"type":"string"}}},
			{"properties":{"value":{"type":"integer"}}}
		]}},
		"anyOf":[{"$ref":"#/$defs/shared"},{"$ref":"#/$defs/shared"}]
	}`, "")
	nav := navigate(t, schema, DefaultPolicy())
	value := fieldNamed(t, nav, "value")
	conditions := []BranchCondition{
		{Pointer: "", Branch: 0, Combinator: combinatorAnyOf},
		{Pointer: "", Branch: 1, Combinator: combinatorAnyOf},
		{Pointer: "/$defs/shared", Branch: 0, Combinator: combinatorOneOf},
		{Pointer: "/$defs/shared", Branch: 1, Combinator: combinatorOneOf},
	}
	if nav.Truncated || value.Applicability != ApplicabilityConditional ||
		!slices.Equal(value.Types, []string{"integer", "string"}) || !slices.Equal(value.Conditions, conditions) {
		t.Fatalf("shared nested union = %+v, field = %+v", nav, value)
	}
	view := schema.Document.branchView(schema.Root, func() bool { return true })
	if declarations := len(view.fields["value"]); declarations != 4 {
		t.Fatalf("nested node/condition declarations = %d, want 4", declarations)
	}
}

func TestNavigateBranchViewBudgetRetriesWithoutDuplicateMembers(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, `{
		"$defs":{"shared":{"properties":{"shared":{"type":"string"}}}},
		"anyOf":[
			{"allOf":[{"$ref":"#/$defs/shared"},{"$ref":"#/$defs/shared"}]},
			{"properties":{"last":{"type":"boolean"}}}
		]
	}`, "")
	policy := DefaultPolicy()
	// Root, first branch, two ref nodes, one shared target, last branch,
	// and two property declarations. The repeated target counts only once.
	for _, visits := range []int{1, 7} {
		policy.MaxNavigationVisits = visits
		if nav := navigate(t, schema, policy); !nav.Truncated || nav.TruncationReason != TruncatedVisits {
			t.Fatalf("budget %d = %+v", visits, nav)
		}
		if views := c.Stats().BranchViews; views != 0 {
			t.Fatalf("budget %d cached %d incomplete views", visits, views)
		}
	}
	policy.MaxNavigationVisits = 8
	for range 2 {
		nav := navigate(t, schema, policy)
		if nav.Truncated || !slices.Equal(fieldNames(nav), []string{"last", "shared"}) {
			t.Fatalf("exact branch-view budget = %+v", nav)
		}
	}
	view := schema.Document.branchView(schema.Root, func() bool { return true })
	if len(view.members) != 5 || c.Stats().BranchViews != 1 {
		t.Fatalf("completed view has %d members; stats = %+v", len(view.members), c.Stats())
	}
	for index, member := range view.members {
		for _, previous := range view.members[:index] {
			if member.node == previous.node && slices.Equal(member.conditions, previous.conditions) {
				t.Fatalf("duplicate node/condition member = %+v", member)
			}
		}
	}
	policy.MaxNavigationVisits = 7
	if nav := navigate(t, schema, policy); !nav.Truncated || nav.TruncationReason != TruncatedVisits {
		t.Fatalf("cached view bypassed budget = %+v", nav)
	}
	if views := c.Stats().BranchViews; views != 1 {
		t.Fatalf("cached view count changed after small budget: %d", views)
	}
}

func TestNavigateBranchViewBudgetsSharedPropertyDeclarations(t *testing.T) {
	var document strings.Builder
	document.WriteString(`{"anyOf":[{"$ref":"#/$defs/shared"},{"$ref":"#/$defs/shared"}],"$defs":{"shared":{"properties":{`)
	for property := range 64 {
		if property > 0 {
			document.WriteByte(',')
		}
		fmt.Fprintf(&document, `"field%02d":{"type":"string"}`, property)
	}
	document.WriteString(`}}}}`)
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, document.String(), "")
	policy := DefaultPolicy()
	// Five node expansions and 64 declarations under each of two conditions.
	const exactBudget = 5 + 2*64
	policy.MaxNavigationVisits = exactBudget - 1
	nav := navigate(t, schema, policy)
	if !nav.Truncated || nav.TruncationReason != TruncatedVisits || c.Stats().BranchViews != 0 {
		t.Fatalf("incomplete property table = %+v, stats = %+v", nav, c.Stats())
	}
	policy.MaxNavigationVisits = exactBudget
	for range 2 {
		nav = navigate(t, schema, policy)
		if nav.Truncated || len(nav.Fields) != 64 || c.Stats().BranchViews != 1 {
			t.Fatalf("exact property budget = %+v, stats = %+v", nav, c.Stats())
		}
	}
	policy.MaxNavigationVisits = exactBudget - 1
	if nav = navigate(t, schema, policy); !nav.Truncated || nav.TruncationReason != TruncatedVisits {
		t.Fatalf("cached declarations bypassed budget = %+v", nav)
	}
}

func TestNavigateSharedUnionDAGStopsBeforeCachingExpansion(t *testing.T) {
	var document strings.Builder
	document.WriteString(`{"anyOf":[{"$ref":"#/$defs/n0"},{"$ref":"#/$defs/n0"}],"$defs":{`)
	for level := range 14 {
		if level > 0 {
			document.WriteByte(',')
		}
		fmt.Fprintf(&document, `"n%d":{"anyOf":[{"$ref":"#/$defs/n%d"},{"$ref":"#/$defs/n%d"}]}`, level, level+1, level+1)
	}
	document.WriteString(`,"n14":{"properties":{"leaf":{"type":"string"}}}}}`)
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, document.String(), "")
	policy := DefaultPolicy()
	for _, visits := range []int{1, 32, policy.MaxNavigationVisits} {
		policy.MaxNavigationVisits = visits
		nav := navigate(t, schema, policy)
		if !nav.Truncated || nav.TruncationReason != TruncatedVisits || len(nav.Fields) != 0 {
			t.Fatalf("DAG budget %d = %+v", visits, nav)
		}
		if views := c.Stats().BranchViews; views != 0 {
			t.Fatalf("DAG budget %d retained %d incomplete views", visits, views)
		}
	}
}

func TestNavigateBuildsAtMostOneViewPerUnionNode(t *testing.T) {
	c := NewCatalog(DefaultPolicy())
	schema := resolvedSchema(t, c, "a", d2020, overlappingUnion, "")
	unions := 0
	for i := range schema.Document.Nodes {
		if isUnion(&schema.Document.Nodes[i]) {
			unions++
		}
	}
	for range 100 {
		navigate(t, schema, DefaultPolicy())
		navigate(t, schema, DefaultPolicy(), field("spec"))
	}
	if views := c.Stats().BranchViews; views == 0 || views > unions {
		t.Fatalf("branch views = %d, union nodes = %d", views, unions)
	}
}

func TestCELCheckingMapping(t *testing.T) {
	d := mustNormalize(t, d2020, `{"properties":{
		"closed": {"type": "object", "additionalProperties": false, "properties": {"a": {}}},
		"open": {"type": "object", "properties": {"a": {}}},
		"map": {"type": "object", "additionalProperties": {"type": "string"}},
		"anymap": {"type": "object"},
		"list": {"type": "array", "items": {"type": "string"}},
		"str": {"type": "string"},
		"time": {"type": "string", "format": "date-time"},
		"i64": {"type": "integer", "format": "int64"},
		"u32": {"type": "integer", "format": "uint32"},
		"int": {"type": "integer"},
		"num": {"type": "number"},
		"bool": {"type": "boolean"},
		"nullable": {"type": ["string", "null"]},
		"union": {"anyOf": [{"type": "string"}, {"type": "integer"}]},
		"multi": {"allOf": [{"type": "object"}, {"properties": {"x": {}}}]},
		"single": {"allOf": [{"type": "boolean"}]},
		"any": {}
	}}`)
	want := map[string]string{
		"closed": CELCheckingStatic, "open": CELCheckingPartial, "map": CELCheckingStatic, "anymap": CELCheckingPartial,
		"list": CELCheckingStatic, "str": CELCheckingStatic, "time": CELCheckingPartial, "i64": CELCheckingStatic,
		"u32": CELCheckingStatic, "int": CELCheckingPartial, "num": CELCheckingPartial, "bool": CELCheckingStatic,
		"nullable": CELCheckingDynamic, "union": CELCheckingDynamic, "multi": CELCheckingDynamic,
		"single": CELCheckingStatic, "any": CELCheckingDynamic,
	}
	for name, checking := range want {
		id, _ := d.Lookup("/properties/" + name)
		if got := celChecking(d, id); got != checking {
			t.Errorf("%s: celChecking = %s, want %s", name, got, checking)
		}
	}
}

func TestNavigateKubernetesPodContainers(t *testing.T) {
	schema := admitKubernetesPodSchema(t)
	nav := navigate(t, schema, DefaultPolicy(), field("spec"), field("containers"), PathSegment{Kind: SegmentItem})
	if nav.Truncated {
		t.Fatalf("container fields truncated: %s", nav.TruncationReason)
	}
	for _, name := range []string{"image", "name", "resources"} {
		fieldNamed(t, nav, name)
	}
	if name := fieldNamed(t, nav, "name"); name.Presence != PresenceRequired || !slices.Equal(name.Types, []string{"string"}) {
		t.Fatalf("container name = %+v", name)
	}
	if resources := fieldNamed(t, nav, "resources"); !resources.HasChildren {
		t.Fatalf("container resources = %+v", resources)
	}
	raw, err := schema.Document.EditorJSON()
	if err != nil {
		t.Fatal(err)
	}
	decodeEditor(t, raw)
}
