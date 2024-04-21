package networker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"syscall"

	"github.com/omniview/kubernetes/pkg/utils"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"

	"github.com/omniviewdev/plugin-sdk/pkg/networker"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

func Register(plugin *sdk.Plugin) {
	portForwarders := map[string]networker.ResourcePortForwarder{
		"core::v1::Pod": PodPortForwarder,
	}

	// Register the capabilities
	if err := networker.RegisterPlugin(plugin, networker.PluginOpts{
		ResourcePortForwarders: portForwarders,
	}); err != nil {
		panic(err)
	}
}

// PodPortForwarder forwards a port from a pod to the local machine.
func PodPortForwarder(
	ctx *types.PluginContext,
	opts networker.ResourcePortForwardHandlerOpts,
) (string, error) {
	_, config, err := utils.ClientsetAndConfigFromPluginCtx(ctx)
	if err != nil {
		return "", err
	}

	// extract name and namespace
	metadata, ok := opts.Resource.ResourceData["metadata"].(map[string]interface{})
	if !ok {
		return "", errors.New("metadata is required")
	}
	name, ok := metadata["name"].(string)
	if !ok {
		return "", errors.New("pod is required")
	}
	namespace, ok := metadata["namespace"].(string)
	if !ok {
		return "", errors.New("namespace is required")
	}

	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s/portforward", namespace, name)
	regexURLScheme := regexp.MustCompile(`(?i)^https?://`)
	hostIP := regexURLScheme.ReplaceAllString(config.Host, "")

	transport, upgrader, err := spdy.RoundTripperFor(config)
	if err != nil {
		return "", err
	}

	stopCh, readyCh, errCh := make(chan struct{}, 1), make(chan struct{}, 1), make(chan error)
	out, errOut := new(bytes.Buffer), new(bytes.Buffer)

	// shouldn't necessarily have to manually handle the signals, but staying on the safe side
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

	dialer := spdy.NewDialer(
		upgrader,
		&http.Client{Transport: transport},
		http.MethodPost,
		&url.URL{Scheme: "https", Path: path, Host: hostIP},
	)
	fw, err := portforward.New(
		dialer,
		[]string{fmt.Sprintf("%d:%d", opts.Options.DestinationPort, opts.Options.SourcePort)},
		stopCh,
		readyCh,
		out,
		errOut,
	)
	if err != nil {
		return "", err
	}

	// start the forwarder
	go func() {
		errCh <- fw.ForwardPorts()
		close(errCh)
	}()

	go func(ctx context.Context, stopCh chan struct{}) {
		select {
		case <-stopCh:
			return
		case <-ctx.Done():
			close(stopCh)
			return
		case <-sigs:
			close(stopCh)
			return
		}
	}(ctx.Context, stopCh)

	// wait until ready first
	<-fw.Ready
	return "", nil
}
