// Package diagnostics provides bounded, native-free application measurements.
package diagnostics

import "time"

const SchemaVersion = 1

type Identity struct {
	InstanceID string `json:"instanceID"`
	Version    string `json:"version"`
	Revision   string `json:"revision"`
	ConfigID   string `json:"configID"`
	// SessionID identifies one process launch; InstanceID identifies its stable profile.
	SessionID  string `json:"sessionID"`
	Generation string `json:"generation"`
	// SourceState is clean, modified, or unknown. Revision alone is not a source fingerprint.
	SourceState string `json:"sourceState"`
	BuildDate   string `json:"buildDate"`
	// ConfigScope describes exactly which settings ConfigID covers.
	ConfigScope string `json:"configScope"`
}
type Health struct {
	Errors        uint64 `json:"errors"`
	Dropped       uint64 `json:"dropped"`
	Gaps          uint64 `json:"gaps"`
	LastError     string `json:"lastError"`
	Complete      bool   `json:"complete"`
	RemoteErrors  uint64 `json:"remoteErrors"`
	RemoteDropped uint64 `json:"remoteDropped"`
}
type Limits struct {
	HistorySamples     int   `json:"historySamples"`
	CaptureCount       int   `json:"captureCount"`
	CaptureSeconds     int   `json:"captureSeconds"`
	ConcurrentCaptures int   `json:"concurrentCaptures"`
	DiskBytes          int64 `json:"diskBytes"`
	Metrics            int   `json:"metrics"`
	SeriesPerMetric    int   `json:"seriesPerMetric"`
	SampleBytes        int   `json:"sampleBytes"`
	CaptureBytes       int   `json:"captureBytes"`
}
type Point struct {
	Attributes   map[string]string `json:"attributes"`
	Value        float64           `json:"value"`
	Count        uint64            `json:"count"`
	Sum          float64           `json:"sum"`
	Bounds       []float64         `json:"bounds"`
	BucketCounts []uint64          `json:"bucketCounts"`
	StartTime    time.Time         `json:"startTime"`
}
type Metric struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Unit        string  `json:"unit"`
	Kind        string  `json:"kind"`
	Points      []Point `json:"points"`
}
type Snapshot struct {
	SchemaVersion  int       `json:"schemaVersion"`
	Identity       Identity  `json:"identity"`
	Sequence       uint64    `json:"sequence"`
	Timestamp      time.Time `json:"timestamp"`
	ElapsedSeconds float64   `json:"elapsedSeconds"`
	Metrics        []Metric  `json:"metrics"`
	Health         Health    `json:"health"`
}
type History struct {
	Samples []Snapshot `json:"samples"`
	Health  Health     `json:"health"`
}

// MetricDescriptor describes an instrument without copying its collected points.
type MetricDescriptor struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Unit        string `json:"unit"`
	Kind        string `json:"kind"`
}
type Catalog struct {
	SchemaVersion int                `json:"schemaVersion"`
	Identity      Identity           `json:"identity"`
	Metrics       []MetricDescriptor `json:"metrics"`
	Limits        Limits             `json:"limits"`
}
type CaptureRequest struct {
	Name            string `json:"name"`
	DurationSeconds int    `json:"durationSeconds"`
	Workload        string `json:"workload"`
}
type Capture struct {
	SchemaVersion   int        `json:"schemaVersion"`
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Workload        string     `json:"workload"`
	Status          string     `json:"status"`
	Identity        Identity   `json:"identity"`
	StartedAt       time.Time  `json:"startedAt"`
	EndedAt         time.Time  `json:"endedAt"`
	DurationSeconds int        `json:"durationSeconds"`
	ElapsedSeconds  float64    `json:"elapsedSeconds"`
	Samples         []Snapshot `json:"samples"`
	Coverage        Health     `json:"coverage"`
	Error           string     `json:"error"`
}

// CaptureSummary is the bounded polling/list representation. Samples are fetched only by GetCapture.
type CaptureSummary struct {
	SchemaVersion   int       `json:"schemaVersion"`
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Workload        string    `json:"workload"`
	Status          string    `json:"status"`
	Identity        Identity  `json:"identity"`
	StartedAt       time.Time `json:"startedAt"`
	EndedAt         time.Time `json:"endedAt"`
	DurationSeconds int       `json:"durationSeconds"`
	ElapsedSeconds  float64   `json:"elapsedSeconds"`
	SampleCount     int       `json:"sampleCount"`
	Coverage        Health    `json:"coverage"`
	Error           string    `json:"error"`
}
type MetricComparison struct {
	Name       string            `json:"name"`
	Unit       string            `json:"unit"`
	Kind       string            `json:"kind"`
	Attributes map[string]string `json:"attributes"`
	Baseline   float64           `json:"baseline"`
	Candidate  float64           `json:"candidate"`
	Delta      float64           `json:"delta"`
	Semantics  string            `json:"semantics"`
	Valid      bool              `json:"valid"`
	Warning    string            `json:"warning"`
}
type Comparison struct {
	Baseline   string             `json:"baseline"`
	Candidate  string             `json:"candidate"`
	Compatible bool               `json:"compatible"`
	Warnings   []string           `json:"warnings"`
	Metrics    []MetricComparison `json:"metrics"`
}
