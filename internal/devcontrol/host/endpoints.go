//go:build devcontrol

package host

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"golang.org/x/net/html"
)

func developmentHTTPClient() *http.Client {
	return &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func developmentLoopbackURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port < 1 || port > 65535 {
		return ""
	}
	return parsed.String()
}

func developmentPortURL(port, path string) string {
	return developmentLoopbackURL("http://127.0.0.1:" + port + path)
}

func developmentBootMatches(document []byte, expected devcontract.BootIdentity) bool {
	tokenizer := html.NewTokenizer(bytes.NewReader(document))
	for {
		kind := tokenizer.Next()
		if kind == html.ErrorToken {
			return false
		}
		if kind != html.StartTagToken {
			continue
		}
		name, _ := tokenizer.TagName()
		if string(name) != "script" {
			continue
		}
		if tokenizer.Next() != html.TextToken {
			continue
		}
		text := strings.TrimSpace(string(tokenizer.Text()))
		const prefix = "window.__OMNIVIEW_INSTANCE__="
		if !strings.HasPrefix(text, prefix) {
			continue
		}
		var actual devcontract.BootIdentity
		if json.Unmarshal([]byte(strings.TrimSuffix(strings.TrimPrefix(text, prefix), ";")), &actual) != nil {
			return false
		}
		return actual == expected
	}
}

func developmentBrowserObserved(ctx context.Context, client *http.Client, endpoint string, expected devcontract.BootIdentity) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Accept", "text/html")
	response, err := client.Do(req)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	return err == nil && developmentBootMatches(body, expected)
}

func developmentMCPObserved(ctx context.Context, client *http.Client, endpoint, token string, expected devcontract.InstanceDescriptor) bool {
	if token == "" {
		return false
	}
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": "host-endpoint-proof", "method": "tools/call", "params": map[string]any{"name": "js_eval", "arguments": map[string]any{"window": "main", "timeout_ms": 1000, "js": "return {boot:window.__OMNIVIEW_INSTANCE__};"}}})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(req)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false
	}
	var envelope struct {
		ID     string          `json:"id"`
		Error  json.RawMessage `json:"error"`
		Result struct {
			IsError bool `json:"isError"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"result"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&envelope) != nil || envelope.ID != "host-endpoint-proof" || len(envelope.Error) != 0 || envelope.Result.IsError {
		return false
	}
	for _, item := range envelope.Result.Content {
		if item.Type != "text" {
			continue
		}
		var proof struct {
			Boot devcontract.BootIdentity `json:"boot"`
		}
		if json.Unmarshal([]byte(item.Text), &proof) != nil {
			continue
		}
		return proof.Boot == expected.BootIdentity()
	}
	return false
}

// Candidates are never advertised solely because an environment port was assigned.
// Browser HTML must carry this identity; authenticated native MCP must execute
// through its actual window and return the immutable boot UUID and generation.
// Do not import another runtime: that can replace the app's event dispatcher.
func (s *developmentControlLifecycle) observeEndpoints(ctx context.Context) {
	// Retry for the host lifetime; each request is independently bounded. A slow
	// native renderer must not permanently lose discovery before it becomes ready.
	client := developmentHTTPClient()
	defer client.CloseIdleConnections()
	browser := ""
	if os.Getenv("WAILS_SERVER_HOST") == "127.0.0.1" {
		browser = developmentPortURL(os.Getenv("WAILS_SERVER_PORT"), "/")
	}
	mcp := ""
	if os.Getenv("WAILS_MCP_HOST") == "127.0.0.1" {
		mcp = developmentPortURL(os.Getenv("WAILS_MCP_PORT"), "/mcp")
	}
	vite := ""
	if developmentAssetProxyEnabled {
		vite = developmentLoopbackURL(os.Getenv("FRONTEND_DEVSERVER_URL"))
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		descriptor := s.readSnapshot()
		changed := false
		if browser != "" && descriptor.Endpoints.Browser == nil && developmentBrowserObserved(ctx, client, browser, descriptor.BootIdentity()) {
			descriptor.Endpoints.Browser = &browser
			changed = true
		}
		if mcp != "" && descriptor.Endpoints.MCP == nil && developmentMCPObserved(ctx, client, mcp, os.Getenv("WAILS_MCP_TOKEN"), descriptor) {
			descriptor.Endpoints.MCP = &mcp
			changed = true
		}
		// Only a non-production asset handler can use the configured proxy. Its
		// document and Vite's actual module endpoint must both be observed.
		if vite != "" && (descriptor.Readiness == "host-ready" || descriptor.Endpoints.Browser != nil) && descriptor.Endpoints.Vite == nil {
			if hmr, err := devsession.ProbeViteHMR(ctx, vite); err == nil {
				descriptor.Endpoints.Vite = &vite
				descriptor.Endpoints.HMR = &hmr
				changed = true
			}
		}
		if changed {
			s.mu.Lock()
			current := s.readSnapshot()
			if descriptor.Endpoints.Browser != nil {
				current.Endpoints.Browser = descriptor.Endpoints.Browser
			}
			if descriptor.Endpoints.MCP != nil {
				current.Endpoints.MCP = descriptor.Endpoints.MCP
			}
			if descriptor.Endpoints.Vite != nil {
				current.Endpoints.Vite = descriptor.Endpoints.Vite
			}
			if descriptor.Endpoints.HMR != nil {
				current.Endpoints.HMR = descriptor.Endpoints.HMR
			}
			if s.server != nil && s.server.Refresh(ctx, current) == nil {
				s.publishSnapshot(current)
			}
			s.mu.Unlock()
		}
		descriptor = s.readSnapshot()
		complete := (browser == "" || descriptor.Endpoints.Browser != nil) && (mcp == "" || descriptor.Endpoints.MCP != nil) && (vite == "" || descriptor.Endpoints.Vite != nil)
		if complete {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
