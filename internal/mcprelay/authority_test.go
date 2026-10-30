package mcprelay

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"sync"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/stretchr/testify/require"
)

func authorityFixture(t *testing.T) (*Authority, Config, ToolInfo, context.Context) {
	t.Helper()
	a := NewAuthority()
	cfg := DefaultConfig("shared-secret")
	cfg.Enabled = true
	cfg.Global.Preset = PresetAll
	tool := ToolInfo{MCPName: "plugin_custom", PluginID: "plugin", Name: "custom", Scope: ScopePlugin, Status: StatusOK}
	a.UpdatePolicy(cfg)
	a.UpdateCatalog([]ToolInfo{tool})
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	t.Cleanup(a.Retire)
	// Unit fixture supplies the private session scope; HTTP integration exercises
	// the SDK-owned server session and its close notification.
	session := &authoritySession{id: "host-test-session", epoch: a.epoch, ctx: ctx, cancel: cancel}
	return a, cfg, tool, context.WithValue(a.Authenticate(ctx), authoritySessionKey{}, session)
}

func TestAuthorityRevocationDuringConsentPreventsProviderCall(t *testing.T) {
	a, cfg, tool, ctx := authorityFixture(t)
	bound, err := a.Bind(ctx, tool, "", []byte(`{"input":"immutable"}`))
	require.NoError(t, err)
	relay := &Relay{authority: a, pending: map[string]*pendingEntry{}, showConfirmation: func() error { return nil }}
	requested := make(chan struct{})
	a.SetAudit(func(e AuditEvent) {
		if e.Outcome == "consent-requested" {
			close(requested)
		}
	})
	resolved := make(chan bool, 1)
	go func() { approved, _ := relay.awaitConfirmation(bound, PendingConfirmation{}); resolved <- approved }()
	<-requested
	cfg.Global.Preset = PresetNone
	a.UpdatePolicy(cfg)
	// Approval races with revocation. Either way dispatch must reject it.
	for _, p := range relay.ListPendingConfirmations() {
		_ = relay.ResolveConfirmation(p.ID, true)
	}
	<-resolved
	calls := 0
	require.Error(t, a.Dispatch(bound, func(context.Context) error { calls++; return nil }))
	require.Zero(t, calls)
}

func TestAuthorityRetirementInvalidatesConsentAndLateResults(t *testing.T) {
	for _, change := range []string{"stop", "credential", "catalog", "policy"} {
		t.Run(change, func(t *testing.T) {
			a, cfg, tool, ctx := authorityFixture(t)
			bound, err := a.Bind(ctx, tool, "", []byte(`{}`))
			require.NoError(t, err)
			require.NoError(t, a.Approve(bound))
			entered, release := make(chan struct{}), make(chan struct{})
			done := make(chan error, 1)
			go func() {
				done <- a.Dispatch(bound, func(context.Context) error { close(entered); <-release; return nil })
			}()
			<-entered
			switch change {
			case "stop":
				a.Retire()
			case "credential":
				cfg.Token = "rotated"
				a.UpdatePolicy(cfg)
			case "catalog":
				replacement := tool
				replacement.Description = "replacement"
				a.UpdateCatalog([]ToolInfo{replacement})
			case "policy":
				cfg.Global.Preset = PresetNone
				a.UpdatePolicy(cfg)
			}
			require.Error(t, bound.Err())
			close(release)
			require.Error(t, <-done, "late provider success must never escape retirement")
		})
	}
}

func TestAuthorityBindsImmutableArgumentsAndActualCustomTarget(t *testing.T) {
	a, _, tool, ctx := authorityFixture(t)
	args := []byte(`{"n":9007199254740993}`)
	bound, err := a.Bind(ctx, tool, "", args)
	require.NoError(t, err)
	require.NoError(t, a.Approve(bound))
	args[0] = '['
	payload := a.Confirmation(bound, PendingConfirmation{ArgumentsJSON: `{"wrong":true}`})
	require.Equal(t, `{"n":9007199254740993}`, payload.ArgumentsJSON)
	require.Equal(t, "external-agent", payload.Origin)
	require.NotEmpty(t, payload.CredentialID)
	require.NotEmpty(t, payload.SessionID)
	boundary := invocation.NewBoundary(a)
	require.NoError(t, a.Dispatch(bound, func(callCtx context.Context) error {
		_, err := boundary.Admit(callCtx, "tools.call", invocation.Target{Provider: tool.PluginID, Action: tool.Name})
		require.NoError(t, err)
		_, err = boundary.Admit(callCtx, "tools.call", invocation.Target{Provider: tool.PluginID, Action: "other"})
		require.Error(t, err)
		_, err = boundary.Admit(callCtx, "resource.StartConnection", invocation.Target{Provider: tool.PluginID})
		require.Error(t, err)
		return nil
	}))
	require.Error(t, a.Dispatch(bound, func(context.Context) error { t.Fatal("must not dispatch twice"); return nil }))
}

func TestAuthorityPluginOnlyToolNeedsNoNativeConnection(t *testing.T) {
	a, _, tool, ctx := authorityFixture(t)
	bound, err := a.Bind(ctx, tool, "", []byte(`{}`))
	require.NoError(t, err)
	require.NoError(t, a.Approve(bound))
	require.NoError(t, a.Dispatch(bound, func(ctx context.Context) error {
		_, err := invocation.NewBoundary(a).Admit(ctx, "tools.call", invocation.Target{Provider: tool.PluginID, Action: tool.Name})
		return err
	}))
}

func TestAuthorityMissingCatalogAndForgedScopeFailClosed(t *testing.T) {
	a, _, tool, ctx := authorityFixture(t)
	unknown := tool
	unknown.Name = "absent"
	_, err := a.Bind(ctx, unknown, "", []byte(`{}`))
	require.Error(t, err)
	forged := invocation.NewScope(invocation.ExternalAgent).Context(context.Background())
	_, err = invocation.NewBoundary(a).Admit(forged, "tools.call", invocation.Target{Provider: tool.PluginID, Action: tool.Name})
	require.Error(t, err)
	_, err = invocation.NewBoundary(nil).Admit(forged, "tools.call", invocation.Target{Provider: tool.PluginID, Action: tool.Name})
	require.Error(t, err)
}

func TestAuthorityNativeOriginsRemainNative(t *testing.T) {
	a := NewAuthority()
	for _, origin := range []invocation.Origin{invocation.Host, invocation.TrustedUI} {
		_, err := invocation.NewBoundary(a).Admit(invocation.NewScope(origin).Context(context.Background()), "resource.StartConnection", invocation.Target{Provider: "plugin"})
		require.NoError(t, err)
	}
}

func TestAuthorityAuditContainsCorrelatedConcreteOutcomes(t *testing.T) {
	a, _, tool, ctx := authorityFixture(t)
	var mu sync.Mutex
	var events []AuditEvent
	a.SetAudit(func(e AuditEvent) { mu.Lock(); events = append(events, e); mu.Unlock() })
	bound, err := a.Bind(ctx, tool, "", []byte(`{"secret":"never-audit"}`))
	require.NoError(t, err)
	require.NoError(t, a.Approve(bound))
	require.Error(t, a.Dispatch(bound, func(context.Context) error { return errors.New("raw-secret-error") }))
	require.Len(t, events, 3)
	require.Equal(t, "admitted", events[0].Outcome)
	require.Equal(t, "dispatched", events[1].Outcome)
	require.Equal(t, "failed", events[2].Outcome)
	require.Equal(t, events[0].InvocationID, events[2].InvocationID)
	encoded, err := json.Marshal(events)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "never-audit")
	require.NotContains(t, string(encoded), "raw-secret-error")
	require.NotContains(t, string(encoded), "shared-secret")
}

func TestConsentRequiresReachableWindow(t *testing.T) {
	for _, show := range []func() error{nil, func() error { return errors.New("no workspace") }} {
		relay := &Relay{pending: map[string]*pendingEntry{}, showConfirmation: show}
		approved, reason := relay.awaitConfirmation(context.Background(), PendingConfirmation{})
		require.False(t, approved)
		require.Equal(t, "unavailable", reason)
		require.Empty(t, relay.ListPendingConfirmations())
	}
}

func TestAuthorityRequiresServerSessionBeforeConsent(t *testing.T) {
	a, _, tool, _ := authorityFixture(t)
	ctx := a.Authenticate(context.Background())
	_, err := a.Bind(ctx, tool, "", []byte(`{}`))
	require.Error(t, err)
	_, err = a.Session(ctx, nil)
	require.Error(t, err)
}

func TestConfirmationWirePreservesNumericMeaningAsText(t *testing.T) {
	a, _, tool, ctx := authorityFixture(t)
	const raw = `{"integer":9007199254740993,"maximum":18446744073709551615,"zero":-0,"decimal":0.12345678901234567890123456789}`
	bound, err := a.Bind(ctx, tool, "", []byte(raw))
	require.NoError(t, err)
	payload := a.Confirmation(bound, PendingConfirmation{ID: "pending"})
	relay := &Relay{pending: map[string]*pendingEntry{
		payload.ID: {payload: payload},
	}}
	for name, value := range map[string]any{
		"event":            payload,
		"pending snapshot": relay.ListPendingConfirmations(),
	} {
		t.Run(name, func(t *testing.T) {
			// Decode the outer wire value with ordinary float64 semantics, as
			// JavaScript JSON.parse does. Argument numbers must stay in text.
			wire, err := json.Marshal(value)
			require.NoError(t, err)
			var decoded any
			require.NoError(t, json.Unmarshal(wire, &decoded))
			if array, ok := decoded.([]any); ok {
				require.Len(t, array, 1)
				decoded = array[0]
			}
			object, ok := decoded.(map[string]any)
			require.True(t, ok)
			require.NotContains(t, object, "arguments", "embedded JSON would round before consent display")
			text, ok := object["argumentsJSON"].(string)
			require.True(t, ok, "both wire paths must carry raw JSON text")
			require.Equal(t, raw, text)
			decoder := json.NewDecoder(strings.NewReader(text))
			decoder.UseNumber()
			var numbers map[string]json.Number
			require.NoError(t, decoder.Decode(&numbers))
			require.Equal(t, "9007199254740993", numbers["integer"].String())
			require.Equal(t, "18446744073709551615", numbers["maximum"].String())
			require.Equal(t, "0.12345678901234567890123456789", numbers["decimal"].String())
			zero, err := numbers["zero"].Float64()
			require.NoError(t, err)
			require.Zero(t, zero)
			require.True(t, math.Signbit(zero), "consent must distinguish negative zero")
		})
	}
}

func TestBoundBuiltinAdoptsConsentPolicyAfterBlockedDiscovery(t *testing.T) {
	a, cfg, _, ctx := authorityFixture(t)
	tool := ToolInfo{MCPName: "plugin_list_connections", PluginID: "plugin", BuiltIn: true, ReadOnly: true, Scope: ScopePlugin, Status: StatusOK}
	a.UpdateCatalog([]ToolInfo{tool})
	cfg.Global.ToolOverrides[tool.MCPName] = ToolOverride{Confirm: new(false)}
	a.UpdatePolicy(cfg)
	discoveryEntered, discoveryRelease := make(chan struct{}), make(chan struct{})
	boundResult := make(chan context.Context, 1)
	errResult := make(chan error, 1)
	go func() {
		close(discoveryEntered)
		<-discoveryRelease
		bound, err := a.Bind(ctx, tool, "", []byte(`{}`))
		boundResult <- bound
		errResult <- err
	}()
	<-discoveryEntered
	cfg.Global.ToolOverrides[tool.MCPName] = ToolOverride{Confirm: new(true)}
	a.UpdatePolicy(cfg)
	close(discoveryRelease)
	bound := <-boundResult
	require.NoError(t, <-errResult)
	confirm, err := a.Confirm(bound)
	require.NoError(t, err)
	require.True(t, confirm, "pre-discovery Confirm=false must not waive the bound requirement")
	relay := &Relay{authority: a, pending: map[string]*pendingEntry{}}
	approved, reason := relay.awaitConfirmation(bound, PendingConfirmation{})
	require.False(t, approved)
	require.Equal(t, "unavailable", reason)
	providerCalls := 0
	require.Error(t, a.Dispatch(bound, func(callCtx context.Context) error {
		_, err := invocation.NewBoundary(a).Admit(callCtx, "resource.ListConnections", invocation.Target{Provider: tool.PluginID})
		if err == nil {
			providerCalls++
		}
		return err
	}))
	require.Zero(t, providerCalls, "unavailable required consent must prevent actual inventory work")
}

func TestBuiltinInventoryUsesBoundPolicyAndFencesRevokedResult(t *testing.T) {
	a, cfg, _, ctx := authorityFixture(t)
	tool := ToolInfo{MCPName: "plugin_list_connections", PluginID: "plugin", BuiltIn: true, ReadOnly: true, Scope: ScopePlugin, Status: StatusOK}
	a.UpdateCatalog([]ToolInfo{tool})
	cfg.Global.ToolOverrides[tool.MCPName] = ToolOverride{Confirm: new(true)}
	a.UpdatePolicy(cfg)
	bound, err := a.Bind(ctx, tool, "", []byte(`{}`))
	require.NoError(t, err)
	confirm, err := a.Confirm(bound)
	require.NoError(t, err)
	require.True(t, confirm)
	require.NoError(t, a.Approve(bound))
	entered, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- a.Dispatch(bound, func(callCtx context.Context) error {
			policy, err := a.Policy(callCtx)
			if err != nil {
				return err
			}
			if !policy.ConnectionAccess(tool.PluginID, "route") {
				return errors.New("initial route unexpectedly denied")
			}
			_, err = invocation.NewBoundary(a).Admit(callCtx, "resource.ListConnections", invocation.Target{Provider: tool.PluginID})
			if err != nil {
				return err
			}
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered
	cfg.BlockConnectionsByDefault = true
	a.UpdatePolicy(cfg)
	close(release)
	require.Error(t, <-done, "inventory collected under revoked policy must not escape")
	_, err = a.Policy(bound)
	require.Error(t, err, "old snapshot must not be reused after revision changes")
	require.Error(t, a.Approve(bound), "retired consent must never be accepted")
}

func TestCursorOwnerUsesSessionNotChildInvocation(t *testing.T) {
	a, _, tool, ctx := authorityFixture(t)
	first, err := a.Bind(ctx, tool, "", []byte(`{}`))
	require.NoError(t, err)
	next, err := a.Bind(ctx, tool, "", []byte(`{}`))
	require.NoError(t, err)
	firstCall := first.Value(authorityContextKey{}).(*authorityCall)
	nextCall := next.Value(authorityContextKey{}).(*authorityCall)
	require.NotEqual(t, firstCall.principal.Owner(), nextCall.principal.Owner())
	require.NotEmpty(t, AuthorityCursorOwner(first))
	require.Equal(t, AuthorityCursorOwner(first), AuthorityCursorOwner(next))
	otherSession := &authoritySession{id: "another-host-session", epoch: a.epoch, ctx: ctx}
	other, err := a.Bind(context.WithValue(ctx, authoritySessionKey{}, otherSession), tool, "", []byte(`{}`))
	require.NoError(t, err)
	require.NotEqual(t, AuthorityCursorOwner(first), AuthorityCursorOwner(other))
	require.Empty(t, AuthorityCursorOwner(invocation.HostContext(context.Background())))
	require.Empty(t, AuthorityCursorOwner(nil))
}

func TestDispatchPreservesNativeFailureDespiteOwnershipCleanup(t *testing.T) {
	a, _, tool, transport := authorityFixture(t)
	bound, err := a.Bind(transport, tool, "", []byte(`{}`))
	require.NoError(t, err)
	require.NoError(t, a.Approve(bound))
	nativeFailure := errors.New("native operation denied")
	err = a.Dispatch(bound, func(ctx context.Context) error {
		_, admissionErr := invocation.NewBoundary(a).Admit(ctx, "tools.call", invocation.Target{Provider: tool.PluginID, Action: tool.Name})
		if admissionErr != nil {
			return admissionErr
		}
		return nativeFailure
	})
	require.ErrorIs(t, err, nativeFailure)
	require.ErrorIs(t, bound.Err(), context.Canceled, "finished ownership must be released")
	require.NoError(t, transport.Err(), "native failure and child cleanup are not transport cancellation")
}
