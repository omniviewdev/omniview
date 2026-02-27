package registry

import (
	"context"
	"fmt"

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
	Version       string   `json:"version"`
	Description   string   `json:"description"`
	Changelog     string   `json:"changelog"`
	MinIDEVersion string   `json:"min_ide_version"`
	MaxIDEVersion string   `json:"max_ide_version"`
	Capabilities  []string `json:"capabilities"`
	CreatedAt     string   `json:"created_at"`
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
	inner   *regclient.Client
	baseURL string // tracks the current API URL so we can detect changes
}

// NewClient creates a new registry client.
func NewClient(baseURL string) *Client {
	opts := []regclient.Option{}
	if baseURL != "" {
		opts = append(opts, regclient.WithBaseURL(baseURL))
	}
	return &Client{
		inner:   regclient.NewClient(opts...),
		baseURL: baseURL,
	}
}

// SetBaseURL replaces the underlying client with one pointing at a new API URL.
// No-op if the URL hasn't changed.
func (c *Client) SetBaseURL(baseURL string) {
	if baseURL == c.baseURL {
		return
	}
	c.baseURL = baseURL
	opts := []regclient.Option{}
	if baseURL != "" {
		opts = append(opts, regclient.WithBaseURL(baseURL))
	}
	c.inner = regclient.NewClient(opts...)
}

// BaseURL returns the current marketplace API URL.
func (c *Client) BaseURL() string {
	return c.baseURL
}

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
	}
}

// ListPlugins fetches all available plugins from the marketplace, paginating
// through results automatically.
func (c *Client) ListPlugins(ctx context.Context) ([]AvailablePlugin, error) {
	return c.fetchAllPlugins(ctx, &regclient.ListOptions{PerPage: 50})
}

// fetchAllPlugins walks through all pages and collects every plugin.
func (c *Client) fetchAllPlugins(ctx context.Context, opts *regclient.ListOptions) ([]AvailablePlugin, error) {
	if opts.Page == 0 {
		opts.Page = 1
	}

	var all []AvailablePlugin
	for {
		result, err := c.inner.ListPlugins(ctx, opts)
		if err != nil {
			return nil, fmt.Errorf("listing plugins (page %d): %w", opts.Page, err)
		}

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
func (c *Client) SearchPlugins(ctx context.Context, query, category, sort string) ([]AvailablePlugin, error) {
	opts := &regclient.ListOptions{
		PerPage:  50,
		Search:   query,
		Category: category,
	}
	if sort != "" {
		opts.OrderField = sort
		opts.OrderDirection = "desc"
	}
	return c.fetchAllPlugins(ctx, opts)
}

// GetPluginReadme fetches the readme for a plugin.
func (c *Client) GetPluginReadme(ctx context.Context, pluginID string) (string, error) {
	p, err := c.inner.GetPlugin(ctx, pluginID)
	if err != nil {
		return "", fmt.Errorf("getting plugin readme: %w", err)
	}
	return p.Readme, nil
}

// GetPluginVersions fetches version history for a plugin.
func (c *Client) GetPluginVersions(ctx context.Context, pluginID string) ([]VersionInfo, error) {
	result, err := c.inner.ListVersions(ctx, pluginID, &regclient.ListOptions{PerPage: 50})
	if err != nil {
		return nil, fmt.Errorf("listing plugin versions: %w", err)
	}

	versions := make([]VersionInfo, len(result.Items))
	for i, v := range result.Items {
		versions[i] = VersionInfo{
			Version:       v.Version,
			Description:   v.Description,
			Changelog:     v.Changelog,
			MinIDEVersion: v.MinIDEVersion,
			MaxIDEVersion: v.MaxIDEVersion,
			Capabilities:  v.Capabilities,
			CreatedAt:     v.CreatedAt.Format("2006-01-02T15:04:05Z"),
		}
	}
	return versions, nil
}

// GetPluginReviews fetches reviews for a plugin.
func (c *Client) GetPluginReviews(ctx context.Context, pluginID string, page int) ([]Review, error) {
	result, err := c.inner.ListReviews(ctx, pluginID, &regclient.ListOptions{
		Page:    page,
		PerPage: 20,
	})
	if err != nil {
		return nil, fmt.Errorf("listing plugin reviews: %w", err)
	}

	reviews := make([]Review, len(result.Items))
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
func (c *Client) GetPluginDownloadStats(ctx context.Context, pluginID string) (*DownloadStats, error) {
	daily, err := c.inner.GetDailyDownloads(ctx, pluginID, 30)
	if err != nil {
		return nil, fmt.Errorf("getting download stats: %w", err)
	}

	stats := &DownloadStats{
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
func (c *Client) DownloadPlugin(ctx context.Context, pluginID, version string) (string, error) {
	return c.inner.DownloadPlugin(ctx, pluginID, version)
}
