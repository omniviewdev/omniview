package devworkspace

import (
	"context"
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
	WorkspaceID  string                    `json:"workspaceID"`
	Generation   string                    `json:"generation"`
	ModulePath   string                    `json:"modulePath"`
	SourceMarker string                    `json:"sourceMarker"`
	VerifiedAt   time.Time                 `json:"verifiedAt"`
	Verification string                    `json:"verification"`
	Checkouts    map[string]CheckoutStatus `json:"checkouts"`
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
	bytes, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return evidence, err
	}
	if response.StatusCode != http.StatusOK || !strings.Contains(string(bytes), marker) {
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
	return SourceReloadEvidence{WorkspaceID: status.Manifest.WorkspaceID, Generation: status.Generation, ModulePath: modulePath, SourceMarker: marker, VerifiedAt: time.Now().UTC(), Verification: "source-marker-served (browser execution not asserted)", Checkouts: checkoutStatuses(ctx, status.Workspace)}, nil
}

func sourceReloadHostReady(connected devcontract.InstanceDescriptor, reported *devcontract.InstanceDescriptor) error {
	if reported == nil || connected.Process != reported.Process {
		return devcontract.Fail(4, "stale_target", "connected host differs from the supervisor-reported host")
	}
	return hostDescriptorReady(connected, *reported)
}
