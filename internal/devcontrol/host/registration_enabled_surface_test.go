package host

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"

	"github.com/stretchr/testify/require"
)

// registration_enabled.go is build-tagged, so the reflection test beside it
// does not run in an untagged build. Parsing needs no tag, which keeps this
// check in the default `go test ./...`.
//
// Wails binds every exported method of a registered service to the page except
// its lifecycle methods, so the service may declare no other exported method
// and may embed nothing that would promote one.
func TestDevelopmentControlLifecycleSurfaceIsLifecycleOnly(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "registration_enabled.go", nil, parser.SkipObjectResolution)
	require.NoError(t, err)
	allowed := map[string]bool{"ServiceName": true, "ServiceStartup": true, "ServiceShutdown": true, "ServeHTTP": true}

	foundType := false
	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if d.Recv == nil || !receiverIs(d.Recv, "developmentControlLifecycle") {
				continue
			}
			if d.Name.IsExported() {
				require.True(t, allowed[d.Name.Name], "exported method %s would be bound by Wails", d.Name.Name)
			}
		case *ast.GenDecl:
			for _, spec := range d.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok || typeSpec.Name.Name != "developmentControlLifecycle" {
					continue
				}
				foundType = true
				structType, ok := typeSpec.Type.(*ast.StructType)
				require.True(t, ok, "developmentControlLifecycle must be a struct")
				for _, field := range structType.Fields.List {
					require.NotEmpty(t, field.Names, "embedded field would promote methods")
				}
			}
		}
	}
	require.True(t, foundType, "developmentControlLifecycle not found in registration_enabled.go")
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
