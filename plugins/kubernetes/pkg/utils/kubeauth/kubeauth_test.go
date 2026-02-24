package kubeauth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

func TestIsEKSAuth(t *testing.T) {
	tests := []struct {
		name     string
		auth     *clientcmdapi.AuthInfo
		expected bool
	}{
		{
			name: "aws CLI with eks in args",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws",
					Args:    []string{"eks", "get-token", "--cluster-name", "my-cluster"},
				},
			},
			expected: true,
		},
		{
			name: "aws CLI without eks in args",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws",
					Args:    []string{"sts", "get-caller-identity"},
				},
			},
			expected: false,
		},
		{
			name: "aws-iam-authenticator command",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws-iam-authenticator",
					Args:    []string{"token", "-i", "my-cluster"},
				},
			},
			expected: true,
		},
		{
			name: "nil Exec",
			auth: &clientcmdapi.AuthInfo{
				Exec: nil,
			},
			expected: false,
		},
		{
			name: "different command entirely",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "kubectl",
					Args:    []string{"get", "pods"},
				},
			},
			expected: false,
		},
		{
			name: "aws CLI with eks as first arg",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws",
					Args:    []string{"eks", "get-token"},
				},
			},
			expected: true,
		},
		{
			name: "aws CLI with eks as middle arg",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws",
					Args:    []string{"--region", "us-east-1", "eks", "get-token"},
				},
			},
			expected: true,
		},
		{
			name: "aws CLI with eks as last arg",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws",
					Args:    []string{"--profile", "prod", "eks"},
				},
			},
			expected: true,
		},
		{
			name: "aws CLI with empty args",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws",
					Args:    []string{},
				},
			},
			expected: false,
		},
		{
			name: "aws-iam-authenticator with no args",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws-iam-authenticator",
				},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsEKSAuth(tt.auth)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestIsGCPAuth(t *testing.T) {
	tests := []struct {
		name     string
		auth     *clientcmdapi.AuthInfo
		expected bool
	}{
		{
			name: "gcloud command",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "gcloud",
					Args:    []string{"config", "config-helper", "--format=json"},
				},
			},
			expected: true,
		},
		{
			name: "different command",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "kubectl",
					Args:    []string{"get", "pods"},
				},
			},
			expected: false,
		},
		{
			name: "nil Exec",
			auth: &clientcmdapi.AuthInfo{
				Exec: nil,
			},
			expected: false,
		},
		{
			name: "gcloud command with no args",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "gcloud",
				},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsGCPAuth(tt.auth)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestIsAKSAuth(t *testing.T) {
	tests := []struct {
		name     string
		auth     *clientcmdapi.AuthInfo
		expected bool
	}{
		{
			name: "az command",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "az",
					Args:    []string{"aks", "get-credentials", "--resource-group", "rg", "--name", "cluster"},
				},
			},
			expected: true,
		},
		{
			name: "different command",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "kubectl",
					Args:    []string{"get", "pods"},
				},
			},
			expected: false,
		},
		{
			name: "nil Exec",
			auth: &clientcmdapi.AuthInfo{
				Exec: nil,
			},
			expected: false,
		},
		{
			name: "az command with no args",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "az",
				},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsAKSAuth(tt.auth)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestCrossChecks(t *testing.T) {
	tests := []struct {
		name      string
		auth      *clientcmdapi.AuthInfo
		expectEKS bool
		expectGCP bool
		expectAKS bool
	}{
		{
			name: "EKS auth should not match GCP or AKS",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws",
					Args:    []string{"eks", "get-token", "--cluster-name", "my-cluster"},
				},
			},
			expectEKS: true,
			expectGCP: false,
			expectAKS: false,
		},
		{
			name: "aws-iam-authenticator should not match GCP or AKS",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "aws-iam-authenticator",
					Args:    []string{"token", "-i", "my-cluster"},
				},
			},
			expectEKS: true,
			expectGCP: false,
			expectAKS: false,
		},
		{
			name: "GCP auth should not match EKS or AKS",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "gcloud",
					Args:    []string{"config", "config-helper", "--format=json"},
				},
			},
			expectEKS: false,
			expectGCP: true,
			expectAKS: false,
		},
		{
			name: "AKS auth should not match EKS or GCP",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "az",
					Args:    []string{"aks", "get-credentials"},
				},
			},
			expectEKS: false,
			expectGCP: false,
			expectAKS: true,
		},
		{
			name: "no Exec should be false for all",
			auth: &clientcmdapi.AuthInfo{
				Exec: nil,
			},
			expectEKS: false,
			expectGCP: false,
			expectAKS: false,
		},
		{
			name: "unknown command should be false for all",
			auth: &clientcmdapi.AuthInfo{
				Exec: &clientcmdapi.ExecConfig{
					Command: "some-unknown-tool",
					Args:    []string{"--flag", "value"},
				},
			},
			expectEKS: false,
			expectGCP: false,
			expectAKS: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expectEKS, IsEKSAuth(tt.auth), "IsEKSAuth mismatch")
			assert.Equal(t, tt.expectGCP, IsGCPAuth(tt.auth), "IsGCPAuth mismatch")
			assert.Equal(t, tt.expectAKS, IsAKSAuth(tt.auth), "IsAKSAuth mismatch")
		})
	}
}
