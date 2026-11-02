package query

import (
	"context"
	"strings"
	"testing"
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
		"duplicate":  strings.Replace(request, `"pageSize":20`, `"pageSize":20,"pageSize":30`, 1),
		"unknown":    strings.Replace(request, `"pageSize":20`, `"pageSize":20,"other":1`, 1),
		"zero page":  strings.Replace(request, `"pageSize":20`, `"pageSize":0`, 1),
		"wrong type": strings.Replace(request, `"kind":"int64","value":"9007199254740993"`, `"kind":"string","value":"x"`, 1),
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
