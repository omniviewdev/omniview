package main

import (
	"encoding/json"
	"reflect"
	"strings"
)

// Derive exact DTO names from their sole declaration; never case-fold arbitrary
// map keys. Raw tagged payloads are validated with their declared type later.
var exactDTOFields = func() map[reflect.Type]map[string]reflect.Type {
	out := map[reflect.Type]map[string]reflect.Type{}
	for _, t := range []reflect.Type{reflect.TypeFor[Request](), reflect.TypeFor[BindingType](), reflect.TypeFor[Value](), reflect.TypeFor[Constraint](), reflect.TypeFor[Clause](), reflect.TypeFor[TextClause](), reflect.TypeFor[DraftRequest]()} {
		fields := map[string]reflect.Type{}
		for i := range t.NumField() {
			field := t.Field(i)
			name := strings.Split(field.Tag.Get("json"), ",")[0]
			if name != "" && name != "-" {
				fields[name] = field.Type
			}
		}
		out[t] = fields
	}
	return out
}()

func jsonShape(t reflect.Type) reflect.Type {
	for t != nil && t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t == reflect.TypeFor[json.RawMessage]() {
		return nil
	}
	return t
}

func jsonMemberShape(t reflect.Type, name string) (reflect.Type, error) {
	t = jsonShape(t)
	if t == nil {
		return nil, nil
	}
	switch t.Kind() {
	case reflect.Struct:
		field, ok := exactDTOFields[t][name]
		if !ok {
			return nil, fail("INVALID_REQUEST", "unexpected exact DTO member")
		}
		return field, nil
	case reflect.Map:
		return t.Elem(), nil
	default:
		return nil, nil // ordinary JSON type admission rejects mismatched shape
	}
}

func jsonElementShape(t reflect.Type) reflect.Type {
	t = jsonShape(t)
	if t != nil && (t.Kind() == reflect.Slice || t.Kind() == reflect.Array) {
		return t.Elem()
	}
	return nil
}

// encoding/json replaces isolated UTF-16 escapes with U+FFFD. Validate raw
// string tokens first so execution and the returned original value cannot
// disagree. Escaped backslashes are skipped as pairs, never read as \u escapes.
func validJSONSurrogates(b []byte) bool {
	for i := 0; i < len(b); i++ {
		if b[i] != '"' {
			continue
		}
		i++
		for i < len(b) && b[i] != '"' {
			if b[i] != '\\' {
				i++
				continue
			}
			if i+1 >= len(b) {
				return false
			}
			if b[i+1] != 'u' {
				i += 2
				continue
			}
			first, ok := jsonHexCodeUnit(b, i)
			if !ok {
				return false
			}
			if first >= 0xdc00 && first <= 0xdfff {
				return false
			}
			if first >= 0xd800 && first <= 0xdbff {
				second, ok := jsonHexCodeUnit(b, i+6)
				if !ok || second < 0xdc00 || second > 0xdfff {
					return false
				}
				i += 12
			} else {
				i += 6
			}
		}
	}
	return true
}

func jsonHexCodeUnit(b []byte, offset int) (uint16, bool) {
	if offset+6 > len(b) || b[offset] != '\\' || b[offset+1] != 'u' {
		return 0, false
	}
	var value uint16
	for _, digit := range b[offset+2 : offset+6] {
		value <<= 4
		switch {
		case digit >= '0' && digit <= '9':
			value += uint16(digit - '0')
		case digit >= 'a' && digit <= 'f':
			value += uint16(digit - 'a' + 10)
		case digit >= 'A' && digit <= 'F':
			value += uint16(digit - 'A' + 10)
		default:
			return 0, false
		}
	}
	return value, true
}
