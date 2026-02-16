package networker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"syscall"

	"github.com/google/uuid"
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
	clients, err := utils.KubeClientsFromContext(ctx)
	if err != nil {
		return "", err
	}

	// extract name and namespace
	metadata, ok := opts.Resource.ResourceData["metadata"].(map[string]any)
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
	hostIP := regexURLScheme.ReplaceAllString(clients.RestConfig.Host, "")

	transport, upgrader, err := spdy.RoundTripperFor(clients.RestConfig)
	if err != nil {
		log.Printf("error while building round-tripper: %s\n", err.Error())
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
		[]string{fmt.Sprintf("%d:%d", opts.Options.LocalPort, opts.Options.RemotePort)},
		stopCh,
		readyCh,
		out,
		errOut,
	)
	if err != nil {
		log.Printf("error while starting portforward: %s\n", err.Error())
		return "", err
	}

	// start the forwarder
	go func() {
		err := fw.ForwardPorts()
		if err != nil {
			log.Printf("error while forwarding ports: %s\n", err.Error())
			errCh <- err
			close(errCh)
		}
	}()

	go func(ctx context.Context, stopCh chan struct{}) {
		select {
		case <-stopCh:
			log.Println("stopping")
			return
		case <-sigs:
			log.Println("got a signal")
			close(stopCh)
			return
		}
	}(ctx.Context, stopCh)

	// wait until ready first
	<-fw.Ready
	return uuid.NewString(), nil
}
