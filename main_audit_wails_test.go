package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/mod/modfile"
)

// The runtime object and method numbers in policy.json are Wails constants.
// This pins them to the pinned Wails version so a dependency bump cannot move
// an allowed number onto a different method, or add an unreviewed object.
func TestRuntimeNumberingMatchesPinnedWails(t *testing.T) {
	policy := auditPolicy(t)

	require.Equal(t, policy.WailsVersion(), requiredWailsVersion(t),
		"Wails changed: re-check every runtime object and method number in internal/auditgate/policy.json "+
			"against pkg/application/messageprocessor*.go, then update the \"wails\" field")

	files := wailsMessageProcessorFiles(t, wailsApplicationDir(t))
	consts := wailsIntConstants(t, files)
	require.Equal(t, 0, consts["CallBinding"])

	policyObjects := make(map[int]string)
	for _, object := range policy.RuntimeObjects() {
		policyObjects[object.Object] = object.Name
	}
	require.Equal(t, wailsMapLiteral(t, files, consts, "objectNames"), policyObjects,
		"Wails runtime objects changed: classify the new or renumbered object")

	methodTables := map[string]string{
		"Clipboard":   "clipboardMethods",
		"Application": "applicationMethodNames",
		"Events":      "eventsMethodNames",
		"Window":      "windowMethodNames",
		"System":      "systemMethodNames",
		"Browser":     "browserMethodNames",
	}
	for _, object := range policy.RuntimeObjects() {
		table, hasTable := methodTables[object.Name]
		if !hasTable {
			continue
		}
		names := wailsMapLiteral(t, files, consts, table)
		for _, method := range object.Methods {
			require.Equal(t, method.Name, names[method.Method],
				"%s method %d is %q in policy.json but %q in Wails",
				object.Name, method.Method, method.Name, names[method.Method])
		}
	}
}

// requiredWailsVersion reads the Wails version go.mod requires.
func requiredWailsVersion(t testing.TB) string {
	t.Helper()
	goMod, err := os.ReadFile("go.mod")
	require.NoError(t, err)
	module, err := modfile.Parse("go.mod", goMod, nil)
	require.NoError(t, err)
	for _, requirement := range module.Require {
		if requirement.Mod.Path == "github.com/wailsapp/wails/v3" {
			return requirement.Mod.Version
		}
	}
	t.Fatal("go.mod does not require github.com/wailsapp/wails/v3")
	return ""
}

func wailsApplicationDir(t testing.TB) string {
	t.Helper()
	goTool, err := exec.LookPath("go")
	require.NoError(t, err, "the go tool is required to locate the Wails sources")
	command := exec.Command(goTool, "list", "-m", "-f", "{{.Dir}}", "github.com/wailsapp/wails/v3")
	command.Env = append(os.Environ(), "GOWORK=off")
	output, err := command.Output()
	require.NoError(t, err)
	dir := filepath.Join(strings.TrimSpace(string(output)), "pkg", "application")
	_, err = os.Stat(dir)
	require.NoError(t, err)
	return dir
}

func wailsMessageProcessorFiles(t testing.TB, dir string) []*ast.File {
	t.Helper()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	fset := token.NewFileSet()
	var files []*ast.File
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "messageprocessor") || !strings.HasSuffix(name, ".go") ||
			strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, parseErr := parser.ParseFile(fset, filepath.Join(dir, name), nil, parser.SkipObjectResolution)
		require.NoError(t, parseErr)
		files = append(files, file)
	}
	require.NotEmpty(t, files, "no messageprocessor sources in %s", dir)
	return files
}

// valueSpecs returns the specs of every package-level declaration of kind tok.
func valueSpecs(files []*ast.File, tok token.Token) []*ast.ValueSpec {
	var specs []*ast.ValueSpec
	for _, file := range files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != tok {
				continue
			}
			for _, spec := range gen.Specs {
				if value, isValue := spec.(*ast.ValueSpec); isValue {
					specs = append(specs, value)
				}
			}
		}
	}
	return specs
}

// wailsIntConstants collects the package-level integer constants of the
// message processor files.
func wailsIntConstants(t testing.TB, files []*ast.File) map[string]int {
	t.Helper()
	consts := make(map[string]int)
	for _, spec := range valueSpecs(files, token.CONST) {
		for i, name := range spec.Names {
			if i >= len(spec.Values) {
				continue
			}
			if literal, ok := spec.Values[i].(*ast.BasicLit); ok && literal.Kind == token.INT {
				number, err := strconv.Atoi(literal.Value)
				require.NoError(t, err)
				consts[name.Name] = number
			}
		}
	}
	return consts
}

// wailsMapLiteral reads a package-level map[int]string literal whose keys are
// integer constants.
func wailsMapLiteral(t testing.TB, files []*ast.File, consts map[string]int, name string) map[int]string {
	t.Helper()
	for _, spec := range valueSpecs(files, token.VAR) {
		if len(spec.Names) != 1 || spec.Names[0].Name != name || len(spec.Values) != 1 {
			continue
		}
		literal, ok := spec.Values[0].(*ast.CompositeLit)
		require.True(t, ok, "%s is not a map literal", name)
		result := make(map[int]string, len(literal.Elts))
		for _, element := range literal.Elts {
			pair, isPair := element.(*ast.KeyValueExpr)
			require.True(t, isPair, "%s: unexpected element %T", name, element)
			value, isLiteral := pair.Value.(*ast.BasicLit)
			require.True(t, isLiteral, "%s: unexpected value %T", name, pair.Value)
			text, err := strconv.Unquote(value.Value)
			require.NoError(t, err)
			result[mapKey(t, name, consts, pair.Key)] = text
		}
		return result
	}
	t.Fatalf("Wails variable %s not found", name)
	return nil
}

// mapKey resolves a map literal key: an integer literal or a named constant.
func mapKey(t testing.TB, table string, consts map[string]int, key ast.Expr) int {
	t.Helper()
	switch k := key.(type) {
	case *ast.Ident:
		number, known := consts[k.Name]
		require.True(t, known, "%s: unknown constant %s", table, k.Name)
		return number
	case *ast.BasicLit:
		number, err := strconv.Atoi(k.Value)
		require.NoError(t, err)
		return number
	default:
		t.Fatalf("%s: unsupported key %T", table, key)
		return 0
	}
}
