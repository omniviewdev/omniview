package telemetry

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"time"

	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	"golang.org/x/net/netutil"
	"google.golang.org/protobuf/proto"
)

const (
	pluginTraceLimit          = 4 << 20
	pluginTraceSecretBytes    = 32
	pluginTraceMaxConnections = 16
	pluginTraceMaxHeaderBytes = 8192
	pluginTraceResponseLimit  = 64 << 10
	pluginTraceTimeout        = 10 * time.Second
	pluginTraceHeaderTimeout  = 5 * time.Second
	pluginTraceRequestTimeout = 15 * time.Second
)

// StartPluginTraceReceiver creates a capability-protected receiver owned by one
// plugin process. The capability is unrelated to the collector credentials.
func (s *Service) StartPluginTraceReceiver(pluginID string) (string, string, func(), error) {
	s.mu.RLock()
	generation := s.pluginTraceGeneration
	armed := s.cfg.Enabled && s.cfg.Traces && s.cfg.OTLPEndpoint != ""
	s.mu.RUnlock()
	var secret [pluginTraceSecretBytes]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return "", "", nil, err
	}
	token := hex.EncodeToString(secret[:])
	listener, err := new(net.ListenConfig).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		return "", "", nil, err
	}
	listener = netutil.LimitListener(listener, pluginTraceMaxConnections)
	client := &http.Client{
		Timeout:       pluginTraceTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	server := &http.Server{
		ReadHeaderTimeout: pluginTraceHeaderTimeout,
		ReadTimeout:       pluginTraceRequestTimeout,
		WriteTimeout:      pluginTraceRequestTimeout,
		MaxHeaderBytes:    pluginTraceMaxHeaderBytes,
	}
	server.Handler = s.pluginTraceHandler(pluginID, token, generation, armed, client)
	go func() { _ = server.Serve(listener) }()
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), pluginTraceTimeout)
		defer cancel()
		if shutdownErr := server.Shutdown(ctx); shutdownErr != nil {
			_ = server.Close()
		}
		client.CloseIdleConnections()
	}
	return "http://" + listener.Addr().String() + "/v1/traces", token, cleanup, nil
}

func (s *Service) pluginTraceHandler(
	pluginID, token string, generation uint64, armed bool, client *http.Client,
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/traces" ||
			subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(token)) != 1 {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.Header.Get("Content-Type") != "application/x-protobuf" || r.Header.Get("Content-Encoding") != "" {
			http.Error(w, "unsupported content", http.StatusUnsupportedMediaType)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, pluginTraceLimit))
		if err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		var data collectortrace.ExportTraceServiceRequest
		if proto.Unmarshal(body, &data) != nil || !validPluginTraceIdentity(&data, pluginID) {
			http.Error(w, "invalid traces", http.StatusBadRequest)
			return
		}
		s.mu.RLock()
		defer s.mu.RUnlock()
		cfg := s.cfg
		if !armed || generation != s.pluginTraceGeneration || !cfg.Enabled || !cfg.Traces || cfg.OTLPEndpoint == "" {
			w.Header().Set("Content-Type", "application/x-protobuf")
			w.WriteHeader(http.StatusOK)
			return
		}
		forwardPluginTraces(w, r, client, cfg, body)
	})
}

func forwardPluginTraces(w http.ResponseWriter, r *http.Request, client *http.Client, cfg Config, body []byte) {
	ctx, cancel := context.WithTimeout(r.Context(), pluginTraceTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, otlpSignalURL(cfg.OTLPEndpoint, "traces"), bytes.NewReader(body),
	)
	if err != nil {
		http.Error(w, "export failed", http.StatusBadGateway)
		return
	}
	req.Header.Set("Content-Type", "application/x-protobuf")
	if cfg.AuthHeader != "" && cfg.AuthValue != "" {
		req.Header.Set(cfg.AuthHeader, cfg.AuthValue)
	}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "export failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		http.Error(w, "export failed", http.StatusBadGateway)
		return
	}
	response, err := io.ReadAll(io.LimitReader(resp.Body, pluginTraceResponseLimit))
	if err != nil {
		http.Error(w, "export failed", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/x-protobuf")
	_, _ = w.Write(response)
}

func validPluginTraceIdentity(data *collectortrace.ExportTraceServiceRequest, pluginID string) bool {
	if pluginID == "" || len(data.GetResourceSpans()) == 0 {
		return false
	}
	for _, rs := range data.GetResourceSpans() {
		if rs == nil || rs.GetResource() == nil ||
			!validPluginTraceAttributes(rs.GetResource().GetAttributes(), pluginID) {
			return false
		}
	}
	return true
}

func validPluginTraceAttributes(attributes []*commonpb.KeyValue, pluginID string) bool {
	name, id := 0, 0
	for _, a := range attributes {
		if a == nil || a.GetValue() == nil {
			return false
		}
		switch a.GetKey() {
		case "service.name":
			if a.GetValue().GetStringValue() != "omniview.plugin."+pluginID {
				return false
			}
			name++
		case "omniview.plugin.id":
			if a.GetValue().GetStringValue() != pluginID {
				return false
			}
			id++
		}
	}
	return name == 1 && id == 1
}
