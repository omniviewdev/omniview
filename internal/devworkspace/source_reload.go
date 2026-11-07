package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// SourceReloadEvidence records explicit source-marker delivery, not merely HMR connectivity.
type SourceReloadEvidence struct {
	WorkspaceID    string                    `json:"workspaceID"`
	Generation     string                    `json:"generation"`
	ModulePath     string                    `json:"modulePath"`
	SourceMarker   string                    `json:"sourceMarker"`
	VerifiedAt     time.Time                 `json:"verifiedAt"`
	Verification   string                    `json:"verification"`
	ResponseDigest string                    `json:"responseDigest"`
	Checkouts      map[string]CheckoutStatus `json:"checkouts"`
}

// VerifySourceReload accepts a caller's unique marker from a deliberate source edit.
// It authenticates the host and supervisor, then reads the transformed source from
// their exact owned Vite endpoint. It does not claim browser execution evidence.
func (m *Manager) VerifySourceReload(ctx context.Context, name, modulePath, marker string) (SourceReloadEvidence, error) {
	var evidence SourceReloadEvidence
	parsed, err := url.Parse(modulePath)
	if err != nil || !strings.HasPrefix(modulePath, "/") || strings.HasPrefix(modulePath, "//") || parsed.IsAbs() || parsed.Host != "" || parsed.Fragment != "" || marker == "" || len(marker) > 512 {
		return evidence, devcontract.Fail(2, "invalid_source_probe", "supply a relative Vite module path and a unique source-edit marker (1–512 bytes)")
	}
	status, err := m.Status(ctx, name)
	if err != nil {
		return evidence, err
	}
	client, descriptor, err := ConnectWorkspaceControl(ctx, status.Workspace, m.options.Home, status.Generation)
	if err != nil {
		return evidence, err
	}
	client.Close()
	if err = sourceReloadHostReady(descriptor, status.Instance); err != nil {
		return evidence, err
	}
	service, ok := status.Services["vite"]
	if !ok || !service.Ready || service.HMR == "" {
		return evidence, devcontract.Fail(3, "vite_not_ready", "source reload verification requires the selected live frontend")
	}
	if descriptor.Endpoints.Vite == nil || strings.TrimSuffix(*descriptor.Endpoints.Vite, "/") != strings.TrimSuffix(service.URL, "/") {
		return evidence, devcontract.Fail(4, "stale_target", "authenticated host frontend differs from the supervisor-owned frontend")
	}
	endpoint, err := url.Parse(service.URL)
	if err != nil || endpoint.Scheme != "http" || endpoint.Hostname() != "127.0.0.1" {
		return evidence, devcontract.Fail(4, "stale_target", "selected frontend endpoint is not owned loopback HTTP")
	}
	endpoint.Path = parsed.Path
	endpoint.RawQuery = parsed.RawQuery
	query := endpoint.Query()
	query.Set("omniview_source_probe", fmt.Sprint(time.Now().UnixNano()))
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return evidence, err
	}
	httpClient := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
		return fmt.Errorf("source probe redirects are not allowed")
	}}
	response, err := httpClient.Do(request)
	if err != nil {
		return evidence, err
	}
	defer response.Body.Close()
	bytes, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	if err != nil {
		return evidence, err
	}
	if len(bytes) > 8<<20 || response.StatusCode != http.StatusOK || !strings.Contains(string(bytes), marker) {
		return evidence, devcontract.Fail(3, "source_reload_unverified", "owned Vite did not serve the source-edit marker; inspect build health and retry after fixing the failed stage")
	}
	current, err := m.Status(ctx, name)
	if err != nil {
		return evidence, err
	}
	if current.Generation != status.Generation || current.Services["vite"].Process != service.Process ||
		sourceReloadHostReady(descriptor, current.Instance) != nil {
		return evidence, devcontract.Fail(4, "stale_target", "workspace frontend changed during source verification; retry against the current generation")
	}
	digest := sha256.Sum256(bytes)
	return SourceReloadEvidence{WorkspaceID: status.Manifest.WorkspaceID, Generation: status.Generation, ModulePath: modulePath, SourceMarker: marker, VerifiedAt: time.Now().UTC(), Verification: "source-marker-served (browser execution and checkout provenance not asserted)", ResponseDigest: hex.EncodeToString(digest[:]), Checkouts: checkoutStatuses(ctx, status.Workspace)}, nil
}

func sourceReloadHostReady(connected devcontract.InstanceDescriptor, reported *devcontract.InstanceDescriptor) error {
	if reported == nil || connected.Process != reported.Process {
		return devcontract.Fail(4, "stale_target", "connected host differs from the supervisor-reported host")
	}
	return frontendDescriptorReady(connected, *reported)
}

// frontendDescriptorReady checks authenticated frontend capability, not native
// application startup. Callers still verify the exact owned frontend endpoint.
func frontendDescriptorReady(actual, target devcontract.InstanceDescriptor) error {
	if actual.Readiness != "backend-ready" {
		return hostDescriptorReady(actual, target)
	}
	if actual.WorkspaceID != target.WorkspaceID || actual.InstanceID != target.InstanceID || actual.Generation != target.Generation || actual.StateRoot != target.StateRoot {
		return devcontract.Fail(4, "stale_target", "host identity differs from the selected workspace generation")
	}
	if actual.Endpoints.Browser == nil || actual.Endpoints.Vite == nil {
		return devcontract.Fail(3, "frontend_not_ready", "selected host has not published browser and Vite capabilities")
	}
	return nil
}
