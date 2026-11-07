package devsdk

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsource"
)

func sdkCheckout(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("Git unavailable")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=", "GIT_CONFIG_NOSYSTEM=1")
		raw, runErr := cmd.CombinedOutput()
		require.NoError(t, runErr, "git %v: %s", args, raw)
	}
	git("init")
	for _, relative := range []string{"go.mod", "pkg/state/root.go", "settings/api.go"} {
		require.NoError(t, os.MkdirAll(filepath.Join(root, filepath.Dir(relative)), 0700))
		require.NoError(t, os.WriteFile(filepath.Join(root, relative), []byte("reviewed source fixture\n"), 0600))
	}
	git("add", ".")
	git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath="+os.DevNull, "commit", "-m", "fixture")
	return root
}

func TestPolicyAdmitsSourceIdentitiesWithoutPublishedAcceptance(t *testing.T) {
	source, err := NewSourceIdentity(fixtureSource(t))
	require.NoError(t, err)
	for name, policy := range map[string]Policy{"zero": {}, "nil acceptance": NewPolicy(nil), "injected": NewPolicy(func(Published) error { return errors.New("never consulted") })} {
		t.Run(name, func(t *testing.T) {
			require.NoError(t, policy.Admit(source))
		})
	}
}

func TestPolicyRefusesEveryPublishedIdentityByDefault(t *testing.T) {
	published, err := NewPublishedIdentity(fixturePublished())
	require.NoError(t, err)
	for name, policy := range map[string]Policy{"zero": {}, "nil acceptance": NewPolicy(nil)} {
		t.Run(name, func(t *testing.T) {
			err := policy.Admit(published)
			require.ErrorIs(t, err, ErrNotAccepted)
		})
	}
}

func TestInjectedPolicyDecidesPublishedIdentities(t *testing.T) {
	published, err := NewPublishedIdentity(fixturePublished())
	require.NoError(t, err)
	var seen []Published
	accept := NewPolicy(func(p Published) error {
		seen = append(seen, p)
		return nil
	})
	require.NoError(t, accept.Admit(published))
	require.Equal(t, []Published{fixturePublished()}, seen, "the policy must judge exactly the validated identity")

	cause := errors.New("below the accepted floor")
	refuse := NewPolicy(func(Published) error { return cause })
	err = refuse.Admit(published)
	require.ErrorIs(t, err, ErrNotAccepted)
	require.ErrorIs(t, err, cause)
}

func TestPolicyNeverAdmitsInvalidIdentities(t *testing.T) {
	accept := NewPolicy(func(Published) error { return nil })
	require.Error(t, accept.Admit(Identity{}), "the zero identity must never be admitted")
	mixed := Identity{mode: ModeSource, published: fixturePublished()}
	require.Error(t, accept.Admit(mixed))
}

// Source-mode identity must be exactly what devsource.Verify observes, before
// and after dirty edits, so the typed seam never changes admitted evidence.
func TestVerifierReturnsExactlyTheDevsourceIdentity(t *testing.T) {
	directory := sdkCheckout(t)
	selection, err := SourceSelection(directory)
	require.NoError(t, err)
	verify := NewVerifier(Policy{})

	for _, state := range []string{"clean", "dirty API edit", "dirty isolation edit"} {
		switch state {
		case "dirty API edit":
			require.NoError(t, os.WriteFile(filepath.Join(directory, "settings/api.go"), []byte("dirty API edit\n"), 0600))
		case "dirty isolation edit":
			require.NoError(t, os.WriteFile(filepath.Join(directory, "pkg/state/root.go"), []byte("dirty state source\n"), 0600))
		}
		expected, err := devsource.Verify(context.Background(), directory)
		require.NoError(t, err, state)
		identity, err := verify(context.Background(), selection)
		require.NoError(t, err, state)
		source, ok := identity.Source()
		require.True(t, ok, state)
		require.Equal(t, expected, source, "%s: typed verification changed the observed identity", state)
		require.NoError(t, identity.Validate(), state)
	}
}

func TestVerifierBindsToTheSelectedCheckout(t *testing.T) {
	selected, other := sdkCheckout(t), sdkCheckout(t)
	selection, err := SourceSelection(selected)
	require.NoError(t, err)
	identity, err := NewVerifier(Policy{})(context.Background(), selection)
	require.NoError(t, err)
	source, _ := identity.Source()
	require.Equal(t, selected, source.Directory)
	require.NotEqual(t, other, source.Directory)

	sibling, err := SourceSelection(filepath.Join(selected, "pkg"))
	require.NoError(t, err)
	_, err = NewVerifier(Policy{})(context.Background(), sibling)
	require.Error(t, err, "a subdirectory is not the selected repository root")

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = NewVerifier(Policy{})(cancelled, selection)
	require.ErrorIs(t, err, context.Canceled)
}

func TestVerifierRefusesPublishedSelectionsUntilTheyCanBeVerified(t *testing.T) {
	accepting := NewPolicy(func(Published) error { return nil })
	for name, policy := range map[string]Policy{"default policy": {}, "accepting policy": accepting} {
		t.Run(name, func(t *testing.T) {
			identity, err := NewVerifier(policy)(context.Background(), PublishedSelection())
			require.ErrorIs(t, err, ErrNotAccepted)
			require.Equal(t, Identity{}, identity, "a refused selection must not yield partial evidence")
		})
	}
}
