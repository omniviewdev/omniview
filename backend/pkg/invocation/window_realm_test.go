package invocation

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type realmWindow struct {
	application.Window
	id      uint
	onClose func(*application.WindowEvent)
}

func (w *realmWindow) ID() uint { return w.id }
func (w *realmWindow) OnWindowEvent(_ events.WindowEventType, callback func(*application.WindowEvent)) func() {
	w.onClose = callback
	return func() {}
}
func realmWindowContext(window application.Window) context.Context {
	return context.WithValue(context.Background(), application.WindowKey, window)
}
func admittedWindowOwner(t *testing.T, realm *WindowRealm, window application.Window) string {
	t.Helper()
	boundary := NewBoundary(AuthorizeFunc(func(Principal, string, Target) error { return nil }))
	ctx, err := boundary.Admit(realm.Context(realmWindowContext(window)), "metric.Query", Target{})
	require.NoError(t, err)
	request, ok := FromContext(ctx)
	require.True(t, ok)
	require.Equal(t, TrustedUI, request.Principal().Origin())
	return request.Principal().Owner()
}
func TestWindowRealmSharesIdentityWithinWindowAndIsolatesWindows(t *testing.T) {
	realm := NewWindowRealm(nil)
	first, second := &realmWindow{id: 1}, &realmWindow{id: 2}
	owner := admittedWindowOwner(t, realm, first)
	require.Equal(t, owner, admittedWindowOwner(t, realm, first))
	require.NotEqual(t, owner, admittedWindowOwner(t, realm, second))
	first.onClose(nil)
	require.Nil(t, realm.ScopeForWindow(first))
	require.NotEmpty(t, admittedWindowOwner(t, realm, second))
}
func TestWindowRealmRejectsMissingWindowWithoutRetainingOtherGrant(t *testing.T) {
	realm := NewWindowRealm(nil)
	boundary := NewBoundary(AuthorizeFunc(func(Principal, string, Target) error { return nil }))
	for _, origin := range []Origin{Host, TrustedUI, ExternalAgent} {
		_, err := boundary.Admit(realm.Context(NewScope(origin).Context(context.Background())), "resource.OpenSourceView", Target{})
		require.Error(t, err)
	}
}
func TestWindowRealmConcurrentServicesShareOnePrincipal(t *testing.T) {
	realm, window := NewWindowRealm(nil), &realmWindow{id: 1}
	owners := make([]string, 16)
	var group sync.WaitGroup
	for index := range owners {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			owners[index] = realm.ScopeForWindow(window).Principal().Owner()
		}(index)
	}
	group.Wait()
	for _, owner := range owners {
		require.Equal(t, owners[0], owner)
	}
}

type otherKindRealmWindow struct{ realmWindow }

func TestWindowRealmKeysScopesByWindowKindAndID(t *testing.T) {
	realm := NewWindowRealm(nil)
	native, browser := &realmWindow{id: 1}, &otherKindRealmWindow{realmWindow{id: 1}}
	nativeScope, browserScope := realm.ScopeForWindow(native), realm.ScopeForWindow(browser)
	require.NotNil(t, nativeScope)
	require.NotNil(t, browserScope)
	require.NotSame(t, nativeScope, browserScope)
	require.NotEqual(t, nativeScope.Principal().Owner(), browserScope.Principal().Owner())
	require.Same(t, nativeScope, realm.ScopeForWindow(native))
	require.Same(t, browserScope, realm.ScopeForWindow(browser))

	native.onClose(nil)
	require.Nil(t, realm.ScopeForWindow(native))
	require.Same(t, browserScope, realm.ScopeForWindow(browser))
	require.Nil(t, realm.ScopeForWindow(&realmWindow{id: 1}))
	require.NotNil(t, realm.ScopeForWindow(&otherKindRealmWindow{realmWindow{id: 2}}))
}

func TestWindowRealmScopeCapCountsEveryWindowKind(t *testing.T) {
	realm := NewWindowRealm(nil)
	for id := uint(1); id <= 32; id++ {
		require.NotNil(t, realm.ScopeForWindow(&realmWindow{id: id}))
		require.NotNil(t, realm.ScopeForWindow(&otherKindRealmWindow{realmWindow{id: id}}))
	}
	require.Nil(t, realm.ScopeForWindow(&realmWindow{id: 33}))
	require.Nil(t, realm.ScopeForWindow(&otherKindRealmWindow{realmWindow{id: 33}}))
}
