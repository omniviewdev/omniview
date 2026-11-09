package query

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// QuerySpec is the versioned, provider-neutral public query request.
type QuerySpec struct {
	Version      string                      `json:"version"`
	Targets      []Target                    `json:"targets"`
	Predicate    Predicate                   `json:"predicate"`
	Declarations map[string]BindingType      `json:"declarations"`
	Bindings     map[string]resourcev2.Value `json:"bindings"`
	Text         *TextConstraint             `json:"text,omitempty"`
	Projection   []Projection                `json:"projection"`
	Order        []OrderTerm                 `json:"order"`
	Delivery     Delivery                    `json:"delivery"`
}
type Target struct {
	TargetID       string                 `json:"targetId"`
	Provider       string                 `json:"provider"`
	Authority      string                 `json:"authority"`
	Type           string                 `json:"type"`
	AccessRoute    resourcev2.AccessRoute `json:"accessRoute"`
	Representation RepresentationSelector `json:"representation"`
	Scope          resourcev2.QueryScope  `json:"scope"`
}
type RepresentationSelector struct {
	ID       string `json:"id"`
	Revision string `json:"revision"`
}
type Predicate struct {
	Language string          `json:"language"`
	Profile  string          `json:"profile,omitempty"`
	Source   string          `json:"source,omitempty"`
	Version  string          `json:"version,omitempty"`
	Document json.RawMessage `json:"document,omitempty"`
}
type BindingType struct {
	Kind    string       `json:"kind"`
	Element *BindingType `json:"element,omitempty"`
	Value   *BindingType `json:"value,omitempty"`
}
type PathSegment struct {
	Kind  string  `json:"kind"`
	Name  *string `json:"name,omitempty"`
	Index *uint32 `json:"index,omitempty"`
}
type DocumentFieldPath []PathSegment
type TextConstraint struct {
	Term    string              `json:"term"`
	Fields  []DocumentFieldPath `json:"fields"`
	Match   string              `json:"match"`
	Case    string              `json:"case"`
	Combine string              `json:"combine"`
}
type Projection struct {
	ID   string            `json:"id"`
	Path DocumentFieldPath `json:"path"`
}
type OrderTerm struct {
	Path      DocumentFieldPath `json:"path"`
	Direction string            `json:"direction"`
	Missing   string            `json:"missing"`
	Null      string            `json:"null"`
}
type Delivery struct {
	Mode         string  `json:"mode"`
	PageSize     uint32  `json:"pageSize"`
	After        *string `json:"after,omitempty"`
	AllowPartial *bool   `json:"allowPartial,omitempty"`
}

const maxRequestBytes = 65536

var parameterName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var reservedNames = map[string]bool{"resource": true, "true": true, "false": true, "null": true, "in": true, "as": true, "break": true, "const": true, "continue": true, "else": true, "for": true, "function": true, "if": true, "import": true, "let": true, "loop": true, "package": true, "namespace": true, "return": true, "var": true, "void": true, "while": true, "int": true, "uint": true, "double": true, "bool": true, "string": true, "bytes": true, "list": true, "map": true, "null_type": true, "type": true, "dyn": true, "google": true}

func invalid(message string) error { return resourcev2.NewError("INVALID_REQUEST", message) }
func limit(message string) error   { return resourcev2.NewError("RESOURCE_LIMIT", message) }

// Decode admits one strictly encoded query. Catalog and access admission are separate.
func Decode(data []byte) (QuerySpec, error) {
	var q QuerySpec
	if len(data) > maxRequestBytes {
		return q, limit("query request exceeds byte limit")
	}
	if err := resourcev2.ValidateJSON(data); err != nil {
		return q, err
	}
	if err := validateRequestShape(data); err != nil {
		return q, err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&q); err != nil {
		return QuerySpec{}, invalid("invalid query request")
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return QuerySpec{}, invalid("trailing query data")
	}
	if err := q.validate(); err != nil {
		return QuerySpec{}, err
	}
	return q, nil
}
func (q QuerySpec) validate() error {
	if q.Version != "omniview.query.v1" || len(q.Targets) == 0 || q.Declarations == nil || q.Bindings == nil || q.Projection == nil || q.Order == nil {
		return invalid("invalid query version or missing fields")
	}
	seen := map[string]bool{}
	for _, t := range q.Targets {
		if t.TargetID == "" || seen[t.TargetID] || t.Provider == "" || t.Authority == "" || t.Type == "" || t.AccessRoute.Connection == "" || t.Representation.ID == "" || t.Representation.Revision == "" || t.Scope == nil {
			return invalid("invalid query target")
		}
		seen[t.TargetID] = true
		if err := resourcev2.ValidateScope(t.Scope); err != nil {
			return err
		}
	}
	if len(q.Declarations) > 128 {
		return limit("too many declarations")
	}
	if len(q.Declarations) != len(q.Bindings) {
		return invalid("bindings must match declarations")
	}
	for name, typ := range q.Declarations {
		if !parameterName.MatchString(name) || reservedNames[name] {
			return invalid("invalid parameter name")
		}
		v, ok := q.Bindings[name]
		if !ok {
			return invalid("missing binding")
		}
		if err := checkBinding(typ, v, 0); err != nil {
			return err
		}
	}
	if q.Delivery.Mode != "once" && q.Delivery.Mode != "follow" {
		return invalid("invalid delivery mode")
	}
	if q.Delivery.PageSize == 0 || q.Delivery.PageSize > 512 {
		return invalid("invalid page size")
	}
	if q.Delivery.After != nil && *q.Delivery.After == "" {
		return invalid("empty continuation")
	}
	if q.Text != nil {
		if q.Text.Match != "substring" || q.Text.Case != "sensitive" || q.Text.Combine != "any" || q.Text.Fields == nil || q.Text.Term != "" && len(q.Text.Fields) == 0 {
			return invalid("invalid text constraint")
		}
		for _, p := range q.Text.Fields {
			if err := validatePath(p); err != nil {
				return err
			}
		}
	}
	ids := map[string]bool{}
	for _, p := range q.Projection {
		if p.ID == "" || ids[p.ID] {
			return invalid("invalid projection id")
		}
		ids[p.ID] = true
		if err := validatePath(p.Path); err != nil {
			return err
		}
	}
	for _, o := range q.Order {
		if o.Direction != "asc" && o.Direction != "desc" || o.Missing != "first" && o.Missing != "last" || o.Null != "first" && o.Null != "last" {
			return invalid("invalid order")
		}
		if err := validatePath(o.Path); err != nil {
			return err
		}
	}
	return nil
}

// ValidateDeclarations admits typed parameter declarations without values: a
// bounded count, identifier-safe unreserved names and well-formed types. A saved
// query and a draft being authored share these rules, so a name accepted while
// authoring is a name the query accepts.
func ValidateDeclarations(declarations map[string]BindingType) error {
	if len(declarations) > 128 {
		return limit("too many declarations")
	}
	for name, typ := range declarations {
		if !parameterName.MatchString(name) || reservedNames[name] {
			return invalid("invalid parameter name")
		}
		if err := validateType(typ, 0); err != nil {
			return err
		}
	}
	return nil
}
func validatePath(p DocumentFieldPath) error {
	if p == nil {
		return invalid("missing field path")
	}
	if len(p) > 32 {
		return limit("field path too deep")
	}
	for _, s := range p {
		switch s.Kind {
		case "member":
			if s.Name == nil || s.Index != nil {
				return invalid("invalid member segment")
			}
		case "index":
			if s.Index == nil || s.Name != nil {
				return invalid("invalid index segment")
			}
		default:
			return invalid("invalid path segment")
		}
	}
	return nil
}
func checkBinding(t BindingType, v resourcev2.Value, depth int) error {
	if depth > 32 {
		return limit("binding type too deep")
	}
	if err := resourcev2.ValidateValue(v); err != nil {
		return err
	}
	switch t.Kind {
	case "bool", "string", "int64", "uint64", "double", "timestamp":
		if t.Element != nil || t.Value != nil || v.Kind != t.Kind {
			return invalid("binding type mismatch")
		}
	case "nullable":
		if t.Value == nil || t.Element != nil {
			return invalid("invalid nullable type")
		}
		if v.Kind == "null" {
			return validateType(*t.Value, depth+1)
		}
		return checkBinding(*t.Value, v, depth+1)
	case "list":
		if t.Element == nil || t.Value != nil || v.Kind != "list" {
			return invalid("binding type mismatch")
		}
		if err := validateType(*t.Element, depth+1); err != nil {
			return err
		}
		for _, item := range v.List {
			if err := checkBinding(*t.Element, item, depth+1); err != nil {
				return err
			}
		}
	case "map":
		if t.Value == nil || t.Element != nil || v.Kind != "map" {
			return invalid("binding type mismatch")
		}
		if err := validateType(*t.Value, depth+1); err != nil {
			return err
		}
		for _, item := range v.Map {
			if err := checkBinding(*t.Value, item, depth+1); err != nil {
				return err
			}
		}
	default:
		return invalid("invalid binding type")
	}
	return nil
}
func validateType(t BindingType, depth int) error {
	if depth > 32 {
		return limit("binding type too deep")
	}
	switch t.Kind {
	case "bool", "string", "int64", "uint64", "double", "timestamp":
		if t.Element != nil || t.Value != nil {
			return invalid("invalid scalar type")
		}
	case "list":
		if t.Element == nil || t.Value != nil {
			return invalid("invalid list type")
		}
		return validateType(*t.Element, depth+1)
	case "map", "nullable":
		if t.Value == nil || t.Element != nil {
			return invalid("invalid nested type")
		}
		return validateType(*t.Value, depth+1)
	default:
		return invalid(fmt.Sprintf("invalid binding kind %q", t.Kind))
	}
	return nil
}
