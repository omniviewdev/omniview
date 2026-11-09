package resourceauthoring

import (
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sorted(in []string) []string {
	out := append([]string{}, in...)
	sort.Strings(out)
	return out
}

// Cloud profile: flat fields, a tag ARRAY of key/value objects, a date-time and
// a nullable string. No Kubernetes construct exists in this schema, and none is
// suggested.
func TestCloudFlatFieldsAndTagArray(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)

	root := f.completeAt("resource." + cursorMark)
	assert.Equal(t, ContextMember, root.Context.Kind)
	assert.Equal(t, DraftIncomplete, root.Context.Draft)
	assert.Equal(t, RootResource, root.Context.Root)
	assert.Equal(t, []string{"account", "createdAt", "description", "id", "region", "sizeBytes", "tags"}, labels(root.Items))
	assert.Equal(t, CompletionComplete, root.Completion.Kind)
	fields := byLabel(root.Items)
	assert.Equal(t, [4]string{"static", "required", "no", "unconditional"}, [4]string{fields["id"].Checking, fields["id"].Presence, fields["id"].Nullable, fields["id"].Applicability})
	assert.Equal(t, "partial", fields["sizeBytes"].Checking, "integer without a format is dyn in CEL: only the integer type survives")
	assert.Equal(t, "partial", fields["createdAt"].Checking, "date-time strings are dyn in CEL")
	assert.Equal(t, [2]string{"dynamic", "yes"}, [2]string{fields["description"].Checking, fields["description"].Nullable}, "nullable string")
	assert.Equal(t, "static", fields["tags"].Checking)
	assert.True(t, fields["tags"].HasChildren)
	assert.Equal(t, []string{"array"}, fields["tags"].Type.Names)
	assert.Equal(t, []string{"integer"}, fields["sizeBytes"].Type.Names)
	assert.Equal(t, "date-time", fields["createdAt"].Type.Format)
	for _, absent := range []string{"metadata", "namespace", "kind", "apiVersion", "spec", "status", "uid", "ownerReferences"} {
		assert.NotContains(t, fields, absent, "no Kubernetes field is suggested for a cloud type")
	}

	prefix := f.completeAt("resource.re" + cursorMark)
	assert.Equal(t, []string{"region"}, labels(prefix.Items))
	assert.Equal(t, "re", prefix.Context.Prefix)
	assert.Equal(t, Range{Start: 9, End: 11, Unit: UnitUTF8Byte}, prefix.Context.Replace)
	assert.Equal(t, Edit{Start: 9, End: 11, Unit: UnitUTF8Byte, Text: "region"}, prefix.Items[0].Edit)
	assert.Equal(t, CompletionComplete, prefix.Completion.Kind)

	// A tag ARRAY: the item tier lists the key and value fields.
	element := f.completeAt("resource.tags[0]." + cursorMark)
	assert.Equal(t, []string{"key", "value"}, labels(element.Items))
	assert.Equal(t, []PathSegment{{Kind: "field", Name: "tags"}, {Kind: "item"}}, element.Context.Path)
	require.Len(t, element.Context.Ancestors, 1, "tags is required and non-null; the array item may not exist")
	assert.Equal(t, []PathSegment{{Kind: "field", Name: "tags"}, {Kind: "item"}}, element.Context.Ancestors[0].Path)
	assert.Equal(t, "unknown", element.Context.Ancestors[0].Presence, "an array element may be absent")

	// Same-element correlation through a macro binds the element variable.
	macro := f.completeAt(`resource.tags.exists(t, t.key == "env" && t.` + cursorMark)
	assert.Equal(t, []string{"key", "value"}, labels(macro.Items))
	assert.Equal(t, RootElement, macro.Context.Root)
	assert.Equal(t, DraftIncomplete, macro.Context.Draft)
	all := f.completeAt(`resource.tags.all(e, e.va` + cursorMark)
	assert.Equal(t, []string{"value"}, labels(all.Items))
	nested := f.completeAt(`resource.tags.exists(t, resource.tags.exists(u, u.` + cursorMark)
	assert.Equal(t, []string{"key", "value"}, labels(nested.Items), "nested macros bind independently")
}

// spec. and spec.con belong to types that have a spec. A cloud type has none,
// so nothing is suggested for it, with or without the resource root.
func TestSpecOnlyOnApplicableTypes(t *testing.T) {
	cloud := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)
	for _, source := range []string{"resource.spec." + cursorMark, "resource.spec.con" + cursorMark, "spec." + cursorMark, "spec.con" + cursorMark, "spec" + cursorMark} {
		response := cloud.completeAt(source)
		assert.Empty(t, response.Items, source)
		assert.Equal(t, CompletionComplete, response.Completion.Kind, "an empty answer is complete, not truncated: %s", source)
	}

	pod := kubernetesFixture(t, "api__v1.json.gz", "io.k8s.api.core.v1.Pod")
	spec := pod.completeAt("resource.spec." + cursorMark)
	specFields := byLabel(spec.Items)
	require.Contains(t, specFields, "containers")
	assert.Equal(t, "required", specFields["containers"].Presence)
	assert.NotContains(t, specFields, "replicas", "a pod spec has no replicas")

	con := pod.completeAt("resource.spec.con" + cursorMark)
	assert.Equal(t, []string{"containers"}, labels(con.Items))
	assert.Equal(t, "con", con.Context.Prefix)

	// The same prefix without its root is rewritten under resource.
	rootless := pod.completeAt("spec.con" + cursorMark)
	require.Equal(t, []string{"containers"}, labels(rootless.Items))
	assert.Equal(t, RootImplicit, rootless.Context.Root)
	assert.Equal(t, Edit{Start: 0, End: 8, Unit: UnitUTF8Byte, Text: "resource.spec.containers"}, rootless.Items[0].Edit)
	assert.True(t, rootless.Items[0].Rootless)
	tier := pod.completeAt("spec." + cursorMark)
	assert.Contains(t, labels(tier.Items), "containers")
	assert.Contains(t, labels(tier.Items), "nodeName")
	bare := pod.completeAt("spec" + cursorMark)
	assert.Equal(t, []string{"spec"}, labels(bare.Items), "only fields that start with the typed prefix")
	assert.Contains(t, labels(bare.Items), "spec", "a typed top-level field offers its rooted form")
	assert.Equal(t, "resource.spec", byLabel(bare.Items)["spec"].Edit.Text)

	deployment := kubernetesFixture(t, "apis__apps__v1.json.gz", "io.k8s.api.apps.v1.Deployment")
	replicas := deployment.completeAt("resource.spec.rep" + cursorMark)
	assert.Equal(t, []string{"replicas"}, labels(replicas.Items))
	assert.Equal(t, "static", replicas.Items[0].Checking, "int32 maps to CEL int")
	template := deployment.completeAt("resource.spec.template.spec.con" + cursorMark)
	assert.Equal(t, []string{"containers"}, labels(template.Items))
}

func TestNestedCloudFieldsMapsAndQuotedNames(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)

	network := f.completeAt("resource.network." + cursorMark)
	assert.Equal(t, []string{"ipv6", "subnets", "vpc"}, labels(network.Items))
	assert.Equal(t, [3]string{"dynamic", "yes", "optional"}, [3]string{byLabel(network.Items)["ipv6"].Checking, byLabel(network.Items)["ipv6"].Nullable, byLabel(network.Items)["ipv6"].Presence})
	require.Len(t, network.Context.Ancestors, 1)
	assert.Equal(t, "optional", network.Context.Ancestors[0].Presence, "network is optional, so a predicate below it needs a presence guard")

	// A nullable nested object: the schema is retained below the dyn boundary and
	// the nullable ancestor is reported, not hidden.
	ipv6 := f.completeAt("resource.network.ipv6." + cursorMark)
	assert.Equal(t, []string{"cidr"}, labels(ipv6.Items))
	assert.Equal(t, "dynamic", ipv6.Items[0].Checking, "below a nullable object CEL checking is dynamic")
	require.Len(t, ipv6.Context.Ancestors, 2)
	assert.Equal(t, "yes", ipv6.Context.Ancestors[1].Nullable)
	assert.Equal(t, "optional", ipv6.Context.Ancestors[1].Presence)

	volumes := f.completeAt("resource.volumes[0]." + cursorMark)
	assert.Equal(t, []string{"device", "sizeGiB"}, labels(volumes.Items))
	assert.Equal(t, "static", byLabel(volumes.Items)["sizeGiB"].Checking, "int64 format maps to CEL int")

	// A tag MAP names no keys: observed-key discovery fills them, not the schema.
	tags := f.completeAt("resource.tags." + cursorMark)
	assert.Equal(t, "dynamic", tags.Context.Keys)
	assert.Empty(t, kindsOf(tags.Items, KindField))
	assert.Equal(t, []string{"size"}, labels(tags.Items))
	index := f.completeAt("resource.tags[" + cursorMark)
	assert.Equal(t, ContextIndex, index.Context.Kind)
	assert.Equal(t, "dynamic", index.Context.Keys)
	assert.Empty(t, index.Items)
	value := f.completeAt(`resource.tags["env"].` + cursorMark)
	assert.Equal(t, []string{"contains", "endsWith", "matches", "size", "startsWith"}, sorted(labels(value.Items)), "a map value is a string")

	// A name CEL cannot select (non-ASCII, punctuation, or one of true, false,
	// null, in) cannot be indexed on a typed object either, so the edit wraps the
	// parent in dyn() and replaces the dot with it.
	quoted := f.completeAt("resource." + cursorMark)
	items := byLabel(quoted.Items)
	assert.Equal(t, Edit{Start: 0, End: 9, Unit: UnitUTF8Byte, Text: `dyn(resource)["name-with-dash"]`}, items["name-with-dash"].Edit)
	assert.Equal(t, `dyn(resource)["in"]`, items["in"].Edit.Text)
	assert.Equal(t, `dyn(resource)["雪"]`, items["雪"].Edit.Text)
	assert.Equal(t, "dynamic", items["name-with-dash"].Checking, "reached through dyn(), the access is checked dynamically")
	assert.Equal(t, "static", items["id"].Checking)
	assert.Equal(t, "id", items["id"].Edit.Text)
	typed := f.completeAt("resource.name" + cursorMark)
	assert.Equal(t, []string{"name-with-dash"}, labels(typed.Items))
	assert.Equal(t, Edit{Start: 0, End: 13, Unit: UnitUTF8Byte, Text: `dyn(resource)["name-with-dash"]`}, typed.Items[0].Edit, "the parent, the dot and the typed prefix are replaced together")
	cjk := f.completeAt("resource.雪" + cursorMark)
	assert.Equal(t, []string{"雪"}, labels(cjk.Items))
	assert.Equal(t, Edit{Start: 0, End: 12, Unit: UnitUTF8Byte, Text: `dyn(resource)["雪"]`}, cjk.Items[0].Edit, "CJK is three bytes")
	// CEL's other reserved words are ordinary selectors.
	reserved := newFixture(t, "reserved", draft2020, `{"type":"object","properties":{"namespace":{"type":"string"},"if":{"type":"string"},"var":{"type":"string"}}}`)
	assert.Equal(t, []string{"if", "namespace", "var"}, labels(reserved.completeAt("resource."+cursorMark).Items))
	assert.Equal(t, "namespace", byLabel(reserved.completeAt("resource.names" + cursorMark).Items)["namespace"].Edit.Text)
	keyword := f.completeAt("resource.i" + cursorMark)
	assert.Equal(t, []string{"id", "in"}, labels(keyword.Items))
}

// Container profile: the lifecycle lives in a nested State object.
func TestContainerStateAndLabels(t *testing.T) {
	f := newFixture(t, "container", draft2020, containerStateSchema)
	state := f.completeAt("resource.State." + cursorMark)
	assert.Equal(t, []string{"ExitCode", "Running", "StartedAt", "Status"}, labels(state.Items))
	byName := byLabel(state.Items)
	assert.Equal(t, "unknown", byName["Status"].Presence, "the catalog reports presence unknown for an any-typed node even when the schema lists it as required")
	assert.Equal(t, "dynamic", byName["Status"].Checking, "an enum without a type is dynamic")
	assert.Contains(t, byName["Status"].Documentation, "Lifecycle status")
	assert.Equal(t, "static", byName["ExitCode"].Checking)
	assert.Equal(t, "yes", byName["StartedAt"].Nullable)
	assert.Equal(t, []PathSegment{{Kind: "field", Name: "State"}}, state.Context.Path)

	prefix := f.completeAt("resource.State.St" + cursorMark)
	assert.Equal(t, []string{"StartedAt", "Status"}, labels(prefix.Items))
	folded := f.completeAt("resource.State.st" + cursorMark)
	assert.Equal(t, []string{"StartedAt", "Status"}, labels(folded.Items), "case-insensitive prefix match")
	assert.Equal(t, 1, matchRankOf(t, "StartedAt", "st"))

	labelKeys := f.completeAt("resource.Labels." + cursorMark)
	assert.Equal(t, "dynamic", labelKeys.Context.Keys)
	names := f.completeAt("resource.Names[0]." + cursorMark)
	assert.Equal(t, []string{"contains", "endsWith", "matches", "size", "startsWith"}, sorted(labels(names.Items)))
}

func matchRankOf(t *testing.T, candidate, prefix string) int {
	t.Helper()
	rank, ok := matchRank(candidate, prefix)
	require.True(t, ok)
	return rank
}

// VM profile: nested hardware with an optional object, a nullable nested object,
// an array of disks and a oneOf boot source.
func TestVMHardwareNestingAndConditionalBranches(t *testing.T) {
	f := newFixture(t, "vm", draft2020, vmHardwareSchema)

	hardware := f.completeAt("resource.hardware." + cursorMark)
	assert.Equal(t, []string{"cpu", "disks", "memory", "nic"}, labels(hardware.Items))
	assert.Contains(t, byLabel(hardware.Items)["cpu"].Documentation, "")
	cpu := f.completeAt("resource.hardware.cpu." + cursorMark)
	assert.Equal(t, []string{"cores", "model", "sockets"}, labels(cpu.Items))
	assert.Equal(t, "required", byLabel(cpu.Items)["cores"].Presence)
	require.Len(t, cpu.Context.Ancestors, 2, "hardware and cpu are both optional")

	disk := f.completeAt("resource.hardware.disks[0]." + cursorMark)
	assert.Equal(t, []string{"bus", "readonly", "sizeGiB"}, labels(disk.Items))
	assert.Equal(t, "partial", byLabel(disk.Items)["sizeGiB"].Checking)

	nic := f.completeAt("resource.hardware.nic." + cursorMark)
	assert.Equal(t, []string{"mac", "model"}, labels(nic.Items))
	var nullable []Ancestor
	for _, ancestor := range nic.Context.Ancestors {
		if ancestor.Nullable == "yes" {
			nullable = append(nullable, ancestor)
		}
	}
	require.Len(t, nullable, 1, "the nullable nic object is reported as a nullable ancestor")
	assert.Equal(t, []PathSegment{{Kind: "field", Name: "hardware"}, {Kind: "field", Name: "nic"}}, nullable[0].Path)

	// oneOf branches: branch fields are conditional and name their branch; the
	// common discriminator field is unconditional.
	boot := f.completeAt("resource.boot." + cursorMark)
	assert.Equal(t, []string{"disk", "kind", "url"}, labels(boot.Items))
	bootFields := byLabel(boot.Items)
	assert.Equal(t, "unconditional", bootFields["kind"].Applicability)
	for _, name := range []string{"disk", "url"} {
		field := bootFields[name]
		assert.Equal(t, "conditional", field.Applicability, name)
		assert.Equal(t, "dynamic", field.Checking, "union members are dyn in CEL, and the schema detail is still reported: %s", name)
		require.Len(t, field.Conditions, 1, name)
		assert.Equal(t, "oneOf", field.Conditions[0].Combinator)
	}
	assert.NotEqual(t, bootFields["disk"].Conditions[0].Branch, bootFields["url"].Conditions[0].Branch)
	assert.Equal(t, bootFields["disk"].Conditions[0].Pointer, bootFields["url"].Conditions[0].Pointer, "both name the same union node")
}

// A discriminator comparison written earlier in the expression is not flow-
// sensitive narrowing: CEL does not narrow on it, so the suggestions keep their
// conditional applicability and dynamic checking.
func TestDiscriminatorComparisonDoesNotNarrow(t *testing.T) {
	f := newFixture(t, "vm", draft2020, vmHardwareSchema)
	plain := f.completeAt("resource.boot." + cursorMark)
	guarded := f.completeAt(`resource.boot.kind == "disk" && resource.boot.` + cursorMark)
	assert.Equal(t, labels(plain.Items), labels(guarded.Items))
	for i, item := range guarded.Items {
		assert.Equal(t, plain.Items[i].Applicability, item.Applicability, item.Label)
		assert.Equal(t, plain.Items[i].Checking, item.Checking, item.Label)
		assert.Equal(t, plain.Items[i].Conditions, item.Conditions, item.Label)
	}
	assert.Equal(t, "conditional", byLabel(guarded.Items)["url"].Applicability, "the network branch field stays visible and conditional")
}

// The SDK corpus's OpenAPI hypervisor schema: anyOf placement, exclusive oneOf,
// allOf with $ref, int-or-string and preserved unknown fields.
func TestHypervisorOpenAPIConditionalAndAllOf(t *testing.T) {
	b := inline(openAPI30, hypervisorOpenAPIVMSchema)
	b.root = "#/components/schemas/VM"
	f := newFixtureFrom(t, "vm", b)

	placement := f.completeAt("resource.placement." + cursorMark)
	assert.Equal(t, []string{"cores", "pool", "sizeGiB"}, labels(placement.Items))
	fields := byLabel(placement.Items)
	assert.Equal(t, "unconditional", fields["pool"].Applicability)
	assert.Equal(t, "required", fields["pool"].Presence)
	for _, name := range []string{"cores", "sizeGiB"} {
		assert.Equal(t, "conditional", fields[name].Applicability, name)
		require.Len(t, fields[name].Conditions, 1)
		assert.Equal(t, "anyOf", fields[name].Conditions[0].Combinator)
	}
	assert.NotEqual(t, fields["cores"].Conditions[0].Branch, fields["sizeGiB"].Conditions[0].Branch)

	network := f.completeAt("resource.network." + cursorMark)
	assert.Equal(t, []string{"bridge", "mode"}, labels(network.Items), "allOf with a $ref resolves to the referenced schema")
	extra := f.completeAt("resource.extra." + cursorMark)
	assert.Empty(t, kindsOf(extra.Items, KindField), "preserved unknown fields name no members")
	nics := f.completeAt("resource.nics[0]." + cursorMark)
	assert.Equal(t, []string{"mac", "model"}, labels(nics.Items))
	description := f.completeAt("resource.description " + cursorMark)
	assert.Contains(t, labels(description.Items), "== null", "OpenAPI nullable allows null tests")
}

// The completion of a path never depends on the cursor being at the end.
func TestMemberCompletionInTheMiddleOfAnExpression(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)

	middle := f.completeAt(`resource.re` + cursorMark + `gion == "us-west-2" && resource.id == "x"`)
	assert.Equal(t, []string{"region"}, labels(middle.Items))
	assert.Equal(t, "re", middle.Context.Prefix, "the filter is the text before the cursor")
	assert.Equal(t, Range{Start: 9, End: 15, Unit: UnitUTF8Byte}, middle.Context.Replace, "the replaced token includes the text after the cursor")
	source, _ := split(t, `resource.re`+cursorMark+`gion == "us-west-2" && resource.id == "x"`)
	applied, err := ApplyEdit(source, middle.Items[0].Edit)
	require.NoError(t, err)
	assert.Equal(t, `resource.region == "us-west-2" && resource.id == "x"`, applied)

	later := f.completeAt(`resource.id == "x" && resource.ta` + cursorMark + ` || resource.id == "y"`)
	assert.Equal(t, []string{"tags"}, labels(later.Items))
	assert.Equal(t, ContextMember, later.Context.Kind)

	// An unparsable earlier clause does not prevent completion in this one.
	broken := f.completeAt(`resource.id = = && resource.re` + cursorMark)
	assert.Equal(t, []string{"region"}, labels(broken.Items))
	assert.Equal(t, DraftIncomplete, broken.Context.Draft)
	unbalanced := f.completeAt(`(resource.id == "x" && (resource.re` + cursorMark)
	assert.Equal(t, []string{"region"}, labels(unbalanced.Items))
	negated := f.completeAt(`!has(resource.de` + cursorMark + `)`)
	assert.Equal(t, []string{"description"}, labels(negated.Items))
	commented := f.completeAt("resource.id == \"x\" // note\n&& resource.re" + cursorMark)
	assert.Equal(t, []string{"region"}, labels(commented.Items))
	inComment := f.completeAt("resource.id == \"x\" // resource.re" + cursorMark)
	assert.Empty(t, inComment.Items, "a comment is not an expression")
	assert.Equal(t, ContextNone, inComment.Context.Kind)
}

// With no schema the type is dynamic and no field can be named; the response
// says so instead of inventing members.
func TestAbsentSchemaCompletesDynamically(t *testing.T) {
	f := newFixtureFrom(t, "absent", binding{state: "absent"})
	assert.Equal(t, "dynamic", f.summary.HostEvaluation)
	response := f.completeAt("resource." + cursorMark)
	assert.Empty(t, response.Items)
	assert.Equal(t, "absent", response.Schema.State)
	assert.Equal(t, "none", response.Schema.Validation)
	assert.Equal(t, CompletionComplete, response.Completion.Kind)
	root := f.completeAt("res" + cursorMark)
	assert.Equal(t, []string{"resource"}, labels(root.Items))
	unavailable := newFixtureFrom(t, "unavailable", binding{state: "unavailable", reason: "FORBIDDEN"})
	assert.Equal(t, "unavailable", unavailable.summary.HostEvaluation)
	assert.Equal(t, "FORBIDDEN", unavailable.summary.HostEvaluationCode)
	assert.Empty(t, unavailable.completeAt("resource."+cursorMark).Items)
}

func TestTypeSpecificMemberMethods(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)
	str := f.completeAt("resource.id." + cursorMark)
	assert.Equal(t, []string{"contains", "endsWith", "matches", "size", "startsWith"}, sorted(labels(str.Items)))
	assert.Equal(t, `startsWith("")`, byLabel(str.Items)["startsWith"].Edit.Text)
	assert.Equal(t, &Range{Start: 12, End: 12, Unit: UnitUTF8Byte}, byLabel(str.Items)["startsWith"].Edit.Selection, "the caret sits between the quotes")
	tags := f.completeAt("resource.tags." + cursorMark)
	assert.Equal(t, []string{"all", "exists", "exists_one", "size"}, sorted(labels(tags.Items)))
	assert.Equal(t, "exists(e, )", byLabel(tags.Items)["exists"].Edit.Text)
	integer := f.completeAt("resource.sizeBytes." + cursorMark)
	assert.Empty(t, integer.Items, "an integer has no members and no methods")
	prefix := f.completeAt("resource.id.sta" + cursorMark)
	assert.Equal(t, []string{"startsWith"}, labels(prefix.Items))
	size := f.completeAt("resource.tags.size()." + cursorMark)
	assert.Empty(t, size.Items, "size() is an integer")
}

func TestCompletionNeverNamesMembersOutsideTheSchema(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)
	for _, source := range []string{
		"resource.nonexistent." + cursorMark,
		"resource.network.nonexistent." + cursorMark,
		"resource.tags[0]." + cursorMark, // tags is a map: an integer index names no field
		"resource.id[0]." + cursorMark,
	} {
		response := f.completeAt(source)
		assert.Empty(t, kindsOf(response.Items, KindField), source)
	}
	closed := f.completeAt("resource.network.vpc.sub" + cursorMark)
	assert.Empty(t, closed.Items)
	assert.True(t, strings.HasPrefix(closed.Context.Kind, "member"))
}
