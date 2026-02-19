package helm

import (
	"fmt"
	"log"
	"os"
	"sync"

	"helm.sh/helm/v3/pkg/action"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// HelmService manages Helm action.Configuration instances per connection+namespace.
type HelmService struct {
	configs sync.Map // key: "connectionID/namespace" → *action.Configuration
}

// NewHelmService creates a new HelmService.
func NewHelmService() *HelmService {
	return &HelmService{}
}

// GetActionConfig returns a Helm action.Configuration for the given connection
// and namespace. Configurations are cached per connection+namespace pair.
func (s *HelmService) GetActionConfig(
	connectionID string,
	restConfig *rest.Config,
	namespace string,
) (*action.Configuration, error) {
	key := connectionID + "/" + namespace
	if cfg, ok := s.configs.Load(key); ok {
		return cfg.(*action.Configuration), nil
	}

	cfg := new(action.Configuration)
	getter := newRESTClientGetter(restConfig, namespace)

	helmDriver := os.Getenv("HELM_DRIVER")
	if helmDriver == "" {
		helmDriver = "secrets"
	}

	if err := cfg.Init(getter, namespace, helmDriver, log.Printf); err != nil {
		return nil, fmt.Errorf("failed to initialize helm action configuration: %w", err)
	}

	s.configs.Store(key, cfg)
	return cfg, nil
}

// InvalidateConnection removes all cached configurations for a connection.
func (s *HelmService) InvalidateConnection(connectionID string) {
	prefix := connectionID + "/"
	s.configs.Range(func(key, _ any) bool {
		k := key.(string)
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			s.configs.Delete(key)
		}
		return true
	})
}

// restClientGetter implements genericclioptions.RESTClientGetter
// using an existing rest.Config from the K8s plugin's ClientSet.
type restClientGetter struct {
	restConfig *rest.Config
	namespace  string
}

func newRESTClientGetter(cfg *rest.Config, namespace string) *restClientGetter {
	return &restClientGetter{restConfig: cfg, namespace: namespace}
}

func (g *restClientGetter) ToRESTConfig() (*rest.Config, error) {
	return g.restConfig, nil
}

func (g *restClientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	dc, err := discovery.NewDiscoveryClientForConfig(g.restConfig)
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(dc), nil
}

func (g *restClientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(dc), nil
}

func (g *restClientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return &simpleClientConfig{namespace: g.namespace}
}

// simpleClientConfig satisfies clientcmd.ClientConfig with just a namespace.
type simpleClientConfig struct {
	namespace string
}

func (c *simpleClientConfig) RawConfig() (clientcmdapi.Config, error) {
	return clientcmdapi.Config{}, nil
}

func (c *simpleClientConfig) ClientConfig() (*rest.Config, error) {
	return nil, fmt.Errorf("not supported")
}

func (c *simpleClientConfig) Namespace() (string, bool, error) {
	return c.namespace, true, nil
}

func (c *simpleClientConfig) ConfigAccess() clientcmd.ConfigAccess {
	return nil
}
