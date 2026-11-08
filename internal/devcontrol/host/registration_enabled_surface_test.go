package host

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const lifecycleTypeName = "developmentControlLifecycle"

// lifecycleSurface is what a scan of a package directory found about
// developmentControlLifecycle.
type lifecycleSurface struct {
	declarations int
	methods      int
	// exported lists exported methods Wails would bind, as "Name in file.go".
	exported []string
	// embedded lists embedded fields, which would promote their methods.
	embedded []string
	// notStruct lists declarations of the type that are not a struct.
	notStruct []string
}

// wailsLifecycleMethod reports the exported method names Wails never binds.
func wailsLifecycleMethod(name string) bool {
	switch name {
	case "ServiceName", "ServiceStartup", "ServiceShutdown", "ServeHTTP":
		return true
	default:
		return false
	}
}

// scanLifecycleSurface parses every non-test Go file of dir, whatever its
// build tags, because the type's methods are spread over several files. Test
// files are skipped: they are never part of the registered service.
func scanLifecycleSurface(t *testing.T, dir string) lifecycleSurface {
	t.Helper()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)

	var surface lifecycleSurface
	fset := token.NewFileSet()
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, parseErr := parser.ParseFile(fset, filepath.Join(dir, name), nil, parser.SkipObjectResolution)
		require.NoError(t, parseErr, name)
		for _, decl := range file.Decls {
			switch d := decl.(type) {
			case *ast.FuncDecl:
				if d.Recv == nil || !receiverIs(d.Recv, lifecycleTypeName) {
					continue
				}
				surface.methods++
				if d.Name.IsExported() && !wailsLifecycleMethod(d.Name.Name) {
					surface.exported = append(surface.exported, d.Name.Name+" in "+name)
				}
			case *ast.GenDecl:
				scanLifecycleType(&surface, d, name)
			}
		}
	}
	return surface
}

func scanLifecycleType(surface *lifecycleSurface, decl *ast.GenDecl, file string) {
	for _, spec := range decl.Specs {
		typeSpec, ok := spec.(*ast.TypeSpec)
		if !ok || typeSpec.Name.Name != lifecycleTypeName {
			continue
		}
		surface.declarations++
		structType, isStruct := typeSpec.Type.(*ast.StructType)
		if !isStruct {
			surface.notStruct = append(surface.notStruct, file)
			continue
		}
		for _, field := range structType.Fields.List {
			if len(field.Names) == 0 {
				surface.embedded = append(surface.embedded, "embedded field in "+file)
			}
		}
	}
}

// The lifecycle service is registered only in development builds, and
// registration_enabled.go is build-tagged, so the reflection test beside it
// does not run in an untagged build. Parsing needs no tag, which keeps this
// check in the default `go test ./...`.
//
// Wails binds every exported method of a registered service to the page except
// its lifecycle methods, so the service may declare no other exported method
// and may embed nothing that would promote one.
func TestDevelopmentControlLifecycleSurfaceIsLifecycleOnly(t *testing.T) {
	surface := scanLifecycleSurface(t, ".")

	require.Equal(t, 1, surface.declarations, "%s must be declared exactly once", lifecycleTypeName)
	require.Empty(t, surface.notStruct, "%s must be a struct", lifecycleTypeName)
	require.Positive(t, surface.methods, "the scan found no method of %s", lifecycleTypeName)
	require.Empty(t, surface.exported, "these exported methods would be bound by Wails")
	require.Empty(t, surface.embedded, "an embedded field would promote methods")
}

// The scan must read every file of the package: the methods of the real type
// are split between registration_enabled.go and endpoints.go.
func TestLifecycleSurfaceScanReadsEveryFile(t *testing.T) {
	write := func(dir, name, source string) {
		t.Helper()
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(source), 0o600))
	}

	t.Run("an exported method in another file is found", func(t *testing.T) {
		dir := t.TempDir()
		write(dir, "a.go", "package host\ntype developmentControlLifecycle struct{ mu int }\n"+
			"func (s *developmentControlLifecycle) ServiceStartup() {}\n")
		write(dir, "b.go", "package host\nfunc (s *developmentControlLifecycle) Leak() {}\n"+
			"func (s developmentControlLifecycle) inspect() {}\n")
		// A test file is not part of the service.
		write(dir, "c_test.go", "package host\nfunc (s *developmentControlLifecycle) TestOnly() {}\n")

		surface := scanLifecycleSurface(t, dir)
		require.Equal(t, 1, surface.declarations)
		require.Equal(t, 3, surface.methods)
		require.Equal(t, []string{"Leak in b.go"}, surface.exported)
		require.Empty(t, surface.embedded)
	})

	t.Run("an embedded field is found", func(t *testing.T) {
		dir := t.TempDir()
		write(dir, "a.go", "package host\nimport \"sync\"\ntype developmentControlLifecycle struct{ sync.Mutex }\n")

		surface := scanLifecycleSurface(t, dir)
		require.Equal(t, []string{"embedded field in a.go"}, surface.embedded)
	})

	t.Run("a declaration that is not a struct is found", func(t *testing.T) {
		dir := t.TempDir()
		write(dir, "a.go", "package host\ntype developmentControlLifecycle = other\n")

		surface := scanLifecycleSurface(t, dir)
		require.Equal(t, 1, surface.declarations)
		require.Equal(t, []string{"a.go"}, surface.notStruct)
	})
}

func receiverIs(recv *ast.FieldList, name string) bool {
	if len(recv.List) != 1 {
		return false
	}
	expr := recv.List[0].Type
	if star, ok := expr.(*ast.StarExpr); ok {
		expr = star.X
	}
	ident, ok := expr.(*ast.Ident)
	return ok && ident.Name == name
}
