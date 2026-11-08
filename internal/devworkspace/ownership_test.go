package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/stretchr/testify/require"
)

func TestSupervisedOwnershipFailureSurvivesAuthenticatedStatusTransport(t *testing.T) {
	t.Parallel()
	g := graphFixture(t, graphFixtureOptions{NoUI: true})
	g.workspace.ManifestPath = filepath.Join(g.workspace.Root, "workspace.json")
	host, err := g.workspace.RepositoryPath("omniview")
	require.NoError(t, err)
	changed := filepath.Join(host, "node_modules/private.tsbuildinfo")
	writeGraphFixture(t, changed, "private token=do-not-publish")
	s := &workspaceSupervisor{manager: &Manager{Root: filepath.Dir(filepath.Dir(g.workspace.Root)), options: Options{Home: t.TempDir()}}, workspace: g.workspace, generation: g.options.Generation, status: Status{Workspace: g.workspace, Generation: g.options.Generation, Phase: "building"}}
	g.options.OnEvent = func(event BuildEvent) {
		if event.Phase == "error" {
			s.status.LastError = supervisedBuildError(event, g.workspace)
			s.status.Phase = "build-error"
		}
	}
	var node BuildNode
	for _, n := range g.Nodes {
		if n.ID == "host-frontend" {
			node = n
		}
	}
	require.NotEmpty(t, node.ID)
	err = g.execute(context.Background(), []BuildNode{{ID: node.ID, Kind: node.Kind, Directory: node.Directory}}, nil)
	var conflict *devoutputs.Conflict
	require.True(t, errors.As(err, &conflict))
	require.NotNil(t, s.status.LastError)
	token := []byte("private-authenticated-ownership-smoke-token")
	server := httptest.NewServer(supervisorHandler(g.workspace.Manifest.WorkspaceID, g.options.Generation, token, s.execute))
	defer server.Close()
	status, err := callSupervisor(context.Background(), supervisorRecord{WorkspaceID: g.workspace.Manifest.WorkspaceID, Generation: g.options.Generation, Endpoint: server.URL + "/v1/supervisor"}, token, supervisorStatusCommand)
	require.NoError(t, err)
	require.Equal(t, "ownership_conflict", status.LastError.Code)
	raw, err := json.Marshal(status.LastError.Details["ownershipConflict"])
	require.NoError(t, err)
	var received devoutputs.Conflict
	require.NoError(t, json.Unmarshal(raw, &received))
	require.Equal(t, filepath.Join(host, "node_modules"), received.Target)
	require.Contains(t, received.ChangedPaths, changed)
	require.Equal(t, "linked", received.LifecyclePhase)
	require.Len(t, received.NextCommands, 3)
	require.NotContains(t, string(raw), "do-not-publish")
	require.NotContains(t, string(raw), string(token))
	t.Logf("authenticated production supervisor transport: code=%s producer=%s phase=%s changedPaths=%d nextCommands=%d", status.LastError.Code, received.Producer, received.LifecyclePhase, len(received.ChangedPaths), len(received.NextCommands))
	ordinary := supervisedBuildError(BuildEvent{Error: "compiler token=secret-output"}, g.workspace)
	require.Equal(t, "build_failed", ordinary.Code)
	require.Empty(t, ordinary.Details)
	require.False(t, strings.Contains(ordinary.Message, "secret-output"))
}

func TestOwnershipPlanEnumeratesCompositionWithoutChangingReceipts(t *testing.T) {
	t.Parallel()
	g := graphFixture(t)
	report, err := InspectOwnership(context.Background(), g.workspace)
	require.NoError(t, err)
	require.True(t, report.Ready)
	modules := 0
	for _, entry := range report.Entries {
		if entry.Producer == "modules" {
			modules++
		}
	}
	require.Equal(t, len(g.plan.Composition.Packages)+1, modules)
	require.NotEmpty(t, OwnershipMetadataPaths(g.workspace)["repositoryOutputs"])
}
