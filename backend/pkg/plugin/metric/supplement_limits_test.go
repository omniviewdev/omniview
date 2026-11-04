package metric

import (
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

func TestSupplementMergeStopsAtCumulativeSampleLimit(t *testing.T) {
	group := func(count int) *sdk.ResourceSetQueryResponse {
		return &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{{Value: &sdk.MetricResult{TimeSeries: &sdk.TimeSeries{DataPoints: make([]sdk.DataPoint, count)}}}}}
	}
	out := group(25000)
	samples := 0
	require.NoError(t, mergeSupplementalGroup(out, nil, &samples))
	require.NoError(t, mergeSupplementalGroup(out, group(25000), &samples))
	require.Equal(t, maxSetSamples, samples)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(mergeSupplementalGroup(out, group(1), &samples)))
}

func TestSupplementMergeStopsAtCumulativeByteLimit(t *testing.T) {
	group := &sdk.ResourceSetQueryResponse{Warnings: []string{strings.Repeat("x", maxSetResponseBytes/2)}}
	out := &sdk.ResourceSetQueryResponse{}
	samples := 0
	require.NoError(t, mergeSupplementalGroup(out, group, &samples))
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(mergeSupplementalGroup(out, group, &samples)))
	require.Zero(t, samples)
}
