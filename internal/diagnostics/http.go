package diagnostics

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type HTTPServer struct {
	service   *Service
	identity  EndpointIdentity
	token     []byte
	directory string
	server    *http.Server
	once      sync.Once
	closeErr  error
	done      chan struct{}
}

// StartHTTP starts diagnostics in desktop and development builds alike.
func StartHTTP(ctx context.Context, service *Service, options HTTPOptions) (*HTTPServer, error) {
	if service == nil {
		return nil, errors.New("diagnostics service is required")
	}
	directory, err := discoveryDirectory(options.RuntimeDirectory)
	if err != nil {
		return nil, err
	}
	if !filepath.IsAbs(options.StateRoot) {
		return nil, errors.New("diagnostics state root must be absolute")
	}
	if options.WorkspaceID == "" {
		options.WorkspaceID = uuid.NewSHA1(uuid.NameSpaceURL, []byte(options.StateRoot)).String()
	}
	if options.Source == "" {
		options.Source, err = os.Executable()
		if err != nil {
			return nil, err
		}
	}
	generation := uuid.NewString()
	process, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: options.WorkspaceID, Generation: generation, Role: "diagnostics", Source: options.Source})
	if err != nil {
		return nil, err
	}
	lock, err := devsession.AcquirePrivateLock(ctx, directory, "discovery.lock")
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	previous, err := readEndpoint(directory)
	if err == nil {
		proofErr := devsession.VerifyOwnedProcess(previous.Process, endpointOwner(previous.EndpointIdentity))
		var mismatch *devsession.ProcessIdentityMismatch
		stale := errors.Is(proofErr, devsession.ErrProcessGone) || (errors.As(proofErr, &mismatch) && mismatch.ObservedStart != previous.Process.StartIdentity)
		if !stale {
			return nil, errors.New("diagnostics profile already belongs to a live or unverified instance")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("invalid existing diagnostics discovery")
	}
	token, err := devsession.GenerateToken()
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	identity := EndpointIdentity{SchemaVersion: 1, WorkspaceID: options.WorkspaceID, InstanceID: service.GetCatalog().Identity.InstanceID, Generation: generation, StateRoot: options.StateRoot, Endpoint: "http://" + listener.Addr().String(), Process: process, Capabilities: []string{"catalog", "snapshot", "history", "captures", "compare", "prometheus"}}
	s := &HTTPServer{service: service, identity: identity, token: token, directory: directory, done: make(chan struct{})}
	s.server = &http.Server{Handler: s, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 8192}
	tokenFile := filepath.Join(directory, "token-"+generation+".secret")
	if err = devsession.WritePrivateFile(tokenFile, token); err == nil {
		err = devsession.WritePrivateJSON(filepath.Join(directory, "discovery.json"), endpointDiscovery{identity, tokenFile})
	}
	if err != nil {
		listener.Close()
		// Atomic publication may have renamed successfully before directory sync failed.
		// Remove this generation's advertisement before removing its credential.
		var advertised endpointDiscovery
		readErr := devsession.ReadPrivateJSON(filepath.Join(directory, "discovery.json"), &advertised)
		if readErr == nil && advertised.Generation == generation {
			if removeErr := os.Remove(filepath.Join(directory, "discovery.json")); removeErr == nil {
				_ = os.Remove(tokenFile)
			}
		} else if errors.Is(readErr, os.ErrNotExist) || readErr == nil {
			_ = os.Remove(tokenFile)
		}
		return nil, err
	}
	go s.server.Serve(listener)
	go func() {
		select {
		case <-ctx.Done():
			s.Close()
		case <-s.done:
		}
	}()
	return s, nil
}

func (s *HTTPServer) Close() error {
	s.once.Do(func() {
		close(s.done)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		s.closeErr = s.server.Shutdown(ctx)
		// Cleanup has its own deadline so a slow request cannot leave a stopped endpoint advertised.
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		lock, err := devsession.AcquirePrivateLock(cleanupCtx, s.directory, "discovery.lock")
		if err != nil {
			s.closeErr = errors.Join(s.closeErr, err)
			return
		}
		defer lock.Close()
		d, err := readEndpoint(s.directory)
		if err == nil && d.Generation == s.identity.Generation {
			s.closeErr = errors.Join(s.closeErr, os.Remove(filepath.Join(s.directory, "discovery.json")), os.Remove(d.TokenFile))
		}
	})
	return s.closeErr
}

func (s *HTTPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	reject := func(status int, message string) {
		code := "invalid_request"
		switch status {
		case http.StatusUnauthorized:
			code = "unauthorized"
		case http.StatusForbidden:
			code = "forbidden"
		case http.StatusConflict:
			code = "stale_target"
		case http.StatusNotFound:
			code = "unknown_path"
		case http.StatusMethodNotAllowed:
			code = "method_not_allowed"
		case http.StatusUnsupportedMediaType:
			code = "unsupported_media_type"
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
	}
	for key := range r.Header {
		if strings.EqualFold(key, "Origin") || strings.EqualFold(key, "Forwarded") || strings.HasPrefix(strings.ToLower(key), "x-forwarded-") || strings.EqualFold(key, "Via") {
			reject(403, "direct non-browser requests only")
			return
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || host != "127.0.0.1" || r.Host != strings.TrimPrefix(s.identity.Endpoint, "http://") || r.URL.IsAbs() || r.Header.Get("Origin") != "" || r.Header.Get("Forwarded") != "" || r.Header.Get("X-Forwarded-For") != "" || r.Header.Get("X-Forwarded-Host") != "" || r.Header.Get("X-Forwarded-Proto") != "" {
		reject(403, "loopback requests only")
		return
	}
	if len(r.Header.Values("Authorization")) != 1 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+string(s.token))) != 1 {
		reject(401, "authentication required")
		return
	}
	if r.URL.Path != "/metrics" && (len(r.Header.Values("X-Diagnostics-Generation")) != 1 || r.Header.Get("X-Diagnostics-Generation") != s.identity.Generation) {
		reject(409, "stale diagnostics generation")
		return
	}
	var result any
	var callErr error
	path := r.URL.Path
	if r.Method == http.MethodGet {
		switch path {
		case "/diagnostics/v1/identity":
			result = s.identity
		case "/diagnostics/v1/catalog":
			result = s.service.GetCatalog()
		case "/diagnostics/v1/snapshot":
			result = s.service.GetSnapshot()
		case "/diagnostics/v1/history":
			result = s.service.GetHistory()
		case "/diagnostics/v1/captures":
			result = s.service.ListCaptures()
		case "/diagnostics/v1/compare":
			result, callErr = s.service.CompareCaptures(r.URL.Query().Get("baseline"), r.URL.Query().Get("candidate"))
		case "/metrics":
			if !s.service.Fresh() {
				reject(503, "diagnostics collection is stale")
				return
			}
			w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
			io.WriteString(w, s.service.Prometheus())
			return
		default:
			if id, ok := capturePath(path); ok {
				result, callErr = s.service.GetCapture(id)
			} else {
				reject(404, "unknown diagnostics path")
				return
			}
		}
	} else if r.Method == http.MethodPost && path == "/diagnostics/v1/captures" {
		if r.Header.Get("Content-Type") != "application/json" {
			reject(415, "JSON content required")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var request CaptureRequest
		if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF {
			reject(400, "invalid capture request")
			return
		}
		result, callErr = s.service.StartCapture(request)
	} else if r.Method == http.MethodDelete && r.URL.Query().Get("remove") == "1" {
		if id, ok := capturePath(path); ok {
			callErr = s.service.DeleteCapture(id)
			result = map[string]bool{"removed": callErr == nil}
		} else {
			reject(404, "unknown diagnostics path")
			return
		}
	} else if r.Method == http.MethodDelete {
		if id, ok := capturePath(path); ok {
			result, callErr = s.service.CancelCapture(id)
		} else {
			reject(404, "unknown diagnostics path")
			return
		}
	} else {
		reject(405, "method not allowed")
		return
	}
	if callErr != nil {
		code := ErrorCode(callErr)
		status, message := http.StatusInternalServerError, "diagnostics operation failed"
		switch code {
		case "invalid_request":
			status, message = http.StatusBadRequest, "invalid capture name, duration, workload, or identifier"
		case "not_found":
			status, message = http.StatusNotFound, "capture not found"
		case "capacity":
			status, message = http.StatusConflict, "capture count, size, or concurrency limit reached"
		case "conflict":
			status, message = http.StatusConflict, "capture conflicts with existing state"
		case "incomplete":
			status, message = http.StatusConflict, "capture is incomplete or not ready"
		case "closed":
			status, message = http.StatusServiceUnavailable, "diagnostics is shutting down"
		case "storage":
			status, message = http.StatusInternalServerError, "capture storage failed; check profile permissions and disk space"
		default:
			code = "operation_failed"
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func capturePath(path string) (string, bool) {
	id, ok := strings.CutPrefix(path, "/diagnostics/v1/captures/")
	if !ok || id == "" || len(id) > 128 {
		return "", false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return "", false
		}
	}
	return id, true
}
