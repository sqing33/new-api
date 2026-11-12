package perfmetrics

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/glebarez/sqlite"
	"github.com/samber/lo"
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

	bucketTs := bucketStart(time.Now().Unix())
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

	bucketTs := bucketStart(time.Now().Unix())
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

func TestClassifyRelayOutcome(t *testing.T) {
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		name string
		ctx  context.Context
		err  *types.NewAPIError
		want Outcome
	}{
		{"success", context.Background(), nil, OutcomeSuccess},
		{"upstream bad request", context.Background(), types.InitOpenAIError("unknown", 400), OutcomeIgnored},
		{"upstream credentials returned as 400", context.Background(), types.InitOpenAIError("invalid_api_key", 400), OutcomeFailure},
		{"wrapped credentials keep their cause", context.Background(), types.NewErrorWithStatusCode(types.InitOpenAIError("invalid_api_key", 400), types.ErrorCodeInvalidRequest, 400), OutcomeFailure},
		{"upstream context limit returned as 500", context.Background(), types.InitOpenAIError("context_length_exceeded", 500), OutcomeIgnored},
		{"local rate limit", context.Background(), types.NewErrorWithStatusCode(errors.New("limited"), types.ErrorCodeInvalidRequest, 429), OutcomeIgnored},
		{"upstream rate limit", context.Background(), types.InitOpenAIError("rate_limit_exceeded", 429), OutcomeFailure},
		{"local quota", context.Background(), types.NewError(errors.New("quota"), types.ErrorCodeInsufficientUserQuota), OutcomeIgnored},
		{"local violation fee", context.Background(), types.NewError(errors.New("csam"), types.ErrorCodeViolationFeeGrokCSAM), OutcomeIgnored},
		{"upstream quota", context.Background(), types.InitOpenAIError("insufficient_quota", 429), OutcomeFailure},
		{"upstream gateway quota", context.Background(), types.InitOpenAIError(types.ErrorCodeInsufficientUserQuota, 403), OutcomeFailure},
		{"unavailable channel", context.Background(), types.NewErrorWithStatusCode(errors.New("disabled"), types.ErrorCodeGetChannelFailed, 403), OutcomeFailure},
		{"empty upstream response", context.Background(), types.NewError(errors.New("empty"), types.ErrorCodeEmptyResponse), OutcomeFailure},
		{"network failure", context.Background(), types.NewOpenAIError(errors.New("connection refused"), types.ErrorCodeDoRequestFailed, 500), OutcomeFailure},
		{"connection closed after non-stream response", canceled, nil, OutcomeSuccess},
		{"client cancellation", canceled, types.NewOpenAIError(errors.New("context canceled"), types.ErrorCodeDoRequestFailed, 500), OutcomeIgnored},
		{"upstream deadline", context.Background(), types.NewOpenAIError(context.DeadlineExceeded, types.ErrorCodeDoRequestFailed, 504), OutcomeFailure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, ClassifyRelayOutcome(tc.ctx, &relaycommon.RelayInfo{}, tc.err))
		})
	}
	assert.Equal(t, OutcomeIgnored, ClassifyRelayOutcome(context.Background(), &relaycommon.RelayInfo{PerformanceBusinessRejection: true}, nil))
}

func TestStreamOutcomeClassification(t *testing.T) {
	for _, tc := range []struct {
		name string
		mark func(*relaycommon.StreamStatus)
		end  relaycommon.StreamEndReason
		want Outcome
	}{
		{"completed", (*relaycommon.StreamStatus).MarkCompleted, relaycommon.StreamEndReasonEOF, OutcomeSuccess},
		{"business rejection", func(s *relaycommon.StreamStatus) { s.MarkFailed("context_length_exceeded", "", 0) }, relaycommon.StreamEndReasonEOF, OutcomeIgnored},
		{"service error", func(s *relaycommon.StreamStatus) { s.MarkFailed("server_error", "", 0) }, relaycommon.StreamEndReasonEOF, OutcomeFailure},
		{"error after completion", func(s *relaycommon.StreamStatus) { s.MarkCompleted(); s.MarkFailed("", "server_error", 0) }, relaycommon.StreamEndReasonEOF, OutcomeFailure},
		{"output limit", func(s *relaycommon.StreamStatus) { s.MarkIncomplete("max_output_tokens") }, relaycommon.StreamEndReasonEOF, OutcomeSuccess},
		{"content filter", func(s *relaycommon.StreamStatus) { s.MarkIncomplete("content_filter") }, relaycommon.StreamEndReasonEOF, OutcomeIgnored},
		{"client cancel", (*relaycommon.StreamStatus).MarkCancelled, relaycommon.StreamEndReasonEOF, OutcomeIgnored},
		{"client gone", nil, relaycommon.StreamEndReasonClientGone, OutcomeIgnored},
		{"timeout", nil, relaycommon.StreamEndReasonTimeout, OutcomeFailure},
		{"missing terminal", nil, relaycommon.StreamEndReasonEOF, OutcomeFailure},
		{"done marker without terminal", nil, relaycommon.StreamEndReasonDone, OutcomeSuccess},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stream := relaycommon.NewStreamStatus()
			stream.RequireTerminal()
			if tc.mark != nil {
				tc.mark(stream)
			}
			stream.SetEndReason(tc.end, nil)
			assert.Equal(t, tc.want, ClassifyRelayOutcome(context.Background(), &relaycommon.RelayInfo{StreamStatus: stream}, nil))
		})
	}
}

func TestClientCancellationDuringUpstreamRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stream := relaycommon.NewStreamStatus()
	stream.RequireTerminal()
	stream.SetEndReason(relaycommon.StreamEndReasonScannerErr, errors.New("reader closed"))
	assert.Equal(t, OutcomeIgnored, ClassifyRelayOutcome(ctx, &relaycommon.RelayInfo{StreamStatus: stream}, nil))

	deadline := relaycommon.NewStreamStatus()
	deadline.SetEndReason(relaycommon.StreamEndReasonClientGone, context.DeadlineExceeded)
	assert.Equal(t, OutcomeFailure, ClassifyRelayOutcome(context.Background(), &relaycommon.RelayInfo{StreamStatus: deadline}, nil))
}

func TestPerformanceWindowIncludesCurrentHour(t *testing.T) {
	now := time.Date(2026, 9, 14, 12, 37, 0, 0, time.UTC)
	start, end := queryWindow(now, 24)
	assert.Equal(t, time.Date(2026, 9, 13, 13, 0, 0, 0, time.UTC).Unix(), start)
	assert.Equal(t, now.Unix(), end)
}

func TestHourlySuccessSeriesWeightsSmallerBuckets(t *testing.T) {
	points := recentSuccessSeries(map[int64]counters{
		3600: {requestCount: 100, successCount: 100},
		3900: {requestCount: 1},
		7200: {requestCount: 1, successCount: 1},
	})
	assert.Equal(t, []SuccessRatePoint{{Ts: 3600, SuccessRate: 99.01}, {Ts: 7200, SuccessRate: 100}}, points)
}

func TestRecentHistoryRejectsOversizedModelLists(t *testing.T) {
	_, err := QuerySummaryAll(24, nil, make([]string, 51)...)
	require.EqualError(t, err, "Invalid parameters")
}

// Terminal task sampling: success/failure counts, end-to-end latency, and
// token throughput only for successful tasks that report tokens.
func TestRecordTaskResultSamplesTerminalTasks(t *testing.T) {
	hotBuckets.Clear()
	t.Cleanup(func() { hotBuckets.Clear() })
	now := time.Now().Unix()
	RecordTaskResult(&model.Task{
		Status:     model.TaskStatusSuccess,
		Group:      "a",
		SubmitTime: now - 120,
		StartTime:  now - 100,
		FinishTime: now,
		Properties: model.Properties{OriginModelName: "video-model"},
	}, &relaycommon.TaskInfo{TotalTokens: 5000})
	RecordTaskResult(&model.Task{
		Status:     model.TaskStatusFailure,
		Group:      "a",
		SubmitTime: now - 60,
		FinishTime: now,
		Properties: model.Properties{OriginModelName: "video-model"},
	}, relaycommon.FailTaskInfo("boom"))
	RecordTaskResult(&model.Task{Status: model.TaskStatusSuccess, FinishTime: now}, nil)

	assert.Equal(t, map[bucketKey]counters{
		{model: "video-model", group: "a", channel: UnknownChannelName}: {
			requestCount:   2,
			successCount:   1,
			totalLatencyMs: 180000,
			outputTokens:   5000,
			generationMs:   100000,
		},
	}, mergedHotBuckets())
}

// Immediate submit results: only successes are sampled, timed from relay start.
func TestRecordImmediateTaskResultSamplesSuccessOnly(t *testing.T) {
	hotBuckets.Clear()
	t.Cleanup(func() { hotBuckets.Clear() })
	info := &relaycommon.RelayInfo{OriginModelName: "image-model", UsingGroup: "a", StartTime: time.Now().Add(-2 * time.Second)}
	RecordImmediateTaskResult(info, &relaycommon.TaskInfo{Status: model.TaskStatusSuccess, TotalTokens: 4096})
	RecordImmediateTaskResult(info, relaycommon.FailTaskInfo("boom"))
	RecordImmediateTaskResult(info, &relaycommon.TaskInfo{Status: model.TaskStatusInProgress})
	RecordImmediateTaskResult(info, nil)

	merged := mergedHotBuckets()
	require.Len(t, merged, 1)
	got := merged[bucketKey{model: "image-model", group: "a", channel: UnknownChannelName}]
	assert.GreaterOrEqual(t, got.totalLatencyMs, int64(2000))
	assert.Equal(t, counters{
		requestCount:   1,
		successCount:   1,
		totalLatencyMs: got.totalLatencyMs,
		outputTokens:   4096,
		generationMs:   got.totalLatencyMs,
	}, got)
}

func mergedHotBuckets() map[bucketKey]counters {
	merged := map[bucketKey]counters{}
	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		k.bucketTs = 0
		mergeCounters(merged, k, value.(*atomicBucket).snapshot())
		return true
	})
	return merged
}

// TEST_PERF_MYSQL_DSN / TEST_PERF_POSTGRES_DSN optionally run the aggregation
// against isolated real MySQL/PostgreSQL databases.
func TestPerformanceAggregationAndFlush(t *testing.T) {
	for _, dialect := range []struct{ name, env string }{
		{"sqlite", ""}, {"mysql", "TEST_PERF_MYSQL_DSN"}, {"postgres", "TEST_PERF_POSTGRES_DSN"},
	} {
		t.Run(dialect.name, func(t *testing.T) {
			dsn := ""
			if dialect.env != "" {
				dsn = os.Getenv(dialect.env)
				if dsn == "" {
					t.Skip("isolated test database DSN is not configured")
				}
			}
			t.Setenv("SQL_DSN", dsn)
			oldDB, oldPath, oldMaster, oldRedis := model.DB, common.SQLitePath, common.IsMasterNode, common.RedisEnabled
			oldType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
			common.SQLitePath, common.IsMasterNode, common.RedisEnabled = filepath.Join(t.TempDir(), "perf.db"), false, false
			hotBuckets.Clear()
			t.Cleanup(func() {
				model.DB, common.SQLitePath, common.IsMasterNode, common.RedisEnabled = oldDB, oldPath, oldMaster, oldRedis
				common.SetDatabaseTypes(oldType, oldLogType)
				hotBuckets.Clear()
			})
			require.NoError(t, model.InitDB())
			db := model.DB
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			require.NoError(t, db.Migrator().DropTable(&model.PerfMetric{}))
			require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
			versionQuery := "SELECT version()"
			if dialect.name == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)

			now := time.Now()
			start, _ := queryWindow(now, 24)
			hour := now.Unix() - now.Unix()%3600 - 3600
			// Historical counters remain usable without reclassification or migration.
			for _, row := range []model.PerfMetric{
				{ModelName: "test-model", Group: "a", BucketTs: hour, RequestCount: 100, SuccessCount: 100, TotalLatencyMs: 100000, TtftCount: 100, TtftSumMs: 10000, OutputTokens: 200, GenerationMs: 40000},
				{ModelName: "test-model", Group: "inactive", BucketTs: hour, RequestCount: 100},
				{ModelName: "test-model", Group: "a", BucketTs: start - 3600, RequestCount: 100},
			} {
				require.NoError(t, model.UpsertPerfMetric(&row))
			}
			groups := []string{"a", "b"}

			RecordRelayResult(context.Background(), &relaycommon.RelayInfo{OriginModelName: "test-model", UsingGroup: "b", StartTime: now}, types.InitOpenAIError("unknown", 400))
			businessRejected, err := QuerySummaryAll(24, groups)
			require.NoError(t, err)
			require.NotNil(t, businessRejected.Summary)
			assert.Equal(t, 100.0, businessRejected.Summary.SuccessRate)

			failure := &atomicBucket{}
			failure.add(Sample{LatencyMs: 2000})
			hotBuckets.Store(bucketKey{model: "test-model", group: "b", bucketTs: hour}, failure)
			before, err := Query(QueryParams{Model: "test-model", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			require.NotNil(t, before.Summary)
			assert.Equal(t, Summary{SuccessRate: 99.01, AvgLatencyMs: 1009, AvgTps: 5}, *before.Summary)
			assert.Equal(t, start, before.WindowStart)
			require.Len(t, before.Series, 1)
			assert.Equal(t, hour, before.Series[0].Ts)
			assert.InDelta(t, 99.01, before.Series[0].SuccessRate, 0.01)
			require.Len(t, before.Groups, 2)

			summary, err := QuerySummaryAll(24, groups)
			require.NoError(t, err)
			assert.Equal(t, before.Summary, summary.Summary)
			require.Len(t, summary.Models, 1)
			assert.Equal(t, 99.01, summary.Models[0].SuccessRate)
			assert.Equal(t, 99.01, summary.Models[0].RecentSuccessSeries[0].SuccessRate)
			encoded, err := common.Marshal(summary)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "request_count")
			assert.NotContains(t, string(encoded), "success_count")

			flushCompletedBuckets()
			flushCompletedBuckets()
			after, err := Query(QueryParams{Model: "test-model", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			assert.Equal(t, before.Summary, after.Summary)
			assert.Equal(t, before.Series, after.Series)

			RecordRelayResult(context.Background(), &relaycommon.RelayInfo{OriginModelName: "test-model", UsingGroup: "a", StartTime: now}, types.InitOpenAIError("context_length_exceeded", 400))
			after, err = Query(QueryParams{Model: "test-model", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			assert.Equal(t, before.Summary, after.Summary)
			onlyA, err := Query(QueryParams{Model: "test-model", Group: "a", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			assert.Equal(t, 100.0, onlyA.Summary.SuccessRate)
			empty, err := Query(QueryParams{Model: "missing", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			assert.Nil(t, empty.Summary)
			assert.Empty(t, empty.Series)

			require.NoError(t, model.UpsertPerfMetric(&model.PerfMetric{ModelName: "second-model", Group: "a", BucketTs: hour, RequestCount: 1}))
			combined, err := QuerySummaryAll(24, groups)
			require.NoError(t, err)
			assert.Equal(t, 98.04, combined.Summary.SuccessRate)
			assert.Equal(t, 99.01, combined.Models[0].SuccessRate)

			t.Run("recent models are summarized over their status sample hours", func(t *testing.T) {
				for i := range 26 {
					require.NoError(t, model.UpsertPerfMetric(&model.PerfMetric{
						ModelName: "history-model", Group: "a", BucketTs: hour - int64(i+1)*6*3600,
						RequestCount: 1, SuccessCount: 1,
					}))
				}
				for _, row := range []model.PerfMetric{
					{ModelName: "history-model", Group: "a", BucketTs: hour + 60, RequestCount: 100, SuccessCount: 100},
					{ModelName: "history-model", Group: "inactive", BucketTs: hour + 120, RequestCount: 100},
					{ModelName: "history-model", Group: "a", BucketTs: hour + 2*3600, RequestCount: 1},
					{ModelName: "history-idle", Group: "a", BucketTs: hour - 3*24*3600, RequestCount: 1},
					{ModelName: "history-hidden", Group: "inactive", BucketTs: hour - 3*24*3600, RequestCount: 1},
				} {
					require.NoError(t, model.UpsertPerfMetric(&row))
				}
				require.NoError(t, db.Create(&model.PerfMetric{ModelName: "history-model", Group: "a", BucketTs: hour - 3600}).Error)
				hotFailure := &atomicBucket{}
				hotFailure.add(Sample{})
				hotBuckets.Store(bucketKey{model: "history-model", group: "b", bucketTs: hour + 120}, hotFailure)
				hotSuccess := &atomicBucket{}
				hotSuccess.add(Sample{Success: true})
				hotBuckets.Store(bucketKey{model: "history-hot", group: "a", bucketTs: hour}, hotSuccess)
				hiddenFailure := &atomicBucket{}
				hiddenFailure.add(Sample{})
				hotBuckets.Store(bucketKey{model: "history-hidden", group: "inactive", bucketTs: hour}, hiddenFailure)

				window, err := QuerySummaryAll(24, groups)
				require.NoError(t, err)
				history, err := QuerySummaryAll(24, groups, "history-model", "history-idle", "history-hidden", "history-hot", "missing")
				require.NoError(t, err)
				assert.Equal(t, window.WindowStart, history.WindowStart)
				summaries := lo.KeyBy(history.Models, func(m ModelSummary) string { return m.ModelName })
				assert.Equal(t, int64(124), summaries["history-model"].RequestCount)
				assert.Equal(t, 99.19, summaries["history-model"].SuccessRate)
				assert.Equal(t, int64(1), summaries["history-idle"].RequestCount)
				assert.Equal(t, 0.0, summaries["history-idle"].SuccessRate)
				assert.NotContains(t, summaries, "history-hidden")
				points := history.RecentSuccessSeries["history-model"]
				require.Len(t, points, 24)
				expected := make([]SuccessRatePoint, 0, 24)
				for i := 23; i > 0; i-- {
					expected = append(expected, SuccessRatePoint{Ts: hour - int64(i)*6*3600, SuccessRate: 100})
				}
				expected = append(expected, SuccessRatePoint{Ts: hour, SuccessRate: 99.01})
				assert.Equal(t, expected, points)
				assert.Equal(t, []SuccessRatePoint{{Ts: hour - 3*24*3600, SuccessRate: 0}}, history.RecentSuccessSeries["history-idle"])
				assert.Equal(t, []SuccessRatePoint{{Ts: hour, SuccessRate: 100}}, history.RecentSuccessSeries["history-hot"])
				assert.Empty(t, history.RecentSuccessSeries["history-hidden"])
				assert.Empty(t, history.RecentSuccessSeries["missing"])

				denied, err := QuerySummaryAll(24, []string{}, "history-model", "history-hidden")
				require.NoError(t, err)
				assert.Empty(t, denied.RecentSuccessSeries)
				flushCompletedBuckets()
				persisted, err := QuerySummaryAll(24, groups, "history-model", "history-hot")
				require.NoError(t, err)
				assert.Equal(t, points, persisted.RecentSuccessSeries["history-model"])
				assert.Equal(t, history.RecentSuccessSeries["history-hot"], persisted.RecentSuccessSeries["history-hot"])
			})

			t.Run("recent history stops at the 7 day boundary even with fewer than 24 samples", func(t *testing.T) {
				historyStart, _ := queryWindow(now, 7*24)
				for _, row := range []model.PerfMetric{
					{ModelName: "history-boundary", Group: "a", BucketTs: historyStart, RequestCount: 1, SuccessCount: 1},
					{ModelName: "history-boundary", Group: "a", BucketTs: historyStart - 3600, RequestCount: 1},
					{ModelName: "history-expired", Group: "a", BucketTs: historyStart - 3600, RequestCount: 1},
				} {
					require.NoError(t, model.UpsertPerfMetric(&row))
				}
				hotExpired := &atomicBucket{}
				hotExpired.add(Sample{Success: true})
				hotBuckets.Store(bucketKey{model: "history-hot-expired", group: "a", bucketTs: historyStart - 3600}, hotExpired)
				hotBoundary := &atomicBucket{}
				hotBoundary.add(Sample{Success: true})
				hotBuckets.Store(bucketKey{model: "history-hot-boundary", group: "a", bucketTs: historyStart}, hotBoundary)

				history, err := QuerySummaryAll(24, groups, "history-boundary", "history-expired", "history-hot-expired", "history-hot-boundary")
				require.NoError(t, err)
				assert.Equal(t, []SuccessRatePoint{{Ts: historyStart, SuccessRate: 100}}, history.RecentSuccessSeries["history-boundary"])
				assert.Equal(t, []SuccessRatePoint{{Ts: historyStart, SuccessRate: 100}}, history.RecentSuccessSeries["history-hot-boundary"])
				assert.Empty(t, history.RecentSuccessSeries["history-expired"])
				assert.Empty(t, history.RecentSuccessSeries["history-hot-expired"])
			})
		})
	}
}
