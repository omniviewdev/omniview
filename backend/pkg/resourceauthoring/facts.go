package resourceauthoring

import (
	"strings"
	"unicode/utf8"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
)

// ApplicabilityUnknown marks ancestor facts the catalog could not list.
const ApplicabilityUnknown = "unknown"

func typeInfoOf(info resourcecatalog.FieldInfo) *TypeInfo {
	names := make([]string, len(info.Types))
	copy(names, info.Types)
	return &TypeInfo{Names: names, Format: info.Format}
}

func conditionsOf(in []resourcecatalog.BranchCondition) []Condition {
	if len(in) == 0 {
		return nil
	}
	out := make([]Condition, len(in))
	for i, c := range in {
		out[i] = Condition{Pointer: c.Pointer, Branch: c.Branch, Combinator: c.Combinator}
	}
	return out
}

func segmentsOf(in []resourcecatalog.PathSegment) []PathSegment {
	out := make([]PathSegment, len(in))
	for i, s := range in {
		out[i] = PathSegment{Kind: s.Kind, Name: s.Name}
	}
	return out
}

// typeLabel is the short display type: "integer (int64)", "string | null", "any".
func typeLabel(info resourcecatalog.FieldInfo) string {
	if len(info.Types) == 0 {
		return "any"
	}
	label := strings.Join(info.Types, " | ")
	if info.Format != "" {
		label += " (" + info.Format + ")"
	}
	return label
}

// documentation joins a field's title and description, bounded by max bytes.
func documentation(info resourcecatalog.FieldInfo, max int) string {
	text := info.Description
	switch {
	case info.Title != "" && info.Description != "" && info.Title != info.Description:
		text = info.Title + "\n\n" + info.Description
	case text == "":
		text = info.Title
	}
	return truncateUTF8(text, max)
}

// truncateUTF8 shortens s to at most max bytes on a scalar boundary, marking a cut.
func truncateUTF8(s string, max int) string {
	if len(s) <= max {
		return s
	}
	const mark = "…"
	cut := max - len(mark)
	if cut < 0 {
		cut = 0
	}
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + mark
}

// itemFor describes a catalog field as a suggestion without an edit.
func itemFor(info resourcecatalog.FieldInfo, label, kind string, max int) Item {
	return Item{
		Label:         label,
		Kind:          kind,
		Detail:        typeLabel(info),
		Documentation: documentation(info, max),
		Type:          typeInfoOf(info),
		Checking:      info.CELChecking,
		Presence:      info.Presence,
		Nullable:      info.Nullable,
		Applicability: info.Applicability,
		Conditions:    conditionsOf(info.Conditions),
		HasChildren:   info.HasChildren,
	}
}

// ancestorsOf reports the tiers that are not guaranteed to be present, non-null
// and unconditional. A guard is needed for each one in a value predicate below
// it. Tiers whose facts the catalog could not list are reported unknown.
func ancestorsOf(path []resourcecatalog.PathSegment, tiers []tier) []Ancestor {
	var out []Ancestor
	for i, t := range tiers {
		ancestor := Ancestor{Path: segmentsOf(path[:i+1])}
		if t.info == nil {
			ancestor.Presence, ancestor.Nullable, ancestor.Applicability = resourcecatalog.PresenceUnknown, resourcecatalog.NullableUnknown, ApplicabilityUnknown
			out = append(out, ancestor)
			continue
		}
		info := t.info
		if info.Presence == resourcecatalog.PresenceRequired && info.Nullable == resourcecatalog.NullableNo && info.Applicability == resourcecatalog.ApplicabilityUnconditional {
			continue
		}
		ancestor.Presence, ancestor.Nullable, ancestor.Applicability = info.Presence, info.Nullable, info.Applicability
		ancestor.Conditions = conditionsOf(info.Conditions)
		out = append(out, ancestor)
	}
	return out
}

// scalarFacts is the schema-free description of a call or literal result.
func scalarFacts(kind string) resourcecatalog.FieldInfo {
	info := resourcecatalog.FieldInfo{
		Presence:      resourcecatalog.PresenceUnknown,
		Nullable:      resourcecatalog.NullableNo,
		Applicability: resourcecatalog.ApplicabilityUnconditional,
		CELChecking:   resourcecatalog.CELCheckingStatic,
	}
	switch kind {
	case "bool":
		info.Types = []string{"boolean"}
	case "int":
		info.Types, info.Format = []string{"integer"}, "int64"
	case "uint":
		info.Types, info.Format = []string{"integer"}, "uint64"
	case "double":
		info.Types = []string{"number"}
	case "string":
		info.Types = []string{"string"}
	case "null":
		info.Types, info.Nullable = []string{"null"}, resourcecatalog.NullableYes
	}
	return info
}

// bindingFacts describes a declared parameter's type.
func bindingFacts(t query.BindingType) resourcecatalog.FieldInfo {
	info := scalarFacts("")
	switch t.Kind {
	case "bool":
		info.Types = []string{"boolean"}
	case "string":
		info.Types = []string{"string"}
	case "int64":
		info.Types, info.Format = []string{"integer"}, "int64"
	case "uint64":
		info.Types, info.Format = []string{"integer"}, "uint64"
	case "double":
		info.Types = []string{"number"}
	case "timestamp":
		info.Types, info.Format = []string{"string"}, "date-time"
	case "list":
		info.Types, info.HasChildren = []string{"array"}, true
	case "map":
		info.Types, info.HasChildren = []string{"object"}, true
	case "nullable":
		if t.Value != nil {
			inner := bindingFacts(*t.Value)
			inner.Nullable = resourcecatalog.NullableYes
			inner.Types = append(append([]string{}, inner.Types...), "null")
			return inner
		}
	}
	return info
}

// bindingLabel renders a declared type for display: string, list<string>, ...
func bindingLabel(t query.BindingType) string {
	switch t.Kind {
	case "list":
		if t.Element != nil {
			return "list<" + bindingLabel(*t.Element) + ">"
		}
	case "map":
		if t.Value != nil {
			return "map<" + bindingLabel(*t.Value) + ">"
		}
	case "nullable":
		if t.Value != nil {
			return bindingLabel(*t.Value) + "?"
		}
	}
	return t.Kind
}
