package resource

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// --- processGroupVersion ---

func TestProcessGroupVersion(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		expectedGroup string
		expectedVer   string
	}{
		{"core v1", "v1", "core", "v1"},
		{"apps/v1", "apps/v1", "apps", "v1"},
		{"batch/v1", "batch/v1", "batch", "v1"},
		{"networking.k8s.io/v1", "networking.k8s.io/v1", "networking", "v1"},
		{"storage.k8s.io/v1", "storage.k8s.io/v1", "storage", "v1"},
		{"rbac.authorization.k8s.io/v1", "rbac.authorization.k8s.io/v1", "rbac", "v1"},
		{"internal.apiserver.k8s.io/v1alpha1", "internal.apiserver.k8s.io/v1alpha1", "apiserverinternal", "v1alpha1"},
		{"flowcontrol.apiserver.k8s.io/v1", "flowcontrol.apiserver.k8s.io/v1", "flowcontrol", "v1"},
		{"admissionregistration.k8s.io/v1", "admissionregistration.k8s.io/v1", "admissionregistration", "v1"},
		{"autoscaling/v2", "autoscaling/v2", "autoscaling", "v2"},
		{"policy/v1", "policy/v1", "policy", "v1"},
		{"v1beta1 core", "v1beta1", "core", "v1beta1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			group, version := processGroupVersion(tt.input)
			assert.Equal(t, tt.expectedGroup, group)
			assert.Equal(t, tt.expectedVer, version)
		})
	}
}

// --- enrichConnectionLabels ---

func TestEnrichConnectionLabels_DefaultAuth(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"my-cluster": {Server: "https://10.0.0.1:6443"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"my-user": {}, // no Exec
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "my-cluster",
		AuthInfo: "my-user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "https://10.0.0.1:6443", labels["server"])
	assert.Equal(t, "default", labels["auth_method"])
}

func TestEnrichConnectionLabels_EKSAuth(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"eks-cluster": {Server: "https://ABC.eks.amazonaws.com"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"eks-user": {
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws",
					Args:    []string{"eks", "get-token", "--region", "us-west-2", "--cluster-name", "my-cluster"},
					Env: []clientcmdapi.ExecEnvVar{
						{Name: "AWS_PROFILE", Value: "staging"},
					},
				},
			},
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "eks-cluster",
		AuthInfo: "eks-user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "eks", labels["auth_method"])
	assert.Equal(t, "us-west-2", labels["region"])
	assert.Equal(t, "staging", labels["profile"])
}

func TestEnrichConnectionLabels_GKEAuth(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"gke-cluster": {Server: "https://gke.example.com"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"gke-user": {
				Exec: &clientcmdapi.ExecConfig{
					Command: "gcloud",
					Args:    []string{"container", "clusters", "get-credentials", "--project", "my-project", "--zone", "us-central1-a"},
				},
			},
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "gke-cluster",
		AuthInfo: "gke-user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "gke", labels["auth_method"])
	assert.Equal(t, "my-project", labels["project"])
	assert.Equal(t, "us-central1-a", labels["zone"])
}

func TestEnrichConnectionLabels_AKSAuth(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"aks-cluster": {Server: "https://aks.example.com"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"aks-user": {
				Exec: &clientcmdapi.ExecConfig{
					Command: "az",
					Args:    []string{"aks", "get-credentials", "--subscription", "sub-123", "--resource-group", "rg-prod"},
				},
			},
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "aks-cluster",
		AuthInfo: "aks-user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "aks", labels["auth_method"])
	assert.Equal(t, "sub-123", labels["subscription"])
	assert.Equal(t, "rg-prod", labels["resource_group"])
}

func TestEnrichConnectionLabels_UnknownExecCommand(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters: map[string]*clientcmdapi.Cluster{
			"cluster": {Server: "https://cluster.example.com"},
		},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{
			"user": {
				Exec: &clientcmdapi.ExecConfig{
					Command: "custom-auth-tool",
				},
			},
		},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "cluster",
		AuthInfo: "user",
	}

	enrichConnectionLabels(labels, config, ctx)

	assert.Equal(t, "custom-auth-tool", labels["auth_method"])
}

func TestEnrichConnectionLabels_MissingCluster(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters:  map[string]*clientcmdapi.Cluster{},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{"user": {}},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "nonexistent",
		AuthInfo: "user",
	}

	enrichConnectionLabels(labels, config, ctx)

	_, hasServer := labels["server"]
	assert.False(t, hasServer, "missing cluster should not set server")
	assert.Equal(t, "default", labels["auth_method"])
}

func TestEnrichConnectionLabels_NilAuthInfo(t *testing.T) {
	labels := make(map[string]interface{})
	config := &clientcmdapi.Config{
		Clusters:  map[string]*clientcmdapi.Cluster{"c": {Server: "https://x"}},
		AuthInfos: map[string]*clientcmdapi.AuthInfo{},
	}
	ctx := &clientcmdapi.Context{
		Cluster:  "c",
		AuthInfo: "nonexistent",
	}

	enrichConnectionLabels(labels, config, ctx)
	assert.Equal(t, "default", labels["auth_method"])
}

// --- enrichEKSLabels ---

func TestEnrichEKSLabels_RegionFromArgs(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"eks", "get-token", "--region", "eu-west-1"},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "eu-west-1", labels["region"])
}

func TestEnrichEKSLabels_RegionFromEnv(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"eks", "get-token"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "AWS_REGION", Value: "ap-southeast-1"},
			},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "ap-southeast-1", labels["region"])
}

func TestEnrichEKSLabels_ArgsRegionTakesPrecedence(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"--region", "from-args"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "AWS_REGION", Value: "from-env"},
			},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "from-args", labels["region"])
}

func TestEnrichEKSLabels_DefaultRegionFallback(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"eks", "get-token"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "AWS_DEFAULT_REGION", Value: "us-east-1"},
			},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "us-east-1", labels["region"])
}

func TestEnrichEKSLabels_RoleArn(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"--role-arn", "arn:aws:iam::123456789012:role/my-role"},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "arn:aws:iam::123456789012:role/my-role", labels["role"])
	assert.Equal(t, "123456789012", labels["account"])
}

func TestEnrichEKSLabels_ShortRoleFlag(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws-iam-authenticator",
			Args:    []string{"-r", "arn:aws:iam::999888777666:role/admin"},
		},
	}

	enrichEKSLabels(labels, auth)
	assert.Equal(t, "999888777666", labels["account"])
}

func TestEnrichEKSLabels_NoRoleNoAccount(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "aws",
			Args:    []string{"eks", "get-token"},
		},
	}

	enrichEKSLabels(labels, auth)
	_, hasRole := labels["role"]
	_, hasAccount := labels["account"]
	assert.False(t, hasRole)
	assert.False(t, hasAccount)
}

// --- enrichGKELabels ---

func TestEnrichGKELabels_AllFields(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "gcloud",
			Args:    []string{"container", "clusters", "get-credentials", "--project", "my-project", "--region", "us-east1"},
		},
	}

	enrichGKELabels(labels, auth)
	assert.Equal(t, "my-project", labels["project"])
	assert.Equal(t, "us-east1", labels["region"])
}

func TestEnrichGKELabels_ProjectFromEnv(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "gcloud",
			Args:    []string{"container", "clusters", "get-credentials"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "CLOUDSDK_CORE_PROJECT", Value: "env-project"},
			},
		},
	}

	enrichGKELabels(labels, auth)
	assert.Equal(t, "env-project", labels["project"])
}

func TestEnrichGKELabels_ArgsProjectTakesPrecedence(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "gcloud",
			Args:    []string{"--project", "from-args"},
			Env: []clientcmdapi.ExecEnvVar{
				{Name: "CLOUDSDK_CORE_PROJECT", Value: "from-env"},
			},
		},
	}

	enrichGKELabels(labels, auth)
	assert.Equal(t, "from-args", labels["project"])
}

func TestEnrichGKELabels_Zone(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "gcloud",
			Args:    []string{"--zone", "us-central1-a"},
		},
	}

	enrichGKELabels(labels, auth)
	assert.Equal(t, "us-central1-a", labels["zone"])
}

// --- enrichAKSLabels ---

func TestEnrichAKSLabels_AllFields(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "az",
			Args:    []string{"aks", "get-credentials", "--subscription", "sub-abc", "--resource-group", "rg-1"},
		},
	}

	enrichAKSLabels(labels, auth)
	assert.Equal(t, "sub-abc", labels["subscription"])
	assert.Equal(t, "rg-1", labels["resource_group"])
}

func TestEnrichAKSLabels_NoArgs(t *testing.T) {
	labels := make(map[string]interface{})
	auth := &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			Command: "az",
			Args:    []string{"aks", "get-credentials"},
		},
	}

	enrichAKSLabels(labels, auth)
	_, hasSub := labels["subscription"]
	_, hasRG := labels["resource_group"]
	assert.False(t, hasSub)
	assert.False(t, hasRG)
}

// --- CheckConnectionFunc ---

func TestCheckConnectionFunc_NilConnection(t *testing.T) {
	status, err := CheckConnectionFunc(nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, types.ConnectionStatusError, status.Status)
	assert.Contains(t, status.Details, "No connection was provided")
}

func TestCheckConnectionFunc_NilClient(t *testing.T) {
	conn := &types.Connection{ID: "test"}
	status, err := CheckConnectionFunc(nil, conn, nil)
	require.NoError(t, err)
	assert.Equal(t, types.ConnectionStatusError, status.Status)
	assert.Contains(t, status.Details, "No client was provided")
}

// --- connectionsFromKubeconfig ---

func TestConnectionsFromKubeconfig_ValidFile(t *testing.T) {
	// Create a temporary kubeconfig.
	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "config")

	content := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://10.0.0.1:6443
  name: cluster-a
- cluster:
    server: https://10.0.0.2:6443
  name: cluster-b
contexts:
- context:
    cluster: cluster-a
    user: user-a
  name: context-a
- context:
    cluster: cluster-b
    user: user-b
    namespace: kube-system
  name: context-b
users:
- name: user-a
  user: {}
- name: user-b
  user: {}
current-context: context-a
`
	require.NoError(t, os.WriteFile(kubeconfigPath, []byte(content), 0644))

	conns, err := connectionsFromKubeconfig(kubeconfigPath)
	require.NoError(t, err)
	require.Len(t, conns, 2)

	// Build a lookup map.
	byID := make(map[string]types.Connection)
	for _, c := range conns {
		byID[c.ID] = c
	}

	a := byID["context-a"]
	assert.Equal(t, "context-a", a.Name)
	assert.Equal(t, "cluster-a", a.Labels["cluster"])
	assert.Equal(t, "user-a", a.Labels["user"])
	assert.Equal(t, "https://10.0.0.1:6443", a.Labels["server"])
	assert.Equal(t, "default", a.Labels["auth_method"])

	b := byID["context-b"]
	assert.Equal(t, "kube-system", b.Data["namespace"])
}

func TestConnectionsFromKubeconfig_InvalidPath(t *testing.T) {
	_, err := connectionsFromKubeconfig("/nonexistent/path/config")
	require.Error(t, err)
}

func TestConnectionsFromKubeconfig_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "config")

	// A valid but empty kubeconfig.
	content := `apiVersion: v1
kind: Config
clusters: []
contexts: []
users: []
`
	require.NoError(t, os.WriteFile(kubeconfigPath, []byte(content), 0644))

	conns, err := connectionsFromKubeconfig(kubeconfigPath)
	require.NoError(t, err)
	assert.Empty(t, conns)
}

func TestConnectionsFromKubeconfig_EKSContext(t *testing.T) {
	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "config")

	content := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://ABC.eks.amazonaws.com
  name: eks-cluster
contexts:
- context:
    cluster: eks-cluster
    user: eks-user
  name: eks-context
users:
- name: eks-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args:
      - eks
      - get-token
      - --region
      - us-west-2
      - --cluster-name
      - my-cluster
      env:
      - name: AWS_PROFILE
        value: production
`
	require.NoError(t, os.WriteFile(kubeconfigPath, []byte(content), 0644))

	conns, err := connectionsFromKubeconfig(kubeconfigPath)
	require.NoError(t, err)
	require.Len(t, conns, 1)

	c := conns[0]
	assert.Equal(t, "eks", c.Labels["auth_method"])
	assert.Equal(t, "us-west-2", c.Labels["region"])
	assert.Equal(t, "production", c.Labels["profile"])
}

func TestConnectionsFromKubeconfig_GKEContext(t *testing.T) {
	dir := t.TempDir()
	kubeconfigPath := filepath.Join(dir, "config")

	content := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://gke.example.com
  name: gke-cluster
contexts:
- context:
    cluster: gke-cluster
    user: gke-user
  name: gke-context
users:
- name: gke-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gcloud
      args:
      - container
      - clusters
      - get-credentials
      - --project
      - my-gcp-project
      - --zone
      - us-central1-a
`
	require.NoError(t, os.WriteFile(kubeconfigPath, []byte(content), 0644))

	conns, err := connectionsFromKubeconfig(kubeconfigPath)
	require.NoError(t, err)
	require.Len(t, conns, 1)

	c := conns[0]
	assert.Equal(t, "gke", c.Labels["auth_method"])
	assert.Equal(t, "my-gcp-project", c.Labels["project"])
	assert.Equal(t, "us-central1-a", c.Labels["zone"])
}
