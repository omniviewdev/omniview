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
	scan, err := scanForWindowCreation(root)
	if err != nil {
		t.Fatalf("scan the repository: %v", err)
	}
	if scan.files < 100 {
		t.Fatalf("the scan read %d Go files; it is not looking at the repository", scan.files)
	}
	for _, position := range scan.around {
		t.Errorf("%s creates a webview window without NewWebviewWindow", position)
	}
}

type windowCreationScan struct {
	files  int
	around []string
}

// scanForWindowCreation parses the Go files of the repository that are not
// tests and not the factory, and lists where they create a window.
func scanForWindowCreation(root string) (windowCreationScan, error) {
	var scan windowCreationScan
	files := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path != root && notScanned(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !isScannedFile(root, path) {
			return nil
		}
		parsed, parseErr := parser.ParseFile(files, path, nil, parser.SkipObjectResolution)
		if parseErr != nil {
			return parseErr
		}
		scan.files++
		scan.around = append(scan.around, windowCreations(files, parsed)...)
		return nil
	})
	return scan, err
}

// notScanned names the directories that hold no Go of the host.
func notScanned(name string) bool {
	switch name {
	case ".git", "node_modules", "dist", "ui", "ui-next", "packages", "docs", "public", "evidence", "plans", "img", "patches":
		return true
	default:
		return false
	}
}

func isScannedFile(root, path string) bool {
	if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
		return false
	}
	factory := filepath.Join(root, "backend", "window")
	return path != filepath.Join(factory, "webview_window_native.go") &&
		path != filepath.Join(factory, "webview_window_server.go")
}

func windowCreations(files *token.FileSet, parsed *ast.File) []string {
	var found []string
	ast.Inspect(parsed, func(node ast.Node) bool {
		if call, isCall := node.(*ast.CallExpr); isCall && createsWebviewWindow(call) {
			found = append(found, files.Position(call.Pos()).String())
		}
		return true
	})
	return found
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
