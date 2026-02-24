package kubeauth

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// writeTestKubeconfig writes a kubeconfig file with the given AuthInfo to a
// temporary directory and returns the path.  The kubeconfig always contains a
// single cluster ("test-cluster"), a single user ("test-user") wired to the
// supplied AuthInfo, and a single context ("test-context") that ties them
// together.
func writeTestKubeconfig(t *testing.T, authInfo *clientcmdapi.AuthInfo) string {
	t.Helper()

	dir := t.TempDir()
	path := filepath.Join(dir, "kubeconfig")

	cfg := clientcmdapi.NewConfig()
	cfg.Clusters["test-cluster"] = &clientcmdapi.Cluster{
		Server: "https://localhost:6443",
	}
	cfg.AuthInfos["test-user"] = authInfo
	cfg.Contexts["test-context"] = &clientcmdapi.Context{
		Cluster:  "test-cluster",
		AuthInfo: "test-user",
	}
	cfg.CurrentContext = "test-context"

	err := clientcmd.WriteToFile(*cfg, path)
	require.NoError(t, err)
	return path
}

func TestDetectAuthStrategy_DefaultAuth(t *testing.T) {
	// Certificate-based auth, no exec provider -> DefaultAuthStrategy
	authInfo := &clientcmdapi.AuthInfo{
		ClientCertificateData: []byte("cert-data"),
		ClientKeyData:         []byte("key-data"),
	}

	path := writeTestKubeconfig(t, authInfo)

	strategy, err := DetectAuthStrategy(path, "test-context")
	require.NoError(t, err)
	_, ok := strategy.(*DefaultAuthStrategy)
	assert.True(t, ok, "expected *DefaultAuthStrategy, got %T", strategy)
}

func TestDetectAuthStrategy_EKSAuth_AwsCLI(t *testing.T) {
	// EKS auth via aws CLI with "eks" in args -> EKSAuthStrategy
	authInfo := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command:    "aws",
			Args:       []string{"--region", "us-west-2", "eks", "get-token", "--cluster-name", "my-cluster"},
			APIVersion: "client.authentication.k8s.io/v1beta1",
		},
	}

	path := writeTestKubeconfig(t, authInfo)

	strategy, err := DetectAuthStrategy(path, "test-context")
	require.NoError(t, err)
	_, ok := strategy.(*EKSAuthStrategy)
	assert.True(t, ok, "expected *EKSAuthStrategy, got %T", strategy)
}

func TestDetectAuthStrategy_EKSAuth_IamAuthenticator(t *testing.T) {
	// EKS auth via aws-iam-authenticator -> EKSAuthStrategy
	authInfo := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command:    "aws-iam-authenticator",
			Args:       []string{"token", "-i", "my-cluster"},
			APIVersion: "client.authentication.k8s.io/v1beta1",
		},
	}

	path := writeTestKubeconfig(t, authInfo)

	strategy, err := DetectAuthStrategy(path, "test-context")
	require.NoError(t, err)
	_, ok := strategy.(*EKSAuthStrategy)
	assert.True(t, ok, "expected *EKSAuthStrategy, got %T", strategy)
}

func TestDetectAuthStrategy_GCPAuth(t *testing.T) {
	// GCP auth via gcloud exec command -> DefaultAuthStrategy
	authInfo := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command:    "gcloud",
			Args:       []string{"config", "config-helper", "--format=json"},
			APIVersion: "client.authentication.k8s.io/v1beta1",
		},
	}

	path := writeTestKubeconfig(t, authInfo)

	strategy, err := DetectAuthStrategy(path, "test-context")
	require.NoError(t, err)
	_, ok := strategy.(*DefaultAuthStrategy)
	assert.True(t, ok, "expected *DefaultAuthStrategy for GCP auth, got %T", strategy)
}

func TestDetectAuthStrategy_AKSAuth(t *testing.T) {
	// AKS auth via az command -> DefaultAuthStrategy
	authInfo := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command:    "az",
			Args:       []string{"aks", "get-credentials", "--resource-group", "rg", "--name", "cluster"},
			APIVersion: "client.authentication.k8s.io/v1beta1",
		},
	}

	path := writeTestKubeconfig(t, authInfo)

	strategy, err := DetectAuthStrategy(path, "test-context")
	require.NoError(t, err)
	_, ok := strategy.(*DefaultAuthStrategy)
	assert.True(t, ok, "expected *DefaultAuthStrategy for AKS auth, got %T", strategy)
}

func TestDetectAuthStrategy_MissingContext(t *testing.T) {
	// A valid kubeconfig file but the requested context does not exist.
	authInfo := &clientcmdapi.AuthInfo{
		ClientCertificateData: []byte("cert-data"),
		ClientKeyData:         []byte("key-data"),
	}
	path := writeTestKubeconfig(t, authInfo)

	_, err := DetectAuthStrategy(path, "nonexistent-context")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestDetectAuthStrategy_InvalidKubeconfigPath(t *testing.T) {
	// A path that does not exist should return an error from the config loader.
	_, err := DetectAuthStrategy("/tmp/does-not-exist/kubeconfig", "test-context")
	require.Error(t, err)
}

func TestDetectAuthStrategy_EmptyContextNoMatch(t *testing.T) {
	// An empty kubeContext string with no matching context in the kubeconfig.
	authInfo := &clientcmdapi.AuthInfo{
		ClientCertificateData: []byte("cert-data"),
		ClientKeyData:         []byte("key-data"),
	}
	path := writeTestKubeconfig(t, authInfo)

	// The kubeconfig has "test-context" but we pass "" which won't match any
	// context name in the map.
	_, err := DetectAuthStrategy(path, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestDetectAuthStrategy_UnknownExecCommand(t *testing.T) {
	// An exec provider with an unrecognised command should fall through to
	// the default strategy.
	authInfo := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command:    "some-unknown-tool",
			Args:       []string{"--flag", "value"},
			APIVersion: "client.authentication.k8s.io/v1beta1",
		},
	}

	path := writeTestKubeconfig(t, authInfo)

	strategy, err := DetectAuthStrategy(path, "test-context")
	require.NoError(t, err)
	_, ok := strategy.(*DefaultAuthStrategy)
	assert.True(t, ok, "expected *DefaultAuthStrategy for unknown exec command, got %T", strategy)
}

func TestDetectAuthStrategy_TokenAuth(t *testing.T) {
	// Token-based auth (no exec, no certs) should fall through to default.
	authInfo := &clientcmdapi.AuthInfo{
		Token: "my-bearer-token",
	}

	path := writeTestKubeconfig(t, authInfo)

	strategy, err := DetectAuthStrategy(path, "test-context")
	require.NoError(t, err)
	_, ok := strategy.(*DefaultAuthStrategy)
	assert.True(t, ok, "expected *DefaultAuthStrategy for token auth, got %T", strategy)
}
