package resourceauthoring

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
)

var (
	comparisons = []string{"==", "!=", "<", "<=", ">", ">=", "in"}
	stringCalls = []string{"startsWith", "endsWith", "contains", "matches", "size"}
	macros      = []string{"exists", "all", "exists_one"}
)

func concat(lists ...[]string) []string {
	var out []string
	for _, list := range lists {
		out = append(out, list...)
	}
	return out
}

func mustApply(t *testing.T, source string, edit Edit) string {
	t.Helper()
	out, err := ApplyEdit(source, edit)
	require.NoError(t, err)
	return out
}

// Types govern operators: a string offers string calls, an integer does not;
// null tests exist only where the schema allows null.
func TestOperatorsFollowTheOperandType(t *testing.T) {
	cloud := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)
	nested := newFixture(t, "nested", draft2020, cloudNestedSchema)
	vm := newFixture(t, "vm", draft2020, vmHardwareSchema)
	state := newFixture(t, "container", draft2020, containerStateSchema)

	cases := []struct {
		name   string
		f      *fixture
		source string
		want   []string
	}{
		{"required string", cloud, "resource.region ", concat(comparisons, stringCalls, []string{"has"})},
		{"integer without format", cloud, "resource.sizeBytes ", concat(comparisons, []string{"has"})},
		{"date-time", cloud, "resource.createdAt ", []string{"==", "!=", "<", "<=", ">", ">=", "has"}},
		{"nullable string", cloud, "resource.description ", concat(comparisons, []string{"== null", "!= null"}, stringCalls, []string{"has"})},
		{"array of objects", cloud, "resource.tags ", concat([]string{"size"}, macros, []string{"has"})},
		{"map", nested, "resource.tags ", []string{"size", "has"}},
		{"boolean", state, "resource.State.Running ", []string{"==", "!=", "in", "has", "&&", "||"}},
		{"int32 integer", state, "resource.State.ExitCode ", concat(comparisons, []string{"has"})},
		{"nullable date-time", state, "resource.State.StartedAt ", []string{"==", "!=", "<", "<=", ">", ">=", "== null", "!= null", "has"}},
		{"struct", state, "resource.State ", []string{"has"}},
		{"nullable struct", vm, "resource.hardware.nic ", []string{"== null", "!= null", "has"}},
		{"enum without a declared type takes its members' type", nested, "resource.state ", concat(comparisons, stringCalls, []string{"has"})},
		{"array element string", nested, "resource.network.subnets[0] ", concat(comparisons, stringCalls)},
		{"element variable", cloud, "resource.tags.exists(t, t.key ", concat(comparisons, stringCalls, []string{"has"})},
		{"size result is an integer", cloud, "resource.tags.size() ", comparisons},
		{"a map value is not selectable by has", nested, `resource.tags["env"] `, concat(comparisons, stringCalls)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			response := tc.f.completeAt(tc.source + cursorMark)
			assert.Equal(t, ContextOperator, response.Context.Kind)
			assert.ElementsMatch(t, tc.want, labels(response.Items))
			for _, item := range response.Items {
				assert.NotEmpty(t, item.Arity, item.Label)
				assert.NotEmpty(t, item.Documentation, item.Label)
			}
		})
	}
}

// After a complete clause only a connective can follow; after a bare boolean
// field both a connective and a comparison are valid.
func TestConnectivesFollowCompleteClauses(t *testing.T) {
	f := newFixture(t, "container", draft2020, containerStateSchema)
	for _, source := range []string{
		`resource.State.Status == "running" `,
		`resource.State.ExitCode > 1 `,
		`resource.State.Status == resource.Id `,
		`resource.State.Status in ["running"] `,
		`resource.State.Running == true `,
		`resource.Names.exists(n, n == "a") `,
		`(resource.State.Status == "running") `,
		`resource.Names[0].startsWith("a") `,
	} {
		response := f.completeAt(source + cursorMark)
		assert.Equal(t, []string{"&&", "||"}, labels(response.Items), source)
		for _, item := range response.Items {
			assert.Equal(t, ArityLogic, item.Arity)
		}
	}
	after := f.completeAt(`resource.State.Running && resource.State.Running ` + cursorMark)
	assert.Contains(t, labels(after.Items), "&&", "a bare boolean clause may be joined")
	assert.Contains(t, labels(after.Items), "==")
	negated := f.completeAt(`!resource.State.Running ` + cursorMark)
	assert.Contains(t, labels(negated.Items), "||")
}

func TestOperatorEditsCarrySpacingAndOperandPlaceholders(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)

	spaced := f.completeAt("resource.region " + cursorMark)
	equal := byLabel(spaced.Items)["=="]
	assert.Equal(t, Edit{Start: 16, End: 16, Unit: UnitUTF8Byte, Text: `== ""`, Selection: &Range{Start: 4, End: 4, Unit: UnitUTF8Byte}}, equal.Edit, "a string operand is a pair of quotes with the caret between them")

	touching := f.completeAt("resource.region" + cursorMark)
	assert.Equal(t, ContextMember, touching.Context.Kind, "directly after a word the cursor is in the member, not after the operand")

	// Types without a safe empty literal leave the caret after the operator.
	integer := f.completeAt("resource.sizeBytes " + cursorMark)
	less := byLabel(integer.Items)["<"]
	assert.Equal(t, "< ", less.Edit.Text)
	assert.Equal(t, &Range{Start: 2, End: 2, Unit: UnitUTF8Byte}, less.Edit.Selection)
	timestamp := f.completeAt("resource.createdAt " + cursorMark)
	assert.Equal(t, `> timestamp("")`, byLabel(timestamp.Items)[">"].Edit.Text)
	assert.Equal(t, &Range{Start: 13, End: 13, Unit: UnitUTF8Byte}, byLabel(timestamp.Items)[">"].Edit.Selection)
	in := byLabel(spaced.Items)["in"]
	assert.Equal(t, "in []", in.Edit.Text)
	assert.Equal(t, &Range{Start: 4, End: 4, Unit: UnitUTF8Byte}, in.Edit.Selection)

	// Method edits consume the gap and add the dot.
	starts := byLabel(spaced.Items)["startsWith"]
	assert.Equal(t, Edit{Start: 15, End: 16, Unit: UnitUTF8Byte, Text: `.startsWith("")`, Selection: &Range{Start: 13, End: 13, Unit: UnitUTF8Byte}}, starts.Edit)
	assert.Equal(t, "resource.region.startsWith(\"\")", mustApply(t, "resource.region ", starts.Edit))

	// The unary presence form replaces the whole operand clause.
	has := byLabel(spaced.Items)["has"]
	assert.Equal(t, Edit{Start: 0, End: 16, Unit: UnitUTF8Byte, Text: "has(resource.region)", Selection: &Range{Start: 20, End: 20, Unit: UnitUTF8Byte}}, has.Edit)
	assert.Equal(t, ArityState, has.Arity)

	// Null tests are fixed text.
	nullable := f.completeAt("resource.description " + cursorMark)
	assert.Equal(t, "== null", byLabel(nullable.Items)["== null"].Edit.Text)

	// Directly after an operand the edit supplies the separating space.
	joined := f.completeAt(`resource.id == "x"` + cursorMark)
	require.Equal(t, []string{"&&", "||"}, labels(joined.Items))
	assert.Equal(t, " && ", joined.Items[0].Edit.Text)
	assert.Equal(t, `resource.id == "x" && `, mustApply(t, `resource.id == "x"`, joined.Items[0].Edit))
	macro := f.completeAt(`resource.tags.exists(t, t.key == "a")` + cursorMark)
	assert.Equal(t, []string{"&&", "||"}, labels(macro.Items), "an exists() result is a complete boolean clause")
}

// An operator is retyped before an operand that already exists: no placeholder.
func TestRetypedOperatorKeepsTheExistingOperand(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)

	source, cursor := split(t, `resource.region =`+cursorMark+`= "x"`)
	response, err := Complete(t.Context(), f.input(source, cursor))
	require.NoError(t, err)
	require.Equal(t, ContextOperator, response.Context.Kind)
	assert.Equal(t, Range{Start: 16, End: 18, Unit: UnitUTF8Byte}, response.Context.Replace, "the whole == token is replaced")
	assert.Equal(t, []string{"=="}, labels(response.Items))
	assert.Equal(t, `resource.region == "x"`, mustApply(t, source, response.Items[0].Edit))

	source, cursor = split(t, `resource.region !`+cursorMark+`= "x"`)
	response, err = Complete(t.Context(), f.input(source, cursor))
	require.NoError(t, err)
	require.Equal(t, []string{"!="}, labels(response.Items))
	assert.Equal(t, `resource.region != "x"`, mustApply(t, source, response.Items[0].Edit))

	// An empty slot still gets the placeholder.
	source, cursor = split(t, `resource.region =`+cursorMark)
	response, err = Complete(t.Context(), f.input(source, cursor))
	require.NoError(t, err)
	assert.Equal(t, `resource.region == ""`, mustApply(t, source, response.Items[0].Edit))
}

func TestPartialOperators(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)
	cases := []struct {
		typed string
		want  []string
	}{
		{"=", []string{"=="}},
		{"!", []string{"!="}},
		{"in", []string{"in"}},
		{"i", []string{"in"}},
		{"sta", []string{"startsWith"}},
		{"con", []string{"contains"}},
		{"has", []string{"has"}},
	}
	for _, tc := range cases {
		t.Run(tc.typed, func(t *testing.T) {
			response := f.completeAt("resource.region " + tc.typed + cursorMark)
			assert.Equal(t, ContextOperator, response.Context.Kind)
			assert.Equal(t, tc.typed, response.Context.Prefix)
			assert.Equal(t, tc.want, labels(response.Items))
			assert.Equal(t, Range{Start: 16, End: 16 + len(tc.typed), Unit: UnitUTF8Byte}, response.Context.Replace)
		})
	}
	// "<" is a complete operator: the cursor after it is a value position.
	assert.Equal(t, ContextValue, f.completeAt("resource.region <"+cursorMark).Context.Kind)

	logical := f.completeAt(`resource.region == "x" &` + cursorMark)
	assert.Equal(t, []string{"&&"}, labels(logical.Items))
	either := f.completeAt(`resource.region == "x" |` + cursorMark)
	assert.Equal(t, []string{"||"}, labels(either.Items))
	andNext := f.completeAt(`resource.region == "x" && ` + cursorMark)
	assert.Equal(t, ContextExpression, andNext.Context.Kind)
	not := f.completeAt(`!` + cursorMark)
	assert.Equal(t, ContextExpression, not.Context.Kind, "a leading ! is a unary not, not a partial !=")
	assert.Contains(t, labels(not.Items), "resource")
}

func TestExpressionPositionOffersRootParametersAndVariables(t *testing.T) {
	f := newFixture(t, "compute/instance", draft2020, cloudFlatSchema)
	declarations := map[string]query.BindingType{
		"region": {Kind: "string"},
		"cap":    {Kind: "int64"},
		"names":  {Kind: "list", Element: &query.BindingType{Kind: "string"}},
	}

	start := f.completeAt(cursorMark, withDeclarations(declarations))
	assert.Equal(t, ContextExpression, start.Context.Kind)
	assert.Equal(t, []string{"resource", "cap", "names", "region", "has"}, labels(start.Items), "no top-level field is listed for an empty prefix")
	params := byLabel(start.Items)
	assert.Equal(t, KindParameter, params["names"].Kind)
	assert.Equal(t, "list<string>", params["names"].Detail)
	assert.Equal(t, "string", params["region"].Detail)
	assert.Equal(t, "has()", params["has"].Edit.Text)
	assert.Equal(t, &Range{Start: 4, End: 4, Unit: UnitUTF8Byte}, params["has"].Edit.Selection)

	// A parameter and a document field with one name are both offered, told apart by what they insert.
	prefixed := f.completeAt("re"+cursorMark, withDeclarations(declarations))
	inserted := map[string]string{}
	for _, item := range prefixed.Items {
		inserted[item.Kind+":"+item.Label] = item.Edit.Text
	}
	assert.Equal(t, map[string]string{"root:resource": "resource", "parameter:region": "region", "field:region": "resource.region"}, inserted)

	scoped := f.completeAt(`resource.tags.exists(t, `+cursorMark, withDeclarations(declarations))
	assert.Equal(t, KindVariable, byLabel(scoped.Items)["t"].Kind)
	afterAnd := f.completeAt(`resource.id == "x" && `+cursorMark, withDeclarations(declarations))
	assert.Contains(t, labels(afterAnd.Items), "resource")
	insideHas := f.completeAt(`has(`+cursorMark, withDeclarations(declarations))
	assert.Contains(t, labels(insideHas.Items), "resource")
	closed := f.completeAt(`resource.tags.exists(t, true) && `+cursorMark, withDeclarations(declarations))
	assert.NotContains(t, labels(closed.Items), "t", "the macro variable ends with its call")
}

// Values: enum members, booleans, null and compatible parameters by operand type.
func TestValuesFollowTheOperandType(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)
	declarations := map[string]query.BindingType{
		"want":  {Kind: "string"},
		"limit": {Kind: "int64"},
		"on":    {Kind: "bool"},
		"when":  {Kind: "timestamp"},
		"maybe": {Kind: "nullable", Value: &query.BindingType{Kind: "string"}},
	}

	state := f.completeAt(`resource.state == `+cursorMark, withDeclarations(declarations))
	assert.Equal(t, ContextValue, state.Context.Kind)
	assert.Equal(t, []string{"pending", "running", "stopped", "maybe", "want"}, labels(state.Items), "string enum members, then compatible parameters; null is not an enum member")
	assert.Equal(t, `"running"`, byLabel(state.Items)["running"].Edit.Text)
	assert.Equal(t, KindEnumValue, byLabel(state.Items)["running"].Kind)
	assert.Equal(t, KindParameter, byLabel(state.Items)["want"].Kind)
	assert.Equal(t, Range{Start: 18, End: 18, Unit: UnitUTF8Byte}, state.Context.Replace)
	assert.Equal(t, "dynamic", byLabel(state.Items)["running"].Checking, "checking is the catalog's: an untyped enum is dyn")

	level := f.completeAt(`resource.level == `+cursorMark, withDeclarations(declarations))
	assert.Equal(t, []string{"1", "2", "3", "limit"}, labels(level.Items), "int64 enum members, then compatible parameters")
	assert.Equal(t, "1", byLabel(level.Items)["1"].Edit.Text)
	code := f.completeAt(`resource.code != `+cursorMark, withDeclarations(declarations))
	assert.Equal(t, []string{"200", "404"}, labels(code.Items), "an int parameter does not compare with a uint field")
	assert.Equal(t, "200u", byLabel(code.Items)["200"].Edit.Text, "a CEL uint literal needs its suffix")
	ratio := f.completeAt(`resource.ratio == ` + cursorMark)
	assert.Equal(t, []string{"0.5", "1"}, labels(ratio.Items))
	assert.Equal(t, "0.5", byLabel(ratio.Items)["0.5"].Edit.Text)

	flag := f.completeAt(`resource.flag == `+cursorMark, withDeclarations(declarations))
	assert.Equal(t, []string{"true", "false", "on"}, labels(flag.Items))
	assert.Equal(t, KindLiteral, byLabel(flag.Items)["true"].Kind)
	partial := f.completeAt(`resource.flag == tr` + cursorMark)
	assert.Equal(t, []string{"true"}, labels(partial.Items))
	assert.Equal(t, Range{Start: 17, End: 19, Unit: UnitUTF8Byte}, partial.Context.Replace)

	// Null is offered where the schema allows it; an enum offers it only if it lists null.
	priority := f.completeAt(`resource.priority == ` + cursorMark)
	assert.Equal(t, []string{"low", "high", "null"}, labels(priority.Items))
	assert.Equal(t, []string{"null"}, labels(f.completeAt(`resource.note == `+cursorMark).Items))
	assert.Empty(t, f.completeAt(`resource.id == `+cursorMark).Items, "a plain string has no known values and no null")
	assert.Empty(t, f.completeAt(`resource.flag != ` + cursorMark).Items[:0])

	// A parameter of another type is never suggested.
	for _, item := range f.completeAt(`resource.id == `+cursorMark, withDeclarations(declarations)).Items {
		assert.Contains(t, []string{"want", "maybe"}, item.Label)
	}
	created := newFixture(t, "compute/instance", draft2020, cloudFlatSchema).completeAt(`resource.createdAt > `+cursorMark, withDeclarations(declarations))
	assert.Equal(t, []string{"when"}, labels(created.Items))
}

func TestValueSlotInStringsAndLists(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)

	inString := f.completeAt(`resource.state == "ru` + cursorMark + `"`)
	assert.Equal(t, []string{"running"}, labels(inString.Items))
	assert.Equal(t, "ru", inString.Context.Prefix)
	assert.Equal(t, Range{Start: 18, End: 22, Unit: UnitUTF8Byte}, inString.Context.Replace, "a terminated literal is replaced whole, quotes included")
	assert.Equal(t, `"running"`, inString.Items[0].Edit.Text)

	empty := f.completeAt(`resource.state == "` + cursorMark + `"`)
	assert.Equal(t, []string{"pending", "running", "stopped"}, labels(empty.Items))
	single := f.completeAt(`resource.state == 'p` + cursorMark)
	assert.Equal(t, []string{"pending"}, labels(single.Items))
	assert.Equal(t, `"pending"`, single.Items[0].Edit.Text, "single quotes are normalized to the double-quoted form")

	list := f.completeAt(`resource.state in [` + cursorMark)
	assert.Equal(t, ContextValue, list.Context.Kind)
	assert.Equal(t, []string{"pending", "running", "stopped"}, labels(list.Items))
	second := f.completeAt(`resource.state in ["pending", "r` + cursorMark)
	assert.Equal(t, []string{"running"}, labels(second.Items))
	third := f.completeAt(`resource.state in ["pending", ` + cursorMark)
	assert.Len(t, third.Items, 3)

	// A string literal in a numeric position takes nothing from a numeric enum.
	assert.Empty(t, f.completeAt(`resource.level == "`+cursorMark).Items)

	// The left operand may be an element variable; a plain string has no schema values.
	assert.Empty(t, f.completeAt(`resource.network.subnets.exists(s, s == "`+cursorMark).Items)

	// Escapes in the typed prefix decode before matching.
	escaped := f.completeAt(`resource.state == "\u0072u` + cursorMark)
	assert.Equal(t, "ru", escaped.Context.Prefix)
	assert.Equal(t, []string{"running"}, labels(escaped.Items))
	dangling := f.completeAt(`resource.state == "ru\` + cursorMark)
	assert.Equal(t, "ru", dangling.Context.Prefix, "a cursor inside an escape yields the text before it")
}

func TestIndexPositionNamesFieldsOfObjectsOnly(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)
	keys := f.completeAt(`resource.network["` + cursorMark)
	assert.Equal(t, ContextIndex, keys.Context.Kind)
	assert.Equal(t, []string{"ipv6", "subnets", "vpc"}, labels(keys.Items))
	assert.Equal(t, `resource.network.vpc`, byLabel(keys.Items)["vpc"].Edit.Text, "a typed object cannot be indexed: the access is rewritten to the form that checks")
	assert.Equal(t, 0, byLabel(keys.Items)["vpc"].Edit.Start, "from the start of the operand")
	assert.Equal(t, Range{Start: 17, End: 18, Unit: UnitUTF8Byte}, keys.Context.Replace, "an unterminated quote is replaced with the complete literal")

	typed := f.completeAt(`resource.network["su` + cursorMark + `bnets"]`)
	assert.Equal(t, []string{"subnets"}, labels(typed.Items))
	assert.Equal(t, `resource.network.subnets`, typed.Items[0].Edit.Text)

	// A quoted segment resolves like a member.
	chained := f.completeAt(`resource["network"].s` + cursorMark)
	assert.Equal(t, []string{"subnets"}, labels(chained.Items))
	deep := f.completeAt(`resource["network"]["ipv6"].` + cursorMark)
	assert.Equal(t, []string{"cidr"}, labels(deep.Items))

	// Maps and arrays name no keys.
	assert.Empty(t, f.completeAt(`resource.tags["`+cursorMark).Items)
	assert.Equal(t, "dynamic", f.completeAt(`resource.tags["`+cursorMark).Context.Keys)
	assert.Empty(t, f.completeAt(`resource.volumes[`+cursorMark).Items)
}
