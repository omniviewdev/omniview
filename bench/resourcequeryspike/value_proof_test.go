package main

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"testing"
	"time"

	"cel.dev/cel-go/common/types"
)

func TestValueProofLifecycleAndCost(t *testing.T) {
	document := value("map", map[string]Value{"items": value("list", []Value{value("int64", "1"), value("int64", "2")})})
	r := Request{Version: probeVersion, Mode: "valueProof", Document: &document, Source: "resource.items.all(x, x > 0)", CostLimit: 1}
	if _, err := Execute(context.Background(), r, Corpus{}); code(err) != "RESOURCE_LIMIT" {
		t.Fatalf("native cost: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Execute(ctx, r, Corpus{}); code(err) != "CANCELLED" {
		t.Fatalf("preflight cancellation: %v", err)
	}
	r.CostLimit = 100000
	r.Source = "resource.items.map(x, x + 1)"
	out, err := Execute(context.Background(), r, Corpus{})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(out.Evaluated)
	if string(encoded) != `{"kind":"list","value":[{"kind":"int64","value":"2"},{"kind":"int64","value":"3"}]}` {
		t.Fatalf("computed result: %s", encoded)
	}
}

func TestNativeResultWireRejectsNonfinite(t *testing.T) {
	for _, n := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		items, bytes := maxItems, maxRequestBytes
		if _, err := encodeNativeValue(types.Double(n), 0, &items, &bytes); code(err) != "INVALID_REQUEST" {
			t.Fatalf("nonfinite result %v: %v", n, err)
		}
	}
}

// Includes strict request/document admission, compilation, native optimized
// evaluation, native-result encoding and final JSON. No cached-program claim.
func BenchmarkValueProof(b *testing.B) {
	for _, size := range []int{1, 64, 256} {
		b.Run(strconv.Itoa(size), func(b *testing.B) {
			items := make([]Value, size)
			for i := range items {
				items[i] = value("int64", "9007199254740993")
			}
			document := value("map", map[string]Value{"items": value("list", items)})
			input, err := json.Marshal(Request{Version: probeVersion, Mode: "valueProof", Document: &document, Source: "resource.items.map(x, x + 1)"})
			if err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.SetBytes(int64(len(input)))
			b.ResetTimer()
			for range b.N {
				r, err := DecodeRequest(input)
				if err != nil {
					b.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				output, err := Execute(ctx, r, Corpus{})
				cancel()
				if err != nil {
					b.Fatal(err)
				}
				if _, err := json.Marshal(output); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
