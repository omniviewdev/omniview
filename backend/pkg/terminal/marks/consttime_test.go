package marks

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"

	_ "embed"
)

// oscSource is the source of the file that checks the nonce. The check is about how a nonce is compared, which no
// input can show (a comparison that stops at the first byte that differs gives the same answers), so the test reads
// the function.
//
//go:embed osc.go
var oscSource string

func isSubtleCompare(e ast.Expr) bool {
	call, ok := e.(*ast.CallExpr)
	if !ok {
		return false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	return ok && pkg.Name == "subtle" && sel.Sel.Name == "ConstantTimeCompare"
}

func TestTheNonceIsComparedInConstantTime(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "osc.go", oscSource, 0)
	if err != nil {
		t.Fatal(err)
	}
	var verified *ast.FuncDecl
	for _, d := range file.Decls {
		if fn, ok := d.(*ast.FuncDecl); ok && fn.Name.Name == "verified" {
			verified = fn
		}
	}
	if verified == nil {
		t.Fatal("osc.go has no function verified")
	}
	compares := 0
	ast.Inspect(verified.Body, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.CallExpr:
			if isSubtleCompare(x) {
				compares++
			}
		case *ast.BinaryExpr:
			_, literal := x.Y.(*ast.BasicLit)
			isEquality := x.Op == token.EQL || x.Op == token.NEQ
			if isEquality && (!isSubtleCompare(x.X) || !literal) {
				t.Errorf("verified compares with %s at %v: use subtle.ConstantTimeCompare only", x.Op, x.Pos())
			}
		}
		return true
	})
	if compares != 1 {
		t.Fatalf("verified calls subtle.ConstantTimeCompare %d times, want 1", compares)
	}
}
