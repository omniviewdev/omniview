package window

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// B-110: a webview window that runs in the server build keeps every event it
// is given (webview_window_server_test.go). A window the host creates is
// therefore created by NewWebviewWindow, which does not run it in that build.
// This test finds a call that goes around the factory: a window made with
// app.Window.New, app.Window.NewWithOptions or application.NewWindow.
func TestEveryWebviewWindowIsCreatedThroughTheFactory(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatalf("resolve the repository root: %v", err)
	}
	factories := map[string]bool{
		filepath.Join(root, "backend", "window", "webview_window_native.go"): true,
		filepath.Join(root, "backend", "window", "webview_window_server.go"): true,
	}
	skipped := map[string]bool{
		".git": true, "node_modules": true, "dist": true, "ui": true, "ui-next": true, "packages": true,
		"docs": true, "public": true, "evidence": true, "plans": true, "img": true, "patches": true,
	}

	files := token.NewFileSet()
	scanned := 0
	var around []string
	walked := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if skipped[entry.Name()] && path != root {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || factories[path] {
			return nil
		}
		parsed, parseErr := parser.ParseFile(files, path, nil, parser.SkipObjectResolution)
		if parseErr != nil {
			return parseErr
		}
		scanned++
		ast.Inspect(parsed, func(node ast.Node) bool {
			call, isCall := node.(*ast.CallExpr)
			if !isCall {
				return true
			}
			if createsWebviewWindow(call) {
				around = append(around, files.Position(call.Pos()).String())
			}
			return true
		})
		return nil
	})
	if walked != nil {
		t.Fatalf("scan the repository: %v", walked)
	}
	if scanned < 100 {
		t.Fatalf("the scan read %d Go files; it is not looking at the repository", scanned)
	}
	for _, position := range around {
		t.Errorf("%s creates a webview window without NewWebviewWindow", position)
	}
}

// createsWebviewWindow reports <anything>.Window.New(...),
// <anything>.Window.NewWithOptions(...) and application.NewWindow(...).
func createsWebviewWindow(call *ast.CallExpr) bool {
	selector, isSelector := call.Fun.(*ast.SelectorExpr)
	if !isSelector {
		return false
	}
	switch selector.Sel.Name {
	case "New", "NewWithOptions":
		manager, isManager := selector.X.(*ast.SelectorExpr)
		return isManager && manager.Sel.Name == "Window"
	case "NewWindow":
		pkg, isPackage := selector.X.(*ast.Ident)
		return isPackage && pkg.Name == "application"
	default:
		return false
	}
}
