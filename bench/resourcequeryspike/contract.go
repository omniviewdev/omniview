// This package is an isolated P01 design/spike, not a product query service.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"unicode/utf8"
)

const (
	probeVersion    = "omniview.p01-spike.v1"
	maxRequestBytes = 65536
	maxSourceBytes  = 16384
	maxDepth        = 32
	maxItems        = 4096
)

type BindingType struct {
	Kind    string       `json:"kind"`
	Element *BindingType `json:"element,omitempty"`
	Value   *BindingType `json:"value,omitempty"`
}

type Value struct {
	Kind  string          `json:"kind"`
	Value json.RawMessage `json:"value,omitempty"`
}

func value(kind string, v any) Value {
	b, _ := json.Marshal(v)
	return Value{Kind: kind, Value: b}
}

type Constraint struct {
	Kind   string   `json:"kind"`
	Values []string `json:"values,omitempty"`
}

type Clause struct {
	Kind      string   `json:"kind"`
	Path      []string `json:"path"`
	Parameter string   `json:"parameter,omitempty"`
}

type TextClause struct {
	Fields [][]string `json:"fields"`
	Term   string     `json:"term"`
}

type Request struct {
	Version                  string                 `json:"version"`
	Scenario                 string                 `json:"scenario"`
	Scope                    map[string]Constraint  `json:"scope"`
	Source                   string                 `json:"source"`
	Declarations             map[string]BindingType `json:"declarations"`
	Bindings                 map[string]Value       `json:"bindings"`
	Builder                  *Clause                `json:"builder,omitempty"`
	Text                     *TextClause            `json:"text,omitempty"`
	PageSize                 int                    `json:"pageSize"`
	Offset                   int                    `json:"offset,omitempty"`
	Mode                     string                 `json:"mode,omitempty"`
	OrderPath                []string               `json:"orderPath,omitempty"`
	Candidates               []string               `json:"candidates,omitempty"` // verification-only finite prefilter
	CostLimit                uint64                 `json:"costLimit,omitempty"`
	Draft                    *DraftRequest          `json:"draft,omitempty"`
	IncompleteRepresentation bool                   `json:"incompleteRepresentation,omitempty"` // conservative coverage negative control
}

type DraftRequest struct {
	Source              string                 `json:"source"`
	Cursor              int                    `json:"cursor"`
	DocumentRevision    string                 `json:"documentRevision"`
	EnvironmentRevision string                 `json:"environmentRevision"`
	Declarations        map[string]BindingType `json:"declarations"`
}

type Record struct {
	Name        string
	Provider    string
	Authority   string
	Type        string
	Scope       map[string]string
	ID          string
	Incarnation string
	Revision    string
	Body        json.RawMessage
}

type Scenario struct {
	Name      string
	Profile   string
	Type      string
	Selection map[string][]string
	Schema    json.RawMessage
	Pages     []struct {
		Cursor  string
		Next    string
		Records []string
	}
	Coverage struct {
		Enumeration string
		Consistency string
		Limitations []string
	}
	Freshness string
}

type Corpus struct {
	Records       []Record
	Scenarios     []Scenario
	IdentityCases []struct {
		Name  string
		Left  string
		Right string
		Equal bool
	}
}

type Response struct {
	Names     []string          `json:"names"`
	Rows      []Row             `json:"rows"`
	Bindings  map[string]Value  `json:"bindings"`
	Coverage  any               `json:"coverage"`
	Freshness string            `json:"freshness"`
	Draft     *Draft            `json:"draft,omitempty"`
	Error     *ObservationError `json:"error,omitempty"`
}

type Row struct {
	Name        string `json:"name"`
	AddressKey  string `json:"addressKey"`
	Incarnation string `json:"incarnation,omitempty"`
	Revision    string `json:"sourceRevision,omitempty"`
}

// ObservationError is a private probe observation, NOT a competing AppError ABI.
// Codes consume C02 meanings. No provider-controlled public error is accepted.
type ObservationError struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

func (e *ObservationError) Error() string { return e.Code + ": " + e.Detail }
func fail(code, detail string) error      { return &ObservationError{Code: code, Detail: detail} }
func code(err error) string {
	if err == nil {
		return ""
	}
	if e, ok := err.(*ObservationError); ok {
		return e.Code
	}
	return "INTERNAL"
}

func canonicalJSON(v any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b.Bytes(), []byte{'\n'}), nil
}

func AddressKey(r Record) (string, error) {
	dims := []string{}
	switch r.Provider + "/" + r.Type {
	case "cloud/compute/instance":
		dims = []string{"account", "region"}
	case "container/container":
		dims = []string{"engine"}
	case "hypervisor/vm", "hypervisor/host", "hypervisor/disk":
		dims = []string{"node"}
	default:
		return "", fail("UNSUPPORTED", "identity type outside declared P44 fixture subset")
	}
	if len(dims) != len(r.Scope) {
		return "", fail("INVALID_REQUEST", "identity dimensions differ")
	}
	for _, s := range []string{r.Provider, r.Authority, r.Type, r.ID} {
		if s == "" || !utf8.ValidString(s) {
			return "", fail("INVALID_REQUEST", "invalid opaque identity")
		}
	}
	sort.Strings(dims)
	tuple := make([][2]string, 0, len(dims))
	for _, k := range dims {
		v, ok := r.Scope[k]
		if !ok || k == "" || v == "" || !utf8.ValidString(k) || !utf8.ValidString(v) {
			return "", fail("INVALID_REQUEST", "invalid identity scope")
		}
		tuple = append(tuple, [2]string{k, v})
	}
	b, err := canonicalJSON([]any{"omniview.address.v1", r.Provider, r.Authority, r.Type, tuple, r.ID})
	return string(b), err
}

func (c Corpus) scenario(name string) (Scenario, error) {
	for _, s := range c.Scenarios {
		if s.Name == name {
			return s, nil
		}
	}
	return Scenario{}, fail("INVALID_REQUEST", fmt.Sprintf("unknown finite scenario %q", name))
}
