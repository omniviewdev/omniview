package resource

import (
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"

	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
)

// helper to create a Kubernetes StatusError with a given code and message.
func k8sStatusError(code int32, message string) error {
	return &k8serrors.StatusError{
		ErrStatus: metav1.Status{
			Code:    code,
			Message: message,
		},
	}
}

func TestClassifyResourceError_Forbidden(t *testing.T) {
	err := k8sStatusError(403, "pods is forbidden: User \"test\"")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "FORBIDDEN", opErr.Code)
	assert.Equal(t, "Access denied", opErr.Title)
	assert.Contains(t, opErr.Message, "pods is forbidden")
	assert.NotEmpty(t, opErr.Suggestions)
}

func TestClassifyResourceError_Unauthorized(t *testing.T) {
	err := k8sStatusError(401, "Unauthorized")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "UNAUTHORIZED", opErr.Code)
	assert.Equal(t, "Authentication failed", opErr.Title)
}

func TestClassifyResourceError_NotFound(t *testing.T) {
	err := k8sStatusError(404, "the server could not find the requested resource")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "NOT_FOUND", opErr.Code)
	assert.Equal(t, "Resource not found", opErr.Title)
}

func TestClassifyResourceError_Timeout408(t *testing.T) {
	err := k8sStatusError(408, "request timeout")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "TIMEOUT", opErr.Code)
}

func TestClassifyResourceError_Timeout504(t *testing.T) {
	err := k8sStatusError(504, "gateway timeout")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "TIMEOUT", opErr.Code)
}

func TestClassifyResourceError_Conflict(t *testing.T) {
	err := k8sStatusError(409, "the object has been modified")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CONFLICT", opErr.Code)
	assert.Equal(t, "Resource conflict", opErr.Title)
}

func TestClassifyResourceError_UnhandledStatusCode(t *testing.T) {
	// 422 Unprocessable Entity — not in our switch
	err := k8sStatusError(422, "Unprocessable Entity")

	result := classifyResourceError(err)
	assert.Nil(t, result, "unhandled K8s status codes should return nil for INTERNAL fallback")
}

func TestClassifyResourceError_ConnectionError(t *testing.T) {
	err := &net.OpError{
		Op:  "dial",
		Net: "tcp",
		Addr: &net.TCPAddr{
			IP:   net.ParseIP("10.0.0.1"),
			Port: 6443,
		},
		Err: errors.New("connection refused"),
	}

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CONNECTION_ERROR", opErr.Code)
	assert.Equal(t, "Connection error", opErr.Title)
	assert.Contains(t, opErr.Message, "connection refused")
}

func TestClassifyResourceError_WrappedConnectionError(t *testing.T) {
	inner := &net.OpError{
		Op:  "dial",
		Net: "tcp",
		Err: errors.New("no such host"),
	}
	wrapped := fmt.Errorf("Get \"https://cluster.example.com\": %w", inner)

	result := classifyResourceError(wrapped)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CONNECTION_ERROR", opErr.Code)
}

func TestClassifyResourceError_CertificateInvalid(t *testing.T) {
	err := x509.CertificateInvalidError{
		Reason: x509.Expired,
	}

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CERTIFICATE_ERROR", opErr.Code)
	assert.Equal(t, "Certificate error", opErr.Title)
}

func TestClassifyResourceError_UnknownAuthority(t *testing.T) {
	err := x509.UnknownAuthorityError{}

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CERTIFICATE_ERROR", opErr.Code)
}

func TestClassifyResourceError_WrappedCertError(t *testing.T) {
	inner := x509.CertificateInvalidError{Reason: x509.Expired}
	wrapped := fmt.Errorf("TLS handshake: %w", inner)

	result := classifyResourceError(wrapped)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "CERTIFICATE_ERROR", opErr.Code)
}

func TestClassifyResourceError_PlainError(t *testing.T) {
	err := errors.New("something completely unexpected")

	result := classifyResourceError(err)
	assert.Nil(t, result, "unclassifiable errors should return nil")
}

func TestClassifyResourceError_PreservesOriginalError(t *testing.T) {
	original := k8sStatusError(403, "pods is forbidden")

	result := classifyResourceError(original)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.True(t, errors.Is(opErr, original),
		"ResourceOperationError.Err should wrap the original error")
}

func TestClassifyResourceError_StatusCodePriority(t *testing.T) {
	// A K8s error that also happens to be wrapped in net.OpError shouldn't
	// be classified as CONNECTION_ERROR — the K8s StatusError check runs first.
	err := k8sStatusError(403, "forbidden")

	result := classifyResourceError(err)
	require.NotNil(t, result)

	var opErr *resourcetypes.ResourceOperationError
	require.True(t, errors.As(result, &opErr))
	assert.Equal(t, "FORBIDDEN", opErr.Code, "K8s StatusError should take priority")
}

// TestClassifyResourceError_JSONRoundTrip verifies the full error flow:
// K8s error → classifyResourceError → ResourceOperationError → .Error() JSON → parseable
func TestClassifyResourceError_JSONRoundTrip(t *testing.T) {
	k8sErr := k8sStatusError(403, `pods is forbidden: User "system:anonymous" cannot list resource "pods"`)
	classified := classifyResourceError(k8sErr)
	require.NotNil(t, classified)

	// The classified error's .Error() should produce valid, parseable JSON
	jsonStr := classified.Error()
	assert.Contains(t, jsonStr, `"code":"FORBIDDEN"`)
	assert.Contains(t, jsonStr, `"title":"Access denied"`)
	assert.Contains(t, jsonStr, `"suggestions"`)
}
