package metric

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sync"
	"time"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

const (
	// DefaultPortForwardTTL is how long an idle port-forward stays alive.
	DefaultPortForwardTTL = 10 * time.Minute
	// DefaultPFReapInterval is how often the reaper checks for stale sessions.
	DefaultPFReapInterval = 1 * time.Minute
)

// pfSession holds the state for a single active port-forward.
type pfSession struct {
	localPort  int
	stopCh     chan struct{}
	lastAccess time.Time
}

// PortForwardManager manages per-connection SPDY port-forwards to the
// configured Prometheus service. It lazily creates forwards on first use,
// caches them, and reaps idle sessions after a TTL.
type PortForwardManager struct {
	mu       sync.Mutex
	sessions map[string]*pfSession // connectionID -> session
	ttl      time.Duration
	stopCh   chan struct{}
	nowFunc  func() time.Time
}

// PortForwardOpts configures a PortForwardManager.
type PortForwardOpts struct {
	TTL     time.Duration
	NowFunc func() time.Time
}

// NewPortForwardManager returns a new PortForwardManager and starts the reaper.
func NewPortForwardManager(opts PortForwardOpts) *PortForwardManager {
	ttl := opts.TTL
	if ttl == 0 {
		ttl = DefaultPortForwardTTL
	}
	nowFunc := opts.NowFunc
	if nowFunc == nil {
		nowFunc = time.Now
	}

	m := &PortForwardManager{
		sessions: make(map[string]*pfSession),
		ttl:      ttl,
		stopCh:   make(chan struct{}),
		nowFunc:  nowFunc,
	}

	go m.reapLoop()
	return m
}

// GetOrCreate returns the localhost URL for an existing port-forward or
// creates a new one targeting the given service. It resolves the service's
// endpoints and port-forwards to the first ready pod.
func (m *PortForwardManager) GetOrCreate(
	connectionID string,
	restConfig *rest.Config,
	clientset *kubernetes.Clientset,
	serviceNamespace string,
	serviceName string,
	servicePort int,
) (string, error) {
	m.mu.Lock()
	if sess, ok := m.sessions[connectionID]; ok {
		sess.lastAccess = m.nowFunc()
		m.mu.Unlock()
		return fmt.Sprintf("http://localhost:%d", sess.localPort), nil
	}
	m.mu.Unlock()

	// Resolve service to a ready pod endpoint.
	endpoints, err := clientset.CoreV1().Endpoints(serviceNamespace).Get(
		context.Background(), serviceName, metav1.GetOptions{},
	)
	if err != nil {
		return "", fmt.Errorf("failed to resolve endpoints for %s/%s: %w", serviceNamespace, serviceName, err)
	}

	var targetPod, targetNamespace string
	for _, subset := range endpoints.Subsets {
		if len(subset.Addresses) > 0 {
			ref := subset.Addresses[0].TargetRef
			if ref != nil && ref.Kind == "Pod" {
				targetPod = ref.Name
				targetNamespace = ref.Namespace
				break
			}
		}
	}
	if targetPod == "" {
		return "", fmt.Errorf("no ready endpoints found for service %s/%s", serviceNamespace, serviceName)
	}

	// Pick a free local port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("failed to allocate local port: %w", err)
	}
	localPort := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	// Build the SPDY dialer.
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s/portforward", targetNamespace, targetPod)
	re := regexp.MustCompile(`(?i)^https?://`)
	hostIP := re.ReplaceAllString(restConfig.Host, "")

	transport, upgrader, err := spdy.RoundTripperFor(restConfig)
	if err != nil {
		return "", fmt.Errorf("failed to build round-tripper: %w", err)
	}

	stopCh := make(chan struct{})
	readyCh := make(chan struct{})
	out, errOut := new(bytes.Buffer), new(bytes.Buffer)

	dialer := spdy.NewDialer(
		upgrader,
		&http.Client{Transport: transport},
		http.MethodPost,
		&url.URL{Scheme: "https", Path: path, Host: hostIP},
	)

	fw, err := portforward.New(
		dialer,
		[]string{fmt.Sprintf("%d:%d", localPort, servicePort)},
		stopCh,
		readyCh,
		out,
		errOut,
	)
	if err != nil {
		return "", fmt.Errorf("failed to create port-forward: %w", err)
	}

	errCh := make(chan error, 1)
	go func() {
		if err := fw.ForwardPorts(); err != nil {
			log.Printf("port-forward error for connection %s: %v", connectionID, err)
			errCh <- err
		}
	}()

	// Wait for the port-forward to be ready or fail.
	select {
	case <-readyCh:
	case err := <-errCh:
		return "", fmt.Errorf("port-forward failed to start: %w", err)
	}

	sess := &pfSession{
		localPort:  localPort,
		stopCh:     stopCh,
		lastAccess: m.nowFunc(),
	}

	m.mu.Lock()
	m.sessions[connectionID] = sess
	m.mu.Unlock()

	return fmt.Sprintf("http://localhost:%d", localPort), nil
}

// Close tears down the port-forward for a specific connection.
func (m *PortForwardManager) Close(connectionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if sess, ok := m.sessions[connectionID]; ok {
		close(sess.stopCh)
		delete(m.sessions, connectionID)
	}
}

// CloseAll tears down all active port-forwards and stops the reaper.
func (m *PortForwardManager) CloseAll() {
	close(m.stopCh)

	m.mu.Lock()
	defer m.mu.Unlock()

	for id, sess := range m.sessions {
		close(sess.stopCh)
		delete(m.sessions, id)
	}
}

// Len returns the number of active sessions (for testing).
func (m *PortForwardManager) Len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}

// reapLoop periodically checks for idle port-forward sessions.
func (m *PortForwardManager) reapLoop() {
	ticker := time.NewTicker(DefaultPFReapInterval)
	defer ticker.Stop()

	for {
		select {
		case <-m.stopCh:
			return
		case <-ticker.C:
			m.reap()
		}
	}
}

// reap closes port-forward sessions that haven't been used within the TTL.
func (m *PortForwardManager) reap() {
	now := m.nowFunc()
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, sess := range m.sessions {
		if now.Sub(sess.lastAccess) > m.ttl {
			log.Printf("reaping idle port-forward for connection %s", id)
			close(sess.stopCh)
			delete(m.sessions, id)
		}
	}
}
