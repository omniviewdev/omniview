package mcprelay

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/require"
)

func TestPolicyChangesProjectWhileDiscoveryIsBlocked(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	h.relay.connections.(*fakeConnections).stateHook = func() {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
	}
	h.relay.requestDiscovery()
	<-started
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()

	changed := make(chan error, 1)
	go func() {
		for i := range 20 {
			if err := h.service.SetToolOverride(Scope{}, "alpha_ping", ToolOverride{Enabled: new(i%2 == 0)}); err != nil {
				changed <- err
				return
			}
		}
		changed <- nil
	}()
	select {
	case err := <-changed:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("policy update waited for resource discovery")
	}
	require.NotContains(t, toolNames(t, session), "alpha_ping")
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "alpha_ping"})
	require.True(t, err != nil || result.IsError, "retired policy must deny old handlers immediately")
	close(release)
	require.Eventually(t, func() bool {
		h.relay.mu.Lock()
		defer h.relay.mu.Unlock()
		return !h.relay.discoveryRunning
	}, 5*time.Second, time.Millisecond)
	require.NotContains(t, toolNames(t, session), "alpha_ping", "old discovery must not restore old policy")
	require.EqualValues(t, 1, calls.Load(), "policy changes must not trigger resource rediscovery")
}

func TestDiscoveryTriggerBurstCoalescesAndRefreshesDisabledInventory(t *testing.T) {
	h := newHarness(t)
	require.NoError(t, h.service.SetEnabled(false))
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	h.relay.connections.(*fakeConnections).stateHook = func() {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
	}
	h.relay.requestDiscovery()
	<-started
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	h.tools.mu.Lock()
	entry := h.tools.plugins["alpha"]
	entry.Tools[0].Description = "disabled inventory replacement"
	entry.Generation++
	h.tools.plugins["alpha"] = entry
	h.tools.mu.Unlock()
	for range 100 {
		h.relay.inventoryChanged()
	}
	close(release)
	require.Eventually(t, func() bool {
		h.relay.mu.Lock()
		defer h.relay.mu.Unlock()
		return !h.relay.discoveryRunning
	}, 5*time.Second, time.Millisecond)
	require.EqualValues(t, 2, calls.Load(), "burst must request only one follow-up discovery")
	views, err := h.service.ListTools(Scope{})
	require.NoError(t, err)
	found := false
	for _, view := range views {
		if view.MCPName == "alpha_ping" {
			found = true
			require.False(t, view.Listed)
		}
	}
	require.True(t, found, "disabled settings must retain fresh inventory")
	require.NoError(t, h.service.SetEnabled(true))
	h.url = h.service.GetStatus().Endpoint
	session := h.connect(t, nil)
	tools, err := session.ListTools(context.Background(), nil)
	require.NoError(t, err)
	for _, tool := range tools.Tools {
		if tool.Name == "alpha_ping" {
			require.Equal(t, "disabled inventory replacement", tool.Description)
			return
		}
	}
	t.Fatal("re-enabled relay did not publish refreshed inventory")
}

func TestDirtyDiscoveryDoesNotPublishIntermediateInventory(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	firstStarted, secondStarted := make(chan struct{}), make(chan struct{})
	firstRelease, secondRelease := make(chan struct{}), make(chan struct{})
	defer func() {
		for _, release := range []chan struct{}{firstRelease, secondRelease} {
			select {
			case <-release:
			default:
				close(release)
			}
		}
	}()
	var calls atomic.Int32
	h.relay.connections.(*fakeConnections).stateHook = func() {
		switch calls.Add(1) {
		case 1:
			close(firstStarted)
			<-firstRelease
		case 2:
			close(secondStarted)
			<-secondRelease
		}
	}
	replace := func(description string) {
		h.tools.mu.Lock()
		defer h.tools.mu.Unlock()
		entry := h.tools.plugins["alpha"]
		entry.Tools = append(entry.Tools[:0:0], entry.Tools...)
		entry.Tools[0].Description = description
		entry.Generation++
		h.tools.plugins["alpha"] = entry
	}
	description := func() string {
		result, err := session.ListTools(context.Background(), nil)
		require.NoError(t, err)
		for _, tool := range result.Tools {
			if tool.Name == "alpha_ping" {
				return tool.Description
			}
		}
		t.Fatal("alpha_ping missing")
		return ""
	}
	replace("intermediate inventory")
	h.relay.requestDiscovery()
	<-firstStarted
	replace("current inventory")
	h.relay.requestDiscovery()
	close(firstRelease)
	<-secondStarted
	require.Empty(t, description(), "dirty discovery must not publish intermediate descriptors")
	close(secondRelease)
	require.Eventually(t, func() bool {
		h.relay.mu.Lock()
		defer h.relay.mu.Unlock()
		return !h.relay.discoveryRunning
	}, 5*time.Second, time.Millisecond)
	require.Equal(t, "current inventory", description())
}

func TestToolRemovalRetiresWhileResourceDiscoveryIsBlocked(t *testing.T) {
	h := newHarness(t)
	session := h.connect(t, nil)
	started, release := make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	var calls atomic.Int32
	h.relay.connections.(*fakeConnections).stateHook = func() {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
	}
	h.relay.requestDiscovery()
	<-started
	h.tools.mu.Lock()
	delete(h.tools.plugins, "alpha")
	h.tools.mu.Unlock()
	changed := make(chan struct{})
	go func() {
		for _, callback := range h.tools.listeners {
			callback()
		}
		close(changed)
	}()
	select {
	case <-changed:
	case <-time.After(2 * time.Second):
		t.Fatal("tool retirement waited for resource discovery")
	}
	require.NotContains(t, toolNames(t, session), "alpha_ping")
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "alpha_ping"})
	require.True(t, err != nil || result.IsError, "removed tool must stop accepting calls before discovery finishes")
	close(release)
	require.Eventually(t, func() bool {
		h.relay.mu.Lock()
		defer h.relay.mu.Unlock()
		return !h.relay.discoveryRunning
	}, 5*time.Second, time.Millisecond)
	require.NotContains(t, toolNames(t, session), "alpha_ping", "stale discovery must not restore removed tool")
}
