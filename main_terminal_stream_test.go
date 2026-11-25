package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/require"
)

// The terminal channel rides one Wails GoStream, registered once, in main, for both builds (the native window and `-tags
// server`) with the handler of the exec package: no second stream, and none registered anywhere else, because the audit gateway
// denies the stream path for remote browsers as a whole and a stream that is not this one would be one more way to reach a
// terminal that nothing pinned. The handler is the controller's: a stream that names a terminal by its capability.
func TestTheTerminalStreamIsTheOneStreamTheHostRegisters(t *testing.T) {
	var sites []string
	hostGoSources(t, func(path string, source []byte) {
		if !bytes.Contains(source, []byte("HandleStream")) {
			return
		}
		ast.Inspect(parseHostSource(t, path, source), func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			if selector, isSelector := call.Fun.(*ast.SelectorExpr); isSelector && selector.Sel.Name == "HandleStream" {
				sites = append(sites, fmt.Sprintf("%s: %s", path, types.ExprString(call)))
			}
			return true
		})
	})
	require.Equal(t,
		[]string{"main.go: app.HandleStream(exec.TerminalStreamName, exec.TerminalStreamHandler(execController))"},
		sites, "the host registers the terminal stream, and only it")
}
