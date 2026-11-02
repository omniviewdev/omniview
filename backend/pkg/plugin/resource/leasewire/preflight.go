package leasewire

import (
	"encoding/json"
	"reflect"
	"strings"
	"unicode/utf8"
)

// preflight bounds encoded JSON before encoding/json can allocate its output.
// It intentionally overestimates structure and includes omitted fields. This
// may reject a near-limit frame early but cannot admit a larger encoded frame.
// Recursion and node counts also bound work on malicious or cyclic values.
func preflight(value any) error {
	budget := sizeBudget{}
	return budget.visit(reflect.ValueOf(value), 0)
}

type sizeBudget struct{ bytes, nodes int }

func (b *sizeBudget) add(n int) error {
	if n < 0 || n > MaxFrameBytes-b.bytes {
		return ErrFrameTooLarge
	}
	b.bytes += n
	return nil
}

func (b *sizeBudget) string(s string) error {
	if err := b.add(2); err != nil {
		return err
	}
	for len(s) > 0 {
		r, n := utf8.DecodeRuneInString(s)
		if r == utf8.RuneError && n == 1 {
			n = 1
			if err := b.add(6); err != nil {
				return err
			}
		} else {
			size := n
			if r < 0x20 || r == '<' || r == '>' || r == '&' || r == '\u2028' || r == '\u2029' {
				size = 6
			} else if r == '"' || r == '\\' {
				size = 2
			}
			if err := b.add(size); err != nil {
				return err
			}
		}
		s = s[n:]
	}
	return nil
}

var rawMessageType = reflect.TypeOf(json.RawMessage{})

func (b *sizeBudget) visit(v reflect.Value, depth int) error {
	b.nodes++
	if depth > 64 || b.nodes > 100000 {
		return ErrFrameTooLarge
	}
	if !v.IsValid() {
		return b.add(4)
	}
	if v.Type() == rawMessageType {
		raw := v.Bytes()
		for i := 0; i < len(raw); i++ {
			n := 1
			if raw[i] == '<' || raw[i] == '>' || raw[i] == '&' {
				n = 6
			}
			if i+2 < len(raw) && raw[i] == 0xe2 && raw[i+1] == 0x80 && (raw[i+2] == 0xa8 || raw[i+2] == 0xa9) {
				n = 6
				i += 2
			}
			if err := b.add(n); err != nil {
				return err
			}
		}
		return nil
	}
	switch v.Kind() {
	case reflect.Interface, reflect.Pointer:
		if v.IsNil() {
			return b.add(4)
		}
		return b.visit(v.Elem(), depth+1)
	case reflect.String:
		return b.string(v.String())
	case reflect.Bool:
		return b.add(5)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		return b.add(32)
	case reflect.Slice, reflect.Array:
		if err := b.add(2); err != nil {
			return err
		}
		for i := range v.Len() {
			if err := b.add(1); err != nil {
				return err
			}
			if err := b.visit(v.Index(i), depth+1); err != nil {
				return err
			}
		}
		return nil
	case reflect.Map:
		if v.Type().Key().Kind() != reflect.String {
			return ErrInvalid
		}
		if err := b.add(2); err != nil {
			return err
		}
		it := v.MapRange()
		for it.Next() {
			if err := b.string(it.Key().String()); err != nil {
				return err
			}
			if err := b.add(2); err != nil {
				return err
			}
			if err := b.visit(it.Value(), depth+1); err != nil {
				return err
			}
		}
		return nil
	case reflect.Struct:
		if err := b.add(2); err != nil {
			return err
		}
		typ := v.Type()
		for i := range v.NumField() {
			field := typ.Field(i)
			if field.PkgPath != "" {
				continue
			}
			tag := field.Tag.Get("json")
			name, _, _ := strings.Cut(tag, ",")
			if name == "-" { // resourcev2.Value's tagged JSON uses these fields in its custom codec.
				if typ.PkgPath() != "github.com/omniviewdev/plugin-sdk/pkg/resource/v2" || typ.Name() != "Value" {
					continue
				}
				name = field.Name
			}
			if name == "" {
				name = field.Name
			}
			if err := b.string(name); err != nil {
				return err
			}
			if err := b.add(2); err != nil {
				return err
			}
			if err := b.visit(v.Field(i), depth+1); err != nil {
				return err
			}
		}
		return nil
	default:
		return ErrInvalid
	}
}
