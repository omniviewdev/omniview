package resourceauthoring

import (
	"go/parser"
	gotoken "go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// The authoring service is the only authoring authority and holds no second
// catalog or evaluator. It may read the catalog (resourcecatalog), parse with the
// predicate profile's parser (query) and use CEL's parser and AST. It must not
// reach into the resource controller, the Wails runtime, the CEL type checker or
// evaluator, or any provider transport: those belong to the host controller and
// to P13, and importing them here would invite a second implementation.
func TestAuthoringImportBoundary(t *testing.T) {
	allowed := map[string]bool{
		"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query": true,
		"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog":       true,
		"github.com/omniviewdev/plugin-sdk/pkg/resource/v2":                 true,
		"cel.dev/cel-go/cel":        true,
		"cel.dev/cel-go/common/ast": true,
		"github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes":  true, // tests only
		"github.com/stretchr/testify/assert":                                    true, // tests only
		"github.com/stretchr/testify/require":                                   true, // tests only
		"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph":     false,
		"github.com/omniviewdev/omniview/backend/pkg/plugin/resource":           false,
		"github.com/wailsapp/wails/v3/pkg/application":                          false,
		"github.com/omniviewdev/omniview/backend/pkg/apperror":                  false,
		"github.com/omniviewdev/omniview/backend/pkg/invocation":                false,
		"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry":  false,
		"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/leasewire": false,
		"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer":   false,
		"cel.dev/cel-go/interpreter":                                            false,
		"cel.dev/cel-go/checker":                                                false,
	}
	files, err := filepath.Glob("*.go")
	require.NoError(t, err)
	fileSet := gotoken.NewFileSet()
	for _, file := range files {
		parsed, err := parser.ParseFile(fileSet, file, nil, parser.ImportsOnly)
		require.NoError(t, err)
		production := !strings.HasSuffix(file, "_test.go")
		for _, spec := range parsed.Imports {
			path := strings.Trim(spec.Path.Value, `"`)
			if !strings.Contains(path, ".") {
				continue // standard library
			}
			ok, listed := allowed[path]
			require.True(t, listed && ok, "%s imports %s, which the authoring service must not depend on", file, path)
			if production {
				require.NotContains(t, []string{"github.com/stretchr/testify/assert", "github.com/stretchr/testify/require", "github.com/omniviewdev/omniview/backend/pkg/resourcecatalog/celtypes"}, path, "%s: test-only import in production code", file)
			}
		}
	}
	_, err = os.Stat("complete.go")
	require.NoError(t, err)
}
