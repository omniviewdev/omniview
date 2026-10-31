package settings

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestHostCommitOrdersLiveEffectsWithDurablePublication(t *testing.T) {
	store := openStore(t)
	service, err := Initialize(Options{Store: store, Categories: definitions()})
	require.NoError(t, err)
	entered := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	var mu sync.Mutex
	actual := "initial"
	service.SetApplyHandler(func(_ string, values map[string]any) error {
		name, ok := values["name"].(string)
		if !ok {
			return fmt.Errorf("expected string name, got %T", values["name"])
		}
		if name == "enabled" {
			close(entered)
			<-release
		}
		mu.Lock()
		actual = name
		mu.Unlock()
		return nil
	})
	type outcome struct {
		result CommitResult
		err    error
	}
	first := make(chan outcome, 1)
	go func() {
		result, commitErr := service.Commit(Scope{Kind: "host"}, map[string]any{"core.name": "enabled"})
		first <- outcome{result, commitErr}
	}()
	select {
	case <-entered:
	case early := <-first:
		require.NoError(t, early.err)
		t.Fatal("first commit returned before entering its suspended live effect")
	}
	secondStarted := make(chan struct{})
	second := make(chan outcome, 1)
	go func() {
		close(secondStarted)
		result, commitErr := service.Commit(Scope{Kind: "host"}, map[string]any{"core.name": "disabled"})
		second <- outcome{result, commitErr}
	}()
	<-secondStarted
	// Keep the first effect suspended while the second writer attempts its commit.
	// Without service-level ordering, the second writer publishes and returns here.
	select {
	case <-second:
		t.Fatal("second commit passed the first commit's suspended live effect")
	case <-time.After(50 * time.Millisecond):
	}
	configured, err := service.Provider().GetString("core.name")
	require.NoError(t, err)
	require.Equal(t, "enabled", configured)
	unblock()
	a, b := <-first, <-second
	require.NoError(t, a.err)
	require.NoError(t, b.err)
	require.True(t, a.result.Applied)
	require.True(t, b.result.Applied)
	require.Equal(t, "enabled", a.result.Snapshot.Categories["core"].Settings["name"].Value)
	require.Equal(t, "disabled", b.result.Snapshot.Categories["core"].Settings["name"].Value)
	mu.Lock()
	applied := actual
	mu.Unlock()
	saved, err := store.LoadCategory("core")
	require.NoError(t, err)
	require.Equal(t, "disabled", saved["name"])
	require.Equal(t, saved["name"], applied)
}
