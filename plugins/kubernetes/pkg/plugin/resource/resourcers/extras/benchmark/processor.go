package benchmark

import (
	"github.com/fairwindsops/polaris/pkg/validator"
)

type BenchmarkResults struct {
	Summary           BenchmarkResultsSummary            `json:"summary"`
	SummaryByCategory map[string]BenchmarkResultsSummary `json:"summary_by_category"`
	Grade             string                             `json:"grade"`
	ClusterInfo       BenchmarkResultsClusterInfo        `json:"cluster_info"`
	Score             uint                               `json:"score"`
	Results           []validator.Result                 `json:"results"`
}

type BenchmarkResultsSummary struct {
	Success uint `json:"success"`
	Warning uint `json:"warning"`
	Danger  uint `json:"danger"`
}

type BenchmarkResultsClusterInfo struct {
	Controllers uint   `json:"controllers"`
	Namespaces  uint   `json:"namespaces"`
	Nodes       uint   `json:"nodes"`
	Pods        uint   `json:"pods"`
	Version     string `json:"string"`
}

func ToBenchmarkResults(report validator.AuditData) BenchmarkResults {
	summary := report.GetSummary()

	results := BenchmarkResults{
		Summary: BenchmarkResultsSummary{
			Success: summary.Successes,
			Warning: summary.Warnings,
			Danger:  summary.Dangers,
		},
		Grade: getGrade(report.GetSummary()),
		ClusterInfo: BenchmarkResultsClusterInfo{
			Controllers: uint(report.ClusterInfo.Controllers),
			Namespaces:  uint(report.ClusterInfo.Namespaces),
			Nodes:       uint(report.ClusterInfo.Nodes),
			Pods:        uint(report.ClusterInfo.Pods),
			Version:     report.ClusterInfo.Version,
		},
		Score:   report.Score,
		Results: report.Results,
	}

	sbc := report.GetSummaryByCategory()
	sbcResults := make(map[string]BenchmarkResultsSummary, len(sbc))
	for cat, summary := range sbc {
		sbcResults[cat] = BenchmarkResultsSummary{
			Success: summary.Successes,
			Warning: summary.Warnings,
			Danger:  summary.Dangers,
		}
	}
	results.SummaryByCategory = sbcResults

	return results
}

func getGrade(counts validator.CountSummary) string {
	score := counts.GetScore()
	if score >= 97 {
		return "A+"
	} else if score >= 93 {
		return "A"
	} else if score >= 90 {
		return "A-"
	} else if score >= 87 {
		return "B+"
	} else if score >= 83 {
		return "B"
	} else if score >= 80 {
		return "B-"
	} else if score >= 77 {
		return "C+"
	} else if score >= 73 {
		return "C"
	} else if score >= 70 {
		return "C-"
	} else if score >= 67 {
		return "D+"
	} else if score >= 63 {
		return "D"
	} else if score >= 60 {
		return "D-"
	} else {
		return "F"
	}
}
