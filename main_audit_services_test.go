package main

import (
	"errors"
	"fmt"
	"go/ast"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog"
)

type fakeServiceA struct{}
type fakeServiceB struct{}
type fakeServiceC struct{}

func TestCompareServiceTypesWith(t *testing.T) {
	declared := []any{(*fakeServiceA)(nil), (*fakeServiceB)(nil), (*fakeServiceC)(nil)}
	optional := []any{(*fakeServiceC)(nil)}

	require.NoError(t, compareServiceTypesWith(declared, []any{&fakeServiceA{}, &fakeServiceB{}, &fakeServiceC{}}, optional))
	require.NoError(t, compareServiceTypesWith(declared, []any{&fakeServiceB{}, &fakeServiceA{}}, optional),
		"an optional type may be absent")

	err := compareServiceTypesWith(declared, []any{&fakeServiceA{}}, optional)
	require.ErrorContains(t, err, "main.fakeServiceB is declared in boundServiceTypes but not registered")
	require.NotContains(t, err.Error(), "fakeServiceC", "an optional type is not reported missing")

	err = compareServiceTypesWith(declared[:2], []any{&fakeServiceA{}, &fakeServiceB{}, &fakeServiceC{}}, nil)
	require.ErrorContains(t, err, "*main.fakeServiceC is registered but not declared")

	err = compareServiceTypesWith(declared, []any{&fakeServiceA{}, &fakeServiceA{}, &fakeServiceB{}}, optional)
	require.ErrorContains(t, err, "*main.fakeServiceA is registered twice")

	err = compareServiceTypesWith(append(declared, (*fakeServiceA)(nil)),
		[]any{&fakeServiceA{}, &fakeServiceB{}}, optional)
	require.ErrorContains(t, err, "*main.fakeServiceA is declared twice")
}

func TestCompareServiceTypesAllowsOnlyPluginLogToBeAbsent(t *testing.T) {
	var registered []any
	for _, service := range boundServiceTypes() {
		if _, isLog := service.(*pluginlog.ServiceWrapper); !isLog {
			registered = append(registered, service)
		}
	}
	require.NoError(t, compareServiceTypes(boundServiceTypes(), registered))
	require.NoError(t, compareServiceTypes(boundServiceTypes(), append(registered, &pluginlog.ServiceWrapper{})))

	err := compareServiceTypes(boundServiceTypes(), registered[1:])
	require.ErrorContains(t, err, "but not registered")
}

func TestHandleAuditFailure(t *testing.T) {
	failure := errors.New("stale allowlist")
	var warned, died []error
	warn := func(err error) { warned = append(warned, err) }
	fatal := func(err error) { died = append(died, err) }

	handleAuditFailure(nil, true, warn, fatal)
	require.Empty(t, warned)
	require.Empty(t, died)

	handleAuditFailure(failure, false, warn, fatal)
	require.Equal(t, []error{failure}, warned, "a non-development host warns and continues")
	require.Empty(t, died)

	handleAuditFailure(failure, true, warn, fatal)
	require.Equal(t, []error{failure}, died, "a development host stops")
	require.Len(t, warned, 1)
}

// Wails mounts a registered service that implements http.Handler at
// ServiceOptions.Route, outside /wails/runtime where the gateway filters. The
// host must never set a Route.
func TestHostSetsNoServiceRoute(t *testing.T) {
	var found []string
	hostGoSources(t, func(path string, source []byte) {
		ast.Inspect(parseHostSource(t, path, source), func(node ast.Node) bool {
			switch n := node.(type) {
			case *ast.CallExpr:
				if selector, ok := n.Fun.(*ast.SelectorExpr); ok && selector.Sel.Name == "NewServiceWithOptions" {
					found = append(found, fmt.Sprintf("%s: NewServiceWithOptions", path))
				}
			case *ast.CompositeLit:
				if !isServiceOptionsType(n.Type) {
					return true
				}
				for _, element := range n.Elts {
					pair, ok := element.(*ast.KeyValueExpr)
					if !ok {
						continue
					}
					if key, ok := pair.Key.(*ast.Ident); ok && key.Name == "Route" {
						found = append(found, fmt.Sprintf("%s: ServiceOptions.Route", path))
					}
				}
			}
			return true
		})
	})
	require.Empty(t, found, "the audit gateway does not filter service routes")
}

// isServiceOptionsType matches application.ServiceOptions.
func isServiceOptionsType(expr ast.Expr) bool {
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := selector.X.(*ast.Ident)
	return ok && pkg.Name == "application" && selector.Sel.Name == "ServiceOptions"
}
