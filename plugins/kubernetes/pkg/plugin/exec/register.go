package exec

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	v1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	restclient "k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/omniviewdev/plugin-sdk/pkg/exec"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

func Register(plugin *sdk.Plugin) {
	// Register the capabilities
	if err := exec.RegisterPlugin(plugin, exec.PluginOpts{
		Handlers: []exec.HandlerOpts{
			{
				Plugin:   "kubernetes",
				Resource: "core::v1::Pod",
				Handler:  PodHandler,
			},
		},
	}); err != nil {
		panic(err)
	}
}

func PodHandler(
	ctx *types.PluginContext,
	opts exec.SessionOptions,
) (io.Writer, io.Reader, io.Reader, error) {
	// create a new kubernetes client
	if ctx.Connection == nil {
		return nil, nil, nil, errors.New("connection is required")
	}

	kubeconfig, ok := ctx.Connection.GetDataKey("kubeconfig")
	if !ok {
		return nil, nil, nil, errors.New("connection is required")
	}
	val, ok := kubeconfig.(string)
	if !ok {
		return nil, nil, nil, errors.New(
			"kubeconfig in connection is required and must be a string",
		)
	}

	// Change this to get from settings provider
	os.Setenv("SHELL", "/bin/zsh")
	os.Setenv("PATH", os.Getenv("PATH")+":/usr/local/bin:/usr/bin")

	// connect to a cluster using the provided kubeconfig and context
	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: val},
		&clientcmd.ConfigOverrides{CurrentContext: ctx.Connection.ID},
	).ClientConfig()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("error creating client: %w", err)
	}

	// create a clientset for being able to initialize informers
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("error creating clientset: %w", err)
	}

	// get the namespace and pod off the data obj
	metadata, ok := opts.ResourceData["metadata"].(map[string]interface{})
	if !ok {
		return nil, nil, nil, errors.New("metadata is required")
	}
	pod, ok := metadata["name"].(string)
	if !ok {
		return nil, nil, nil, errors.New("pod is required")
	}
	namespace, ok := metadata["namespace"].(string)
	if !ok {
		return nil, nil, nil, errors.New("namespace is required")
	}
	container, ok := opts.Params["container"]
	if !ok {
		container = ""
	}

	return ExecCmdExample(
		ctx.Context,
		clientset,
		config,
		namespace,
		pod,
		container,
		opts.Command,
		opts.TTY,
	)
}

// ExecCmd exec command on specific pod and wait the command's output.
func ExecCmdExample(
	ctx context.Context,
	client kubernetes.Interface,
	config *restclient.Config,
	namespace string,
	pod string,
	container string,
	command []string,
	tty bool,
) (io.Writer, io.Reader, io.Reader, error) {
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
		TTY:       tty,
	}

	req.VersionedParams(
		option,
		scheme.ParameterCodec,
	)

	exec, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		return nil, nil, nil, err
	}

	var (
		stdin  *bytes.Buffer
		stdout *bytes.Buffer
		stderr *bytes.Buffer
	)

	err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:  stdin,
		Stdout: stdout,
		Stderr: stderr,
		Tty:    true,
	})
	if err != nil {
		return nil, nil, nil, err
	}

	return stdin, stdout, stderr, nil
}
