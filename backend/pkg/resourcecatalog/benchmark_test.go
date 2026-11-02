package resourcecatalog_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"os"
	"testing"

	"cel.dev/cel-go/cel"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes"
)

const benchmarkPodRoot = "#/components/schemas/io.k8s.api.core.v1.Pod"

const benchmarkPod = `{
	"apiVersion": "v1",
	"kind": "Pod",
	"metadata": {"name": "web", "namespace": "default", "labels": {"app": "web"}, "creationTimestamp": "2026-11-01T10:00:00Z"},
	"spec": {
		"restartPolicy": "Always",
		"containers": [{
			"name": "nginx",
			"image": "nginx:1.27",
			"ports": [{"containerPort": 80, "protocol": "TCP"}],
			"resources": {"limits": {"cpu": "500m", "memory": "128Mi"}},
			"readinessProbe": {"httpGet": {"path": "/", "port": "http"}}
		}]
	}
}`

func kubernetesCoreV1(b *testing.B) []byte {
	b.Helper()
	compressed, err := os.ReadFile("testdata/kubernetes/api__v1.json.gz")
	if err != nil {
		b.Fatal(err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		b.Fatal(err)
	}
	document, err := io.ReadAll(reader)
	if err != nil {
		b.Fatal(err)
	}
	return document
}

func podCatalog(document []byte) resourcev2.Catalog {
	revision := "schema/1"
	return resourcev2.Catalog{Provider: "kubernetes", Revision: "c1", Types: []resourcev2.ResourceType{{
		Type: "core::v1::Pod", DisplayName: "Pod", DefaultRepresentation: "r",
		Representations: []resourcev2.Representation{{ID: "r", Revision: "rep/1", Schema: resourcev2.SchemaBinding{
			State: "available", Revision: &revision, Dialect: resourcev2.DialectOpenAPI30, Root: benchmarkPodRoot,
			Document: json.RawMessage(document)}}},
	}}}
}

func resolvePod(b *testing.B, catalog *resourcecatalog.Catalog, document []byte) (*resourcecatalog.Snapshot, *resourcecatalog.Entry, *resourcecatalog.Schema) {
	b.Helper()
	snapshot := catalog.Observe(retentionKey("bench"), podCatalog(document))
	entry, schema := resolveType(b, snapshot, "core::v1::Pod")
	return snapshot, entry, schema
}

func BenchmarkNormalizeKubernetesCoreV1(b *testing.B) {
	document := kubernetesCoreV1(b)
	b.SetBytes(int64(len(document)))
	b.ReportAllocs()
	for b.Loop() {
		resolvePod(b, resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy()), document)
	}
}

func BenchmarkAdmitPod(b *testing.B) {
	policy := resourcecatalog.DefaultPolicy()
	_, _, schema := resolvePod(b, resourcecatalog.NewCatalog(policy), kubernetesCoreV1(b))
	pod := mustValue(b, benchmarkPod)
	b.ReportAllocs()
	for b.Loop() {
		if _, err := resourcecatalog.Admit(context.Background(), schema, pod, retentionCoverage, policy); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkNavigatePodSpec(b *testing.B) {
	policy := resourcecatalog.DefaultPolicy()
	_, _, schema := resolvePod(b, resourcecatalog.NewCatalog(policy), kubernetesCoreV1(b))
	path := []resourcecatalog.PathSegment{{Kind: resourcecatalog.SegmentField, Name: "spec"}}
	b.ReportAllocs()
	for b.Loop() {
		navigation, err := resourcecatalog.Navigate(context.Background(), schema, path, policy)
		if err != nil || len(navigation.Fields) == 0 {
			b.Fatalf("navigate = %+v, %v", navigation, err)
		}
	}
}

func BenchmarkCELCompileEvalPod(b *testing.B) {
	snapshot, entry, schema := resolvePod(b, resourcecatalog.NewCatalog(resourcecatalog.DefaultPolicy()), kubernetesCoreV1(b))
	resource, err := celtypes.ToCEL(mustValue(b, benchmarkPod))
	if err != nil {
		b.Fatal(err)
	}
	activation := map[string]any{"resource": resource}
	const expression = `resource.spec.containers.exists(c, c.image.startsWith("nginx"))`
	b.ReportAllocs()
	for b.Loop() {
		environment, err := celtypes.NewEnvironment(snapshot.Revision(), entry, schema)
		if err != nil {
			b.Fatal(err)
		}
		env, err := cel.NewEnv(append([]cel.EnvOption{
			cel.CrossTypeNumericComparisons(true),
			cel.ParserRecursionLimit(64),
			cel.ParserExpressionSizeLimit(16384),
		}, environment.Options...)...)
		if err != nil {
			b.Fatal(err)
		}
		ast, issues := env.Compile(expression)
		if issues.Err() != nil {
			b.Fatal(issues.Err())
		}
		program, err := env.Program(ast, cel.EvalOptions(cel.OptOptimize))
		if err != nil {
			b.Fatal(err)
		}
		out, _, err := program.Eval(activation)
		if err != nil || out.Value() != true {
			b.Fatalf("eval = %v, %v", out, err)
		}
	}
}
