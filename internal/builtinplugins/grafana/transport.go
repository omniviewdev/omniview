package grafana

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxResponseBytes = 8 << 20

// HTTPError deliberately excludes response bodies and URLs, which may contain secrets.
type HTTPError struct{ Status int }

func (e *HTTPError) Error() string { return fmt.Sprintf("metrics server returned HTTP %d", e.Status) }
func (e *HTTPError) Denied() bool  { return e.Status == 401 || e.Status == 403 }

type transport struct {
	client                *http.Client
	endpoint              *url.URL
	mode, token, username string
	generation            context.Context
	cancelGeneration      context.CancelFunc
	borrowed              bool
}

func newTransport(endpoint, mode, token, username string) (*transport, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("endpoint must be an HTTP(S) URL without credentials, query or fragment")
	}
	if mode != "prometheus" && mode != "grafana" {
		return nil, errors.New("transport must be prometheus or grafana")
	}
	if strings.ContainsAny(token, "\r\n") || strings.ContainsAny(username, "\r\n") {
		return nil, errors.New("invalid credential")
	}
	base := http.DefaultTransport.(*http.Transport).Clone()
	return &transport{client: &http.Client{Transport: base, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("metrics redirects are disabled") }}, endpoint: u, mode: mode, token: token, username: username}, nil
}
func (t *transport) close() {
	if !t.borrowed {
		t.client.CloseIdleConnections()
	}
}
func (t *transport) lease() *transport { lease := *t; lease.borrowed = true; return &lease }
func (t *transport) get(ctx context.Context, path string, params url.Values, out any) error {
	if t.generation != nil {
		if err := t.generation.Err(); err != nil {
			return err
		}
		call, cancel := context.WithCancel(ctx)
		stop := context.AfterFunc(t.generation, cancel)
		defer stop()
		defer cancel()
		ctx = call
	}
	u := *t.endpoint
	u.Path = strings.TrimRight(u.Path, "/") + path
	u.RawPath = ""
	u.RawQuery = params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return errors.New("cannot create metrics request")
	}
	req.Header.Set("Accept", "application/json")
	if t.token != "" {
		if t.username != "" {
			req.SetBasicAuth(t.username, t.token)
		} else {
			req.Header.Set("Authorization", "Bearer "+t.token)
		}
	}
	resp, err := t.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("metrics request failed (check endpoint, TLS and connectivity)")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &HTTPError{Status: resp.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return errors.New("cannot read metrics response")
	}
	if len(data) > maxResponseBytes {
		return errors.New("metrics response exceeds 8 MiB limit")
	}
	if err = json.Unmarshal(data, out); err != nil {
		return errors.New("invalid metrics JSON response")
	}
	return nil
}
func (t *transport) apiPath(uid, suffix string) (string, error) {
	if t.mode == "prometheus" {
		return "/api/v1/" + suffix, nil
	}
	if uid == "" || len(uid) > 128 {
		return "", errors.New("Grafana datasource UID is required")
	}
	for _, r := range uid {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return "", errors.New("invalid datasource UID")
		}
	}
	return "/api/datasources/proxy/uid/" + uid + "/api/v1/" + suffix, nil
}

type promSample struct {
	Metric map[string]string   `json:"metric"`
	Value  []json.RawMessage   `json:"value"`
	Values [][]json.RawMessage `json:"values"`
}
type promResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string       `json:"resultType"`
		Result     []promSample `json:"result"`
	} `json:"data"`
	Warnings  []string `json:"warnings"`
	ErrorType string   `json:"errorType"`
}

func (t *transport) query(ctx context.Context, uid, expression string, start, end time.Time, step time.Duration, series bool) (*promResponse, error) {
	if len(expression) > 65536 {
		return nil, errors.New("compiled query exceeds 64 KiB")
	}
	suffix := "query"
	params := url.Values{"query": {expression}, "time": {fmt.Sprintf("%.3f", float64(end.UnixMilli())/1000)}}
	if series {
		if step <= 0 || !end.After(start) || end.Sub(start)/step >= 10000 {
			return nil, errors.New("range requires positive bounds and step, with fewer than 10000 intervals")
		}
		suffix = "query_range"
		params.Del("time")
		params.Set("start", fmt.Sprintf("%.3f", float64(start.UnixMilli())/1000))
		params.Set("end", fmt.Sprintf("%.3f", float64(end.UnixMilli())/1000))
		params.Set("step", fmt.Sprintf("%.3f", step.Seconds()))
	}
	path, err := t.apiPath(uid, suffix)
	if err != nil {
		return nil, err
	}
	var result promResponse
	if err = t.get(ctx, path, params, &result); err != nil {
		return nil, err
	}
	if result.Status != "success" {
		return nil, errors.New("Prometheus query rejected; check query syntax and datasource permissions")
	}
	if (!series && result.Data.ResultType != "vector") || (series && result.Data.ResultType != "matrix") {
		return nil, errors.New("query must return an identity-labelled vector or matrix")
	}
	if len(result.Data.Result) > 4096 {
		return nil, errors.New("query exceeds 4096 series limit")
	}
	if len(result.Warnings) > 16 {
		result.Warnings = result.Warnings[:16]
	}
	for i, w := range result.Warnings {
		if t.token != "" {
			w = strings.ReplaceAll(w, t.token, "[redacted]")
		}
		if len(w) > 512 {
			w = w[:512]
		}
		result.Warnings[i] = w
	}
	return &result, nil
}
