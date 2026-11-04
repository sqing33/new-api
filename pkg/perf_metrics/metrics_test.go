package perfmetrics

import (
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
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
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}, &model.PerfConcurrency{}))
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

// TestQueryAggregatesTokensByIdAndName 覆盖令牌维度聚合：同一个令牌的多行
// （不同渠道、不同时间桶）要合并成一行并带上真实名称，历史行（token_id=0）
// 仍要作为「未知令牌」出现。
func TestQueryAggregatesTokensByIdAndName(t *testing.T) {
	hotBuckets = sync.Map{}
	setupPerfMetricsTestDB(t)

	bucketTs := time.Now().Unix() - 3600
	nextBucketTs := bucketTs + 300
	seed := []model.PerfMetric{
		{ModelName: "gpt-test", Group: "default", ChannelName: "channel-a", BucketTs: bucketTs, TokenId: 7, TokenName: "令牌甲", RequestCount: 2, SuccessCount: 2, TotalLatencyMs: 200},
		{ModelName: "gpt-test", Group: "default", ChannelName: "channel-b", BucketTs: bucketTs, TokenId: 7, TokenName: "令牌甲", RequestCount: 3, SuccessCount: 3, TotalLatencyMs: 300},
		{ModelName: "gpt-test", Group: "default", ChannelName: "channel-a", BucketTs: nextBucketTs, TokenId: 7, TokenName: "令牌甲", RequestCount: 5, SuccessCount: 5, TotalLatencyMs: 500},
		{ModelName: "gpt-test", Group: "default", ChannelName: "channel-a", BucketTs: bucketTs, TokenId: 9, TokenName: "令牌乙", RequestCount: 1, SuccessCount: 1, TotalLatencyMs: 100},
		{ModelName: "gpt-test", Group: "default", ChannelName: "channel-a", BucketTs: bucketTs, RequestCount: 1, SuccessCount: 1, TotalLatencyMs: 100},
	}
	for i := range seed {
		require.NoError(t, model.UpsertPerfMetric(&seed[i]))
	}

	result, err := Query(QueryParams{Model: "gpt-test", Hours: 1})
	require.NoError(t, err)

	require.Len(t, result.Tokens, 3, "两个具名令牌 + token_id=0 的历史行")

	byId := map[int]TokenResult{}
	for _, token := range result.Tokens {
		byId[token.TokenId] = token
	}
	// 同一令牌跨渠道、跨桶合并：10 次请求、1000ms
	assert.Equal(t, "令牌甲", byId[7].TokenName)
	assert.Equal(t, int64(100), byId[7].AvgLatencyMs)
	assert.Len(t, byId[7].Series, 2, "两个时间桶各一个点")
	assert.Equal(t, "令牌乙", byId[9].TokenName)
	assert.Equal(t, "", byId[0].TokenName, "历史行归入未知令牌")
}

// TestSplitModelGroupToken 覆盖采样键解析：模型名和分组名本身可能含 '|'，
// 解析必须从右往左切，否则含竖线的模型名会被截断。
func TestSplitModelGroupToken(t *testing.T) {
	cases := []struct {
		triple    string
		wantModel string
		wantGroup string
		wantToken int
	}{
		{"gpt-test|default|33", "gpt-test", "default", 33},
		{"gpt-test|default|0", "gpt-test", "default", 0},
		{"vendor|model|with|bars|vip|7", "vendor|model|with|bars", "vip", 7},
		{"gpt-test|", "gpt-test", "", 0},
	}
	for _, tc := range cases {
		modelName, group, tokenId := splitModelGroupToken(tc.triple)
		assert.Equal(t, tc.wantModel, modelName, tc.triple)
		assert.Equal(t, tc.wantGroup, group, tc.triple)
		assert.Equal(t, tc.wantToken, tokenId, tc.triple)
	}
}

func TestOutputTokensPerSecond(t *testing.T) {
	t.Run("missing info or tokens yields zero", func(t *testing.T) {
		assert.Equal(t, 0.0, OutputTokensPerSecond(nil, 100))
		assert.Equal(t, 0.0, OutputTokensPerSecond(&relaycommon.RelayInfo{}, 100))
		assert.Equal(t, 0.0, OutputTokensPerSecond(&relaycommon.RelayInfo{StartTime: time.Now()}, 0))
	})

	t.Run("non-stream divides by the full latency", func(t *testing.T) {
		// 2s 总耗时、200 输出 tokens => 约 100 t/s
		info := &relaycommon.RelayInfo{StartTime: time.Now().Add(-2 * time.Second)}
		assert.InDelta(t, 100, OutputTokensPerSecond(info, 200), 5)
	})

	t.Run("stream excludes the time to first token", func(t *testing.T) {
		// 总耗时 3s，其中首字用掉 2s => 生成阶段约 1s，200 tokens => 约 200 t/s
		start := time.Now().Add(-3 * time.Second)
		info := &relaycommon.RelayInfo{
			StartTime:         start,
			IsStream:          true,
			FirstResponseTime: start.Add(2 * time.Second),
		}
		assert.InDelta(t, 200, OutputTokensPerSecond(info, 200), 15)
	})
}
