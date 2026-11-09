package resourceauthoring

import (
	"fmt"
	"strings"
	"testing"

	"cel.dev/cel-go/cel"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
)

// The suggestions' checking labels are claims about the CEL checker. These tests
// do not trust them: every suggested path is compiled with the production
// catalog-backed CEL environment (celtypes, the same mapping the query compiler
// uses) and the label is compared with what the checker actually does.

func celType(b query.BindingType) *cel.Type {
	switch b.Kind {
	case "bool":
		return cel.BoolType
	case "string":
		return cel.StringType
	case "int64":
		return cel.IntType
	case "uint64":
		return cel.UintType
	case "double":
		return cel.DoubleType
	case "timestamp":
		return cel.TimestampType
	case "list":
		return cel.ListType(celType(*b.Element))
	case "map":
		return cel.MapType(cel.StringType, celType(*b.Value))
	case "nullable":
		return celType(*b.Value)
	}
	return cel.DynType
}

func (f *fixture) celEnv(declarations map[string]query.BindingType) *cel.Env {
	f.t.Helper()
	options := append([]cel.EnvOption{}, f.env.Options...)
	options = append(options, cel.CrossTypeNumericComparisons(true), cel.ParserRecursionLimit(64), cel.ParserExpressionSizeLimit(16384))
	for name, typ := range declarations {
		options = append(options, cel.Variable(name, celType(typ)))
	}
	env, err := cel.NewEnv(options...)
	require.NoError(f.t, err)
	return env
}

func compiles(env *cel.Env, expression string) (*cel.Ast, bool) {
	ast, issues := env.Compile(expression)
	return ast, issues == nil || issues.Err() == nil
}

type observed struct {
	dyn        bool
	openStruct bool
	dynElement bool
	rejects    bool // some wrongly typed use fails to check
}

// observe asks the checker what it knows about expression.
func observe(env *cel.Env, expression string) (observed, bool) {
	ast, ok := compiles(env, expression)
	if !ok {
		return observed{}, false
	}
	out := ast.OutputType()
	result := observed{dyn: out.Kind() == cel.DynKind}
	switch out.Kind() {
	case cel.StructKind:
		_, undeclared := compiles(env, expression+".__undeclared__")
		result.openStruct = undeclared
	case cel.ListKind, cel.MapKind:
		for _, parameter := range out.Parameters() {
			if parameter.Kind() == cel.DynKind {
				result.dynElement = true
			}
		}
	}
	_, plusInt := compiles(env, expression+" + 1")
	_, plusString := compiles(env, expression+` + "s"`)
	result.rejects = !plusInt || !plusString
	return result, true
}

// walk completes members breadth first through the tiers of one fixture and
// calls visit with every suggested field and the source that selects it.
func (f *fixture) walk(t *testing.T, limit, depth int, visit func(source string, item Item, context Context)) {
	t.Helper()
	type node struct {
		source string
		depth  int
	}
	queue := []node{{source: "resource.", depth: 0}}
	seen := map[string]bool{}
	completions := 0
	for len(queue) > 0 && completions < limit {
		current := queue[0]
		queue = queue[1:]
		response := f.completeAt(current.source + cursorMark)
		completions++
		for _, item := range response.Items {
			if item.Kind != KindField {
				continue
			}
			selected := mustApply(t, current.source, item.Edit)
			if seen[selected] {
				continue
			}
			seen[selected] = true
			visit(selected, item, response.Context)
			if !item.HasChildren || current.depth+1 >= depth {
				continue
			}
			types := strings.Join(item.Type.Names, ",")
			queue = append(queue, node{source: selected + ".", depth: current.depth + 1})
			if strings.Contains(types, "array") {
				queue = append(queue, node{source: selected + "[0].", depth: current.depth + 1})
			}
		}
	}
}

func TestCheckingLabelsMatchTheCELChecker(t *testing.T) {
	hypervisor := inline(openAPI30, hypervisorOpenAPIVMSchema)
	hypervisor.root = "#/components/schemas/VM"
	fixtures := map[string]*fixture{
		"cloud flat":    newFixture(t, "compute/instance", draft2020, cloudFlatSchema),
		"cloud nested":  newFixture(t, "nested", draft2020, cloudNestedSchema),
		"container":     newFixture(t, "container", draft2020, containerStateSchema),
		"vm hardware":   newFixture(t, "vm", draft2020, vmHardwareSchema),
		"hypervisor":    newFixtureFrom(t, "vm", hypervisor),
		"k8s pod":       kubernetesFixture(t, "api__v1.json.gz", "io.k8s.api.core.v1.Pod"),
		"k8s workloads": kubernetesFixture(t, "apis__apps__v1.json.gz", "io.k8s.api.apps.v1.Deployment"),
	}
	total := map[string]int{}
	for name, f := range fixtures {
		t.Run(name, func(t *testing.T) {
			env := f.celEnv(nil)
			f.walk(t, 150, 4, func(source string, item Item, context Context) {
				seen, ok := observe(env, source)
				require.True(t, ok, "%s: a suggested path must check: %s", name, source)
				total[item.Checking]++
				switch item.Checking {
				case "dynamic":
					assert.True(t, seen.dyn, "%s is labelled dynamic but the checker types it: %+v", source, seen)
				case "static":
					assert.False(t, seen.dyn, "%s is labelled static but is dyn", source)
					assert.False(t, seen.openStruct, "%s is labelled static but accepts undeclared members", source)
					// A typed map or list with dyn elements is still a static container:
					// the checker rejects misuse of the container itself. Only its
					// elements are dyn, and their own tier is labelled dynamic.
					assert.True(t, seen.rejects, "%s is labelled static but the checker rejects no misuse", source)
				case "partial":
					assert.True(t, seen.dyn || seen.openStruct || seen.dynElement, "%s is labelled partial but is fully typed and closed: %+v", source, seen)
				default:
					t.Errorf("%s: missing checking label %q", source, item.Checking)
				}
				if item.Applicability == "conditional" {
					assert.Equal(t, "dynamic", item.Checking, "%s: a union member is dyn in CEL", source)
				}
			})
		})
	}
	assert.Positive(t, total["static"], "the walk covered statically checked paths")
	assert.Positive(t, total["partial"], "the walk covered partially checked paths")
	assert.Positive(t, total["dynamic"], "the walk covered dynamically checked paths")
	t.Logf("checked %v suggestions against the CEL checker", total)
}

// Every suggested field edit yields a path the checker accepts, so completion
// never leads a user into a typo the schema would reject.
func TestSuggestedPathsAreValidCEL(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)
	env := f.celEnv(nil)
	response := f.completeAt("resource." + cursorMark)
	for _, item := range response.Items {
		applied := mustApply(t, "resource.", item.Edit)
		_, ok := compiles(env, applied)
		assert.True(t, ok, "%s: %s", item.Label, applied)
	}
	// A name CEL cannot select from a typed object is reached through dyn().
	quoted := mustApply(t, "resource.", byLabel(response.Items)["name-with-dash"].Edit)
	assert.Equal(t, `dyn(resource)["name-with-dash"]`, quoted, "CEL cannot index a typed object, so the access goes through dyn()")
	ast, ok := compiles(env, quoted)
	require.True(t, ok)
	assert.Equal(t, cel.DynKind, ast.OutputType().Kind())
	assert.Equal(t, "dynamic", byLabel(response.Items)["name-with-dash"].Checking, "the access is checked dynamically")
	reserved := mustApply(t, "resource.", byLabel(response.Items)["in"].Edit)
	_, ok = compiles(env, reserved)
	assert.True(t, ok, reserved)
	cjk := mustApply(t, "resource.", byLabel(response.Items)["雪"].Edit)
	_, ok = compiles(env, cjk)
	assert.True(t, ok, cjk)
}

// fill supplies a type-appropriate operand where an operator edit leaves a
// placeholder, so the whole clause can be compiled.
func fill(t *testing.T, source string, item Item, operand Operand) (string, bool) {
	t.Helper()
	applied := mustApply(t, source, item.Edit)
	if item.Edit.Selection == nil {
		return applied, true
	}
	at := item.Edit.Start + item.Edit.Selection.Start
	names := strings.Join(operand.Type.Names, ",")
	var sample string
	switch {
	case item.Arity == ArityLogic:
		sample = "true"
	case item.Label == "in":
		switch {
		case strings.Contains(names, "string"):
			sample = `"x"`
		case strings.Contains(names, "boolean"):
			sample = "true"
		case strings.Contains(operand.Type.Format, "uint"):
			sample = "1u"
		default:
			sample = "1"
		}
	case item.Arity == ArityMethod && item.Kind == KindMacro:
		sample = "true"
	case item.Arity == ArityMethod && item.Label == "size":
		return applied, true
	case item.Arity == ArityMethod:
		sample = "x"
	case item.Arity == ArityState || strings.HasSuffix(item.Label, "null"):
		return applied, true
	case strings.Contains(operand.Type.Format, "date-time"):
		sample = "2026-01-01T00:00:00Z"
	case strings.Contains(names, "string"):
		sample = "x"
	case strings.Contains(names, "boolean"):
		sample = "true"
	case strings.Contains(names, "number"):
		sample = "1.5"
	case strings.Contains(operand.Type.Format, "uint"):
		sample = "1u"
	default:
		sample = "1"
	}
	return applied[:at] + sample + applied[at:], true
}

// Types govern operators: every operator edit, once its operand is supplied,
// is a clause the checker accepts for the operand's declared type.
func TestOperatorEditsCheckAgainstOperandTypes(t *testing.T) {
	hypervisor := inline(openAPI30, hypervisorOpenAPIVMSchema)
	hypervisor.root = "#/components/schemas/VM"
	cases := []struct {
		f       *fixture
		operand string
	}{
		{newFixture(t, "compute/instance", draft2020, cloudFlatSchema), "resource.region"},
		{newFixture(t, "compute/instance", draft2020, cloudFlatSchema), "resource.sizeBytes"},
		{newFixture(t, "compute/instance", draft2020, cloudFlatSchema), "resource.createdAt"},
		{newFixture(t, "compute/instance", draft2020, cloudFlatSchema), "resource.description"},
		{newFixture(t, "compute/instance", draft2020, cloudFlatSchema), "resource.tags"},
		{newFixture(t, "compute/instance", draft2020, cloudFlatSchema), "resource.tags[0].key"},
		{newFixture(t, "nested", draft2020, cloudNestedSchema), "resource.tags"},
		{newFixture(t, "nested", draft2020, cloudNestedSchema), "resource.flag"},
		{newFixture(t, "nested", draft2020, cloudNestedSchema), "resource.level"},
		{newFixture(t, "nested", draft2020, cloudNestedSchema), "resource.code"},
		{newFixture(t, "nested", draft2020, cloudNestedSchema), "resource.state"},
		{newFixture(t, "nested", draft2020, cloudNestedSchema), "resource.network.subnets"},
		{newFixture(t, "container", draft2020, containerStateSchema), "resource.State.Status"},
		{newFixture(t, "container", draft2020, containerStateSchema), "resource.State.ExitCode"},
		{newFixture(t, "container", draft2020, containerStateSchema), "resource.State.StartedAt"},
		{newFixture(t, "vm", draft2020, vmHardwareSchema), "resource.hardware.cpu.cores"},
		{newFixture(t, "vm", draft2020, vmHardwareSchema), "resource.hardware.nic"},
		{newFixture(t, "vm", draft2020, vmHardwareSchema), "resource.hardware.disks"},
		{newFixtureFrom(t, "vm", hypervisor), "resource.console"},
		{newFixtureFrom(t, "vm", hypervisor), "resource.description"},
		{kubernetesFixture(t, "apis__apps__v1.json.gz", "io.k8s.api.apps.v1.Deployment"), "resource.spec.replicas"},
		{kubernetesFixture(t, "apis__apps__v1.json.gz", "io.k8s.api.apps.v1.Deployment"), "resource.spec.template.spec.containers"},
	}
	checked := 0
	for _, tc := range cases {
		t.Run(tc.operand, func(t *testing.T) {
			env := tc.f.celEnv(nil)
			source := tc.operand + " "
			response := tc.f.completeAt(source + cursorMark)
			require.Equal(t, ContextOperator, response.Context.Kind)
			require.NotNil(t, response.Context.Operand)
			require.NotNil(t, response.Context.Operand.Type)
			for _, item := range response.Items {
				if item.Arity == ArityLogic {
					continue
				}
				clause, ok := fill(t, source, item, *response.Context.Operand)
				require.True(t, ok)
				_, valid := compiles(env, clause)
				assert.True(t, valid, "%s %s: %q must check", tc.operand, item.Label, clause)
				checked++
			}
		})
	}
	assert.Greater(t, checked, 150)
}

// Enum members and compatible parameters are values the checker accepts.
func TestValueEditsCheckAgainstOperandTypes(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)
	declarations := map[string]query.BindingType{
		"want":  {Kind: "string"},
		"limit": {Kind: "int64"},
		"on":    {Kind: "bool"},
		"maybe": {Kind: "nullable", Value: &query.BindingType{Kind: "string"}},
		"bound": {Kind: "uint64"},
		"ratio": {Kind: "double"},
	}
	env := f.celEnv(declarations)
	checked := 0
	for _, operand := range []string{"resource.state", "resource.level", "resource.code", "resource.ratio", "resource.flag", "resource.priority", "resource.note", "resource.id"} {
		for _, op := range []string{"==", "!="} {
			source := operand + " " + op + " "
			response := f.completeAt(source+cursorMark, withDeclarations(declarations))
			for _, item := range response.Items {
				clause := mustApply(t, source, item.Edit)
				_, ok := compiles(env, clause)
				assert.True(t, ok, "%q must check", clause)
				checked++
			}
		}
	}
	assert.Greater(t, checked, 30)
	// An enum literal inside an in-list.
	list := f.completeAt(`resource.state in [`+cursorMark, withDeclarations(declarations))
	for _, item := range list.Items {
		clause := mustApply(t, "resource.state in [", item.Edit) + "]"
		_, ok := compiles(env, clause)
		assert.True(t, ok, clause)
	}
	// The suggested parameter forms.
	assert.NotContains(t, labels(f.completeAt(`resource.level == `+cursorMark, withDeclarations(declarations)).Items), "bound", "a uint parameter does not compare with an int field")
	assert.NotContains(t, labels(f.completeAt(`resource.code == `+cursorMark, withDeclarations(declarations)).Items), "limit")
	assert.Contains(t, labels(f.completeAt(`resource.code == `+cursorMark, withDeclarations(declarations)).Items), "bound")
	_, ok := compiles(env, "resource.code == bound")
	assert.True(t, ok)
	_, ok = compiles(env, "resource.code == limit")
	assert.False(t, ok, "the checker really does reject a uint field against an int parameter")
}

// has() is offered only where the macro is valid.
func TestHasIsOfferedOnlyForFieldSelections(t *testing.T) {
	f := newFixture(t, "nested", draft2020, cloudNestedSchema)
	env := f.celEnv(nil)
	for _, operand := range []string{"resource.network", "resource.network.vpc", "resource.id", "resource.tags"} {
		response := f.completeAt(operand + " " + cursorMark)
		has, ok := byLabel(response.Items)["has"]
		require.True(t, ok, operand)
		_, valid := compiles(env, mustApply(t, operand+" ", has.Edit))
		assert.True(t, valid, operand)
	}
	for _, operand := range []string{`resource.tags["env"]`, "resource.volumes[0]", "resource.tags.size()"} {
		response := f.completeAt(operand + " " + cursorMark)
		assert.NotContains(t, labels(response.Items), "has", operand)
	}
	_, valid := compiles(env, `has(resource.tags["env"])`)
	assert.False(t, valid, "the checker agrees: has() takes a field selection")
}

// The environment identity covers the schema revision, so a completion cache
// keyed by it cannot survive a schema change.
func TestEnvironmentRevisionTracksTheSchema(t *testing.T) {
	a := newFixture(t, "nested", draft2020, cloudNestedSchema)
	b := newFixture(t, "nested", draft2020, strings.Replace(cloudNestedSchema, `"flag": {"type": "boolean"}`, `"flag": {"type": "string"}`, 1))
	require.NotEqual(t, a.env.ContentKey, b.env.ContentKey)
	require.NotEqual(t, a.identity.EnvironmentRevision, b.identity.EnvironmentRevision)
	flagA := byLabel(a.completeAt("resource.flag " + cursorMark).Items)
	flagB := byLabel(b.completeAt("resource.flag " + cursorMark).Items)
	assert.Contains(t, flagB, "startsWith")
	assert.NotContains(t, flagA, "startsWith", fmt.Sprint("completion follows the schema: ", len(flagA), len(flagB)))
}
