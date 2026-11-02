package query

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

const request = `{"version":"omniview.query.v1","targets":[{"targetId":"t","provider":"p","authority":"a","type":"vm","accessRoute":{"connection":"c"},"representation":{"id":"full","revision":"1"},"scope":[]}],"predicate":{"language":"cel","profile":"omniview.resource-predicate.v1","source":"resource.enabled && threshold > 2"},"declarations":{"threshold":{"kind":"int64"}},"bindings":{"threshold":{"kind":"int64","value":"9007199254740993"}},"projection":[],"order":[],"delivery":{"mode":"once","pageSize":20}}`

func TestDecodeAndParse(t *testing.T) {
	q, err := Decode([]byte(request))
	if err != nil {
		t.Fatal(err)
	}
	if q.Bindings["threshold"].Int != "9007199254740993" {
		t.Fatal("integer changed")
	}
	parsed, err := Parse(context.Background(), q)
	if err != nil || parsed.CEL == nil {
		t.Fatalf("parse: %v", err)
	}
}
func TestRejectedRequests(t *testing.T) {
	for name, input := range map[string]string{
		"duplicate":       strings.Replace(request, `"pageSize":20`, `"pageSize":20,"pageSize":30`, 1),
		"unknown":         strings.Replace(request, `"pageSize":20`, `"pageSize":20,"other":1`, 1),
		"zero page":       strings.Replace(request, `"pageSize":20`, `"pageSize":0`, 1),
		"wrong type":      strings.Replace(request, `"kind":"int64","value":"9007199254740993"`, `"kind":"string","value":"x"`, 1),
		"target case":     strings.Replace(request, `"targetId":"t"`, `"targetId":"t","TargetID":"other"`, 1),
		"selector case":   strings.Replace(request, `"id":"full"`, `"id":"full","ID":"other"`, 1),
		"projection case": strings.Replace(request, `"projection":[]`, `"projection":[{"id":"a","ID":"b","path":[]}]`, 1),
		"order case":      strings.Replace(request, `"order":[]`, `"order":[{"path":[],"direction":"asc","missing":"first","null":"last","Null":"first"}]`, 1),
		"segment null":    strings.Replace(request, `"projection":[]`, `"projection":[{"id":"a","path":[{"kind":"member","name":"x","index":null}]}]`, 1),
		"segment case":    strings.Replace(request, `"projection":[]`, `"projection":[{"id":"a","path":[{"kind":"member","name":"x","Name":"y"}]}]`, 1),
		"reserved":        strings.ReplaceAll(request, "threshold", "int"),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Decode([]byte(input)); err == nil {
				t.Fatal("accepted invalid request")
			}
		})
	}
}
func TestParseBuilderAndCancellation(t *testing.T) {
	input := strings.Replace(request, `{"language":"cel","profile":"omniview.resource-predicate.v1","source":"resource.enabled && threshold > 2"}`, `{"language":"builder","version":"omniview.builder.v1","document":{"version":"omniview.builder.v1","root":{"kind":"exists","path":{"root":"resource","segments":[{"kind":"member","name":"items"}]},"element":"item","child":{"kind":"state","path":{"root":{"element":"item"},"segments":[]},"state":"present"}}}}`, 1)
	q, err := Decode([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := Parse(context.Background(), q)
	if err != nil || parsed.Builder == nil {
		t.Fatalf("builder: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = Parse(ctx, q); err == nil {
		t.Fatal("cancelled parse succeeded")
	}
}
func TestBadSyntax(t *testing.T) {
	q, err := Decode([]byte(strings.Replace(request, "resource.enabled && threshold > 2", "resource.enabled &&", 1)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Parse(context.Background(), q); err == nil {
		t.Fatal("invalid CEL parsed")
	}
}

func TestBuilderStrictCase(t *testing.T) {
	builder := `{"language":"builder","version":"omniview.builder.v1","document":{"version":"omniview.builder.v1","root":{"kind":"state","path":{"root":"resource","segments":[{"kind":"member","name":"x"}]},"state":"present"}}}`
	original := `{"language":"cel","profile":"omniview.resource-predicate.v1","source":"resource.enabled && threshold > 2"}`
	for _, modified := range []string{
		strings.Replace(builder, `"root":{"kind"`, `"Root":{"kind"`, 1),
		strings.Replace(builder, `"segments":[`, `"Segments":[`, 1),
		strings.Replace(builder, `"name":"x"`, `"name":"x","index":null`, 1),
	} {
		q, err := Decode([]byte(strings.Replace(request, original, modified, 1)))
		if err == nil {
			_, err = Parse(context.Background(), q)
		}
		if err == nil {
			t.Fatal("accepted malformed builder")
		}
	}
}

func TestLimitsAndDeadline(t *testing.T) {
	q, err := Decode([]byte(request))
	if err != nil {
		t.Fatal(err)
	}
	q.Predicate.Source = `"` + strings.Repeat("x", 16382) + `"`
	if _, err = Parse(context.Background(), q); err != nil {
		t.Fatalf("source boundary: %v", err)
	}
	q.Predicate.Source += "x"
	if _, err = Parse(context.Background(), q); err == nil {
		t.Fatal("accepted oversized source")
	}
	if _, err = Decode([]byte(request + strings.Repeat(" ", 65536-len(request)))); err != nil {
		t.Fatalf("request byte boundary: %v", err)
	}
	for _, n := range []int{32, 33} {
		path := make(DocumentFieldPath, n)
		for i := range path {
			name := "x"
			path[i] = PathSegment{Kind: "member", Name: &name}
		}
		err = validatePath(path)
		if (n == 32) != (err == nil) {
			t.Fatalf("path depth %d: %v", n, err)
		}
	}
	if _, err = Decode([]byte(strings.Repeat(" ", 65537))); err == nil {
		t.Fatal("accepted oversized request")
	}
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if _, err = Parse(ctx, q); err == nil || !strings.Contains(err.Error(), "TIMEOUT") {
		t.Fatalf("deadline: %v", err)
	}
	declarations := make([]string, 129)
	bindings := make([]string, 129)
	for i := range declarations {
		declarations[i] = fmt.Sprintf(`"p%d":{"kind":"bool"}`, i)
		bindings[i] = fmt.Sprintf(`"p%d":{"kind":"bool","value":true}`, i)
	}
	for _, n := range []int{128, 129} {
		input := strings.Replace(request, `"declarations":{"threshold":{"kind":"int64"}}`, `"declarations":{`+strings.Join(declarations[:n], ",")+`}`, 1)
		input = strings.Replace(input, `"bindings":{"threshold":{"kind":"int64","value":"9007199254740993"}}`, `"bindings":{`+strings.Join(bindings[:n], ",")+`}`, 1)
		_, err = Decode([]byte(input))
		if (n == 128) != (err == nil) {
			t.Fatalf("declarations %d: %v", n, err)
		}
	}
}
