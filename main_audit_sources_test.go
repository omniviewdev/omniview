package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// hostGoSources calls visit for every non-test Go file of the host module.
// Nested modules, vendored code and test data are not part of the host.
func hostGoSources(t testing.TB, visit func(path string, source []byte)) {
	t.Helper()
	scanned := 0
	err := filepath.WalkDir(".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return hostDirectory(path, entry)
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		scanned++
		visit(filepath.ToSlash(path), source)
		return nil
	})
	require.NoError(t, err)
	require.Greater(t, scanned, 100, "the scan must cover the host sources")
}

// hostDirectory decides whether the walk descends into a directory.
func hostDirectory(path string, entry fs.DirEntry) error {
	switch entry.Name() {
	case ".git", "node_modules", "dist", "testdata", "vendor":
		return fs.SkipDir
	}
	if path == "." {
		return nil
	}
	if _, err := os.Stat(filepath.Join(path, "go.mod")); err == nil {
		return fs.SkipDir // a nested module is not part of the host
	}
	return nil
}

func parseHostSource(t testing.TB, path string, source []byte) *ast.File {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), path, source, parser.SkipObjectResolution)
	require.NoError(t, err, path)
	return file
}

// The gateway resolves IDs from the FNV hash of the name. A binding alias or a
// registered method ID would make the host run a method the hash does not
// name, so neither may appear in the host.
func TestNoBindingAliasesOrRegisteredIDs(t *testing.T) {
	forbidden := []string{"BindAliases", "RegisterBindingMethodID"}
	var found []string
	hostGoSources(t, func(path string, source []byte) {
		if !bytes.Contains(source, []byte(forbidden[0])) && !bytes.Contains(source, []byte(forbidden[1])) {
			return
		}
		ast.Inspect(parseHostSource(t, path, source), func(node ast.Node) bool {
			if ident, ok := node.(*ast.Ident); ok && (ident.Name == forbidden[0] || ident.Name == forbidden[1]) {
				found = append(found, fmt.Sprintf("%s: %s", path, ident.Name))
			}
			return true
		})
	})
	require.Empty(t, found,
		"the audit gateway resolves method IDs by hashing names; "+
			"teach it the alias map before using aliases or registered IDs")
}

// isNewServiceCall matches application.NewService and
// application.NewServiceWithOptions.
func isNewServiceCall(call *ast.CallExpr) bool {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := selector.X.(*ast.Ident)
	return ok && pkg.Name == "application" &&
		(selector.Sel.Name == "NewService" || selector.Sel.Name == "NewServiceWithOptions")
}

// isRegistration matches the three ways to hand a service to Wails: a
// RegisterService call, an application.NewService call and a Services option.
func isRegistration(node ast.Node) bool {
	switch n := node.(type) {
	case *ast.CallExpr:
		selector, ok := n.Fun.(*ast.SelectorExpr)
		return isNewServiceCall(n) || (ok && selector.Sel.Name == "RegisterService")
	case *ast.KeyValueExpr:
		return isServicesOption(n)
	default:
		return false
	}
}

// isServicesOption matches application.Options{Services: []application.Service{...}}.
func isServicesOption(pair *ast.KeyValueExpr) bool {
	key, ok := pair.Key.(*ast.Ident)
	if !ok || key.Name != "Services" {
		return false
	}
	literal, ok := pair.Value.(*ast.CompositeLit)
	if !ok {
		return false
	}
	list, ok := literal.Type.(*ast.ArrayType)
	if !ok {
		return false
	}
	element, ok := list.Elt.(*ast.SelectorExpr)
	return ok && element.Sel.Name == "Service"
}

func registersServices(file *ast.File) bool {
	found := false
	ast.Inspect(file, func(node ast.Node) bool {
		if isRegistration(node) {
			found = true
		}
		return !found
	})
	return found
}

// Every service the host binds must pass through the allowlist. main registers
// the services boundServiceTypes lists, and a development build registers one
// more from internal/devcontrol/host (its devcontrol-tagged test checks that it
// binds nothing unclassified). Any other registration site would bypass both
// checks, so a new one must be wired into them before it can land.
func TestServiceRegistrationSitesAreKnown(t *testing.T) {
	seen := map[string]bool{
		"main.go": false,
		"internal/devcontrol/host/registration_enabled.go": false,
	}
	var unknown []string
	hostGoSources(t, func(path string, source []byte) {
		if !bytes.Contains(source, []byte("NewService")) &&
			!bytes.Contains(source, []byte("RegisterService")) &&
			!bytes.Contains(source, []byte("Services")) {
			return
		}
		if !registersServices(parseHostSource(t, path, source)) {
			return
		}
		if _, known := seen[path]; known {
			seen[path] = true
			return
		}
		unknown = append(unknown, path)
	})
	require.Empty(t, unknown,
		"these files register Wails services outside main.go: "+
			"wire them into boundServiceTypes or the startup check, then list them here")
	for path, registered := range seen {
		require.True(t, registered, "%s no longer registers a service: update this list", path)
	}
}
