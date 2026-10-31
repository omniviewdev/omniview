//go:build devcontrol

package devcontrol

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

const maxRequestBytes = 1 << 20
const maxResultBytes = 2 << 20
const maxOperations = 1024
const settingsValidationExit = 2

type operation struct {
	response devcontract.Response
	done     chan struct{}
}
type Server struct {
	mu          sync.Mutex
	descriptor  devcontract.InstanceDescriptor
	workspaceID string
	generation  string
	adapters    Adapters
	discovery   *devsession.DiscoveryStore
	token       []byte
	host        string
	http        *http.Server
	ctx         context.Context
	cancel      context.CancelFunc
	operations  map[string]*operation
	closed      bool
	closeDone   chan struct{}
	closeErr    error
}

func newServer(ctx context.Context, c Config, token []byte) *Server {
	ctx, cancel := context.WithCancel(ctx)
	return &Server{descriptor: c.Descriptor, workspaceID: c.Descriptor.WorkspaceID, generation: c.Descriptor.Generation, adapters: c.Adapters, discovery: c.Discovery, token: token, ctx: ctx, cancel: cancel, operations: make(map[string]*operation), closeDone: make(chan struct{})}
}
func Start(ctx context.Context, c Config) (*Server, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c.Descriptor.Kind != "development" || c.Descriptor.WorkspaceID == "" || c.Descriptor.Generation == "" || c.Discovery == nil || c.Adapters.Inspect == nil || c.Adapters.Plugins == nil || c.Adapters.Dev == nil || c.Adapters.Settings == nil {
		return nil, devcontract.Fail(2, "invalid_configuration", "complete development control adapters and identity are required")
	}
	token, err := devsession.GenerateToken()
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s := newServer(ctx, c, token)
	s.host = listener.Addr().String()
	s.http = &http.Server{Handler: http.HandlerFunc(s.serveHTTP), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 40 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	if err := s.Refresh(ctx, c.Descriptor); err != nil {
		listener.Close()
		s.cancel()
		return nil, err
	}
	go func() {
		if err := s.http.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
			defer done()
			_ = s.Close(shutdown)
		}
	}()
	go func() {
		<-s.ctx.Done()
		shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = s.Close(shutdown)
	}()
	return s, nil
}
func (s *Server) Endpoint() string { return "http://" + s.host + "/v1/control" }

// Refresh preserves the captured generation/process identity and token while
// publishing actual endpoint/readiness observations supplied by the host.
func (s *Server) Refresh(ctx context.Context, d devcontract.InstanceDescriptor) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || d.WorkspaceID != s.descriptor.WorkspaceID || d.Generation != s.descriptor.Generation || d.InstanceID != s.descriptor.InstanceID || d.Process != s.descriptor.Process {
		return devsession.ErrOwnership
	}
	endpoint := s.Endpoint()
	d.Endpoints.Control = &endpoint
	if _, err := s.discovery.Publish(ctx, d, s.token); err != nil {
		return err
	}
	s.descriptor = d
	return nil
}
func (s *Server) Close(ctx context.Context) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		select {
		case <-s.closeDone:
			s.mu.Lock()
			err := s.closeErr
			s.mu.Unlock()
			return err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	s.closed = true
	pending := make([]<-chan struct{}, 0, len(s.operations))
	for _, op := range s.operations {
		pending = append(pending, op.done)
	}
	s.mu.Unlock()
	s.cancel()
	var err error
	if s.http != nil {
		err = s.http.Shutdown(ctx)
		if err != nil {
			_ = s.http.Close()
		}
	}
wait:
	for _, done := range pending {
		select {
		case <-done:
		case <-ctx.Done():
			err = errors.Join(err, ctx.Err())
			break wait
		}
	}
	if s.discovery != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err = errors.Join(err, s.discovery.Remove(cleanup, s.workspaceID, s.generation))
		cancel()
	}
	s.mu.Lock()
	s.closeErr = err
	close(s.closeDone)
	s.mu.Unlock()
	return err
}
func (s *Server) base(request devcontract.Request) devcontract.Response {
	return devcontract.Response{ProtocolVersion: devcontract.ProtocolVersion, RequestID: request.RequestID, WorkspaceID: s.workspaceID, Generation: s.generation, Status: "succeeded"}
}
func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	response := s.base(devcontract.Request{})
	fail := func(status int, e *devcontract.Error) {
		response.Status = "failed"
		response.Error = e
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(response)
	}
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || peer != "127.0.0.1" || r.Host != s.host || len(r.Header.Values("Origin")) != 0 {
		fail(http.StatusForbidden, devcontract.Fail(6, "unauthorized", "control request is not authorized"))
		return
	}
	authorization := r.Header.Get("Authorization")
	expected := "Bearer " + string(s.token)
	if len(r.Header.Values("Authorization")) != 1 || subtle.ConstantTimeCompare([]byte(authorization), []byte(expected)) != 1 {
		fail(http.StatusUnauthorized, devcontract.Fail(6, "unauthorized", "control request is not authorized"))
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/v1/control" || r.URL.RawQuery != "" {
		fail(http.StatusBadRequest, devcontract.Fail(2, "invalid_request", "POST /v1/control is required"))
		return
	}
	var request devcontract.Request
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		fail(http.StatusBadRequest, devcontract.Fail(2, "invalid_request", "request must be a bounded v1 JSON envelope"))
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(http.StatusBadRequest, devcontract.Fail(2, "invalid_request", "one request envelope is required"))
		return
	}
	if len(request.RequestID) > 128 {
		fail(http.StatusBadRequest, devcontract.Fail(2, "invalid_request", "request ID is too long"))
		return
	}
	// Do not echo attacker-controlled identities or params on authentication errors.
	response = s.base(request)
	if err := request.ValidateTarget(s.workspaceID, s.generation); err != nil {
		fail(http.StatusBadRequest, safeError(err))
		return
	}
	response = s.dispatch(r.Context(), request)
	_ = json.NewEncoder(w).Encode(response)
}
func strictParams(data json.RawMessage, target any) error {
	if len(data) == 0 {
		data = []byte("{}")
	}
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return invalidParams()
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(target) != nil {
		return invalidParams()
	}
	if d.Decode(new(any)) != io.EOF {
		return invalidParams()
	}
	return nil
}
func invalidParams() *devcontract.Error {
	return devcontract.Fail(2, "invalid_params", "parameters do not match the operation schema")
}
func safeError(err error) *devcontract.Error {
	var commit *settingsservice.CommitError
	if errors.As(err, &commit) && commit.Validation {
		return devcontract.Fail(settingsValidationExit, "validation_failed", "setting value did not pass validation")
	}
	var e *devcontract.Error
	if errors.As(err, &e) {
		switch e.Code {
		case "invalid_request", "invalid_params", "unknown_operation", "stale_target", "setting_not_found", "operation_not_found", "operation_capacity", "shutting_down", "timeout", "conflict", "not_found", "validation_failed", "dependency_failed", "committed_cleanup_pending", "commit_uncertain":
			result := devcontract.Fail(e.Exit, e.Code, safeMessage(e.Code))
			if e.Code == "committed_cleanup_pending" {
				result.Details = map[string]any{"category": e.Code, "committed": true, "recoveryRequired": true}
			}
			if e.Code == "commit_uncertain" {
				result.Details = map[string]any{"category": e.Code, "commitUncertain": true, "recoveryRequired": true}
			}
			return result
		}
	}
	var app *apperror.AppError
	if errors.As(err, &app) {
		code, exit := "dependency_failed", 5
		switch app.Type {
		case apperror.TypePluginNotFound, apperror.TypePluginNotLoaded:
			code, exit = "not_found", 3
		case apperror.TypePluginAlreadyLoaded, apperror.TypeResourceConflict:
			code, exit = "conflict", 4
		case apperror.TypeValidation, apperror.TypeSettingsInvalidConfig:
			code, exit = "validation_failed", 2
		case apperror.TypeResourceTimeout:
			code, exit = "timeout", 7
		case apperror.TypePluginCommittedCleanupPending:
			code = "committed_cleanup_pending"
		case apperror.TypePluginCommitUncertain:
			code = "commit_uncertain"
		}
		result := devcontract.Fail(exit, code, safeMessage(code))
		result.Details = map[string]any{"category": code}
		if code == "committed_cleanup_pending" {
			result.Details["committed"] = true
			result.Details["recoveryRequired"] = true
		}
		if code == "commit_uncertain" {
			result.Details["commitUncertain"] = true
			result.Details["recoveryRequired"] = true
		}
		switch app.Type {
		case apperror.TypePluginNotFound, apperror.TypePluginNotLoaded, apperror.TypePluginAlreadyLoaded, apperror.TypePluginInstallFailed, apperror.TypePluginLoadFailed, apperror.TypePluginBuildFailed, apperror.TypeResourceConflict, apperror.TypeValidation, apperror.TypeSettingsInvalidConfig, apperror.TypeResourceTimeout, apperror.TypePluginCommittedCleanupPending, apperror.TypePluginCommitUncertain:
			result.Details["type"] = app.Type
		}
		if app.Status >= 100 && app.Status <= 599 {
			result.Details["status"] = app.Status
		}
		return result
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return devcontract.Fail(7, "timeout", "operation did not complete before the wait deadline")
	}
	if errors.Is(err, context.Canceled) {
		return devcontract.Fail(5, "cancelled", "operation was cancelled by host shutdown")
	}
	return devcontract.Fail(5, "operation_failed", "operation failed; inspect the local host diagnostics")
}
func safeMessage(code string) string {
	switch code {
	case "stale_target":
		return "workspace or generation does not match"
	case "timeout":
		return "operation did not complete before the wait deadline"
	case "operation_not_found":
		return "operation is not retained by this generation"
	case "invalid_params":
		return "parameters do not match the operation schema"
	case "setting_not_found":
		return "setting is not registered"
	case "unknown_operation":
		return "operation is not allowed"
	case "operation_capacity":
		return "too many active operations"
	case "shutting_down":
		return "host is shutting down"
	case "validation_failed":
		return "provider rejected the requested value"
	case "not_found":
		return "requested plugin was not found"
	case "conflict":
		return "operation conflicts with current state"
	case "dependency_failed":
		return "plugin build or readiness failed"
	case "committed_cleanup_pending":
		return "plugin installation committed; owned backup cleanup requires recovery"
	case "commit_uncertain":
		return "plugin installation commit could not be confirmed; recovery is required"
	default:
		return "request was rejected"
	}
}
func (s *Server) result(request devcontract.Request, value any, err error) devcontract.Response {
	response := s.base(request)
	if err != nil {
		response.Status = "failed"
		response.Error = safeError(err)
		return response
	}
	if value != nil {
		data, err := json.Marshal(value)
		if err != nil || len(data) > maxResultBytes {
			response.Status = "failed"
			response.Error = devcontract.Fail(5, "result_too_large", "result could not be safely encoded")
			return response
		}
		response.Result = data
	}
	return response
}
func (s *Server) accept(request devcontract.Request, run func(context.Context) (any, error)) devcontract.Response {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return s.result(request, nil, devcontract.Fail(4, "shutting_down", ""))
	}
	if len(s.operations) >= maxOperations {
		for id, op := range s.operations {
			select {
			case <-op.done:
				delete(s.operations, id)
			default:
			}
			if len(s.operations) < maxOperations {
				break
			}
		}
	}
	if len(s.operations) >= maxOperations {
		s.mu.Unlock()
		return s.result(request, nil, devcontract.Fail(4, "operation_capacity", ""))
	}
	id := uuid.NewString()
	response := s.base(request)
	response.OperationID = id
	response.Status = "accepted"
	op := &operation{response: response, done: make(chan struct{})}
	s.operations[id] = op
	s.mu.Unlock()
	go func() {
		s.mu.Lock()
		op.response.Status = "running"
		s.mu.Unlock()
		var value any
		err := s.ctx.Err()
		if err == nil {
			value, err = run(s.ctx)
		}
		finished := s.result(request, value, err)
		finished.OperationID = id
		if errors.Is(err, context.Canceled) {
			finished.Status = "cancelled"
		}
		s.mu.Lock()
		op.response = finished
		close(op.done)
		s.mu.Unlock()
	}()
	return response
}
func (s *Server) getOperation(ctx context.Context, request devcontract.Request, p OperationParams, wait bool) devcontract.Response {
	s.mu.Lock()
	op := s.operations[p.OperationID]
	s.mu.Unlock()
	if op == nil {
		return s.result(request, nil, devcontract.Fail(3, "operation_not_found", ""))
	}
	if wait {
		timeout := p.TimeoutMS
		if timeout == 0 {
			timeout = 30000
		}
		timer := time.NewTimer(time.Duration(timeout) * time.Millisecond)
		defer timer.Stop()
		select {
		case <-op.done:
		case <-timer.C:
			s.mu.Lock()
			response := op.response
			s.mu.Unlock()
			response.RequestID = request.RequestID
			response.Error = safeError(context.DeadlineExceeded)
			return response
		case <-ctx.Done():
			s.mu.Lock()
			response := op.response
			s.mu.Unlock()
			response.RequestID = request.RequestID
			response.Error = safeError(ctx.Err())
			return response
		}
	}
	s.mu.Lock()
	response := op.response
	s.mu.Unlock()
	response.RequestID = request.RequestID
	return response
}
