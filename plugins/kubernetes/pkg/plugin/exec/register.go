package exec

import (
	"context"
	"errors"
	"log"
	"os"

	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/omniview/kubernetes/pkg/utils"
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
				Plugin:     "kubernetes",
				Resource:   "core::v1::Pod",
				TTYHandler: PodHandler,
				TargetBuilder: sdkresource.ActionTargetBuilder{
					Paths: []string{"$.spec.containers[*]"},
					Selectors: map[string]string{
						"container": "$.name",
					},
					LabelSelector: "container",
				},
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
	stopCh chan struct{},
	resize <-chan exec.SessionResizeInput,
) error {
	clientset, config, err := utils.ClientsetAndConfigFromPluginCtx(ctx)
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
		clientset,
		config,
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
	stopChan chan struct{},
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

	go func(tty *os.File, stopCh chan struct{}) {
		err = executor.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdin:  tty,
			Stdout: tty,
			Stderr: tty,
			Tty:    true,
		})
		if err != nil {
			log.Println("error while streaming to executor", err)
		} else {
			log.Println("session ended successfully")
		}

		stopCh <- struct{}{}
	}(tty, stopChan)

	return nil
}
