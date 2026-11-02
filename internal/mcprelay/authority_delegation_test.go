package mcprelay

import (
	"context"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/stretchr/testify/require"
)

func TestDelegatedAuthorityKeepsConcurrentReadAndWriteSeparate(t *testing.T) {
	a, _, _, parent := authorityFixture(t)
	read := ToolInfo{MCPName: "flux_status", PluginID: "flux", Name: "status", Scope: ScopeConnection, ConnectionOwner: "kubernetes", ReadOnly: true, Status: StatusOK}
	write := ToolInfo{MCPName: "flux_suspend", PluginID: "flux", Name: "suspend", Scope: ScopeConnection, ConnectionOwner: "kubernetes", Status: StatusOK}
	a.UpdateCatalog([]ToolInfo{read, write})
	consumer := config.PluginMeta{ID: "flux", Requires: &config.RequiresSpec{Connections: []config.ConnectionRequirement{{Plugin: "kubernetes", Operations: []string{"catalog", "get", "update"}, ResourceTypes: []string{"flux/*"}}}}}
	owner := config.PluginMeta{ID: "kubernetes", Exports: &config.ExportsSpec{Connections: &config.ConnectionExport{Operations: []string{"catalog", "get", "update"}, ResourceTypes: []string{"flux/*"}}}}
	grant, err := config.GrantConnections(consumer, owner)
	require.NoError(t, err)
	boundary := invocation.NewBoundary(a)
	readCtx, err := a.Bind(parent, read, "cluster", []byte(`{}`))
	require.NoError(t, err)
	require.NoError(t, a.Approve(readCtx))
	writeCtx, err := a.Bind(parent, write, "cluster", []byte(`{}`))
	require.NoError(t, err)
	require.NoError(t, a.Approve(writeCtx))
	ready := make(chan struct{}, 2)
	release := make(chan struct{})
	results := make(chan error, 2)
	for _, tc := range []struct {
		ctx  context.Context
		tool ToolInfo
	}{{readCtx, read}, {writeCtx, write}} {
		tc := tc
		go func() {
			results <- a.Dispatch(tc.ctx, func(ctx context.Context) error {
				admitted, err := boundary.Admit(ctx, "tools.call", invocation.Target{Provider: "flux", Connection: "cluster", Action: tc.tool.Name})
				if err != nil {
					return err
				}
				stop, err := boundary.RegisterDelegation(admitted, invocation.Delegation{Consumer: "flux", Owner: "kubernetes", Connection: "cluster", ReadOnly: tc.tool.ReadOnly, Grant: grant})
				if err != nil {
					return err
				}
				defer stop()
				ready <- struct{}{}
				<-release
				_, err = boundary.Admit(admitted, "resource.Mutate", invocation.Target{Provider: "kubernetes", Connection: "cluster", ResourceType: "flux/items", Action: "update"})
				if tc.tool.ReadOnly && err == nil {
					return errAuthority
				}
				if !tc.tool.ReadOnly && err != nil {
					return err
				}
				_, err = boundary.Admit(admitted, "resource.Get", invocation.Target{Provider: "other", Connection: "cluster", ResourceType: "flux/items"})
				if err == nil {
					return errAuthority
				}
				_, err = boundary.Admit(admitted, "resource.Get", invocation.Target{Provider: "kubernetes", Connection: "wrong", ResourceType: "flux/items"})
				if err == nil {
					return errAuthority
				}
				_, err = boundary.Admit(admitted, "resource.Get", invocation.Target{Provider: "kubernetes", Connection: "cluster", ResourceType: "secret/items"})
				if err == nil {
					return errAuthority
				}
				return nil
			})
		}()
	}
	<-ready
	<-ready
	close(release)
	require.NoError(t, <-results)
	require.NoError(t, <-results)
	_, err = boundary.Admit(readCtx, "resource.Get", invocation.Target{Provider: "kubernetes", Connection: "cluster", ResourceType: "flux/items"})
	require.Error(t, err)
}
