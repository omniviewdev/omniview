package extensionread

import (
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"math"
	"regexp"
	"slices"
	"unicode/utf16"
	"unicode/utf8"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	segment           = `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`
	maxWireSources    = 8
	maxWireCandidates = 129
	maxWireEvidence   = 4
	maxWireFields     = 64
	maxStringUnits    = 4096
)

var (
	operationID = regexp.MustCompile(`^` + segment + `/` + segment + `@[1-9][0-9]{0,8}$`)
	fieldName   = regexp.MustCompile(`^` + segment + `$`)
)

// Reserve space for every borrowed string before invoking a generic resource
// validator or JSON marshaler. The encoded-size check then includes escaping,
// all punctuation and the enclosing protobuf, not just these lower bounds.
func validRequest(in Request, read bool) bool {
	if len(in.Operation) > 267 || !operationID.MatchString(in.Operation) || in.Root.Incarnation == nil ||
		read && (len(in.Sources) == 0 || len(in.Sources) > maxWireSources) || !read && in.Sources != nil {
		return false
	}
	budget := requestBudget(requestBytes)
	a := in.Root.Address
	if !budget.charge(in.Operation) || !budget.charge(in.Route.Connection) || in.Route.Connection == "" ||
		!budget.charge(*in.Root.Incarnation) || *in.Root.Incarnation == "" || !budget.admitAddress(a) {
		return false
	}
	for i, target := range in.Sources {
		if !budget.admitSource(target, a, in.Route) ||
			slices.ContainsFunc(in.Sources[:i], func(previous resourcev2.ReadTarget) bool { return previous.Type == target.Type }) {
			return false
		}
	}
	return true
}

type requestBudget int

func (b *requestBudget) charge(s string) bool {
	if len(s) >= int(*b) || !utf8.ValidString(s) {
		return false
	}
	*b -= requestBudget(len(s) + 1)
	return true
}

func (b *requestBudget) admitAddress(a resourcev2.ResourceAddress) bool {
	if !b.charge(a.Authority) || !b.charge(a.Provider) || !b.charge(a.Type) || !b.charge(a.ID) || len(a.Scope) > int(*b)/2 {
		return false
	}
	for _, sc := range a.Scope {
		if !b.charge(sc.Dimension) || !b.charge(sc.Value) {
			return false
		}
	}
	return resourcev2.ValidateAddress(a) == nil
}

func (b *requestBudget) admitSource(t resourcev2.ReadTarget, root resourcev2.ResourceAddress, route resourcev2.AccessRoute) bool {
	if t.Route != route || t.Provider != root.Provider || t.Type == root.Type && t.Authority != root.Authority ||
		!b.charge(t.Route.Connection) || !b.charge(t.Provider) || !b.charge(t.Authority) || !b.charge(t.Type) || !b.charge(t.Representation) ||
		len(t.Scope) > int(*b)/2 {
		return false
	}
	covered := 0
	for _, sc := range t.Scope {
		if !b.charge(sc.Dimension) {
			return false
		}
		index := slices.IndexFunc(root.Scope, func(s resourcev2.ScopeEntry) bool { return s.Dimension == sc.Dimension })
		if !b.admitConstraint(sc, root, t.Type, index) {
			return false
		}
		if index >= 0 {
			covered++
		}
	}
	return covered == len(root.Scope) && resourcev2.ValidateEnumerateRequest(resourcev2.EnumerateRequest{Target: t, PageSize: 0, Cursor: nil}) == nil
}

func (b *requestBudget) admitConstraint(sc resourcev2.ScopeConstraint, root resourcev2.ResourceAddress, sourceType string, index int) bool {
	if sc.Match == resourcev2.ScopeAny {
		return sc.Values == nil && index < 0 // Selection-only dimension, independently authorized by the broker.
	}
	if sc.Match != resourcev2.ScopeOneOf || sc.Values == nil || len(*sc.Values) != 1 || !b.charge((*sc.Values)[0]) {
		return false
	}
	value := (*sc.Values)[0]
	if index < 0 {
		return sourceType == root.Type && value == root.ID
	}
	return value == root.Scope[index].Value
}

// Use a closed, case-sensitive, duplicate-rejecting UTF-8 decoder. Count each
// collection before decoding its next element. Never decode arbitrary JSON
// into any: rows contain only validated strings or finite IEEE-754 numbers.
type wireSources []string

func (sources *wireSources) UnmarshalJSONFrom(d *jsontext.Decoder) error {
	return readArray(d, (*[]string)(sources), maxWireSources, func(d *jsontext.Decoder) (string, error) {
		t, err := d.ReadToken()
		if err != nil || t.Kind() != '"' {
			return "", errWire
		}
		s := t.String()
		if s == "" || len(s) > requestBytes || slices.Contains(*sources, s) {
			return "", errWire
		}
		return s, nil
	})
}

type wireCandidates []Candidate

func (rows *wireCandidates) UnmarshalJSONFrom(d *jsontext.Decoder) error {
	return readArray(d, (*[]Candidate)(rows), maxWireCandidates, readCandidate)
}

func readArray[T any](d *jsontext.Decoder, dst *[]T, limit int, item func(*jsontext.Decoder) (T, error)) error {
	if t, err := d.ReadToken(); err != nil || t.Kind() != '[' {
		return errWire
	}
	*dst = []T{}
	for d.PeekKind() != ']' {
		if len(*dst) >= limit {
			return errWire
		}
		value, err := item(d)
		if err != nil {
			return errWire
		}
		*dst = append(*dst, value)
	}
	_, err := d.ReadToken()
	return err
}

func decodeSources(data []byte, _ Request) ([]string, error) {
	var response struct {
		Sources wireSources `json:"sources"`
	}
	if json.Unmarshal(data, &response, json.RejectUnknownMembers(true)) != nil || len(response.Sources) == 0 {
		return nil, errWire
	}
	return response.Sources, nil
}

func decodePage(data []byte, in Request) (Page, error) {
	var wire struct {
		Sources  wireSources    `json:"sources"`
		Coverage string         `json:"coverage"`
		Rows     wireCandidates `json:"rows"`
	}
	if json.Unmarshal(data, &wire, json.RejectUnknownMembers(true)) != nil {
		return Page{}, errWire
	}
	p := Page{Sources: wire.Sources, Coverage: wire.Coverage, Rows: wire.Rows}
	if p.Rows == nil || len(p.Sources) == 0 ||
		p.Coverage != "partial" && p.Coverage != "complete" || p.Coverage == "complete" && len(in.Sources) != len(p.Sources) {
		return Page{}, errWire
	}
	for _, id := range p.Sources {
		if !slices.ContainsFunc(in.Sources, func(t resourcev2.ReadTarget) bool { return t.Type == id }) {
			return Page{}, errWire
		}
	}
	for _, row := range p.Rows {
		examined := false
		for _, ref := range row.Evidence {
			if !citationBound(in, ref, p.Sources) {
				return Page{}, errWire
			}
			examined = examined || slices.Contains(p.Sources, ref.Address.Type)
		}
		if !examined || row.Neighbor != nil && !citationBound(in, *row.Neighbor, nil) {
			return Page{}, errWire
		}
	}
	return p, nil
}

// The root's type in the source list denotes only this exact root, not its
// collection. Every other resource citation uses its own target's authority.
// These are shape and binding checks, not substitutes for the broker's Gets.
func citationBound(in Request, ref resourcev2.ResourceReference, families []string) bool {
	a, root := ref.Address, in.Root.Address
	if a.Provider != root.Provider || len(a.Scope) != len(root.Scope) {
		return false
	}
	for _, entry := range root.Scope {
		if !slices.Contains(a.Scope, entry) {
			return false
		}
	}
	if a.Type == root.Type {
		return a.Authority == root.Authority && a.ID == root.ID && *ref.Incarnation == *in.Root.Incarnation
	}
	return (families == nil || slices.Contains(families, a.Type)) && slices.ContainsFunc(in.Sources, func(t resourcev2.ReadTarget) bool {
		return t.Type == a.Type && t.Authority == a.Authority
	})
}

func readCandidate(d *jsontext.Decoder) (Candidate, error) {
	var c Candidate
	if t, err := d.ReadToken(); err != nil || t.Kind() != '{' {
		return Candidate{}, errWire
	}
	for d.PeekKind() != '}' {
		k, err := d.ReadToken()
		if err != nil || k.Kind() != '"' {
			return Candidate{}, errWire
		}
		switch k.String() {
		case "row":
			c.Row, err = readRow(d)
		case "evidence":
			err = readArray(d, &c.Evidence, maxWireEvidence, readReference)
		case "neighbor":
			var ref resourcev2.ResourceReference
			ref, err = readReference(d)
			c.Neighbor = &ref
		default:
			return Candidate{}, errWire
		}
		if err != nil {
			return Candidate{}, errWire
		}
	}
	if _, err := d.ReadToken(); err != nil || len(c.Row) == 0 || len(c.Evidence) == 0 {
		return Candidate{}, errWire
	}
	return c, nil
}

func readReference(d *jsontext.Decoder) (resourcev2.ResourceReference, error) {
	var r resourcev2.ResourceReference
	// The published resource decoder requires an exact address, a nonnull
	// dimension array and strict nested members. This RPC requires a UID too.
	if d.PeekKind() != '{' || json.UnmarshalDecode(d, &r) != nil || r.Incarnation == nil || *r.Incarnation == "" {
		return resourcev2.ResourceReference{}, errWire
	}
	return r, nil
}

func readRow(d *jsontext.Decoder) (map[string]any, error) {
	if t, err := d.ReadToken(); err != nil || t.Kind() != '{' {
		return nil, errWire
	}
	row := make(map[string]any)
	for d.PeekKind() != '}' {
		if len(row) >= maxWireFields {
			return nil, errWire
		}
		k, err := d.ReadToken()
		if err != nil || k.Kind() != '"' {
			return nil, errWire
		}
		key := k.String()
		if len(key) > 128 || !fieldName.MatchString(key) {
			return nil, errWire
		}
		t, err := d.ReadToken()
		if err != nil {
			return nil, errWire
		}
		row[key], err = readScalar(t)
		if err != nil {
			return nil, err
		}
	}
	_, err := d.ReadToken()
	return row, err
}

func readScalar(t jsontext.Token) (any, error) {
	if t.Kind() == jsontext.KindString {
		s := t.String()
		if len(s) > maxStringUnits*3 {
			return nil, errWire
		}
		units := 0
		for _, r := range s {
			units += utf16.RuneLen(r)
		}
		if units > maxStringUnits {
			return nil, errWire
		}
		return s, nil
	}
	if t.Kind() == jsontext.KindNumber {
		n, err := t.Float()
		if err == nil && !math.IsNaN(n) && !math.IsInf(n, 0) {
			return n, nil
		}
	}
	return nil, errWire
}
