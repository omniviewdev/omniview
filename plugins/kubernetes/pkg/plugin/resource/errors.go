package resource

import (
	"crypto/x509"
	"errors"
	"net"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"

	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
)

// classifyResourceError inspects a Kubernetes API error and returns a structured
// ResourceOperationError with an appropriate code, title, and suggestions.
// Returns nil for errors it cannot classify (the gRPC server falls back to INTERNAL).
func classifyResourceError(err error) error {
	// Check Kubernetes StatusError first (covers most API server errors).
	var statusErr *k8serrors.StatusError
	if errors.As(err, &statusErr) {
		code := statusErr.ErrStatus.Code
		msg := statusErr.ErrStatus.Message

		switch {
		case code == 403:
			return &resourcetypes.ResourceOperationError{
				Err:     err,
				Code:    "FORBIDDEN",
				Title:   "Access denied",
				Message: msg,
				Suggestions: []string{
					"Check your RBAC permissions for this resource type",
					"Contact your cluster administrator for access",
				},
			}
		case code == 401:
			return &resourcetypes.ResourceOperationError{
				Err:     err,
				Code:    "UNAUTHORIZED",
				Title:   "Authentication failed",
				Message: msg,
				Suggestions: []string{
					"Your auth token may have expired — try re-authenticating",
					"Check your kubeconfig credentials",
				},
			}
		case code == 404:
			return &resourcetypes.ResourceOperationError{
				Err:     err,
				Code:    "NOT_FOUND",
				Title:   "Resource not found",
				Message: msg,
				Suggestions: []string{
					"The resource or API group may not exist on this cluster",
					"You may not have permission to discover this API group",
				},
			}
		case code == 408 || code == 504:
			return &resourcetypes.ResourceOperationError{
				Err:     err,
				Code:    "TIMEOUT",
				Title:   "Request timed out",
				Message: msg,
				Suggestions: []string{
					"The cluster may be under heavy load",
					"Check your network connection",
				},
			}
		case code == 409:
			return &resourcetypes.ResourceOperationError{
				Err:     err,
				Code:    "CONFLICT",
				Title:   "Resource conflict",
				Message: msg,
				Suggestions: []string{
					"The resource was modified by another process",
					"Refresh and try again",
				},
			}
		}
	}

	// Check for network-level errors.
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return &resourcetypes.ResourceOperationError{
			Err:     err,
			Code:    "CONNECTION_ERROR",
			Title:   "Connection error",
			Message: opErr.Error(),
			Suggestions: []string{
				"Check that the cluster is running and reachable",
				"Verify your network connection",
				"Check if a VPN or proxy is required",
			},
		}
	}

	// Check for TLS/certificate errors.
	var certInvalidErr x509.CertificateInvalidError
	var unknownAuthErr x509.UnknownAuthorityError
	if errors.As(err, &certInvalidErr) || errors.As(err, &unknownAuthErr) {
		return &resourcetypes.ResourceOperationError{
			Err:     err,
			Code:    "CERTIFICATE_ERROR",
			Title:   "Certificate error",
			Message: err.Error(),
			Suggestions: []string{
				"The cluster certificate may have expired",
				"Your kubeconfig may reference outdated certificates",
				"Check if the CA bundle is configured correctly",
			},
		}
	}

	// Unclassified — let the gRPC server wrap as INTERNAL.
	return nil
}
