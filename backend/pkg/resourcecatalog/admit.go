package resourcecatalog

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ValidationNone marks an admission without a schema (absent binding);
// ValidationFull and ValidationReduced are declared with Schema.
const ValidationNone = "none"

// admissionContextCheckInterval is the work-unit stride between ctx checks.
const admissionContextCheckInterval = 1024

// Admission is the outcome of admitting one record body against a schema.
type Admission struct {
	// Validation is "full", "reduced" (Unvalidated lists what was not
	// enforced) or "none" (absent schema). Callers that require full
	// validation must reject "reduced".
	Validation string
	// Unvalidated lists the schema constraints reachable from the root that
	// admission did not enforce.
	Unvalidated []Constraint
	// UnavailablePaths lists missing required properties and values whose
	// omission-sensitive checks are indeterminate. The root pointer is "".
	// Paths are sorted and unique.
	UnavailablePaths []string
}

// errBranchMismatch is the cheap failure returned while evaluating a union
// branch: the branch outcome is discarded, so no message is rendered.
var errBranchMismatch = errors.New("branch mismatch")

// Admit validates value against schema under coverage, sharing one work budget
// across the whole request. A nil schema (absent binding) performs only the
// structural tagged-value check and returns Validation "none". Partial and
// unknown coverage can make omission-sensitive checks indeterminate; definite
// contradictions still fail. Admit ignores separate known-absence facts, never
// writes to the schema document, and retains nothing after it returns.
func Admit(ctx context.Context, schema *Schema, value resourcev2.Value, coverage resourcev2.Coverage, policy Policy) (Admission, error) {
	if err := ctx.Err(); err != nil {
		return Admission{}, admissionContextError(ctx)
	}
	if value.Kind != "map" {
		return Admission{}, invalidf("resource value at %q must be a map, got %s", "", value.Kind)
	}
	a := admitter{
		ctx:      ctx,
		policy:   policy,
		coverage: coverage,
		path:     make([]pathSegment, 0, 32),
	}
	if err := a.walkValue(&value, 0); err != nil {
		return Admission{}, err
	}
	if err := resourcev2.ValidateValue(value); err != nil {
		return Admission{}, structuralError(value, err)
	}
	if schema == nil {
		return Admission{Validation: ValidationNone}, nil
	}
	a.nodes = schema.Document.Nodes
	if err := a.evaluate(schema.Root, &value); err != nil {
		return Admission{}, err
	}
	out := Admission{Validation: ValidationFull}
	if len(schema.Unvalidated) > 0 {
		out.Validation = ValidationReduced
		out.Unvalidated = slices.Clone(schema.Unvalidated)
	}
	if len(a.unavailable) > 0 {
		slices.Sort(a.unavailable)
		out.UnavailablePaths = slices.Compact(a.unavailable)
	}
	return out, nil
}

// pathSegment is one step from the record root to the value under evaluation.
// Pointers are rendered only for errors and unavailable paths.
type pathSegment struct {
	name    string
	index   int
	isIndex bool
}

type admitter struct {
	ctx      context.Context
	nodes    []Node
	policy   Policy
	coverage resourcev2.Coverage
	work     int
	// branchDepth > 0 while evaluating an anyOf/oneOf branch; mismatches
	// then return errBranchMismatch instead of a rendered error.
	branchDepth int
	path        []pathSegment
	unavailable []string
}

func (a *admitter) pointer() string {
	var b strings.Builder
	for _, s := range a.path {
		b.WriteByte('/')
		if s.isIndex {
			b.WriteString(strconv.Itoa(s.index))
		} else {
			b.WriteString(escapePointerToken(s.name))
		}
	}
	return b.String()
}

func (a *admitter) childPointer(name string) string {
	return childPointer(a.pointer(), name)
}

// here renders the current value pointer lazily, only when an error message
// is formatted.
func (a *admitter) here() currentPointer { return currentPointer{a} }

type currentPointer struct{ a *admitter }

func (p currentPointer) String() string { return p.a.pointer() }

// mismatch reports that the current value contradicts the schema.
func (a *admitter) mismatch(format string, args ...any) error {
	if a.branchDepth > 0 {
		return errBranchMismatch
	}
	return invalidf(format, args...)
}

func (a *admitter) charge() error {
	a.work++
	if a.work > a.policy.MaxAdmissionWork {
		return resourcev2.NewError(codeResourceLimit,
			fmt.Sprintf("admission exceeds MaxAdmissionWork (%d) at %q", a.policy.MaxAdmissionWork, a.pointer()))
	}
	if a.work%admissionContextCheckInterval == 0 && a.ctx.Err() != nil {
		return admissionContextError(a.ctx)
	}
	return nil
}

// chargeValue, chargeSchemaNode and chargeBranch each cost one work unit.
func (a *admitter) chargeValue() error      { return a.charge() }
func (a *admitter) chargeSchemaNode() error { return a.charge() }
func (a *admitter) chargeBranch() error     { return a.charge() }

// walkValue accounts for structural validation, including unconstrained children.
// The SDK's depth bound also prevents unbounded recursion before validation.
func (a *admitter) walkValue(v *resourcev2.Value, depth int) error {
	if err := a.chargeValue(); err != nil {
		return err
	}
	if depth > resourcev2.MaxValueDepth {
		return resourcev2.NewError(codeResourceLimit, "resource value at \"\" exceeds value complexity limit")
	}
	switch v.Kind {
	case "list":
		for i := range v.List {
			a.path = append(a.path, pathSegment{index: i, isIndex: true})
			err := a.walkValue(&v.List[i], depth+1)
			a.path = a.path[:len(a.path)-1]
			if err != nil {
				return err
			}
		}
	case "map":
		for name, value := range v.Map {
			a.path = append(a.path, pathSegment{name: name})
			err := a.walkValue(&value, depth+1)
			a.path = a.path[:len(a.path)-1]
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (a *admitter) evaluate(id NodeID, v *resourcev2.Value) error {
	if err := a.chargeSchemaNode(); err != nil {
		return err
	}
	n := &a.nodes[id]
	if n.Ref != 0 {
		if err := a.evaluate(n.Ref, v); err != nil {
			return err
		}
	}
	if n.Types != 0 && !typeAdmits(n.Types, n.Format, v) {
		return a.mismatch("value at %q has kind %s, schema at %q allows %s", a.here(), v.Kind, n.Pointer, allowedTypes(n.Types))
	}
	if n.Const != nil {
		outcome, err := a.compareConstraint(n.Const, v)
		if err != nil {
			return err
		}
		if outcome == branchMismatch {
			return a.mismatch("value at %q does not equal the const of schema at %q", a.here(), n.Pointer)
		}
		if outcome == branchIndeterminate {
			a.unavailable = append(a.unavailable, a.pointer())
		}
	}
	if len(n.Enum) > 0 {
		matched, uncertain := false, false
		for i := range n.Enum {
			outcome, err := a.compareConstraint(&n.Enum[i], v)
			if err != nil {
				return err
			}
			if outcome == branchMatch {
				matched = true
				break
			}
			uncertain = uncertain || outcome == branchIndeterminate
		}
		if !matched && !uncertain {
			return a.mismatch("value at %q is not one of the enum values of schema at %q", a.here(), n.Pointer)
		}
		if !matched {
			a.unavailable = append(a.unavailable, a.pointer())
		}
	}
	var err error
	switch v.Kind {
	case "int64", "uint64", "double":
		err = a.numeric(n, v)
	case "string":
		err = a.text(n, v.String)
	case "timestamp":
		err = a.text(n, v.Timestamp)
	case "list":
		err = a.list(n, v.List)
	case "map":
		err = a.object(n, v.Map)
	}
	if err != nil {
		return err
	}
	return a.combinators(n, v)
}

// typeAdmits applies the spec §5 compatibility rules without coercion.
func typeAdmits(types TypeSet, format string, v *resourcev2.Value) bool {
	switch v.Kind {
	case "null":
		return types&TypeNull != 0
	case "bool":
		return types&TypeBoolean != 0
	case "string":
		return types&TypeString != 0
	case "timestamp":
		return types&TypeString != 0 && format == "date-time"
	case "int64", "uint64":
		return types&(TypeInteger|TypeNumber) != 0
	case "double":
		return types&TypeNumber != 0
	case "list":
		return types&TypeArray != 0
	case "map":
		return types&TypeObject != 0
	}
	return false
}

var admissionTypeOrder = []struct {
	bit  TypeSet
	name string
}{
	{TypeNull, "null"}, {TypeBoolean, "boolean"}, {TypeString, "string"}, {TypeInteger, "integer"},
	{TypeNumber, "number"}, {TypeObject, "object"}, {TypeArray, "array"},
}

// allowedTypes renders a TypeSet for error messages, only when formatted.
type allowedTypes TypeSet

func (types allowedTypes) String() string {
	names := make([]string, 0, len(admissionTypeOrder))
	for _, t := range admissionTypeOrder {
		if TypeSet(types)&t.bit != 0 {
			names = append(names, t.name)
		}
	}
	return strings.Join(names, "|")
}

// valuesEqual is exact tagged-value equality: kinds must match, so an int64
// never equals a double of nearby magnitude.
func (a *admitter) valuesEqual(x, y *resourcev2.Value) (bool, error) {
	if err := a.charge(); err != nil {
		return false, err
	}
	if x.Kind != y.Kind {
		return false, nil
	}
	switch x.Kind {
	case "null":
		return true, nil
	case "bool":
		return x.Bool == y.Bool, nil
	case "string":
		return x.String == y.String, nil
	case "int64":
		return x.Int == y.Int, nil
	case "uint64":
		return x.Uint == y.Uint, nil
	case "double":
		return x.Double == y.Double, nil
	case "timestamp":
		return x.Timestamp == y.Timestamp, nil
	case "list":
		if len(x.List) != len(y.List) {
			return false, nil
		}
		for i := range x.List {
			equal, err := a.valuesEqual(&x.List[i], &y.List[i])
			if err != nil || !equal {
				return equal, err
			}
		}
		return true, nil
	case "map":
		if len(x.Map) != len(y.Map) {
			return false, nil
		}
		for k, xv := range x.Map {
			yv, ok := y.Map[k]
			if !ok {
				return false, nil
			}
			equal, err := a.valuesEqual(&xv, &yv)
			if err != nil || !equal {
				return equal, err
			}
		}
		return true, nil
	}
	return false, nil
}

// valuesEqual compares normalized schema annotations during navigation.
// Admission uses the budgeted method above instead.
func valuesEqual(x, y resourcev2.Value) bool {
	if x.Kind != y.Kind {
		return false
	}
	switch x.Kind {
	case "null":
		return true
	case "bool":
		return x.Bool == y.Bool
	case "string":
		return x.String == y.String
	case "int64":
		return x.Int == y.Int
	case "uint64":
		return x.Uint == y.Uint
	case "double":
		return x.Double == y.Double
	case "timestamp":
		return x.Timestamp == y.Timestamp
	case "list":
		return slices.EqualFunc(x.List, y.List, valuesEqual)
	case "map":
		if len(x.Map) != len(y.Map) {
			return false
		}
		for k, xv := range x.Map {
			yv, ok := y.Map[k]
			if !ok || !valuesEqual(xv, yv) {
				return false
			}
		}
		return true
	}
	return false
}

// numberRatOf returns the exact rational represented by the numeric payload.
// Values passed structural validation, so integer payloads are canonical decimals.
func numberRatOf(v *resourcev2.Value) *big.Rat {
	if v.Kind == "double" {
		return new(big.Rat).SetFloat64(v.Double)
	}
	text := v.Int
	if v.Kind == "uint64" {
		text = v.Uint
	}
	r, _ := new(big.Rat).SetString(text)
	return r
}

func (a *admitter) numeric(n *Node, v *resourcev2.Value) error {
	if n.Minimum == nil && n.Maximum == nil && n.MultipleOf == nil {
		return nil
	}
	x := numberRatOf(v)
	if n.Minimum != nil {
		c := x.Cmp(n.Minimum)
		if c < 0 || (c == 0 && n.ExclusiveMinimum) {
			return a.mismatch("value at %q is below the minimum of schema at %q", a.here(), n.Pointer)
		}
	}
	if n.Maximum != nil {
		c := x.Cmp(n.Maximum)
		if c > 0 || (c == 0 && n.ExclusiveMaximum) {
			return a.mismatch("value at %q is above the maximum of schema at %q", a.here(), n.Pointer)
		}
	}
	if n.MultipleOf != nil && !x.Quo(x, n.MultipleOf).IsInt() {
		return a.mismatch("value at %q is not a multiple of multipleOf of schema at %q", a.here(), n.Pointer)
	}
	return nil
}

func (a *admitter) text(n *Node, s string) error {
	if n.MinLength != nil || n.MaxLength != nil {
		length := utf8.RuneCountInString(s)
		if n.MinLength != nil && length < int(*n.MinLength) {
			return a.mismatch("value at %q is shorter than minLength %d of schema at %q", a.here(), *n.MinLength, n.Pointer)
		}
		if n.MaxLength != nil && length > int(*n.MaxLength) {
			return a.mismatch("value at %q is longer than maxLength %d of schema at %q", a.here(), *n.MaxLength, n.Pointer)
		}
	}
	if n.Pattern != nil && !n.Pattern.MatchString(s) {
		return a.mismatch("value at %q does not match the pattern of schema at %q", a.here(), n.Pointer)
	}
	return nil
}

func (a *admitter) list(n *Node, items []resourcev2.Value) error {
	if n.MinItems != nil && len(items) < int(*n.MinItems) {
		if !a.affected(a.pointer()) {
			return a.mismatch("value at %q has fewer than minItems %d of schema at %q", a.here(), *n.MinItems, n.Pointer)
		}
		a.unavailable = append(a.unavailable, a.pointer())
	}
	if n.MaxItems != nil && len(items) > int(*n.MaxItems) {
		return a.mismatch("value at %q has more than maxItems %d of schema at %q", a.here(), *n.MaxItems, n.Pointer)
	}
	if n.UniqueItems {
		// The comparison's root costs the pair unit; descendants cost
		// additional units so nested values cannot bypass the budget.
		for i := range items {
			for j := i + 1; j < len(items); j++ {
				equal, err := a.valuesEqual(&items[i], &items[j])
				if err != nil {
					return err
				}
				if equal {
					return a.mismatch("value at %q repeats item %d at %d, schema at %q requires unique items", a.here(), i, j, n.Pointer)
				}
			}
		}
	}
	if a.coverage.Kind != "complete" && (n.MaxItems != nil || n.UniqueItems || n.Items != 0) {
		pointer := a.pointer()
		if a.affected(pointer) {
			omittedItemsMayFail := n.MaxItems != nil || n.UniqueItems
			if !omittedItemsMayFail && n.Items != 0 {
				var err error
				omittedItemsMayFail, err = a.couldRejectOmittedValue(n.Items, 0)
				if err != nil {
					return err
				}
			}
			if omittedItemsMayFail {
				a.unavailable = append(a.unavailable, pointer)
			}
		}
	}
	if n.Items == 0 {
		return nil
	}
	for i := range items {
		a.path = append(a.path, pathSegment{index: i, isIndex: true})
		err := a.chargeValue()
		if err == nil {
			err = a.evaluate(n.Items, &items[i])
		}
		a.path = a.path[:len(a.path)-1]
		if err != nil {
			return err
		}
	}
	return nil
}

func (a *admitter) object(n *Node, fields map[string]resourcev2.Value) error {
	if n.MinProperties != nil && len(fields) < int(*n.MinProperties) {
		if !a.affected(a.pointer()) {
			return a.mismatch("value at %q has fewer than minProperties %d of schema at %q", a.here(), *n.MinProperties, n.Pointer)
		}
		a.unavailable = append(a.unavailable, a.pointer())
	}
	if n.MaxProperties != nil && len(fields) > int(*n.MaxProperties) {
		return a.mismatch("value at %q has more than maxProperties %d of schema at %q", a.here(), *n.MaxProperties, n.Pointer)
	}
	for _, name := range n.Required {
		if _, ok := fields[name]; !ok {
			if err := a.missingRequired(name); err != nil {
				return err
			}
		}
	}
	declaredPresent := 0
	omittedPropertyMayFail := false
	for _, property := range n.Properties {
		value, ok := fields[property.Name]
		if !ok {
			if !omittedPropertyMayFail && a.branchDepth > 0 && a.coverage.Kind != "complete" {
				_, required := slices.BinarySearch(n.Required, property.Name)
				if !required && a.limited(a.childPointer(property.Name)) {
					var err error
					omittedPropertyMayFail, err = a.couldRejectOmittedValue(property.Node, 0)
					if err != nil {
						return err
					}
				}
			}
			continue
		}
		declaredPresent++
		if err := a.field(property.Name, property.Node, &value); err != nil {
			return err
		}
	}
	if a.coverage.Kind != "complete" && (omittedPropertyMayFail || n.MaxProperties != nil || n.Additional != AdditionalAny) {
		pointer := a.pointer()
		if a.affected(pointer) {
			omittedPropertyMayFail = omittedPropertyMayFail || n.MaxProperties != nil || n.Additional == AdditionalForbidden
			if !omittedPropertyMayFail && n.Additional == AdditionalSchema {
				var err error
				omittedPropertyMayFail, err = a.couldRejectOmittedValue(n.AdditionalOf, 0)
				if err != nil {
					return err
				}
			}
			if omittedPropertyMayFail {
				a.unavailable = append(a.unavailable, pointer)
			}
		}
	}
	if n.Additional == AdditionalAny || declaredPresent == len(fields) {
		return nil
	}
	return a.undeclared(n, fields)
}

// couldRejectOmittedValue proves common unconstrained shapes, including refs
// and unions. Other shapes remain conservative without the omitted value.
func (a *admitter) couldRejectOmittedValue(id NodeID, depth int) (bool, error) {
	if err := a.charge(); err != nil {
		return false, err
	}
	if depth > a.policy.MaxRefChain {
		return true, nil
	}
	n := &a.nodes[id]
	if n.Types != 0 || n.Enum != nil || n.Const != nil || len(n.Required) > 0 ||
		n.Additional == AdditionalForbidden || n.Minimum != nil || n.Maximum != nil || n.MultipleOf != nil ||
		(n.Pattern != nil && n.Pattern.String() != "") || n.MaxLength != nil || n.MaxItems != nil || n.MaxProperties != nil ||
		(n.MinLength != nil && *n.MinLength > 0) || (n.MinItems != nil && *n.MinItems > 0) ||
		(n.MinProperties != nil && *n.MinProperties > 0) || n.UniqueItems {
		return true, nil
	}
	additional := NodeID(0)
	if n.Additional == AdditionalSchema {
		additional = n.AdditionalOf
	}
	for _, child := range [3]NodeID{n.Ref, n.Items, additional} {
		if child != 0 {
			mayReject, err := a.couldRejectOmittedValue(child, depth+1)
			if err != nil || mayReject {
				return mayReject, err
			}
		}
	}
	for _, property := range n.Properties {
		mayReject, err := a.couldRejectOmittedValue(property.Node, depth+1)
		if err != nil || mayReject {
			return mayReject, err
		}
	}
	for _, branch := range n.AllOf {
		mayReject, err := a.couldRejectOmittedValue(branch, depth+1)
		if err != nil || mayReject {
			return mayReject, err
		}
	}
	if len(n.AnyOf) > 0 {
		unconstrained := false
		for _, branch := range n.AnyOf {
			mayReject, err := a.couldRejectOmittedValue(branch, depth+1)
			if err != nil {
				return false, err
			}
			if !mayReject {
				unconstrained = true
				break
			}
		}
		if !unconstrained {
			return true, nil
		}
	}
	if len(n.OneOf) > 1 {
		return true, nil
	}
	if len(n.OneOf) == 1 {
		return a.couldRejectOmittedValue(n.OneOf[0], depth+1)
	}
	return false, nil
}

func declares(n *Node, name string) bool {
	_, found := slices.BinarySearchFunc(n.Properties, name, func(p Property, name string) int { return strings.Compare(p.Name, name) })
	return found
}

// undeclared checks properties the node does not declare, in name order so
// the reported failure is deterministic.
func (a *admitter) undeclared(n *Node, fields map[string]resourcev2.Value) error {
	names := make([]string, 0, len(fields))
	for name := range fields {
		if !declares(n, name) {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	for _, name := range names {
		if n.Additional == AdditionalForbidden {
			return a.mismatch("property at %q is not allowed by closed schema at %q", a.childPointer(name), n.Pointer)
		}
		value := fields[name]
		if err := a.field(name, n.AdditionalOf, &value); err != nil {
			return err
		}
	}
	return nil
}

func (a *admitter) field(name string, id NodeID, value *resourcev2.Value) error {
	a.path = append(a.path, pathSegment{name: name})
	err := a.chargeValue()
	if err == nil {
		err = a.evaluate(id, value)
	}
	a.path = a.path[:len(a.path)-1]
	return err
}

// missingRequired applies the spec §5 coverage rule to one missing required
// property.
func (a *admitter) missingRequired(name string) error {
	missing := a.childPointer(name)
	if a.coverage.Kind != "complete" && a.limited(missing) {
		a.unavailable = append(a.unavailable, missing)
		return nil
	}
	return a.mismatch("required property at %q is missing", missing)
}

// limited reports whether coverage declares pointer omissible: no listed
// paths limits the whole body; otherwise a listed path must equal pointer or
// be a segment-wise prefix of it.
func (a *admitter) limited(pointer string) bool {
	if len(a.coverage.Paths) == 0 {
		return true
	}
	for _, path := range a.coverage.Paths {
		if pointer == path || (strings.HasPrefix(pointer, path) && pointer[len(path)] == '/') {
			return true
		}
	}
	return false
}

// affected includes values containing a limitation, as well as values below it.
func (a *admitter) affected(pointer string) bool {
	if a.coverage.Kind == "complete" {
		return false
	}
	if a.limited(pointer) {
		return true
	}
	for _, path := range a.coverage.Paths {
		if pointer == "" || (strings.HasPrefix(path, pointer) && len(path) > len(pointer) && path[len(pointer)] == '/') {
			return true
		}
	}
	return false
}

// compareConstraint compares a schema literal with the observed value. Missing
// members can make equality uncertain, but present contradictions remain final.
func (a *admitter) compareConstraint(expected, observed *resourcev2.Value) (branchOutcome, error) {
	if expected.Kind != observed.Kind || (observed.Kind != "map" && observed.Kind != "list") || !a.affected(a.pointer()) {
		equal, err := a.valuesEqual(expected, observed)
		if err != nil {
			return branchMismatch, err
		}
		if equal {
			return branchMatch, nil
		}
		return branchMismatch, nil
	}
	if err := a.charge(); err != nil {
		return branchMismatch, err
	}
	if observed.Kind == "list" {
		if len(observed.List) > len(expected.List) {
			return branchMismatch, nil
		}
		if len(observed.List) < len(expected.List) && !a.limited(a.pointer()) {
			// Local member limits make some expected elements optional. Keep
			// alternative matches: a greedy match can leave an unlimited tail.
			reachable := make([]bool, len(observed.List)+1)
			reachable[0] = true
			for index := range expected.List {
				a.path = append(a.path, pathSegment{index: index, isIndex: true})
				omittable := a.limited(a.pointer())
				a.path = a.path[:len(a.path)-1]
				possible := false
				for count := min(index+1, len(observed.List)); count >= 0; count-- {
					if err := a.charge(); err != nil {
						return branchMismatch, err
					}
					canMatch := count > 0 && reachable[count-1]
					reachable[count] = omittable && reachable[count]
					if canMatch {
						a.path = append(a.path, pathSegment{index: count - 1, isIndex: true})
						outcome, err := a.compareConstraint(&expected.List[index], &observed.List[count-1])
						a.path = a.path[:len(a.path)-1]
						if err != nil {
							return branchMismatch, err
						}
						reachable[count] = reachable[count] || outcome != branchMismatch
					}
					possible = possible || reachable[count]
				}
				if !possible {
					return branchMismatch, nil
				}
			}
			if !reachable[len(observed.List)] {
				return branchMismatch, nil
			}
			return branchIndeterminate, nil
		}
		next := 0
		for i := range observed.List {
			matched := false
			// Leave enough expected elements for the remaining observations.
			for next <= len(expected.List)-(len(observed.List)-i) {
				a.path = append(a.path, pathSegment{index: i, isIndex: true})
				outcome, err := a.compareConstraint(&expected.List[next], &observed.List[i])
				a.path = a.path[:len(a.path)-1]
				next++
				if err != nil {
					return branchMismatch, err
				}
				if outcome != branchMismatch {
					matched = true
					break
				}
			}
			if !matched {
				return branchMismatch, nil
			}
		}
	} else {
		for key, value := range observed.Map {
			want, ok := expected.Map[key]
			if !ok {
				if err := a.charge(); err != nil {
					return branchMismatch, err
				}
				return branchMismatch, nil
			}
			a.path = append(a.path, pathSegment{name: key})
			outcome, err := a.compareConstraint(&want, &value)
			a.path = a.path[:len(a.path)-1]
			if err != nil || outcome == branchMismatch {
				return branchMismatch, err
			}
		}
		if len(expected.Map) != len(observed.Map) {
			for key := range expected.Map {
				if _, ok := observed.Map[key]; !ok {
					if err := a.charge(); err != nil {
						return branchMismatch, err
					}
					if !a.limited(a.childPointer(key)) {
						return branchMismatch, nil
					}
				}
			}
		}
	}
	return branchIndeterminate, nil
}

func (a *admitter) combinators(n *Node, v *resourcev2.Value) error {
	for _, branch := range n.AllOf {
		if err := a.chargeBranch(); err != nil {
			return err
		}
		if err := a.evaluate(branch, v); err != nil {
			return err
		}
	}
	if len(n.AnyOf) > 0 {
		mark := len(a.unavailable)
		matched, uncertain := false, false
		for _, branch := range n.AnyOf {
			outcome, err := a.tryBranch(branch, v)
			if err != nil {
				return err
			}
			if outcome == branchMatch {
				matched = true
				a.unavailable = a.unavailable[:mark]
				break
			}
			uncertain = uncertain || outcome == branchIndeterminate
		}
		if !matched && !uncertain {
			return a.mismatch("value at %q matches no anyOf branch of schema at %q", a.here(), n.Pointer)
		}
	}
	if len(n.OneOf) > 0 {
		matched, uncertain := false, 0
		for _, branch := range n.OneOf {
			outcome, err := a.tryBranch(branch, v)
			if err != nil {
				return err
			}
			if outcome == branchIndeterminate {
				uncertain++
			} else if outcome == branchMatch {
				if matched {
					return a.mismatch("value matches more than one oneOf branch at %q of schema at %q", a.here(), n.Pointer)
				}
				matched = true
			}
		}
		if !matched && uncertain == 0 {
			return a.mismatch("value at %q matches no oneOf branch of schema at %q", a.here(), n.Pointer)
		}
		if uncertain > 1 || (matched && uncertain > 0) {
			a.unavailable = append(a.unavailable, a.pointer())
		}
	}
	return nil
}

type branchOutcome uint8

const (
	branchMismatch branchOutcome = iota
	branchMatch
	branchIndeterminate
)

// tryBranch discards paths from failed branches and retains paths from
// indeterminate branches. Lifecycle and budget failures propagate.
func (a *admitter) tryBranch(branch NodeID, v *resourcev2.Value) (branchOutcome, error) {
	if err := a.chargeBranch(); err != nil {
		return branchMismatch, err
	}
	mark := len(a.unavailable)
	a.branchDepth++
	err := a.evaluate(branch, v)
	a.branchDepth--
	if err == nil {
		if len(a.unavailable) > mark {
			return branchIndeterminate, nil
		}
		return branchMatch, nil
	}
	a.unavailable = a.unavailable[:mark]
	if errors.Is(err, errBranchMismatch) {
		return branchMismatch, nil
	}
	return branchMismatch, err
}

func admissionContextError(ctx context.Context) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return resourcev2.NewError(codeTimeout, "Schema admission timed out.")
	}
	return resourcev2.NewError(codeCancelled, "Schema admission was cancelled.")
}

// structuralError locates the first structurally invalid value so the error
// names its RFC6901 pointer. Tree-wide budget failures name the root.
func structuralError(root resourcev2.Value, cause error) error {
	code := resourcev2.ErrorCode(cause)
	pointer, detail, found := findInvalidValue(&root, "")
	if !found {
		pointer, detail = "", structuralDetail(cause)
	}
	return resourcev2.NewError(code, fmt.Sprintf("resource value at %q is not a valid tagged value: %s", pointer, detail))
}

func findInvalidValue(v *resourcev2.Value, pointer string) (string, string, bool) {
	switch v.Kind {
	case "list":
		for i := range v.List {
			if p, detail, found := findInvalidValue(&v.List[i], childPointer(pointer, strconv.Itoa(i))); found {
				return p, detail, true
			}
		}
		return "", "", false
	case "map":
		names := make([]string, 0, len(v.Map))
		for name := range v.Map {
			names = append(names, name)
		}
		slices.Sort(names)
		for _, name := range names {
			child := childPointer(pointer, name)
			if err := resourcev2.ValidateValue(resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{name: {Kind: "null"}}}); err != nil {
				return child, "invalid property name", true
			}
			value := v.Map[name]
			if p, detail, found := findInvalidValue(&value, child); found {
				return p, detail, true
			}
		}
		return "", "", false
	default:
		if err := resourcev2.ValidateValue(*v); err != nil {
			return pointer, structuralDetail(err), true
		}
		return "", "", false
	}
}

func structuralDetail(err error) string {
	var classified *resourcev2.ResourceOperationError
	if errors.As(err, &classified) && classified != nil {
		return classified.Message
	}
	return err.Error()
}
