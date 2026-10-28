package main

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"time"

	"cel.dev/cel-go/cel"
	"cel.dev/cel-go/common/types"
	"cel.dev/cel-go/common/types/ref"
	"cel.dev/cel-go/common/types/traits"
)

// This private proof exercises the proposed tagged document and native-result
// seam. It is not an SDK/source protocol, schema adapter or query planner.
func admitTaggedDocument(v Value, depth int, remaining *int) (any, error) {
	*remaining--
	if depth > maxDepth || *remaining < 0 {
		return nil, fail("RESOURCE_LIMIT", "tagged document structure budget")
	}
	switch v.Kind {
	case "null":
		if len(v.Value) != 0 {
			return nil, fail("INVALID_REQUEST", "null has no payload")
		}
		return nil, nil
	case "map":
		var entries map[string]Value
		if err := strictJSON(v.Value, &entries); err != nil {
			return nil, err
		}
		if entries == nil {
			return nil, fail("INVALID_REQUEST", "map payload required")
		}
		result := make(map[string]any, len(entries))
		for key, child := range entries {
			admitted, err := admitTaggedDocument(child, depth+1, remaining)
			if err != nil {
				return nil, err
			}
			result[key] = admitted
		}
		return result, nil
	case "list":
		var entries []Value
		if err := strictJSON(v.Value, &entries); err != nil {
			return nil, err
		}
		if entries == nil {
			return nil, fail("INVALID_REQUEST", "list payload required")
		}
		result := make([]any, len(entries))
		for i, child := range entries {
			admitted, err := admitTaggedDocument(child, depth+1, remaining)
			if err != nil {
				return nil, err
			}
			result[i] = admitted
		}
		return result, nil
	case "bool", "string", "int64", "uint64", "double", "timestamp":
		admitted, _, err := admitValue(BindingType{Kind: v.Kind}, v, depth)
		return admitted, err
	default:
		return nil, fail("INVALID_REQUEST", "unknown document value tag")
	}
}

func encodeNativeValue(v ref.Val, depth int, remaining, textBytes *int) (Value, error) {
	*remaining--
	if depth > maxDepth || *remaining < 0 {
		return Value{}, fail("RESOURCE_LIMIT", "native result structure budget")
	}
	switch n := v.(type) {
	case types.Null:
		return Value{Kind: "null"}, nil
	case types.Bool:
		return value("bool", bool(n)), nil
	case types.String:
		*textBytes -= len(n)
		if *textBytes < 0 {
			return Value{}, fail("RESOURCE_LIMIT", "native result text budget")
		}
		return value("string", string(n)), nil
	case types.Int:
		return value("int64", strconv.FormatInt(int64(n), 10)), nil
	case types.Uint:
		return value("uint64", strconv.FormatUint(uint64(n), 10)), nil
	case types.Double:
		if math.IsNaN(float64(n)) || math.IsInf(float64(n), 0) {
			return Value{}, fail("INVALID_REQUEST", "nonfinite native result")
		}
		return value("double", float64(n)), nil
	case types.Timestamp:
		instant := n.Value().(time.Time).UTC()
		if instant.Year() < 1 || instant.Year() > 9999 {
			return Value{}, fail("INVALID_REQUEST", "timestamp result outside wire range")
		}
		return value("timestamp", instant.Format(time.RFC3339Nano)), nil
	case traits.Lister:
		count, ok := n.Size().(types.Int)
		if !ok || count < 0 || int64(count) > int64(*remaining) {
			return Value{}, fail("RESOURCE_LIMIT", "native list result budget")
		}
		entries := make([]Value, int(count))
		for i := range entries {
			child, err := encodeNativeValue(n.Get(types.Int(i)), depth+1, remaining, textBytes)
			if err != nil {
				return Value{}, err
			}
			entries[i] = child
		}
		return value("list", entries), nil
	case traits.Mapper:
		count, ok := n.Size().(types.Int)
		if !ok || count < 0 || int64(count) > int64(*remaining) {
			return Value{}, fail("RESOURCE_LIMIT", "native map result budget")
		}
		entries := make(map[string]Value, int(count))
		iterator := n.Iterator()
		for iterator.HasNext() == types.True {
			key, ok := iterator.Next().(types.String)
			if !ok {
				return Value{}, fail("UNSUPPORTED", "native map wire keys must be strings")
			}
			*textBytes -= len(key)
			if *textBytes < 0 {
				return Value{}, fail("RESOURCE_LIMIT", "native result key budget")
			}
			child, err := encodeNativeValue(n.Get(key), depth+1, remaining, textBytes)
			if err != nil {
				return Value{}, err
			}
			entries[string(key)] = child
		}
		return value("map", entries), nil
	default:
		return Value{}, fail("UNSUPPORTED", "native result has no public value variant")
	}
}

func executeValueProof(ctx context.Context, r Request) (Response, error) {
	out := Response{Names: []string{}, Rows: []Row{}}
	if r.Document == nil || r.Document.Kind != "map" || r.Draft != nil || r.Builder != nil || r.Text != nil || len(r.OrderPath) != 0 || r.Candidates != nil || r.IncompleteRepresentation {
		return out, fail("INVALID_REQUEST", "value proof requires complete tagged map document")
	}
	if len(r.Source) == 0 {
		return out, fail("INVALID_REQUEST", "value proof source required")
	}
	if len(r.Source) > maxSourceBytes {
		return out, fail("RESOURCE_LIMIT", "value proof source budget")
	}
	remaining := maxItems
	document, err := admitTaggedDocument(*r.Document, 0, &remaining)
	if err != nil {
		return out, err
	}
	opts, activation, _, err := admitBindings(r)
	if err != nil {
		return out, err
	}
	activation["resource"] = document
	opts = append(opts, cel.CrossTypeNumericComparisons(true), cel.ParserRecursionLimit(64), cel.ParserExpressionSizeLimit(maxSourceBytes))
	env, err := cel.NewEnv(opts...)
	if err != nil {
		return out, fail("INVALID_REQUEST", "value proof environment")
	}
	ast, issues := env.Compile(r.Source)
	if issues != nil && issues.Err() != nil {
		return out, fail("INVALID_REQUEST", issues.String())
	}
	cost := r.CostLimit
	if cost == 0 {
		cost = 100000
	}
	if cost > 100000 {
		return out, fail("RESOURCE_LIMIT", "value proof runtime cost budget")
	}
	program, err := env.Program(ast, cel.EvalOptions(cel.OptTrackCost, cel.OptOptimize), cel.CostLimit(cost), cel.InterruptCheckFrequency(1))
	if err != nil {
		return out, fail("INVALID_REQUEST", "value proof program")
	}
	native, details, err := program.ContextEval(ctx, activation)
	if err != nil {
		if ctx.Err() != nil {
			return out, cancelError(ctx.Err())
		}
		if details != nil && details.ActualCost() != nil && *details.ActualCost() > cost {
			return out, fail("RESOURCE_LIMIT", "value proof runtime cost")
		}
		return out, fail("INVALID_REQUEST", "value proof evaluation")
	}
	remaining = maxItems
	textBytes := maxRequestBytes
	encoded, err := encodeNativeValue(native, 0, &remaining, &textBytes)
	if err != nil {
		return out, err
	}
	wire, err := json.Marshal(encoded)
	if err != nil {
		return out, fail("INVALID_REQUEST", "native result encoding")
	}
	if len(wire) > maxRequestBytes {
		return out, fail("RESOURCE_LIMIT", "native result byte budget")
	}
	if err := ctx.Err(); err != nil {
		return out, cancelError(err)
	}
	out.Evaluated = &encoded
	return out, nil
}
