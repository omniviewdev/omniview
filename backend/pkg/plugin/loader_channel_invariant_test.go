package plugin

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const goPluginImportPath = "github.com/hashicorp/go-plugin"

// goPluginClientUse is one use of go-plugin's NewClient in non-test code.
type goPluginClientUse struct {
	position token.Position
	// autoMTLS reports that the use is a call whose configuration is a literal
	// with AutoMTLS: true. Any other use cannot be shown to set it.
	autoMTLS bool
}

// goPluginLocalName returns the name the file gives the go-plugin package, or
// "" when it does not import it.
func goPluginLocalName(file *ast.File) string {
	for _, spec := range file.Imports {
		importPath, err := strconv.Unquote(spec.Path.Value)
		if err != nil || importPath != goPluginImportPath {
			continue
		}
		if spec.Name != nil {
			return spec.Name.Name
		}
		return "plugin"
	}
	return ""
}

// setsAutoMTLS reports that call is NewClient(&ClientConfig{..., AutoMTLS: true, ...}).
func setsAutoMTLS(call *ast.CallExpr) bool {
	if len(call.Args) != 1 {
		return false
	}
	unary, isUnary := call.Args[0].(*ast.UnaryExpr)
	if !isUnary || unary.Op != token.AND {
		return false
	}
	literal, isLiteral := unary.X.(*ast.CompositeLit)
	if !isLiteral {
		return false
	}
	for _, element := range literal.Elts {
		pair, isPair := element.(*ast.KeyValueExpr)
		if !isPair {
			continue
		}
		key, isKey := pair.Key.(*ast.Ident)
		value, isValue := pair.Value.(*ast.Ident)
		if isKey && isValue && key.Name == "AutoMTLS" && value.Name == "true" {
			return true
		}
	}
	return false
}

// goPluginClientUses returns every use of go-plugin's NewClient in file.
func goPluginClientUses(fset *token.FileSet, file *ast.File, local string) []goPluginClientUse {
	isNewClient := func(node ast.Node) (*ast.SelectorExpr, bool) {
		selector, isSelector := node.(*ast.SelectorExpr)
		if !isSelector || selector.Sel.Name != "NewClient" {
			return nil, false
		}
		ident, isIdent := selector.X.(*ast.Ident)
		return selector, isIdent && ident.Name == local
	}
	calls := map[*ast.SelectorExpr]*ast.CallExpr{}
	ast.Inspect(file, func(node ast.Node) bool {
		if call, isCall := node.(*ast.CallExpr); isCall {
			if selector, ok := isNewClient(call.Fun); ok {
				calls[selector] = call
			}
		}
		return true
	})
	var uses []goPluginClientUse
	ast.Inspect(file, func(node ast.Node) bool {
		if selector, ok := isNewClient(node); ok {
			call := calls[selector]
			uses = append(uses, goPluginClientUse{
				position: fset.Position(selector.Pos()),
				autoMTLS: call != nil && setsAutoMTLS(call),
			})
		}
		return true
	})
	return uses
}

// TestHostLaunchesPluginsThroughOneClientWithAutoMTLS keeps a second launch path
// from bypassing the channel's authentication: non-test code of the module has
// exactly one use of go-plugin's NewClient, and its configuration sets
// AutoMTLS: true. The behavioural tests all go through createBackend, so they
// cannot notice a new loader that builds its own client.
func TestHostLaunchesPluginsThroughOneClientWithAutoMTLS(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", ".."))
	require.NoError(t, err)
	require.FileExists(t, filepath.Join(root, "go.mod"), "the module root moved")

	var uses []goPluginClientUse
	fset := token.NewFileSet()
	require.NoError(t, filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", "node_modules", "dist":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		// Imports first: only a file that imports go-plugin can call its NewClient.
		header, parseErr := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if parseErr != nil {
			return parseErr
		}
		local := goPluginLocalName(header)
		if local == "" {
			return nil
		}
		file, parseErr := parser.ParseFile(fset, path, nil, 0)
		if parseErr != nil {
			return parseErr
		}
		uses = append(uses, goPluginClientUses(fset, file, local)...)
		return nil
	}))

	places := make([]string, 0, len(uses))
	for _, found := range uses {
		places = append(places, found.position.String())
	}
	require.Len(t, uses, 1, "the host must start plugins through one go-plugin client; found %v", places)
	require.True(t, uses[0].autoMTLS, "%s must build its ClientConfig literal with AutoMTLS: true", uses[0].position)
}
