package devcontrol

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

type Client struct {
	endpoint                string
	token                   []byte
	workspaceID, generation string
	http                    *http.Client
}

func NewClient(endpoint string, token []byte, workspaceID, generation string) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, devcontract.Fail(2, "invalid_endpoint", "control endpoint is invalid")
	}
	port, portErr := strconv.Atoi(u.Port())
	if u.Scheme != "http" || u.Hostname() != "127.0.0.1" || portErr != nil || port < 1 || port > 65535 || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "/v1/control" && u.Path != "") || workspaceID == "" || generation == "" || len(token) < 32 {
		return nil, devcontract.Fail(2, "invalid_endpoint", "explicit loopback control endpoint and target are required")
	}
	u.Path = "/v1/control"
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, ResponseHeaderTimeout: 35 * time.Second, IdleConnTimeout: 30 * time.Second, MaxIdleConnsPerHost: 2}
	return &Client{endpoint: u.String(), token: bytes.Clone(token), workspaceID: workspaceID, generation: generation, http: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) Close() { c.http.CloseIdleConnections() }
func (c *Client) Call(ctx context.Context, operation string, params any) (devcontract.Response, error) {
	var response devcontract.Response
	raw, err := json.Marshal(params)
	if err != nil {
		return response, devcontract.Fail(2, "invalid_params", "parameters cannot be encoded")
	}
	request := devcontract.Request{ProtocolVersion: devcontract.ProtocolVersion, RequestID: uuid.NewString(), WorkspaceID: c.workspaceID, Generation: c.generation, Operation: operation, Params: raw}
	if err := request.ValidateTarget(c.workspaceID, c.generation); err != nil {
		return response, err
	}
	data, err := json.Marshal(request)
	if err != nil {
		return response, err
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(data))
	if err != nil {
		return response, devcontract.Fail(2, "invalid_endpoint", "control endpoint is invalid")
	}
	r.Header.Set("Authorization", "Bearer "+string(c.token))
	r.Header.Set("Content-Type", "application/json")
	result, err := c.http.Do(r)
	if err != nil {
		if ctx.Err() != nil {
			return response, devcontract.Fail(7, "timeout", "control wait was interrupted; an accepted mutation is not cancelled")
		}
		return response, devcontract.Fail(3, "control_unreachable", "target control endpoint is not reachable")
	}
	defer result.Body.Close()
	d := json.NewDecoder(io.LimitReader(result.Body, (2<<20)+8192))
	if err := d.Decode(&response); err != nil {
		if ctx.Err() != nil {
			return response, devcontract.Fail(7, "timeout", "control wait was interrupted; an accepted mutation is not cancelled")
		}
		return response, devcontract.Fail(5, "invalid_response", "target returned an invalid control response")
	}
	if d.Decode(new(any)) != io.EOF {
		return response, devcontract.Fail(5, "invalid_response", "target returned multiple response values")
	}
	if response.ProtocolVersion != devcontract.ProtocolVersion || response.WorkspaceID != c.workspaceID || response.Generation != c.generation {
		return response, devcontract.Fail(4, "stale_target", "control response target does not match")
	}
	if response.Error != nil {
		response.Error.Exit = errorExit(response.Error.Code)
		if response.RequestID != "" && response.RequestID != request.RequestID {
			return response, devcontract.Fail(5, "invalid_response", "control response request does not match")
		}
		return response, response.Error
	}
	if response.RequestID != request.RequestID || result.StatusCode != http.StatusOK {
		return response, devcontract.Fail(5, "invalid_response", "control response request does not match")
	}
	switch response.Status {
	case "accepted", "running", "succeeded", "failed", "cancelled":
	default:
		return response, devcontract.Fail(5, "invalid_response", "control response status is invalid")
	}
	if response.Status == "failed" || response.Status == "cancelled" {
		return response, devcontract.Fail(5, "operation_failed", "operation did not succeed")
	}
	return response, nil
}
func (c *Client) Wait(ctx context.Context, operationID string, timeout time.Duration) (devcontract.Response, error) {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	deadline := time.Now().Add(timeout)
	waitCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	last := devcontract.Response{ProtocolVersion: devcontract.ProtocolVersion, WorkspaceID: c.workspaceID, Generation: c.generation, OperationID: operationID, Status: "running"}
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			last.Error = devcontract.Fail(7, "timeout", "operation wait deadline expired")
			return last, last.Error
		}
		ms := int((remaining + time.Millisecond - 1) / time.Millisecond)
		if ms > 30000 {
			ms = 30000
		}
		response, err := c.Call(waitCtx, "operation.wait", OperationParams{OperationID: operationID, TimeoutMS: ms})
		if response.OperationID != "" {
			last = response
		}
		if err != nil {
			if response.Error != nil && response.Error.Code == "timeout" && (response.Status == "accepted" || response.Status == "running") && time.Now().Before(deadline) {
				continue
			}
			if response.OperationID == "" {
				if e, ok := err.(*devcontract.Error); ok {
					last.Error = e
				}
				return last, err
			}
			return response, err
		}
		switch response.Status {
		case "succeeded", "failed", "cancelled":
			return response, err
		case "accepted", "running":
		default:
			return response, fmt.Errorf("invalid operation status")
		}
	}
}
func errorExit(code string) int {
	switch code {
	case "unauthorized":
		return 6
	case "timeout":
		return 7
	case "invalid_request", "invalid_params", "validation_failed", "unknown_operation", "invalid_configuration", "invalid_endpoint":
		return 2
	case "not_found", "setting_not_found", "operation_not_found", "control_unreachable":
		return 3
	case "stale_target", "conflict", "operation_capacity", "shutting_down":
		return 4
	default:
		return 5
	}
}
