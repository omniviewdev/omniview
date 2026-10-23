package devbaseline

import (
	"context"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func TestSeedEstablishesDefaultProfileStartupOwnership(t *testing.T) {
	home, source, profile := fixture(t)
	sourceSettings(t, source)
	_, err := Seed(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home}, ImportOptions{Destination: profile, Home: home})
	require.NoError(t, err)
	require.NoError(t, devcontract.EnsureDefaultProfileOwnership(home, profile.Descriptor.WorkspaceID), "seeded profile must pass the same ownership admission as host startup")
}
