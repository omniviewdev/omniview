package resourcecatalog

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/url"
	"strconv"
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	codeInvalidRequest = "INVALID_REQUEST"
	codeUnsupported    = "UNSUPPORTED"
	codeResourceLimit  = "RESOURCE_LIMIT"
	codeResetRequired  = "RESET_REQUIRED"
	codeNotFound       = "NOT_FOUND"
	codeUnavailable    = "UNAVAILABLE"
	codeCancelled      = "CANCELLED"
	codeTimeout        = "TIMEOUT"

	// maxNumberExponent bounds decimal exponents accepted for exact big.Rat
	// bounds so a tiny token cannot expand into an enormous rational.
	maxNumberExponent = 1024
)

func invalidf(format string, args ...any) error {
	return resourcev2.NewError(codeInvalidRequest, fmt.Sprintf(format, args...))
}

// limitf reports a policy ceiling breach; the message always names the field.
func limitf(field string, ceiling int64, pointer string) error {
	if pointer == "" {
		return resourcev2.NewError(codeResourceLimit, fmt.Sprintf("schema exceeds %s (%d)", field, ceiling))
	}
	return resourcev2.NewError(codeResourceLimit, fmt.Sprintf("schema exceeds %s (%d) at %s", field, ceiling, pointer))
}

// contextError classifies a done context as CANCELLED or TIMEOUT.
func contextError(ctx context.Context) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return resourcev2.NewError(codeTimeout, "Schema resolution timed out.")
	}
	return resourcev2.NewError(codeCancelled, "Schema resolution was cancelled.")
}

// decodeDocument admits raw bytes with the SDK JSON checks (duplicate keys,
// invalid UTF-8, structural budgets) and decodes them with exact numbers.
func decodeDocument(raw []byte) (any, error) {
	if err := resourcev2.ValidateJSON(raw); err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var tree any
	if err := decoder.Decode(&tree); err != nil {
		return nil, invalidf("schema document is not valid JSON")
	}
	return tree, nil
}

// escapePointerToken applies RFC6901 escaping to one reference token.
func escapePointerToken(token string) string {
	if !strings.ContainsAny(token, "~/") {
		return token
	}
	return strings.ReplaceAll(strings.ReplaceAll(token, "~", "~0"), "/", "~1")
}

func childPointer(parent string, tokens ...string) string {
	var b strings.Builder
	b.WriteString(parent)
	for _, t := range tokens {
		b.WriteByte('/')
		b.WriteString(escapePointerToken(t))
	}
	return b.String()
}

// fragmentPointer converts a local "#..." URI fragment into a decoded RFC6901
// pointer. ok is false for fragments that are not JSON pointers (anchors) or
// that are malformed.
func fragmentPointer(fragment string) (string, bool) {
	if !strings.HasPrefix(fragment, "#") {
		return "", false
	}
	pointer, err := url.PathUnescape(fragment[1:])
	if err != nil {
		return "", false
	}
	if pointer != "" && !strings.HasPrefix(pointer, "/") {
		return "", false
	}
	for i := 0; i < len(pointer); i++ {
		if pointer[i] == '~' {
			if i+1 == len(pointer) || (pointer[i+1] != '0' && pointer[i+1] != '1') {
				return "", false
			}
			i++
		}
	}
	return pointer, true
}

func isIntegralToken(n json.Number) bool { return !strings.ContainsAny(string(n), ".eE") }

// numberRat converts a JSON number token into an exact rational.
func numberRat(raw any, pointer, keyword string) (*big.Rat, error) {
	n, ok := raw.(json.Number)
	if !ok {
		return nil, invalidf("schema keyword %q at %s must be a number", keyword, pointer)
	}
	s := string(n)
	if i := strings.IndexAny(s, "eE"); i >= 0 {
		exp, err := strconv.Atoi(strings.TrimPrefix(s[i+1:], "+"))
		if err != nil || exp > maxNumberExponent || exp < -maxNumberExponent {
			return nil, invalidf("schema keyword %q at %s has an unsupported exponent", keyword, pointer)
		}
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return nil, invalidf("schema keyword %q at %s must be a number", keyword, pointer)
	}
	return r, nil
}

// numberUint32 converts a non-negative integral JSON number that fits uint32.
func numberUint32(raw any, pointer, keyword string) (*uint32, error) {
	r, err := numberRat(raw, pointer, keyword)
	if err != nil {
		return nil, err
	}
	if !r.IsInt() || r.Sign() < 0 || r.Num().Cmp(big.NewInt(math.MaxUint32)) > 0 {
		return nil, invalidf("schema keyword %q at %s must be a non-negative integer no greater than %d", keyword, pointer, uint32(math.MaxUint32))
	}
	return new(uint32(r.Num().Uint64())), nil
}

// jsonValue maps a decoded JSON value onto a tagged resource value: integral
// number tokens become int64 (uint64 above MaxInt64), rejecting tokens outside
// both integer ranges. Every other number token becomes double.
func jsonValue(raw any, pointer string) (resourcev2.Value, error) {
	switch v := raw.(type) {
	case nil:
		return resourcev2.Value{Kind: "null"}, nil
	case bool:
		return resourcev2.Value{Kind: "bool", Bool: v}, nil
	case string:
		return resourcev2.Value{Kind: "string", String: v}, nil
	case json.Number:
		return numberValue(v, pointer)
	case []any:
		list := make([]resourcev2.Value, len(v))
		for i, item := range v {
			value, err := jsonValue(item, childPointer(pointer, strconv.Itoa(i)))
			if err != nil {
				return resourcev2.Value{}, err
			}
			list[i] = value
		}
		return resourcev2.Value{Kind: "list", List: list}, nil
	case map[string]any:
		m := make(map[string]resourcev2.Value, len(v))
		for k, item := range v {
			value, err := jsonValue(item, childPointer(pointer, k))
			if err != nil {
				return resourcev2.Value{}, err
			}
			m[k] = value
		}
		return resourcev2.Value{Kind: "map", Map: m}, nil
	default:
		return resourcev2.Value{}, invalidf("schema value at %s has an unsupported JSON type", pointer)
	}
}

func numberValue(n json.Number, pointer string) (resourcev2.Value, error) {
	s := string(n)
	if isIntegralToken(n) {
		if i, err := strconv.ParseInt(s, 10, 64); err == nil {
			return resourcev2.Value{Kind: "int64", Int: strconv.FormatInt(i, 10)}, nil
		}
		if u, err := strconv.ParseUint(s, 10, 64); err == nil {
			return resourcev2.Value{Kind: "uint64", Uint: strconv.FormatUint(u, 10)}, nil
		}
		return resourcev2.Value{}, invalidf("schema integer at %s is outside the int64 and uint64 ranges", pointer)
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
		return resourcev2.Value{}, invalidf("schema number at %s is not a finite double", pointer)
	}
	return resourcev2.Value{Kind: "double", Double: f}, nil
}
