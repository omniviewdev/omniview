package kubeauth

import (
	"slices"

	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

const (
	awsCliCommand              = "aws"
	awsIamAuthenticatorCommand = "aws-iam-authenticator"
)

func isEKSAuth(auth *clientcmdapi.AuthInfo) bool {
	return auth.Exec != nil &&
		((auth.Exec.Command == awsCliCommand && contains(auth.Exec.Args, "eks")) ||
			(auth.Exec.Command == awsIamAuthenticatorCommand))
}

// IsEKSAuth returns true if the auth info uses EKS authentication (aws CLI or aws-iam-authenticator).
func IsEKSAuth(auth *clientcmdapi.AuthInfo) bool {
	return isEKSAuth(auth)
}

func isGCPAuth(auth *clientcmdapi.AuthInfo) bool {
	return auth.Exec != nil && auth.Exec.Command == "gcloud"
}

// IsGCPAuth returns true if the auth info uses GCP/gcloud authentication.
func IsGCPAuth(auth *clientcmdapi.AuthInfo) bool {
	return isGCPAuth(auth)
}

func isAKSAuth(auth *clientcmdapi.AuthInfo) bool {
	return auth.Exec != nil && auth.Exec.Command == "az"
}

// IsAKSAuth returns true if the auth info uses Azure AKS authentication.
func IsAKSAuth(auth *clientcmdapi.AuthInfo) bool {
	return isAKSAuth(auth)
}

func contains(list []string, val string) bool {
	return slices.Contains(list, val)
}
