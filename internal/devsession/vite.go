package devsession

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

const viteJSONString = `"(?:[^"\\]|\\.)*"`

var viteProtocol = regexp.MustCompile(`const\s+socketProtocol\s*=\s*(` + viteJSONString + `|null)\s*\|\|`)
var vitePort = regexp.MustCompile(`const\s+hmrPort\s*=\s*(` + viteJSONString + `|[0-9]+|null)\s*;`)
var viteToken = regexp.MustCompile(`const\s+wsToken\s*=\s*(` + viteJSONString + `)\s*;`)
var viteSocket = regexp.MustCompile("const\\s+socketHost\\s*=\\s*`\\$\\{(" + viteJSONString + "|null)\\s*\\|\\|\\s*importMetaUrl\\.hostname\\}:\\$\\{hmrPort\\s*\\|\\|\\s*importMetaUrl\\.port\\}\\$\\{(" + viteJSONString + ")\\}`")

func viteString(raw []byte) (string, error) {
	if string(raw) == "null" {
		return "", nil
	}
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return "", fmt.Errorf("Vite HMR client has an unsupported injected string declaration")
	}
	return value, nil
}

// ProbeViteHMR discovers the websocket URL from the ACTUAL served Vite client,
// including configured hostname/clientPort/HMR path. It requires a real Vite
// protocol connected frame, not HTTP text, an open port or a guessed WS URL.
// Returned URL and all errors omit the ephemeral websocket token/source text.
func ProbeViteHMR(ctx context.Context, address string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	base, err := url.Parse(address)
	if err != nil || base.Scheme != "http" || base.Hostname() != "127.0.0.1" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return "", fmt.Errorf("Vite discovery requires an explicit loopback HTTP URL")
	}
	port, err := strconv.Atoi(base.Port())
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("Vite discovery requires an explicit positive port")
	}
	moduleURL, err := url.JoinPath(address, "@vite/client")
	if err != nil {
		return "", fmt.Errorf("Vite client module URL is invalid")
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, moduleURL, nil)
	if err != nil {
		return "", fmt.Errorf("Vite module request is invalid")
	}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("Vite client module is not reachable")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil || response.StatusCode != http.StatusOK || len(body) > 2<<20 {
		return "", fmt.Errorf("Vite client module is unavailable or oversized")
	}
	protocolMatch := viteProtocol.FindSubmatch(body)
	portMatch := vitePort.FindSubmatch(body)
	hostMatch := viteSocket.FindSubmatch(body)
	tokenMatch := viteToken.FindSubmatch(body)
	if len(protocolMatch) != 2 || len(portMatch) != 2 || len(hostMatch) != 3 || len(tokenMatch) != 2 {
		return "", fmt.Errorf("served client has no supported injected Vite HMR configuration")
	}
	protocol, err := viteString(protocolMatch[1])
	if err != nil {
		return "", err
	}
	if protocol == "" {
		protocol = "ws"
	}
	if protocol != "ws" && protocol != "wss" {
		return "", fmt.Errorf("Vite HMR protocol is unsupported")
	}
	host, err := viteString(hostMatch[1])
	if err != nil {
		return "", err
	}
	if host == "" {
		host = base.Hostname()
	}
	if host != "127.0.0.1" {
		return "", fmt.Errorf("Vite HMR listener is not explicit IPv4 loopback")
	}
	portText := string(portMatch[1])
	if portText == "null" {
		portText = ""
	} else if strings.HasPrefix(portText, "\"") {
		portText, err = viteString(portMatch[1])
		if err != nil {
			return "", err
		}
	}
	if portText == "" {
		portText = base.Port()
	}
	port, err = strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("Vite HMR client port is invalid")
	}
	path, err := viteString(hostMatch[2])
	if err != nil {
		return "", err
	}
	if path == "" {
		path = "/"
	}
	parsedPath, err := url.Parse(path)
	if err != nil || !strings.HasPrefix(path, "/") || parsedPath.IsAbs() || parsedPath.Host != "" || parsedPath.RawQuery != "" || parsedPath.Fragment != "" {
		return "", fmt.Errorf("Vite HMR client path is invalid")
	}
	token, err := viteString(tokenMatch[1])
	if err != nil || token == "" {
		return "", fmt.Errorf("Vite HMR client token is unavailable")
	}
	public := url.URL{Scheme: protocol, Host: net.JoinHostPort(host, strconv.Itoa(port)), Path: parsedPath.Path, RawPath: parsedPath.RawPath}
	authenticated := public
	query := url.Values{}
	query.Set("token", token)
	authenticated.RawQuery = query.Encode()
	connection, _, err := websocket.Dial(ctx, authenticated.String(), &websocket.DialOptions{HTTPClient: client, Subprotocols: []string{"vite-hmr"}, HTTPHeader: http.Header{"Origin": []string{base.Scheme + "://" + base.Host}}})
	if err != nil {
		return "", fmt.Errorf("Vite HMR listener did not complete an authenticated websocket handshake")
	}
	defer connection.CloseNow()
	_, payload, err := connection.Read(ctx)
	if err != nil {
		return "", fmt.Errorf("Vite HMR listener did not acknowledge its protocol")
	}
	var message struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(payload, &message) != nil || message.Type != "connected" {
		return "", fmt.Errorf("Vite HMR listener returned a non-ready protocol frame")
	}
	return public.String(), nil
}
