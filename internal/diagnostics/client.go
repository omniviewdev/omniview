package diagnostics

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// 300 retained samples at the 256 KiB sample bound fit within this limit.
const maxResponseBytes = 96 << 20

type Client struct {
	identity EndpointIdentity
	token    []byte
	http     *http.Client
}

func NewClient(identity EndpointIdentity, token []byte) (*Client, error) {
	u, err := url.Parse(identity.Endpoint)
	if err != nil {
		return nil, errors.New("invalid diagnostics endpoint")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Host != "127.0.0.1:"+strconv.Itoa(port) || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || identity.Generation == "" || len(token) < 32 {
		return nil, errors.New("invalid diagnostics endpoint or capability")
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext, ResponseHeaderTimeout: 10 * time.Second, IdleConnTimeout: 15 * time.Second, MaxIdleConnsPerHost: 2}
	return &Client{identity: identity, token: bytes.Clone(token), http: &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) Close() { c.http.CloseIdleConnections() }
func (c *Client) Get(ctx context.Context, path string, result any) error {
	return c.Request(ctx, http.MethodGet, path, nil, result)
}
func (c *Client) Request(ctx context.Context, method, path string, input, result any) error {
	u, err := url.Parse(path)
	if err != nil || u.IsAbs() || u.Host != "" || len(path) == 0 || path[0] != '/' || u.Fragment != "" {
		return errors.New("invalid diagnostics request path")
	}
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return errors.New("invalid diagnostics request")
		}
		if len(raw) > 4096 {
			return errors.New("diagnostics request too large")
		}
		body = bytes.NewReader(raw)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.identity.Endpoint+path, body)
	if err != nil {
		return errors.New("invalid diagnostics request")
	}
	request.Header.Set("Authorization", "Bearer "+string(c.token))
	request.Header.Set("X-Diagnostics-Generation", c.identity.Generation)
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("diagnostics target unreachable")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return errors.New("diagnostics response exceeds limits or cannot be read")
	}
	if response.StatusCode != http.StatusOK {
		var failure struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if len(data) <= 4096 && json.Unmarshal(data, &failure) == nil {
			switch failure.Error.Code {
			case "invalid_request":
				return errors.New("invalid capture name, duration, workload, or identifier")
			case "not_found":
				return errors.New("capture not found")
			case "capacity":
				return errors.New("capture count, size, or concurrency limit reached")
			case "conflict":
				return errors.New("capture conflicts with existing state")
			case "incomplete":
				return errors.New("capture is incomplete or not ready")
			case "closed":
				return errors.New("diagnostics is shutting down")
			case "storage":
				return errors.New("capture storage failed; check profile permissions and disk space")
			}
		}
		switch response.StatusCode {
		case http.StatusUnauthorized:
			return errors.New("diagnostics authentication rejected")
		case http.StatusConflict:
			return errors.New("diagnostics target generation is stale")
		case http.StatusNotFound:
			return errors.New("diagnostics operation unsupported or capture not found")
		}
		return errors.New("diagnostics request rejected (HTTP " + strconv.Itoa(response.StatusCode) + ")")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	if decoder.Decode(result) != nil || decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid diagnostics JSON response")
	}
	return nil
}
