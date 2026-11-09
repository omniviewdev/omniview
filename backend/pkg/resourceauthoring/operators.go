package resourceauthoring

import (
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
)

// opClass summarizes what an operand can be, from its declared schema type. The
// type governs which operators are offered, so a string never offers ordering
// arithmetic it cannot use and an integer never offers startsWith.
type opClass struct {
	// any means the schema does not constrain the type (dynamic checking).
	any       bool
	str       bool
	timestamp bool // a string with format date-time
	integer   bool
	number    bool
	boolean   bool
	array     bool
	object    bool
	null      bool
	// nullable is true when null is a possible value (yes or unknown).
	nullable bool
	// isMap is an object whose members are values of one schema, not named fields.
	isMap bool
}

func classOf(info resourcecatalog.FieldInfo, listing *resourcecatalog.Navigation) opClass {
	c := opClass{any: len(info.Types) == 0, nullable: info.Nullable != resourcecatalog.NullableNo}
	for _, name := range info.Types {
		switch name {
		case "string":
			if info.Format == "date-time" {
				c.timestamp = true
			} else {
				c.str = true
			}
		case "integer":
			c.integer = true
		case "number":
			c.number = true
		case "boolean":
			c.boolean = true
		case "array":
			c.array = true
		case "object":
			c.object = true
		case "null":
			c.null = true
		}
	}
	if c.any {
		c = enumClass(c, info.Enum)
	}
	if c.object && listing != nil {
		named, mapValue := false, false
		for _, entry := range listing.Fields {
			switch entry.Segment.Kind {
			case resourcecatalog.SegmentField:
				named = true
			case resourcecatalog.SegmentMapValue:
				mapValue = true
			}
		}
		c.isMap = mapValue && !named
	}
	return c
}

// scalar reports a value an ordinary comparison can use. A null alongside an
// object or array does not make the operand comparable: it has its own tests.
func (c opClass) scalar() bool {
	return c.any || c.str || c.timestamp || c.integer || c.number || c.boolean
}

// enumClass derives the class of a field that declares no type but lists an
// enum: its members decide what it can be. Checking stays dynamic because the
// catalog types it as dyn; only the operators offered follow the members.
func enumClass(c opClass, enum []resourcev2.Value) opClass {
	if len(enum) == 0 {
		return c
	}
	derived := opClass{}
	for _, v := range enum {
		switch v.Kind {
		case "string":
			derived.str = true
		case "int64", "uint64":
			derived.integer = true
		case "double":
			derived.number = true
		case "bool":
			derived.boolean = true
		case "null":
			derived.null, derived.nullable = true, true
		default:
			return c
		}
	}
	return derived
}

func (c opClass) ordered() bool {
	return c.any || c.str || c.timestamp || c.integer || c.number
}

// opSpec is one operator the catalog of authoring edits can insert.
type opSpec struct {
	label  string
	kind   string
	arity  string
	detail string
	doc    string
	apply  func(opClass) bool
}

// comparison operators apply by operand type. Heterogeneous comparisons are a
// CEL checker concern: the suggestions follow the operand's own type.
var comparisonSpecs = []opSpec{
	{label: "==", kind: KindOperator, arity: ArityBinary, detail: "equal to", doc: "True when the value equals the operand.", apply: opClass.scalar},
	{label: "!=", kind: KindOperator, arity: ArityBinary, detail: "not equal to", doc: "True when the value differs from the operand. A missing or null value is also not equal; use has() or a null test to guard.", apply: opClass.scalar},
	{label: "<", kind: KindOperator, arity: ArityBinary, detail: "less than", doc: "True when the value is less than the operand.", apply: opClass.ordered},
	{label: "<=", kind: KindOperator, arity: ArityBinary, detail: "less than or equal to", doc: "True when the value is at most the operand.", apply: opClass.ordered},
	{label: ">", kind: KindOperator, arity: ArityBinary, detail: "greater than", doc: "True when the value is greater than the operand.", apply: opClass.ordered},
	{label: ">=", kind: KindOperator, arity: ArityBinary, detail: "greater than or equal to", doc: "True when the value is at least the operand.", apply: opClass.ordered},
	{label: "in", kind: KindOperator, arity: ArityBinary, detail: "one of a list", doc: "True when the value equals any element of the list.", apply: func(c opClass) bool {
		return c.any || c.str || c.integer || c.number || c.boolean
	}},
}

// nullSpecs apply only where the schema allows null. A null test on a type that
// cannot be null is a checker error, so it is never offered there.
var nullSpecs = []opSpec{
	{label: "== null", kind: KindOperator, arity: ArityBinary, detail: "is null", doc: "True when the value is present and null. A missing value is not null.", apply: func(c opClass) bool { return c.nullable }},
	{label: "!= null", kind: KindOperator, arity: ArityBinary, detail: "is not null", doc: "True when the value is not null; a missing value also satisfies this.", apply: func(c opClass) bool { return c.nullable }},
}

var methodSpecs = []opSpec{
	{label: "startsWith", kind: KindMethod, arity: ArityMethod, detail: "string.startsWith(prefix) → bool", doc: "True when the string begins with the prefix.", apply: func(c opClass) bool { return c.str }},
	{label: "endsWith", kind: KindMethod, arity: ArityMethod, detail: "string.endsWith(suffix) → bool", doc: "True when the string ends with the suffix.", apply: func(c opClass) bool { return c.str }},
	{label: "contains", kind: KindMethod, arity: ArityMethod, detail: "string.contains(substring) → bool", doc: "True when the string contains the substring.", apply: func(c opClass) bool { return c.str }},
	{label: "matches", kind: KindMethod, arity: ArityMethod, detail: "string.matches(regex) → bool", doc: "True when the string matches the RE2 regular expression anywhere.", apply: func(c opClass) bool { return c.str }},
	{label: "size", kind: KindMethod, arity: ArityMethod, detail: "size() → int", doc: "The number of characters, elements or entries.", apply: func(c opClass) bool { return c.str || c.array || c.isMap }},
	{label: "exists", kind: KindMacro, arity: ArityMethod, detail: "list.exists(e, predicate) → bool", doc: "True when the predicate holds for at least one element. Conditions on the same element belong inside one predicate.", apply: func(c opClass) bool { return c.array }},
	{label: "all", kind: KindMacro, arity: ArityMethod, detail: "list.all(e, predicate) → bool", doc: "True when the predicate holds for every element, and for an empty list.", apply: func(c opClass) bool { return c.array }},
	{label: "exists_one", kind: KindMacro, arity: ArityMethod, detail: "list.exists_one(e, predicate) → bool", doc: "True when the predicate holds for exactly one element.", apply: func(c opClass) bool { return c.array }},
}

var (
	hasSpec = opSpec{label: "has", kind: KindFunction, arity: ArityState, detail: "has(field) → bool", doc: "True when the field is present. It does not guard its ancestors: a missing or null ancestor is an evaluation error."}
	andSpec = opSpec{label: "&&", kind: KindOperator, arity: ArityLogic, detail: "and", doc: "Joins two clauses; both must hold."}
	orSpec  = opSpec{label: "||", kind: KindOperator, arity: ArityLogic, detail: "or", doc: "Joins two clauses; either may hold."}
)
