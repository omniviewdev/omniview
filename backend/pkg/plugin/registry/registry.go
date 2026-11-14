package registry

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	otelcodes "go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"golang.org/x/mod/semver"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	"github.com/omniviewdev/omniview/internal/version"
	logging "github.com/omniviewdev/plugin-sdk/log"
	regclient "github.com/omniviewdev/registry"
)

// AvailablePlugin represents a plugin from the marketplace, enriched with
// local install status for the desktop app frontend.
type AvailablePlugin struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	IconURL       string   `json:"icon_url"`
	Category      string   `json:"category"`
	Tags          []string `json:"tags"`
	License       string   `json:"license"`
	Official      bool     `json:"official"`
	Featured      bool     `json:"featured"`
	DownloadCount int64    `json:"download_count"`
	AverageRating float64  `json:"average_rating"`
	ReviewCount   int64    `json:"review_count"`
	Repository    string   `json:"repository"`
	URL           string   `json:"url"`
	PublisherName string   `json:"publisher_name"`
	Installed     bool     `json:"installed"`
	InstalledVer  string   `json:"installed_version"`
	LatestVer     string   `json:"latest_version"`
	UpdateAvail   bool     `json:"update_available"`
}

// VersionInfo represents a plugin version for the frontend.
type VersionInfo struct {
	Version             string   `json:"version"`
	Channel             string   `json:"channel"`
	Description         string   `json:"description"`
	Changelog           string   `json:"changelog"`
	MinIDEVersion       string   `json:"min_ide_version"`
	MaxIDEVersion       string   `json:"max_ide_version"`
	Capabilities        []string `json:"capabilities"`
	CreatedAt           string   `json:"created_at"`
	Compatible          bool     `json:"compatible"`
	CompatibilityReason string   `json:"compatibility_reason"`
	DiscoverySupported  bool     `json:"discovery_supported"`
}

// Review represents a plugin review for the frontend.
type Review struct {
	ID        string `json:"id"`
	UserID    uint   `json:"user_id"`
	Rating    int    `json:"rating"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
}

// DownloadStats holds plugin download statistics.
type DownloadStats struct {
	Total      int64       `json:"total"`
	LastMonth  int64       `json:"last_month"`
	LastWeek   int64       `json:"last_week"`
	DailyStats []DailyStat `json:"daily_stats"`
}

// DailyStat is a single day's download count.
type DailyStat struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

// Client wraps the registry client with convenience methods for the desktop app.
type Client struct {
	mu                 sync.RWMutex
	inner              *regclient.Client
	baseURL            string // tracks the current API URL so we can detect changes
	logger             logging.Logger
	hostReleaseChannel string
}

// NewClient creates a new registry client.
func NewClient(baseURL string) *Client {
	c := &Client{mu: sync.RWMutex{}, inner: nil, baseURL: baseURL, logger: nil}
	c.inner = newRegistryClient(baseURL, c)
	return c
}

// WithHostReleaseChannel records the host release channel for plugin selection.
func (c *Client) WithHostReleaseChannel(channel string) *Client {
	c.mu.Lock()
	c.hostReleaseChannel = channel
	c.mu.Unlock()
	return c
}

// HostReleaseChannel returns the host release channel.
func (c *Client) HostReleaseChannel() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.hostReleaseChannel
}

// SetBaseURL replaces the underlying client with one pointing at a new API URL.
// No-op if the URL hasn't changed.
func (c *Client) SetBaseURL(baseURL string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if baseURL == c.baseURL {
		return
	}
	c.baseURL = baseURL
	c.inner = newRegistryClient(baseURL, c)
}

// BaseURL returns the current marketplace API URL.
func (c *Client) BaseURL() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.baseURL
}

func (c *Client) snapshot() *regclient.Client {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.inner
}

func newRegistryClient(baseURL string, owner *Client) *regclient.Client {
	if baseURL == "" {
		baseURL = coresettings.DefaultMarketplaceURL
	}
	// The registry client appends absolute API paths to this string.
	baseURL = strings.TrimRight(baseURL, "/")
	client := regclient.NewClient(regclient.WithBaseURL(baseURL))
	base, err := url.Parse(baseURL)
	if err != nil {
		// Preserve the registry client's request-time validation of malformed URLs.
		return client
	}
	regclient.WithHTTPClient(&http.Client{
		Timeout:   30 * time.Second, // Preserve the registry client's default.
		Transport: &compatibilityTransport{base: base, next: http.DefaultTransport, owner: owner},
	})(client)
	return client
}

// compatibilityTransport only decorates direct registry API requests. Redirects
// and artifact/CDN paths must retain their original (potentially signed) URLs.
type compatibilityTransport struct {
	base  *url.URL
	next  http.RoundTripper
	owner *Client // optional; supplies the logger
}

type artifactRequestKey struct{}

type versionDiscoveryKey struct{}

type versionDiscovery struct {
	supported bool
}

// Each DownloadPlugin call resolves one artifact URL before fetching it.
type artifactRequest struct {
	url string
}

// RoundTrip traces every registry request. Only the URL path is recorded (never the
// query, headers or body); artifact/CDN URLs may carry signed material so their
// path is replaced by a fixed token.
func (t *compatibilityTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	artifact, _ := req.Context().Value(artifactRequestKey{}).(*artifactRequest)
	isArtifact := artifact != nil && artifact.url == req.URL.String()
	path := req.URL.Path
	if isArtifact {
		path = "{artifact}"
	}
	ctx, span := startSpan(req.Context(), "registry.http",
		attribute.String("http.request.method", req.Method),
		attribute.String("url.path", path),
		attribute.Bool("artifact", isArtifact))
	started := time.Now()
	resp, err := t.roundTrip(req.WithContext(ctx))
	elapsed := time.Since(started).Milliseconds()
	switch {
	case err != nil:
		t.owner.warn(ctx, "registry request failed", "method", req.Method, "path", path,
			"durationMs", elapsed, "errorClass", telemetryutil.ErrorClass(err))
		endSpan(span, err)
		return resp, err
	case resp.StatusCode >= http.StatusBadRequest:
		t.owner.warn(ctx, "registry request returned non-success status", "method", req.Method, "path", path,
			"status", resp.StatusCode, "durationMs", elapsed)
		span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode),
			attribute.String("outcome", "failure"))
		span.SetStatus(otelcodes.Error, "http_status")
		span.End()
	default:
		t.owner.debug(ctx, "registry request", "method", req.Method, "path", path,
			"status", resp.StatusCode, "durationMs", elapsed)
		span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode))
		endSpan(span, nil)
	}
	return resp, nil
}

func (t *compatibilityTransport) roundTrip(req *http.Request) (*http.Response, error) {
	artifact, _ := req.Context().Value(artifactRequestKey{}).(*artifactRequest)
	if (artifact != nil && artifact.url == req.URL.String()) ||
		t.base == nil || req.Response != nil ||
		req.URL.Scheme != t.base.Scheme || req.URL.Host != t.base.Host ||
		!strings.HasPrefix(req.URL.EscapedPath(), strings.TrimSuffix(t.base.EscapedPath(), "/")+"/v1/") {
		return t.next.RoundTrip(req)
	}
	clone := req.Clone(req.Context())
	query := clone.URL.Query()
	if t.owner != nil && t.owner.HostReleaseChannel() == "nightly" {
		query.Set("ignore_ide_compatibility", "true")
	} else {
		query.Set("ide_version", version.CompatibilityVersion())
	}
	discovery, _ := req.Context().Value(versionDiscoveryKey{}).(*versionDiscovery)
	if discovery != nil && req.Method == http.MethodGet && strings.HasSuffix(req.URL.Path, "/versions") {
		query.Set("include_incompatible", "true")
	}
	clone.URL.RawQuery = query.Encode()
	resp, err := t.next.RoundTrip(clone)
	if err == nil && discovery != nil {
		discovery.supported = resp.Header.Get("X-Omniview-Incompatible-Versions") == "true"
	}
	if err == nil && artifact != nil &&
		(resp.StatusCode == http.StatusFound || resp.StatusCode == http.StatusTemporaryRedirect) {
		artifact.url = resp.Header.Get("Location")
	}
	return resp, err
}

const (
	// pluginsPageSize is the page size used when listing or searching plugins and versions.
	pluginsPageSize = 50
	// reviewsPageSize is the page size used when listing plugin reviews.
	reviewsPageSize = 20
	// downloadStatsDays is the number of days of daily download counts fetched.
	downloadStatsDays = 30
)

// toAvailablePlugin converts a registry Plugin to the frontend-facing AvailablePlugin.
func toAvailablePlugin(p regclient.Plugin) AvailablePlugin {
	return AvailablePlugin{
		ID:            p.ID,
		Name:          p.Name,
		Description:   p.Description,
		IconURL:       p.IconURL,
		Category:      p.Category,
		Tags:          p.Tags,
		License:       p.License,
		Official:      p.Official,
		Featured:      p.Featured,
		DownloadCount: p.DownloadCount,
		AverageRating: p.AverageRating,
		ReviewCount:   p.ReviewCount,
		Repository:    p.Repository,
		URL:           p.URL,
		PublisherName: p.PublisherName,
		LatestVer:     p.LatestVersion,
		Installed:     false,
		InstalledVer:  "",
		UpdateAvail:   false,
	}
}

// ListPlugins fetches all available plugins from the marketplace, paginating
// through results automatically.
//
//nolint:nonamedreturns // Deferred telemetry records the result count and error.
func (c *Client) ListPlugins(ctx context.Context) (plugins []AvailablePlugin, err error) {
	ctx, span := startSpan(ctx, "registry.ListPlugins")
	defer func() {
		span.SetAttributes(attribute.Int("count", len(plugins)))
		endSpan(span, err)
	}()
	return c.fetchAllPlugins(ctx, &regclient.ListOptions{
		Page:           0,
		PerPage:        pluginsPageSize,
		OrderField:     "",
		OrderDirection: "",
		Search:         "",
		Category:       "",
		Featured:       false,
	})
}

// fetchAllPlugins walks through all pages and collects every plugin.
func (c *Client) fetchAllPlugins(ctx context.Context, opts *regclient.ListOptions) ([]AvailablePlugin, error) {
	if opts.Page == 0 {
		opts.Page = 1
	}

	inner := c.snapshot()
	var all []AvailablePlugin
	for {
		result, err := inner.ListPlugins(ctx, opts)
		if err != nil {
			c.warn(ctx, "registry list page failed", "page", opts.Page, "errorClass", telemetryutil.ErrorClass(err))
			return nil, fmt.Errorf("listing plugins (page %d): %w", opts.Page, err)
		}
		trace.SpanFromContext(ctx).AddEvent("page",
			trace.WithAttributes(attribute.Int("page", opts.Page), attribute.Int("items", len(result.Items))))
		c.debug(ctx, "registry list page", "page", opts.Page, "items", len(result.Items))

		for _, p := range result.Items {
			all = append(all, toAvailablePlugin(p))
		}

		if result.Pagination == nil || opts.Page >= int(result.Pagination.TotalPages) {
			break
		}
		opts.Page++
	}
	return all, nil
}

// SearchPlugins searches plugins with filters, paginating through all results.
//
//nolint:nonamedreturns // Deferred telemetry records the result count and error.
func (c *Client) SearchPlugins(
	ctx context.Context, query, category, sort string,
) (plugins []AvailablePlugin, err error) {
	// The query text is user input and is never exported; only its presence is.
	ctx, span := startSpan(ctx, "registry.SearchPlugins",
		attribute.Bool("has_query", query != ""), attribute.Bool("has_category", category != ""),
		attribute.Bool("has_sort", sort != ""))
	defer func() {
		span.SetAttributes(attribute.Int("count", len(plugins)))
		endSpan(span, err)
	}()
	opts := &regclient.ListOptions{
		Page:           0,
		PerPage:        pluginsPageSize,
		OrderField:     "",
		OrderDirection: "",
		Search:         query,
		Category:       category,
		Featured:       false,
	}
	if sort != "" {
		opts.OrderField = sort
		opts.OrderDirection = "desc"
	}
	return c.fetchAllPlugins(ctx, opts)
}

// GetPluginReadme fetches the readme for a plugin.
//
//nolint:nonamedreturns // Deferred telemetry records the result size and error.
func (c *Client) GetPluginReadme(ctx context.Context, pluginID string) (readme string, err error) {
	ctx, span := startSpan(ctx, "registry.GetPluginReadme", attribute.String("plugin_id", pluginID))
	defer func() {
		span.SetAttributes(attribute.Int("bytes", len(readme)))
		endSpan(span, err)
	}()
	p, err := c.snapshot().GetPlugin(ctx, pluginID)
	if err != nil {
		return "", fmt.Errorf("getting plugin readme: %w", err)
	}
	return p.Readme, nil
}

// GetPluginVersions fetches version history for a plugin.
//
//nolint:nonamedreturns // Deferred telemetry records the result count and error.
func (c *Client) GetPluginVersions(ctx context.Context, pluginID, channel string) (versions []VersionInfo, err error) {
	ctx, span := startSpan(ctx, "registry.GetPluginVersions", attribute.String("plugin_id", pluginID))
	defer func() {
		span.SetAttributes(attribute.Int("count", len(versions)))
		endSpan(span, err)
	}()
	discovery := &versionDiscovery{}
	ctx = context.WithValue(ctx, versionDiscoveryKey{}, discovery)
	inner := c.snapshot()
	opts := &regclient.ListOptions{Page: 1, PerPage: pluginsPageSize}
	if channel != "stable" {
		opts.Channel = channel
	}
	versions = make([]VersionInfo, 0)
	for {
		result, err := inner.ListVersions(ctx, pluginID, opts)
		if err != nil {
			c.warn(ctx, "registry versions page failed", "pluginID", pluginID, "page", opts.Page,
				"errorClass", telemetryutil.ErrorClass(err))
			return nil, fmt.Errorf("listing plugin versions (page %d): %w", opts.Page, err)
		}
		trace.SpanFromContext(ctx).AddEvent("page",
			trace.WithAttributes(attribute.Int("page", opts.Page), attribute.Int("items", len(result.Items))))
		for _, v := range result.Items {
			reason := ""
			if c.HostReleaseChannel() != "nightly" {
				reason = compatibilityReason(v.MinIDEVersion, v.MaxIDEVersion)
			}
			versions = append(versions, VersionInfo{
				Version:             v.Version,
				Channel:             v.Channel,
				Description:         v.Description,
				Changelog:           v.Changelog,
				MinIDEVersion:       v.MinIDEVersion,
				MaxIDEVersion:       v.MaxIDEVersion,
				Capabilities:        v.Capabilities,
				CreatedAt:           v.CreatedAt.Format("2006-01-02T15:04:05Z"),
				Compatible:          reason == "",
				CompatibilityReason: reason,
				DiscoverySupported:  discovery.supported,
			})
		}
		if result.Pagination == nil || opts.Page >= int(result.Pagination.TotalPages) {
			break
		}
		opts.Page++
	}
	sort.SliceStable(versions, func(i, j int) bool {
		return semver.Compare("v"+versions[i].Version, "v"+versions[j].Version) > 0
	})
	return versions, nil
}

// ListChannels returns the active release channels for a plugin.
func (c *Client) ListChannels(ctx context.Context, pluginID string) ([]regclient.PluginChannel, error) {
	return c.snapshot().ListChannels(ctx, pluginID)
}

func compatibilityReason(minimum, maximum string) string {
	host := "v" + version.CompatibilityVersion()
	min, max := "v"+minimum, "v"+maximum
	if (minimum != "" && !validCompatibilityBound(minimum)) || (maximum != "" && !validCompatibilityBound(maximum)) ||
		(minimum != "" && maximum != "" && semver.Compare(min, max) > 0) {
		return "Plugin declares invalid IDE compatibility bounds."
	}
	if minimum != "" && semver.Compare(host, min) < 0 {
		return "Update Omniview to " + minimum + " or newer."
	}
	if maximum != "" && semver.Compare(host, max) > 0 {
		return "Plugin supports Omniview " + maximum + " or older."
	}
	return ""
}

func validCompatibilityBound(bound string) bool {
	core := strings.SplitN(strings.SplitN(bound, "-", 2)[0], "+", 2)[0]
	return strings.Count(core, ".") == 2 && semver.IsValid("v"+bound)
}

// GetPluginReviews fetches reviews for a plugin.
//
//nolint:nonamedreturns // Deferred telemetry records the result count and error.
func (c *Client) GetPluginReviews(ctx context.Context, pluginID string, page int) (reviews []Review, err error) {
	ctx, span := startSpan(ctx, "registry.GetPluginReviews",
		attribute.String("plugin_id", pluginID), attribute.Int("page", page))
	defer func() {
		span.SetAttributes(attribute.Int("count", len(reviews)))
		endSpan(span, err)
	}()
	result, err := c.snapshot().ListReviews(ctx, pluginID, &regclient.ListOptions{
		Page:           page,
		PerPage:        reviewsPageSize,
		OrderField:     "",
		OrderDirection: "",
		Search:         "",
		Category:       "",
		Featured:       false,
	})
	if err != nil {
		return nil, fmt.Errorf("listing plugin reviews: %w", err)
	}

	reviews = make([]Review, len(result.Items))
	for i, r := range result.Items {
		reviews[i] = Review{
			ID:        r.ID,
			UserID:    r.UserID,
			Rating:    r.Rating,
			Title:     r.Title,
			Body:      r.Body,
			CreatedAt: r.CreatedAt.Format("2006-01-02T15:04:05Z"),
		}
	}
	return reviews, nil
}

// GetPluginDownloadStats fetches download statistics.
//
//nolint:nonamedreturns // Deferred telemetry records the returned error.
func (c *Client) GetPluginDownloadStats(ctx context.Context, pluginID string) (stats *DownloadStats, err error) {
	ctx, span := startSpan(ctx, "registry.GetPluginDownloadStats",
		attribute.String("plugin_id", pluginID), attribute.Int("days", downloadStatsDays))
	defer func() { endSpan(span, err) }()
	daily, err := c.snapshot().GetDailyDownloads(ctx, pluginID, downloadStatsDays)
	if err != nil {
		return nil, fmt.Errorf("getting download stats: %w", err)
	}

	stats = &DownloadStats{
		Total:      0,
		LastMonth:  0,
		LastWeek:   0,
		DailyStats: make([]DailyStat, len(daily)),
	}
	for i, d := range daily {
		stats.DailyStats[i] = DailyStat{
			Date:  d.Date,
			Count: d.Count,
		}
		stats.Total += d.Count
	}
	return stats, nil
}

// DownloadPlugin downloads and verifies a plugin artifact.
// Returns the path to the downloaded temp file.
//
//nolint:nonamedreturns // Deferred telemetry records the returned error.
func (c *Client) DownloadPlugin(ctx context.Context, pluginID, version string) (path string, err error) {
	ctx, span := startSpan(ctx, "registry.DownloadPlugin",
		attribute.String("plugin_id", pluginID), attribute.String("version", version))
	defer func() { endSpan(span, err) }()
	ctx = context.WithValue(ctx, artifactRequestKey{}, &artifactRequest{})
	path, err = c.snapshot().DownloadPlugin(ctx, pluginID, version)
	if err != nil {
		return path, err
	}
	if info, statErr := os.Stat(path); statErr == nil {
		span.SetAttributes(attribute.Int64("bytes", info.Size()))
		c.debug(ctx, "registry artifact downloaded", "pluginID", pluginID, "version", version, "bytes", info.Size())
	}
	return path, nil
}
