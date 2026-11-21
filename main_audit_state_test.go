package main

import (
	"go/ast"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// The plugin manager disposes of a plugin's directory when the plugin is
// uninstalled, and the state service keeps the store and data roots it opened in
// it. Only the application can connect the two: without
// manager.SetPluginStateReleaser(stateService.ReleasePluginRoots) a plugin
// installed again under the same ID keeps writing through the roots of the
// deleted directory (plugin.TestReinstallWithoutAStateReleaserWritesThroughTheOldRoots
// shows the failure). This reads main.go the way the other audits here do.
func TestPluginManagerReleasesTheStateRootsOfAnUninstalledPlugin(t *testing.T) {
	source, err := os.ReadFile("main.go")
	require.NoError(t, err)
	file := parseHostSource(t, "main.go", source)

	manager := variableAssignedFrom(file, "plugin", "NewManager")
	state := variableAssignedFrom(file, "appstate", "New")
	require.NotEmpty(t, manager, "main.go builds the plugin manager with plugin.NewManager")
	require.NotEmpty(t, state, "main.go opens the state service with appstate.New")

	wired := false
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) != 1 {
			return true
		}
		method, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || method.Sel.Name != "SetPluginStateReleaser" {
			return true
		}
		receiver, ok := method.X.(*ast.Ident)
		if !ok || receiver.Name != manager {
			return true
		}
		release, ok := call.Args[0].(*ast.SelectorExpr)
		if !ok || release.Sel.Name != "ReleasePluginRoots" {
			return true
		}
		if owner, isIdent := release.X.(*ast.Ident); isIdent && owner.Name == state {
			wired = true
		}
		return true
	})
	require.True(t, wired, "main.go must call %s.SetPluginStateReleaser(%s.ReleasePluginRoots)", manager, state)
}

// variableAssignedFrom names the first variable that receives the result of a
// call of pkg.function, or returns "".
func variableAssignedFrom(file *ast.File, pkg, function string) string {
	name := ""
	ast.Inspect(file, func(node ast.Node) bool {
		assign, ok := node.(*ast.AssignStmt)
		if !ok || name != "" || len(assign.Rhs) != 1 || len(assign.Lhs) == 0 {
			return true
		}
		call, ok := assign.Rhs[0].(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != function {
			return true
		}
		if owner, isIdent := selector.X.(*ast.Ident); isIdent && owner.Name == pkg {
			if variable, isVariable := assign.Lhs[0].(*ast.Ident); isVariable {
				name = variable.Name
			}
		}
		return true
	})
	return name
}
