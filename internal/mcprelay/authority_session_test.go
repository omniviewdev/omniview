package mcprelay

import (
	"context"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/stretchr/testify/require"
)

func TestAuthorityOwnsNativeSessionWithoutTransportID(t *testing.T) {
	a, _, tool, _ := authorityFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	server := mcp.NewServer(&mcp.Implementation{Name: "native-session-test", Version: "1"}, nil)
	native, err := server.Connect(ctx, serverTransport, nil)
	require.NoError(t, err)
	defer native.Close()
	client := mcp.NewClient(&mcp.Implementation{Name: "untrusted-client-name", Version: "1"}, nil)
	connected, err := client.Connect(ctx, clientTransport, nil)
	require.NoError(t, err)
	defer connected.Close()
	require.Empty(t, native.ID(), "this real SDK transport has no wire session identifier")
	// The SDK detaches Initialize's request context for subsequent RPC work,
	// retaining the host-authenticated receipt after that HTTP request ends.
	initializeCtx, finishInitialize := context.WithCancel(ctx)
	authenticated := a.Authenticate(initializeCtx)
	finishInitialize()
	require.Error(t, authenticated.Err())
	receipt := authenticated.Value(authorityContextKey{}).(*authorityCall)
	a.forget(receipt)
	rpcCtx := context.WithoutCancel(authenticated)

	firstScope, err := a.Session(rpcCtx, native)
	require.NoError(t, err)
	first, err := a.Bind(firstScope, tool, "", []byte(`{}`))
	require.NoError(t, err)
	nextScope, err := a.Session(rpcCtx, native)
	require.NoError(t, err)
	next, err := a.Bind(nextScope, tool, "", []byte(`{}`))
	require.NoError(t, err)
	require.NotEmpty(t, AuthorityCursorOwner(first))
	require.Equal(t, AuthorityCursorOwner(first), AuthorityCursorOwner(next), "native session object owns stable scope")
	require.NoError(t, a.Approve(next))
	require.NoError(t, a.Dispatch(next, func(callCtx context.Context) error {
		_, err := invocation.NewBoundary(a).Admit(callCtx, "tools.call", invocation.Target{Provider: tool.PluginID, Action: tool.Name})
		return err
	}), "completed initialize HTTP context must not prevent actual native admission")

	require.NoError(t, connected.Close())
	select {
	case <-first.Done():
	case <-ctx.Done():
		t.Fatal("closing the actual SDK session did not retire accepted consent")
	}
	require.Error(t, a.Approve(first))
	calls := 0
	require.Error(t, a.Dispatch(first, func(context.Context) error { calls++; return nil }))
	require.Zero(t, calls)
}

func TestAuthorityCloseStartFencesExistingAndFirstCallsBeforeSDKDrain(t *testing.T) {
	a, _, tool, _ := authorityFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, pending := range []bool{false, true} {
		clientTransport, serverTransport := mcp.NewInMemoryTransports()
		native, err := mcp.NewServer(&mcp.Implementation{Name: "close-start", Version: "1"}, nil).Connect(ctx, serverTransport, nil)
		require.NoError(t, err)
		defer native.Close()
		client, err := mcp.NewClient(&mcp.Implementation{Name: "client", Version: "1"}, nil).Connect(ctx, clientTransport, nil)
		require.NoError(t, err)
		defer client.Close()
		authenticated := a.Authenticate(ctx)
		var bound context.Context
		if pending {
			scope, err := a.Session(authenticated, native)
			require.NoError(t, err)
			bound, err = a.Bind(scope, tool, "", []byte(`{}`))
			require.NoError(t, err)
		}
		// This call must complete before the transport starts graceful Close.
		require.NoError(t, a.CloseSession(a.Authenticate(ctx), native))
		if pending {
			require.Error(t, bound.Err(), "close-start cancellation must be synchronous, not deferred to AfterFunc")
			require.Error(t, a.Approve(bound))
		}
		_, err = a.Session(authenticated, native)
		require.Error(t, err, "a first RPC racing after close-start must not recreate live ownership")
	}
}
