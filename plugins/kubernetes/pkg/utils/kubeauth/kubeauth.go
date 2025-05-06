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

func isGCPAuth(auth *clientcmdapi.AuthInfo) bool {
	return auth.Exec != nil && auth.Exec.Command == "gcloud"
}

func isAKSAuth(auth *clientcmdapi.AuthInfo) bool {
	return auth.Exec != nil && auth.Exec.Command == "az"
}

func contains(list []string, val string) bool {
	return slices.Contains(list, val)
}
