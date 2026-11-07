package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/diagnostics"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/spf13/cobra"
)

func diagnosticsCommandError(err error) *devcontract.Error {
	var typed *devcontract.Error
	if errors.As(err, &typed) {
		return typed
	}
	message := err.Error()
	exit, code := 5, "diagnostics_failed"
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		exit, code = 7, "timeout"
	case message == "diagnostics target unreachable", message == "diagnostics unavailable: missing or invalid private discovery", message == "capture not found", message == "diagnostics operation unsupported or capture not found":
		exit, code = 3, "diagnostics_unavailable"
	case message == "diagnostics authentication rejected", message == "cannot read private diagnostics credential":
		exit, code = 6, "unauthorized"
	case message == "diagnostics target generation is stale", message == "diagnostics target is stale or cannot be verified", message == "diagnostics target does not match selected profile", message == "authenticated diagnostics identity differs from discovery", message == "capture conflicts with existing state", message == "capture count, size, or concurrency limit reached", message == "capture is incomplete or not ready":
		exit, code = 4, "conflicting_target"
	case message == "invalid capture name, duration, workload, or identifier":
		exit, code = 2, "invalid_request"
	}
	return devcontract.Fail(exit, code, message)
}

func addDiagnosticsCommands(root *cobra.Command) {
	var workspace, collection, channel, stateRoot string
	group := &cobra.Command{Use: "diagnostics", Short: "Read application performance diagnostics and persistent captures"}
	group.PersistentFlags().StringVar(&workspace, "workspace", "", "Workspace name or manifest")
	group.PersistentFlags().StringVar(&collection, "root", "", "Repository collection root")
	group.PersistentFlags().StringVar(&channel, "channel", "local", "Selected instance channel: local, stable, nightly")
	group.PersistentFlags().StringVar(&stateRoot, "state-root", "", "Explicit selected instance state root")
	group.PersistentFlags().Bool("json", false, "Emit structured JSON")
	connect := func(ctx context.Context) (*diagnostics.Client, error) {
		var profile instance.Profile
		var err error
		options := diagnostics.HTTPOptions{}
		if channel == "local" {
			selected, e := resolveControlWorkspace(ctx, collection, workspace)
			if e != nil {
				return nil, e
			}
			if stateRoot != "" && stateRoot != selected.StateRoot {
				return nil, devcontract.Fail(4, "conflicting_target", "state root differs from selected workspace")
			}
			profile, err = instance.Resolve(instance.Options{Workspace: selected.ManifestPath, StateRoot: selected.StateRoot})
			options.WorkspaceID = selected.Manifest.WorkspaceID
			if err != nil {
				return nil, err
			}
			options.Source, err = selected.RepositoryPath("omniview")
		} else {
			if workspace != "" || collection != "" {
				return nil, devcontract.Fail(2, "invalid_target", "workspace selection requires local channel")
			}
			home, e := os.UserHomeDir()
			if e != nil {
				return nil, e
			}
			profile, err = instance.Resolve(instance.Options{CWD: home, Home: home, Channel: channel, StateRoot: stateRoot})
		}
		if err != nil {
			return nil, err
		}
		options.RuntimeDirectory = profile.RuntimeRoot
		options.StateRoot = profile.Descriptor.StateRoot
		return diagnostics.DiscoverClient(ctx, options)
	}
	execute := func(cmd *cobra.Command, run func(context.Context, *diagnostics.Client) (any, error)) error {
		signalCtx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		ctx, cancel := context.WithTimeout(signalCtx, 6*time.Minute)
		defer cancel()
		client, err := connect(ctx)
		var result any
		if err == nil {
			defer client.Close()
			result, err = run(ctx, client)
		}
		if err != nil {
			failure := diagnosticsCommandError(err)
			envelope := map[string]any{"error": failure}
			if result != nil {
				envelope["result"] = result
			}
			if json.NewEncoder(cmd.OutOrStdout()).Encode(envelope) != nil {
				return commandExit(5)
			}
			return commandExit(devcontract.ExitCode(failure))
		}
		if json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]any{"schemaVersion": 1, "result": result}) != nil {
			return commandExit(5)
		}
		return nil
	}
	for name, path := range map[string]string{"describe": "/diagnostics/v1/catalog", "snapshot": "/diagnostics/v1/snapshot"} {
		name, path := name, path
		group.AddCommand(&cobra.Command{Use: name, Short: "Read diagnostics " + name, Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
			return execute(cmd, func(ctx context.Context, c *diagnostics.Client) (any, error) {
				var result json.RawMessage
				err := c.Get(ctx, path, &result)
				return result, err
			})
		}})
	}
	var duration time.Duration
	var name, workload string
	capture := &cobra.Command{Use: "capture", Short: "Record a bounded persistent capture and wait for completion", Args: cobra.NoArgs}
	capture.Flags().DurationVar(&duration, "duration", 60*time.Second, "Capture duration (whole seconds, at most 5m)")
	capture.Flags().StringVar(&name, "name", "", "Capture name")
	capture.Flags().StringVar(&workload, "workload", "", "Safe workload description for comparison")
	_ = capture.MarkFlagRequired("name")
	capture.RunE = func(cmd *cobra.Command, _ []string) error {
		if duration < time.Second || duration > 5*time.Minute || duration%time.Second != 0 {
			return devcontract.Fail(2, "invalid_duration", "duration must be whole seconds between 1s and 5m")
		}
		return execute(cmd, func(ctx context.Context, c *diagnostics.Client) (any, error) {
			var result diagnostics.Capture
			if err := c.Request(ctx, http.MethodPost, "/diagnostics/v1/captures", diagnostics.CaptureRequest{Name: name, DurationSeconds: int(duration / time.Second), Workload: workload}, &result); err != nil {
				return nil, err
			}
			return waitDiagnosticsCapture(ctx, c, result, duration)
		})
	}
	group.AddCommand(capture)
	group.AddCommand(&cobra.Command{Use: "compare BASELINE CANDIDATE", Short: "Compare persisted capture IDs, including captures from earlier builds", Args: cobra.ExactArgs(2), RunE: func(cmd *cobra.Command, args []string) error {
		return execute(cmd, func(ctx context.Context, c *diagnostics.Client) (any, error) {
			var result diagnostics.Comparison
			err := c.Get(ctx, "/diagnostics/v1/compare?baseline="+url.QueryEscape(args[0])+"&candidate="+url.QueryEscape(args[1]), &result)
			return result, err
		})
	}})
	root.AddCommand(group)
}

type captureCancellation struct {
	Attempted bool   `json:"attempted"`
	Confirmed bool   `json:"confirmed"`
	ErrorCode string `json:"errorCode,omitempty"`
}
type captureWaitFailure struct {
	CaptureID    string               `json:"captureID"`
	Status       string               `json:"status"`
	Cancellation *captureCancellation `json:"cancellation,omitempty"`
}

func captureTerminalError(status string) error {
	switch status {
	case "complete":
		return nil
	case "error":
		return devcontract.Fail(5, "capture_failed", "capture failed; inspect persisted capture coverage and profile storage")
	case "incomplete", "interrupted", "reset":
		return devcontract.Fail(4, "capture_incomplete", "capture did not complete with valid coverage")
	case "canceled":
		return devcontract.Fail(7, "capture_canceled", "capture was canceled")
	default:
		return devcontract.Fail(5, "invalid_response", "target returned an unknown capture state")
	}
}

// waitDiagnosticsCapture preserves the primary wait/poll failure independently
// from best-effort cancellation, which uses a fresh bounded cleanup context.
func waitDiagnosticsCapture(ctx context.Context, client *diagnostics.Client, capture diagnostics.Capture, duration time.Duration) (any, error) {
	waitCtx, cancel := context.WithTimeout(ctx, duration+30*time.Second)
	defer cancel()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	abort := func(cause error) (any, error) {
		outcome := &captureCancellation{Attempted: true}
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		var canceled diagnostics.Capture
		err := client.Request(cleanup, http.MethodDelete, "/diagnostics/v1/captures/"+url.PathEscape(capture.ID), nil, &canceled)
		if err != nil {
			outcome.ErrorCode = diagnosticsCommandError(err).Code
		} else {
			outcome.Confirmed = canceled.Status != "running"
			if !outcome.Confirmed {
				outcome.ErrorCode = "cancellation_unconfirmed"
			}
		}
		return captureWaitFailure{CaptureID: capture.ID, Status: capture.Status, Cancellation: outcome}, cause
	}
	for capture.Status == "running" {
		select {
		case <-waitCtx.Done():
			return abort(waitCtx.Err())
		case <-ticker.C:
			var next diagnostics.Capture
			if err := client.Get(waitCtx, "/diagnostics/v1/captures/"+url.PathEscape(capture.ID), &next); err != nil {
				return abort(err)
			}
			capture = next
		}
	}
	if err := captureTerminalError(capture.Status); err != nil {
		return captureWaitFailure{CaptureID: capture.ID, Status: capture.Status}, err
	}
	return capture, nil
}
