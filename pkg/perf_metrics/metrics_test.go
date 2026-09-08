package perfmetrics

import (
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPerfMetricsTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
	t.Cleanup(func() {
		hotBuckets = sync.Map{}
	})
}

func TestQueryAggregatesByGroupAndChannel(t *testing.T) {
	hotBuckets = sync.Map{}
	setupPerfMetricsTestDB(t)

	bucketTs := time.Now().Unix() - 3600
	seed := []model.PerfMetric{
		{ModelName: "gpt-test", Group: "default", ChannelName: "channel-a", BucketTs: bucketTs, RequestCount: 4, SuccessCount: 3, TotalLatencyMs: 400, TtftSumMs: 200, TtftCount: 2, OutputTokens: 300, GenerationMs: 300},
		{ModelName: "gpt-test", Group: "default", ChannelName: "channel-b", BucketTs: bucketTs, RequestCount: 6, SuccessCount: 6, TotalLatencyMs: 600, TtftSumMs: 300, TtftCount: 3, OutputTokens: 600, GenerationMs: 600},
		{ModelName: "gpt-test", Group: "vip", ChannelName: "channel-a", BucketTs: bucketTs, RequestCount: 2, SuccessCount: 2, TotalLatencyMs: 100, TtftSumMs: 50, TtftCount: 1, OutputTokens: 100, GenerationMs: 100},
	}
	for i := range seed {
		require.NoError(t, model.UpsertPerfMetric(&seed[i]))
	}

	result, err := Query(QueryParams{Model: "gpt-test", Hours: 1})
	require.NoError(t, err)

	require.Len(t, result.Groups, 2)
	require.Len(t, result.Channels, 2)

	groupsByName := map[string]GroupResult{}
	for _, g := range result.Groups {
		groupsByName[g.Group] = g
	}
	def := groupsByName["default"]
	// default 组 = channel-a + channel-b 聚合: 10 次请求,总延迟 1000ms,成功 9 次
	assert.Equal(t, int64(100), def.Series[0].AvgLatencyMs)
	assert.InDelta(t, 90.0, def.SuccessRate, 0.001)
	vip := groupsByName["vip"]
	assert.Equal(t, int64(50), vip.AvgLatencyMs)
	assert.InDelta(t, 100.0, vip.SuccessRate, 0.001)

	channelsByName := map[string]ChannelResult{}
	for _, ch := range result.Channels {
		channelsByName[ch.Channel] = ch
	}
	channelA := channelsByName["channel-a"]
	// channel-a = default(4 请求 3 成功,400ms) + vip(2 请求 2 成功,100ms) 聚合
	assert.Equal(t, int64(83), channelA.AvgLatencyMs)
	assert.InDelta(t, 83.33, channelA.SuccessRate, 0.01)
	channelB := channelsByName["channel-b"]
	assert.Equal(t, int64(100), channelB.AvgLatencyMs)
	assert.InDelta(t, 100.0, channelB.SuccessRate, 0.001)
}

func TestRecordDefaultsUnknownChannel(t *testing.T) {
	hotBuckets = sync.Map{}
	setupPerfMetricsTestDB(t)

	Record(Sample{Model: "gpt-test", Group: "default", LatencyMs: 100, Success: true})

	found := false
	hotBuckets.Range(func(key, _ any) bool {
		k := key.(bucketKey)
		if k.model == "gpt-test" && k.group == "default" {
			found = true
			assert.Equal(t, UnknownChannelName, k.channel)
		}
		return true
	})
	assert.True(t, found, "sample without channel should land in the unknown-channel bucket")
}
