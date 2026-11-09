package resourcecatalog_test

import (
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// TestCatalogImportBoundary enforces spec §1: the catalog is provider-neutral
// and self-contained. resourcecatalog imports only the standard library, the
// SDK resourcev2 package and singleflight; celtypes adds the catalog itself and
// cel-go. Any Kubernetes, host-controller or second-catalog dependency fails
// here before it can become a duplicate source of schema truth.
func TestCatalogImportBoundary(t *testing.T) {
	const (
		sdk     = "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
		catalog = "github.com/omniviewdev/omniview/backend/pkg/resourcecatalog"
	)
	packages := []struct {
		dir      string
		allowed  map[string]bool
		prefixes []string
	}{
		{".", map[string]bool{sdk: true, "golang.org/x/sync/singleflight": true}, nil},
		{"celtypes", map[string]bool{sdk: true, catalog: true}, []string{"cel.dev/cel-go/"}},
	}
	for _, pkg := range packages {
		files, err := filepath.Glob(filepath.Join(pkg.dir, "*.go"))
		if err != nil || len(files) == 0 {
			t.Fatalf("no sources in %s: %v", pkg.dir, err)
		}
		checked := 0
		for _, file := range files {
			if strings.HasSuffix(file, "_test.go") {
				continue
			}
			parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.ImportsOnly)
			if err != nil {
				t.Fatalf("parse %s: %v", file, err)
			}
			checked++
			for _, spec := range parsed.Imports {
				path, err := strconv.Unquote(spec.Path.Value)
				if err != nil {
					t.Fatalf("%s: import %s: %v", file, spec.Path.Value, err)
				}
				if !strings.Contains(strings.SplitN(path, "/", 2)[0], ".") {
					continue // standard library
				}
				allowed := pkg.allowed[path]
				for _, prefix := range pkg.prefixes {
					allowed = allowed || strings.HasPrefix(path, prefix)
				}
				if !allowed {
					t.Errorf("%s imports %q, which is outside the catalog boundary", file, path)
				}
			}
		}
		if checked == 0 {
			t.Fatalf("no non-test sources in %s", pkg.dir)
		}
	}
}
