package diagnostics

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// HTTPOptions selects one profile. Diagnostics never writes control discovery.
type HTTPOptions struct{ RuntimeDirectory, WorkspaceID, StateRoot, Source string }

// EndpointIdentity is public identity proof; it contains no credential references.
type EndpointIdentity struct {
	SchemaVersion int                         `json:"schemaVersion"`
	WorkspaceID   string                      `json:"workspaceId"`
	InstanceID    string                      `json:"instanceId"`
	Generation    string                      `json:"generation"`
	StateRoot     string                      `json:"stateRoot"`
	Endpoint      string                      `json:"endpoint"`
	Process       devcontract.ProcessIdentity `json:"process"`
	Capabilities  []string                    `json:"capabilities"`
}

type endpointDiscovery struct {
	EndpointIdentity
	TokenFile string `json:"tokenFile"`
}

func discoveryDirectory(runtime string) (string, error) {
	if !filepath.IsAbs(runtime) {
		return "", errors.New("diagnostics runtime directory must be absolute")
	}
	return devsession.EnsurePrivateDirectory(filepath.Join(runtime, "diagnostics"))
}

func endpointOwner(d EndpointIdentity) devsession.ProcessOwner {
	return devsession.ProcessOwner{WorkspaceID: d.WorkspaceID, Generation: d.Generation, Role: "diagnostics", Source: d.Process.Source}
}

func readEndpoint(directory string) (endpointDiscovery, error) {
	var d endpointDiscovery
	if err := devsession.ReadPrivateJSON(filepath.Join(directory, "discovery.json"), &d); err != nil {
		return d, err
	}
	if d.SchemaVersion != 1 || d.TokenFile != filepath.Join(directory, "token-"+d.Generation+".secret") {
		return d, errors.New("invalid diagnostics discovery")
	}
	if id, err := uuid.Parse(d.Generation); err != nil || id.String() != d.Generation {
		return d, errors.New("invalid diagnostics generation")
	}
	if err := devsession.ValidatePrivateFile(d.TokenFile); err != nil {
		return d, errors.New("diagnostics token file missing or unsafe")
	}
	return d, nil
}

// DiscoverClient verifies private files, process lifetime, profile and authenticated identity.
func DiscoverClient(ctx context.Context, options HTTPOptions) (*Client, error) {
	directory, err := discoveryDirectory(options.RuntimeDirectory)
	if err != nil {
		return nil, err
	}
	lock, err := devsession.AcquirePrivateLock(ctx, directory, "discovery.lock")
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	d, err := readEndpoint(directory)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, devcontract.Fail(3, "diagnostics_unavailable", "no running diagnostics instance discovered")
		}
		return nil, devcontract.Fail(4, "invalid_discovery", "private diagnostics discovery is invalid or unsafe")
	}
	if d.StateRoot != options.StateRoot || (options.WorkspaceID != "" && d.WorkspaceID != options.WorkspaceID) || (options.Source != "" && d.Process.Source != options.Source) {
		return nil, devcontract.Fail(4, "conflicting_target", "diagnostics target does not match selected profile")
	}
	if err := devsession.VerifyOwnedProcess(d.Process, endpointOwner(d.EndpointIdentity)); err != nil {
		return nil, devcontract.Fail(4, "stale_target", "diagnostics target is stale or cannot be verified")
	}
	token, err := os.ReadFile(d.TokenFile)
	if err != nil {
		return nil, devcontract.Fail(6, "unauthorized", "cannot read private diagnostics credential")
	}
	client, err := NewClient(d.EndpointIdentity, token)
	if err != nil {
		return nil, err
	}
	var actual EndpointIdentity
	if err = client.Get(ctx, "/diagnostics/v1/identity", &actual); err != nil {
		client.Close()
		return nil, err
	}
	// Bind authenticated identity to the selected private discovery and process proof.
	if actual.SchemaVersion != d.SchemaVersion || actual.WorkspaceID != d.WorkspaceID || actual.InstanceID != d.InstanceID || actual.Generation != d.Generation || actual.StateRoot != d.StateRoot || actual.Endpoint != d.Endpoint || actual.Process != d.Process {
		client.Close()
		return nil, devcontract.Fail(4, "stale_target", "authenticated diagnostics identity differs from discovery")
	}
	return client, nil
}
