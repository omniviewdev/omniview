package devsession

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

type ProcessBridgeConfig struct {
	Endpoint      string
	TokenFile     string
	WorkspaceFile string
	WorkspaceID   string
	Generation    string
	Host          devcontract.ProcessIdentity
}

type ProcessStart struct {
	PluginID         string `json:"pluginID"`
	PluginGeneration string `json:"pluginGeneration"`
	Kind             string `json:"kind"`
	Source           string `json:"source"`
	Port             int    `json:"port,omitempty"`
	PNPMPath         string `json:"pnpmPath,omitempty"`
	NodePath         string `json:"nodePath,omitempty"`
}
type ProcessRequest struct {
	RequestID   string                      `json:"requestID"`
	WorkspaceID string                      `json:"workspaceID"`
	Generation  string                      `json:"generation"`
	Host        devcontract.ProcessIdentity `json:"host"`
	Operation   string                      `json:"operation"`
	Start       *ProcessStart               `json:"start,omitempty"`
	ProcessID   string                      `json:"processID,omitempty"`
	TimeoutMS   int                         `json:"timeoutMS,omitempty"`
	Cursor      int64                       `json:"cursor,omitempty"`
	Limit       int                         `json:"limit,omitempty"`
}
type ProcessStatus struct {
	ProcessID string                      `json:"processID"`
	Identity  devcontract.ProcessIdentity `json:"identity"`
	Running   bool                        `json:"running"`
	ExitCode  int                         `json:"exitCode"`
}
type ProcessLogPage struct {
	Data       string             `json:"data"`
	NextCursor int64              `json:"nextCursor"`
	EOF        bool               `json:"eof"`
	Overflow   bool               `json:"overflow"`
	Error      *devcontract.Error `json:"error,omitempty"`
}
type ProcessResponse struct {
	RequestID   string             `json:"requestID"`
	WorkspaceID string             `json:"workspaceID"`
	Generation  string             `json:"generation"`
	Process     *ProcessStatus     `json:"process,omitempty"`
	Logs        *ProcessLogPage    `json:"logs,omitempty"`
	Error       *devcontract.Error `json:"error,omitempty"`
}
type ProcessBridgeClient struct {
	config ProcessBridgeConfig
	token  []byte
	http   *http.Client
}
type RemoteProcess struct {
	client *ProcessBridgeClient
	status ProcessStatus
}
type ProcessExitError struct{ Code int }

func (e *ProcessExitError) Error() string {
	return fmt.Sprintf("owned managed process exited with status %d", e.Code)
}
func (e *ProcessExitError) ExitCode() int { return e.Code }

func NewProcessBridgeClient(config ProcessBridgeConfig) (*ProcessBridgeClient, error) {
	endpoint, err := url.Parse(config.Endpoint)
	if err != nil || endpoint.Scheme != "http" || endpoint.Hostname() != "127.0.0.1" || endpoint.Port() == "" || endpoint.Path != "/v1/process" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, devcontract.Fail(2, "invalid_process_bridge", "process bridge requires its explicit loopback endpoint")
	}
	if !filepath.IsAbs(config.WorkspaceFile) {
		return nil, devcontract.Fail(2, "invalid_process_bridge", "process bridge requires the explicit absolute workspace manifest")
	}
	generation, generationErr := uuid.Parse(config.Generation)
	if generationErr != nil || generation == uuid.Nil || generation.String() != config.Generation {
		return nil, devcontract.Fail(2, "invalid_process_bridge", "process bridge requires the canonical workspace generation")
	}
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: config.WorkspaceFile})
	if err != nil {
		return nil, err
	}
	if workspace.Manifest.WorkspaceID != config.WorkspaceID || config.Generation == "" || config.Host.PID != os.Getpid() || config.Host.WorkspaceID != config.WorkspaceID || config.Host.Generation != config.Generation || config.Host.Role != "host" {
		return nil, devcontract.Fail(4, "stale_target", "process bridge host context differs")
	}
	hostSource, err := workspace.RepositoryPath("omniview")
	if err != nil {
		return nil, err
	}
	if config.Host.Source != hostSource {
		return nil, devcontract.Fail(4, "stale_target", "process bridge requires selected captured host source")
	}
	if err = VerifyOwnedProcess(config.Host, ProcessOwner{WorkspaceID: config.WorkspaceID, Generation: config.Generation, Role: "host", Source: hostSource}); err != nil {
		return nil, err
	}
	expected := filepath.Join(workspace.Root, ".local", "supervisor-"+config.Generation+".secret")
	if config.TokenFile != expected {
		return nil, devcontract.Fail(4, "invalid_process_bridge", "process bridge token reference is outside its workspace generation")
	}
	canonicalToken, err := devcontract.CanonicalPath(expected)
	if err != nil {
		return nil, err
	}
	if canonicalToken != expected {
		return nil, devcontract.Fail(4, "invalid_process_bridge", "process bridge token parent is redirected")
	}
	if err = ValidatePrivateFile(expected); err != nil {
		return nil, err
	}
	token, err := os.ReadFile(expected)
	if err != nil {
		return nil, err
	}
	if len(token) < 32 {
		return nil, devcontract.Fail(4, "invalid_process_bridge", "process bridge token is invalid")
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext, ResponseHeaderTimeout: 35 * time.Second}
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &ProcessBridgeClient{config: config, token: token, http: client}, nil
}
func (c *ProcessBridgeClient) Close() { c.http.CloseIdleConnections() }
func (c *ProcessBridgeClient) call(ctx context.Context, request ProcessRequest) (ProcessResponse, error) {
	var response ProcessResponse
	request.RequestID = uuid.NewString()
	request.WorkspaceID = c.config.WorkspaceID
	request.Generation = c.config.Generation
	request.Host = c.config.Host
	data, err := json.Marshal(request)
	if err != nil {
		return response, err
	}
	call, err := http.NewRequestWithContext(ctx, http.MethodPost, c.config.Endpoint, bytes.NewReader(data))
	if err != nil {
		return response, devcontract.Fail(2, "invalid_process_bridge", "process bridge request is invalid")
	}
	call.Header.Set("Authorization", "Bearer "+string(c.token))
	call.Header.Set("Content-Type", "application/json")
	result, err := c.http.Do(call)
	if err != nil {
		if ctx.Err() != nil {
			return response, devcontract.Fail(7, "timeout", "process bridge wait was interrupted; accepted owned work remains tracked")
		}
		return response, devcontract.Fail(3, "process_bridge_unreachable", "owned process supervisor is unreachable")
	}
	defer result.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(result.Body, (2<<20)+8192))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&response) != nil || decoder.Decode(new(any)) != io.EOF {
		return response, devcontract.Fail(5, "invalid_response", "process supervisor returned an invalid response")
	}
	if (response.RequestID != request.RequestID && !(response.Error != nil && response.RequestID == "")) || response.WorkspaceID != c.config.WorkspaceID || response.Generation != c.config.Generation {
		return response, devcontract.Fail(4, "stale_target", "process supervisor response differs from the exact request")
	}
	if response.Error != nil {
		response.Error.Exit = 5
		switch response.Error.Code {
		case "unauthorized":
			response.Error.Exit = 6
		case "timeout":
			response.Error.Exit = 7
		case "stale_target", "process_conflict", "invalid_process_source", "invalid_process_port", "process_output_overflow":
			response.Error.Exit = 4
		case "invalid_request", "invalid_process_override":
			response.Error.Exit = 2
		}
		return response, response.Error
	}
	if result.StatusCode != http.StatusOK {
		return response, devcontract.Fail(5, "process_bridge_failed", "process supervisor request failed")
	}
	return response, nil
}
func (c *ProcessBridgeClient) Start(ctx context.Context, start ProcessStart) (*RemoteProcess, error) {
	response, err := c.call(ctx, ProcessRequest{Operation: "start", Start: &start})
	if typed, ok := err.(*devcontract.Error); ok && (typed.Code == "timeout" || typed.Code == "process_bridge_unreachable") {
		reconcile, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		response, err = c.call(reconcile, ProcessRequest{Operation: "start", Start: &start})
		cancel()
	}
	if err != nil {
		return nil, err
	}
	if response.Process == nil || response.Process.ProcessID == "" {
		return nil, devcontract.Fail(5, "invalid_response", "process start returned no owned handle")
	}
	identity := response.Process.Identity
	role := "plugin-vite"
	if start.Kind == "install" {
		role = "plugin-install"
	}
	if identity.WorkspaceID != c.config.WorkspaceID || identity.Generation != c.config.Generation || identity.Source != start.Source || identity.Role != role {
		return nil, devcontract.Fail(4, "stale_target", "process start returned a different owner")
	}
	return &RemoteProcess{client: c, status: *response.Process}, nil
}
func (p *RemoteProcess) Identity() devcontract.ProcessIdentity { return p.status.Identity }
func (p *RemoteProcess) ID() string                            { return p.status.ProcessID }
func (p *RemoteProcess) Status(ctx context.Context) (ProcessStatus, error) {
	response, err := p.client.call(ctx, ProcessRequest{Operation: "status", ProcessID: p.ID()})
	if err != nil {
		return ProcessStatus{}, err
	}
	if response.Process == nil || response.Process.ProcessID != p.ID() || response.Process.Identity != p.status.Identity {
		return ProcessStatus{}, devcontract.Fail(4, "stale_target", "owned process identity changed")
	}
	return *response.Process, nil
}
func (p *RemoteProcess) Wait(ctx context.Context) error {
	for {
		response, err := p.client.call(ctx, ProcessRequest{Operation: "wait", ProcessID: p.ID(), TimeoutMS: 20000})
		if err != nil {
			return err
		}
		if response.Process == nil || response.Process.ProcessID != p.ID() || response.Process.Identity != p.status.Identity {
			return devcontract.Fail(4, "stale_target", "owned process wait identity changed")
		}
		if !response.Process.Running {
			if response.Process.ExitCode != 0 {
				return &ProcessExitError{Code: response.Process.ExitCode}
			}
			return nil
		}
	}
}
func (p *RemoteProcess) Stop(ctx context.Context) error {
	response, err := p.client.call(ctx, ProcessRequest{Operation: "stop", ProcessID: p.ID()})
	if err != nil {
		return err
	}
	if response.Process == nil || response.Process.ProcessID != p.ID() || response.Process.Identity != p.status.Identity || response.Process.Running {
		return devcontract.Fail(5, "process_stop_failed", "owned process has not actually exited")
	}
	return nil
}
func (p *RemoteProcess) Logs(ctx context.Context, cursor int64, limit int) (ProcessLogPage, error) {
	response, err := p.client.call(ctx, ProcessRequest{Operation: "logs", ProcessID: p.ID(), Cursor: cursor, Limit: limit})
	if err != nil {
		return ProcessLogPage{}, err
	}
	if response.Logs == nil {
		return ProcessLogPage{}, devcontract.Fail(5, "invalid_response", "process log observation is missing")
	}
	if response.Logs.Error != nil {
		response.Logs.Error.Exit = 4
		return *response.Logs, response.Logs.Error
	}
	return *response.Logs, nil
}
