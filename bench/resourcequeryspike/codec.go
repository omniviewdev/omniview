package main

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"cel.dev/cel-go/cel"
)

// Check duplicate keys before decoding maps/structs can discard evidence. This
// scan is byte/depth/item bounded; exact shape validation follows separately.
func strictJSON(b []byte, dst any) error {
	if !utf8.Valid(b) || !validJSONSurrogates(b) {
		return fail("INVALID_REQUEST", "invalid UTF-8 or unpaired JSON surrogate")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	items := 0
	var scan func(int, reflect.Type) error
	scan = func(depth int, shape reflect.Type) error {
		items++
		if depth > maxDepth || items > maxItems {
			return fail("RESOURCE_LIMIT", "JSON structure budget")
		}
		tok, err := d.Token()
		if err != nil {
			return fail("INVALID_REQUEST", "malformed JSON")
		}
		delim, ok := tok.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return fail("INVALID_REQUEST", "malformed object")
				}
				s, ok := key.(string)
				if !ok || seen[s] {
					return fail("INVALID_REQUEST", "duplicate or invalid object member")
				}
				seen[s] = true
				child, err := jsonMemberShape(shape, s)
				if err != nil {
					return err
				}
				if err := scan(depth+1, child); err != nil {
					return err
				}
			}
		case '[':
			for d.More() {
				if err := scan(depth+1, jsonElementShape(shape)); err != nil {
					return err
				}
			}
		default:
			return fail("INVALID_REQUEST", "unexpected JSON delimiter")
		}
		end, err := d.Token()
		if err != nil || (delim == '{' && end != json.Delim('}')) || (delim == '[' && end != json.Delim(']')) {
			return fail("INVALID_REQUEST", "unclosed JSON")
		}
		return nil
	}
	if err := scan(0, reflect.TypeOf(dst)); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return fail("INVALID_REQUEST", "trailing JSON")
	}
	d = json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return fail("INVALID_REQUEST", "unexpected JSON shape")
	}
	return nil
}

func DecodeRequest(b []byte) (Request, error) {
	var r Request
	if len(b) > maxRequestBytes {
		return r, fail("RESOURCE_LIMIT", "request byte budget")
	}
	trimmed := bytes.TrimSpace(b)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return r, fail("INVALID_REQUEST", "request must be object")
	}
	if err := strictJSON(b, &r); err != nil {
		return r, err
	}
	return r, nil
}

var canonicalInt = regexp.MustCompile(`^(0|-[1-9][0-9]*|[1-9][0-9]*)$`)
var canonicalUint = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)
var timestampForm = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$`)
var identifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func bindingCELType(t BindingType, depth int) (*cel.Type, error) {
	if depth > maxDepth {
		return nil, fail("RESOURCE_LIMIT", "declaration depth")
	}
	if (t.Kind == "list" && (t.Element == nil || t.Value != nil)) || ((t.Kind == "map" || t.Kind == "nullable") && (t.Value == nil || t.Element != nil)) {
		return nil, fail("INVALID_REQUEST", "malformed collection declaration")
	}
	if t.Kind != "list" && t.Kind != "map" && t.Kind != "nullable" && (t.Element != nil || t.Value != nil) {
		return nil, fail("INVALID_REQUEST", "scalar declaration has child")
	}
	switch t.Kind {
	case "bool":
		return cel.BoolType, nil
	case "string":
		return cel.StringType, nil
	case "int64":
		return cel.IntType, nil
	case "uint64":
		return cel.UintType, nil
	case "double":
		return cel.DoubleType, nil
	case "timestamp":
		return cel.TimestampType, nil
	case "list":
		e, err := bindingCELType(*t.Element, depth+1)
		if err != nil {
			return nil, err
		}
		return cel.ListType(e), nil
	case "map":
		e, err := bindingCELType(*t.Value, depth+1)
		if err != nil {
			return nil, err
		}
		return cel.MapType(cel.StringType, e), nil
	case "nullable":
		_, err := bindingCELType(*t.Value, depth+1)
		// Explicit dynamic checking boundary; strict host admission is retained.
		return cel.DynType, err
	default:
		return nil, fail("INVALID_REQUEST", "unknown binding declaration")
	}
}

func admitValue(t BindingType, v Value, depth int) (any, Value, error) {
	bad := func() (any, Value, error) {
		return nil, Value{}, fail("INVALID_REQUEST", "binding type or value mismatch")
	}
	if depth > maxDepth {
		return nil, Value{}, fail("RESOURCE_LIMIT", "binding depth")
	}
	if t.Kind == "nullable" {
		if v.Kind == "null" {
			if len(v.Value) != 0 {
				return bad()
			}
			return nil, v, nil
		}
		return admitValue(*t.Value, v, depth+1)
	}
	if t.Kind != v.Kind || len(v.Value) == 0 || bytes.Equal(bytes.TrimSpace(v.Value), []byte("null")) {
		return bad()
	}
	var admitted any
	switch t.Kind {
	case "string", "int64", "uint64", "timestamp":
		var s string
		if err := strictJSON(v.Value, &s); err != nil {
			return bad()
		}
		switch t.Kind {
		case "string":
			admitted = s
		case "int64":
			if !canonicalInt.MatchString(s) {
				return bad()
			}
			n, err := strconv.ParseInt(s, 10, 64)
			if err != nil {
				return bad()
			}
			admitted = n
		case "uint64":
			if !canonicalUint.MatchString(s) {
				return bad()
			}
			n, err := strconv.ParseUint(s, 10, 64)
			if err != nil {
				return bad()
			}
			admitted = n
		case "timestamp":
			if !timestampForm.MatchString(s) {
				return bad()
			}
			// RFC3339 offsets are bounded independently; Go permits +24:00.
			if s[len(s)-1] != 'Z' {
				h, _ := strconv.Atoi(s[len(s)-5 : len(s)-3])
				m, _ := strconv.Atoi(s[len(s)-2:])
				if h > 23 || m > 59 {
					return bad()
				}
			}
			n, err := time.Parse(time.RFC3339Nano, s)
			if err != nil || n.Year() < 1 || n.UTC().Year() < 1 || n.UTC().Year() > 9999 {
				return bad()
			}
			admitted = n.UTC()
			v = value("timestamp", n.UTC().Format(time.RFC3339Nano))
		}
	case "bool":
		var b bool
		if err := strictJSON(v.Value, &b); err != nil || string(v.Value) == "null" {
			return bad()
		}
		admitted = b
	case "double":
		var n float64
		if err := strictJSON(v.Value, &n); err != nil || string(v.Value) == "null" || math.IsNaN(n) || math.IsInf(n, 0) {
			return bad()
		}
		admitted = n
	case "list":
		var list []Value
		if err := strictJSON(v.Value, &list); err != nil || list == nil {
			return bad()
		}
		out := make([]any, len(list))
		for i, x := range list {
			a, n, err := admitValue(*t.Element, x, depth+1)
			if err != nil {
				return nil, Value{}, err
			}
			out[i], list[i] = a, n
		}
		admitted = out
		v = value("list", list)
	case "map":
		var m map[string]Value
		if err := strictJSON(v.Value, &m); err != nil || m == nil {
			return bad()
		}
		out := make(map[string]any, len(m))
		for k, x := range m {
			a, n, err := admitValue(*t.Value, x, depth+1)
			if err != nil {
				return nil, Value{}, err
			}
			out[k], m[k] = a, n
		}
		admitted = out
		v = value("map", m)
	default:
		return bad()
	}
	return admitted, v, nil
}

func validParameter(name string) bool {
	switch name {
	case "resource", "true", "false", "null", "in", "as", "break", "const", "continue", "else", "for", "function", "if", "import", "let", "loop", "package", "namespace", "return", "var", "void", "while", "int", "uint", "double", "bool", "string", "bytes", "list", "map", "type", "timestamp", "duration", "dyn", "size", "has":
		return false
	}
	return identifier.MatchString(name) && !strings.HasPrefix(name, "__")
}

func admitBindings(r Request) ([]cel.EnvOption, map[string]any, map[string]Value, error) {
	if len(r.Declarations) > 128 {
		return nil, nil, nil, fail("RESOURCE_LIMIT", "declaration count budget")
	}
	if len(r.Declarations) != len(r.Bindings) {
		return nil, nil, nil, fail("INVALID_REQUEST", "missing or extra binding")
	}
	opts := []cel.EnvOption{cel.Variable("resource", cel.DynType)}
	activation := map[string]any{}
	normalized := map[string]Value{}
	for name, t := range r.Declarations {
		v, ok := r.Bindings[name]
		if !ok || !validParameter(name) {
			return nil, nil, nil, fail("INVALID_REQUEST", "invalid parameter identifier or missing binding")
		}
		ct, err := bindingCELType(t, 0)
		if err != nil {
			return nil, nil, nil, err
		}
		a, n, err := admitValue(t, v, 0)
		if err != nil {
			return nil, nil, nil, err
		}
		opts = append(opts, cel.Variable(name, ct))
		activation[name], normalized[name] = a, n
	}
	return opts, activation, normalized, nil
}

// Fixture-only dynamic numeric classification: exact integral lexemes retain
// int64/uint64 domains. Fractional documents are outside this probe, not banned
// by the proposed production profile. Tagged double bindings remain supported.
func admitDocument(raw []byte) (map[string]any, error) {
	if len(raw) > maxRequestBytes {
		return nil, fail("RESOURCE_LIMIT", "document bytes")
	}
	var body map[string]any
	if err := strictJSON(raw, &body); err != nil {
		return nil, err
	}
	if body == nil {
		return nil, fail("INVALID_REQUEST", "document must be object")
	}
	var convert func(any) (any, error)
	convert = func(v any) (any, error) {
		switch x := v.(type) {
		case json.Number:
			if n, err := strconv.ParseInt(string(x), 10, 64); err == nil {
				return n, nil
			}
			if n, err := strconv.ParseUint(string(x), 10, 64); err == nil {
				return n, nil
			}
			return nil, fail("UNSUPPORTED", "fixture document numeric domain not admitted")
		case map[string]any:
			for k, a := range x {
				b, err := convert(a)
				if err != nil {
					return nil, err
				}
				x[k] = b
			}
			return x, nil
		case []any:
			for i, a := range x {
				b, err := convert(a)
				if err != nil {
					return nil, err
				}
				x[i] = b
			}
			return x, nil
		default:
			return v, nil
		}
	}
	v, err := convert(body)
	if err != nil {
		return nil, err
	}
	return v.(map[string]any), nil
}
