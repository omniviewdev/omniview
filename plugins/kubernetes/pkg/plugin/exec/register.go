package exec

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/omniview/kubernetes/pkg/utils"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/omniviewdev/plugin-sdk/pkg/exec"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

func Register(plugin *sdk.Plugin) {
	// Register the capabilities
	if err := exec.RegisterPlugin(plugin, exec.PluginOpts{
		Handlers: []exec.Handler{
			{
				Plugin:         "kubernetes",
				Resource:       "core::v1::Pod",
				TTYHandler:     PodHandler,
				DefaultCommand: []string{"/bin/bash", "-c", "stty -echo && /bin/bash"},
				TargetBuilder: sdkresource.ActionTargetBuilder{
					Paths: []string{"$.spec.containers[*]"},
					Selectors: map[string]string{
						"container": "$.name",
					},
					LabelSelector: "container",
				},
			},
			{
				Plugin:         "kubernetes",
				Resource:       "core::v1::Node",
				TTYHandler:     NodeHandler,
				DefaultCommand: []string{"/bin/bash"},
			},
		},
	}); err != nil {
		panic(err)
	}
}

func PodHandler(
	ctx *types.PluginContext,
	opts exec.SessionOptions,
	tty *os.File,
	stopCh chan error,
	resize <-chan exec.SessionResizeInput,
) error {
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return err
	}

	// get the namespace and pod off the data obj
	metadata, ok := opts.ResourceData["metadata"].(map[string]interface{})
	if !ok {
		return errors.New("metadata is required")
	}
	pod, ok := metadata["name"].(string)
	if !ok {
		return errors.New("pod is required")
	}
	namespace, ok := metadata["namespace"].(string)
	if !ok {
		return errors.New("namespace is required")
	}
	container, ok := opts.Params["container"]
	if !ok {
		container = ""
	}

	return ExecCmd(
		ctx.Context,
		clients.Clientset,
		clients.RestConfig,
		namespace,
		pod,
		container,
		opts.Command,
		tty,
		stopCh,
		resize,
	)
}

type sizeQueue chan remotecommand.TerminalSize

func (s *sizeQueue) Next() *remotecommand.TerminalSize {
	size, ok := <-*s
	if !ok {
		return nil
	}
	return &size
}

// ExecCmd exec command on specific pod and wait the command's output.
func ExecCmd(
	ctx context.Context,
	client kubernetes.Interface,
	config *restclient.Config,
	namespace string,
	pod string,
	container string,
	command []string,
	tty *os.File,
	stopChan chan error,
	resize <-chan exec.SessionResizeInput,
) error {
	req := client.
		CoreV1().
		RESTClient().
		Post().
		Resource("pods").
		Name(pod).
		Namespace(namespace).
		SubResource("exec")

	option := &v1.PodExecOptions{
		Command:   command,
		Container: container,
		Stdin:     true,
		Stdout:    true,
		Stderr:    true,
		TTY:       true,
	}

	req.VersionedParams(
		option,
		scheme.ParameterCodec,
	)

	spdy, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		return err
	}
	ws, err := remotecommand.NewWebSocketExecutor(config, "GET", req.URL().String())
	if err != nil {
		return err
	}
	executor, err := remotecommand.NewFallbackExecutor(ws, spdy, httpstream.IsUpgradeFailure)
	if err != nil {
		return err
	}

	go func(tty *os.File, stopCh chan error) {
		err = executor.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdin:  tty,
			Stdout: tty,
			Stderr: tty,
			Tty:    true,
		})
		if err != nil {
			stopCh <- classifyExecError(err, command)
		} else {
			stopCh <- nil
		}
	}(tty, stopChan)

	return nil
}

// classifyExecError inspects a Kubernetes exec error and returns a structured
// ExecError with user-facing title, suggestion, and retry information.
func classifyExecError(err error, command []string) error {
	msg := err.Error()
	lower := strings.ToLower(msg)

	type classification struct {
		pattern       string
		title         string
		suggestion    string
		retryable     bool
		retryCommands []string
	}

	classifications := []classification{
		{
			pattern:       "no such file or directory",
			title:         "Shell not found",
			suggestion:    fmt.Sprintf("The shell %q was not found in this container. It may be a distroless or minimal image.", strings.Join(command, " ")),
			retryable:     true,
			retryCommands: []string{"sh", "/bin/sh", "ash"},
		},
		{
			pattern:       "executable file not found",
			title:         "Shell not found",
			suggestion:    fmt.Sprintf("The executable %q is not available in this container's PATH.", strings.Join(command, " ")),
			retryable:     true,
			retryCommands: []string{"sh", "/bin/sh", "ash"},
		},
		{
			pattern:       "oci runtime exec failed",
			title:         "Container runtime error",
			suggestion:    "The container runtime could not execute the command. The container may be a distroless image.",
			retryable:     true,
			retryCommands: []string{"sh", "/bin/sh"},
		},
		{
			pattern:    "permission denied",
			title:      "Permission denied",
			suggestion: "You may not have permission to exec into this container. Check your RBAC rules.",
			retryable:  false,
		},
		{
			pattern:    "container not running",
			title:      "Container not running",
			suggestion: "The target container is not in a running state. It may have crashed or completed its task.",
			retryable:  false,
		},
		{
			pattern:    "cannot exec in a stopped",
			title:      "Container stopped",
			suggestion: "The container has stopped. It may have crashed or completed its task.",
			retryable:  false,
		},
		{
			pattern:    "container name must be specified",
			title:      "Container not specified",
			suggestion: "This pod has multiple containers and the container name was not provided in the exec request.",
			retryable:  false,
		},
	}

	for _, c := range classifications {
		if strings.Contains(lower, c.pattern) {
			return &exec.ExecError{
				Err:           err,
				Title:         c.title,
				Message:       msg,
				Suggestion:    c.suggestion,
				Retryable:     c.retryable,
				RetryCommands: c.retryCommands,
			}
		}
	}

	// Default: generic retryable error
	return &exec.ExecError{
		Err:           err,
		Title:         "Exec failed",
		Message:       msg,
		Suggestion:    "The exec session failed unexpectedly.",
		Retryable:     true,
		RetryCommands: []string{"sh", "/bin/sh"},
	}
}
