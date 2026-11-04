package perfmetrics

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
)

var hotBuckets sync.Map

// seriesSchema is a stable client cache/schema marker. Do not change it when
// hiding fields or making response-only privacy hardening changes.
const seriesSchema = "dbcd0a3c01b55203"

// tokenKeySeparator 分隔令牌聚合键里的 id 与名称。令牌名可能为空或含任意字符，
// 用不可能出现在名称里的控制字符做分隔，输出时再按第一个分隔符切回两个字段。
const tokenKeySeparator = "\x00"

func splitTokenKey(key string) (int, string) {
	idText, name, _ := strings.Cut(key, tokenKeySeparator)
	id, _ := strconv.Atoi(idText)
	return id, name
}

func Init() {
	go flushLoop()
}

// generationDuration is the generation phase duration in milliseconds. Streamed
// responses exclude the time to first token; other requests use the full
// latency. A non-positive streamed result falls back to the full latency so a
// stalled or inverted clock cannot produce a negative duration.
func generationDuration(info *relaycommon.RelayInfo, now time.Time) int64 {
	latencyMs := now.Sub(info.StartTime).Milliseconds()
	if info.IsStream && info.HasSendResponse() {
		if generationMs := now.Sub(info.FirstResponseTime).Milliseconds(); generationMs > 0 {
			return generationMs
		}
	}
	return latencyMs
}

// OutputTokensPerSecond returns a single request's generation throughput using
// the same definition as the aggregated performance metrics, so a per-request
// usage log shows the same figure as the dashboard throughput column.
func OutputTokensPerSecond(info *relaycommon.RelayInfo, outputTokens int64) float64 {
	if info == nil || outputTokens <= 0 || info.StartTime.IsZero() {
		return 0
	}
	generationMs := generationDuration(info, time.Now())
	if generationMs <= 0 {
		return 0
	}
	return float64(outputTokens) / (float64(generationMs) / 1000)
}

func RecordRelaySample(info *relaycommon.RelayInfo, success bool, outputTokens int64) {
	if info == nil {
		return
	}
	now := time.Now()
	hasTtft := info.IsStream && info.HasSendResponse()
	ttftMs := int64(0)
	if hasTtft {
		ttftMs = info.FirstResponseTime.Sub(info.StartTime).Milliseconds()
	}
	channelName := ""
	if info.ChannelMeta != nil {
		channelName = info.ChannelMeta.ChannelName
	}
	Record(Sample{
		Model:        info.OriginModelName,
		Group:        info.UsingGroup,
		ChannelName:  channelName,
		TokenId:      info.TokenId,
		TokenName:    info.TokenName,
		LatencyMs:    now.Sub(info.StartTime).Milliseconds(),
		TtftMs:       ttftMs,
		HasTtft:      hasTtft,
		Success:      success,
		OutputTokens: outputTokens,
		GenerationMs: generationDuration(info, now),
	})
}

func Record(sample Sample) {
	setting := perf_metrics_setting.GetSetting()
	if !setting.Enabled || sample.Model == "" {
		return
	}
	if sample.Group == "" {
		sample.Group = "default"
	}
	if sample.ChannelName == "" {
		sample.ChannelName = UnknownChannelName
	}
	if sample.LatencyMs < 0 {
		sample.LatencyMs = 0
	}

	key := bucketKey{
		model:     sample.Model,
		group:     sample.Group,
		channel:   sample.ChannelName,
		tokenId:   sample.TokenId,
		tokenName: sample.TokenName,
		bucketTs:  bucketStart(time.Now().Unix()),
	}
	actual, _ := hotBuckets.LoadOrStore(key, &atomicBucket{})
	actual.(*atomicBucket).add(sample)
	recordRedis(key, sample)
}

func Query(params QueryParams) (QueryResult, error) {
	if params.Hours <= 0 {
		params.Hours = 24
	}
	if params.Hours > 24*30 {
		params.Hours = 24 * 30
	}
	endTs := time.Now().Unix()
	startTs := endTs - int64(params.Hours)*3600

	merged := map[bucketKey]counters{}
	rows, err := model.GetPerfMetrics(params.Model, params.Group, startTs, endTs)
	if err != nil {
		return QueryResult{}, err
	}
	for _, row := range rows {
		channel := row.ChannelName
		if channel == "" {
			channel = UnknownChannelName
		}
		mergeCounters(merged, bucketKey{
			model:     row.ModelName,
			group:     row.Group,
			channel:   channel,
			tokenId:   row.TokenId,
			tokenName: row.TokenName,
			bucketTs:  row.BucketTs,
		}, counters{
			requestCount:   row.RequestCount,
			successCount:   row.SuccessCount,
			totalLatencyMs: row.TotalLatencyMs,
			ttftSumMs:      row.TtftSumMs,
			ttftCount:      row.TtftCount,
			outputTokens:   row.OutputTokens,
			generationMs:   row.GenerationMs,
		})
	}

	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		if k.model != params.Model || k.bucketTs < startTs || k.bucketTs > endTs {
			return true
		}
		if params.Group != "" && k.group != params.Group {
			return true
		}
		mergeCounters(merged, k, value.(*atomicBucket).snapshot())
		return true
	})

	result := buildQueryResult(params.Model, merged)
	attachConcurrencyToResult(&result, startTs, endTs)
	return result, nil
}

// concurrencyAgg 汇总一个维度（分组或渠道）在单个时间桶上的并发采样。
type concurrencyAgg struct {
	max int
	sum int
	cnt int
}

func addConcurrencyAgg(target map[string]map[int64]*concurrencyAgg, name string, ts int64, row model.PerfConcurrency) {
	buckets, ok := target[name]
	if !ok {
		buckets = map[int64]*concurrencyAgg{}
		target[name] = buckets
	}
	item, ok := buckets[ts]
	if !ok {
		item = &concurrencyAgg{}
		buckets[ts] = item
	}
	if row.MaxConcurrency > item.max {
		item.max = row.MaxConcurrency
	}
	item.sum += row.SumConcurrency
	item.cnt += row.SampleCount
}

// addTokenConcurrencyAgg 汇总单个令牌在某个时间桶上的并发采样。
// 令牌粒度的行按渠道分别落库，读取时要求「该令牌的总并发」，
// 所以峰值取各渠道峰值之和（同一时刻不同渠道各自有峰值）。
func addTokenConcurrencyAgg(target map[int]map[int64]*concurrencyAgg, tokenId int, ts int64, row model.PerfConcurrency) {
	buckets, ok := target[tokenId]
	if !ok {
		buckets = map[int64]*concurrencyAgg{}
		target[tokenId] = buckets
	}
	item, ok := buckets[ts]
	if !ok {
		item = &concurrencyAgg{}
		buckets[ts] = item
	}
	item.max += row.MaxConcurrency
	item.sum += row.SumConcurrency
	item.cnt += row.SampleCount
}

// concurrencyStats 从聚合结果算出峰值与均值。
func concurrencyStats(buckets map[int64]*concurrencyAgg) (int, float64) {
	if len(buckets) == 0 {
		return 0, 0
	}
	maxValue, sumValue, countValue := 0, 0, 0
	for _, item := range buckets {
		if item.max > maxValue {
			maxValue = item.max
		}
		sumValue += item.sum
		countValue += item.cnt
	}
	avgValue := float64(maxValue)
	if countValue > 0 {
		avgValue = float64(sumValue) / float64(countValue)
	}
	return maxValue, avgValue
}

// applyConcurrencySeries 把并发采样对齐到已有的 series 时间轴上。
// series 来自请求聚合，并发采样可能缺桶（该桶没有进行中的请求），缺桶补 0。
func applyConcurrencySeries(series []BucketPoint, buckets map[int64]*concurrencyAgg) {
	for i := range series {
		item, ok := buckets[series[i].Ts]
		if !ok {
			continue
		}
		series[i].MaxConcurrency = item.max
		if item.cnt > 0 {
			series[i].AvgConcurrency = float64(item.sum) / float64(item.cnt)
		} else {
			series[i].AvgConcurrency = float64(item.max)
		}
	}
}

// attachConcurrencyToResult 把并发采样按分组/渠道/令牌注入查询结果。
// 并发数据存在独立的 perf_concurrency 表里，与请求聚合的 merged 无关，
// 因此单独映射一遍，避免改动 buildQueryResult 的聚合路径。
//
// 该表同时存两种粒度：channel_name 非空的是渠道行，token_id > 0 的是令牌行。
// 令牌行跨渠道求和后写入 Tokens，渠道行写入 Groups/Channels，互不干扰。
func attachConcurrencyToResult(result *QueryResult, startTs int64, endTs int64) {
	rows, err := model.GetPerfConcurrencies(result.ModelName, "", startTs, endTs)
	if err != nil || len(rows) == 0 {
		return
	}

	byGroup := map[string]map[int64]*concurrencyAgg{}
	byChannel := map[string]map[int64]*concurrencyAgg{}
	byToken := map[int]map[int64]*concurrencyAgg{}
	for _, row := range rows {
		if row.TokenId > 0 {
			addTokenConcurrencyAgg(byToken, row.TokenId, row.BucketTs, row)
			continue
		}
		channel := row.ChannelName
		if channel == "" {
			channel = UnknownChannelName
		}
		addConcurrencyAgg(byGroup, row.Group, row.BucketTs, row)
		addConcurrencyAgg(byChannel, channel, row.BucketTs, row)
	}

	for i := range result.Groups {
		buckets := byGroup[result.Groups[i].Group]
		result.Groups[i].MaxConcurrency, result.Groups[i].AvgConcurrency = concurrencyStats(buckets)
		applyConcurrencySeries(result.Groups[i].Series, buckets)
	}
	for i := range result.Channels {
		buckets := byChannel[result.Channels[i].Channel]
		result.Channels[i].MaxConcurrency, result.Channels[i].AvgConcurrency = concurrencyStats(buckets)
		applyConcurrencySeries(result.Channels[i].Series, buckets)
	}
	for i := range result.Tokens {
		buckets := byToken[result.Tokens[i].TokenId]
		result.Tokens[i].MaxConcurrency, result.Tokens[i].AvgConcurrency = concurrencyStats(buckets)
		applyConcurrencySeries(result.Tokens[i].Series, buckets)
	}
}

func QuerySummaryAll(hours int, groups []string) (SummaryAllResult, error) {
	if hours <= 0 {
		hours = 24
	}
	if hours > 24*30 {
		hours = 24 * 30
	}
	endTs := time.Now().Unix()
	startTs := endTs - int64(hours)*3600
	allowedGroups := allowedGroupSet(groups)

	rows, err := model.GetPerfMetricsSummaryBucketsAll(startTs, endTs, groups)
	if err != nil {
		return SummaryAllResult{}, err
	}

	totals := map[string]counters{}
	modelBuckets := map[string]map[int64]counters{}
	for _, row := range rows {
		value := counters{
			requestCount:   row.RequestCount,
			successCount:   row.SuccessCount,
			totalLatencyMs: row.TotalLatencyMs,
			outputTokens:   row.OutputTokens,
			generationMs:   row.GenerationMs,
		}
		mergeModelTotals(totals, row.ModelName, value)
		mergeNamedBucket(modelBuckets, row.ModelName, row.BucketTs, value)
	}

	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		if k.bucketTs < startTs || k.bucketTs > endTs {
			return true
		}
		if allowedGroups != nil {
			if _, ok := allowedGroups[k.group]; !ok {
				return true
			}
		}
		snap := value.(*atomicBucket).snapshot()
		if snap.requestCount == 0 {
			return true
		}
		mergeModelTotals(totals, k.model, snap)
		mergeNamedBucket(modelBuckets, k.model, k.bucketTs, snap)
		return true
	})

	models := make([]ModelSummary, 0, len(totals))
	for name, total := range totals {
		if total.requestCount == 0 {
			continue
		}
		avgLatency := total.totalLatencyMs / total.requestCount
		successRate := float64(total.successCount) / float64(total.requestCount) * 100
		avgTps := 0.0
		if total.generationMs > 0 {
			avgTps = float64(total.outputTokens) / (float64(total.generationMs) / 1000.0)
		}
		concurrencySeries := concurrencySeriesForModel(name, startTs, endTs)
		maxConcurrency, avgConcurrency := 0, 0.0
		for _, point := range concurrencySeries {
			if point.MaxConcurrency > maxConcurrency {
				maxConcurrency = point.MaxConcurrency
			}
			avgConcurrency += point.AvgConcurrency
		}
		if len(concurrencySeries) > 0 {
			avgConcurrency /= float64(len(concurrencySeries))
		}
		models = append(models, ModelSummary{
			ModelName:               name,
			AvgLatencyMs:            avgLatency,
			SuccessRate:             math.Round(successRate*100) / 100,
			AvgTps:                  math.Round(avgTps*100) / 100,
			RecentSuccessSeries:     recentSuccessSeries(modelBuckets[name]),
			RecentConcurrencySeries: concurrencySeries,
			MaxConcurrency:          maxConcurrency,
			AvgConcurrency:          avgConcurrency,
			RequestCount:            total.requestCount,
		})
	}
	sort.Slice(models, func(i, j int) bool {
		return models[i].RequestCount > models[j].RequestCount
	})

	return SummaryAllResult{Models: models}, nil
}

func mergeModelTotals(totals map[string]counters, modelName string, value counters) {
	if value.requestCount == 0 {
		return
	}
	current := totals[modelName]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.totalLatencyMs += value.totalLatencyMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	totals[modelName] = current
}

func mergeNamedBucket(namedBuckets map[string]map[int64]counters, name string, bucketTs int64, value counters) {
	if value.requestCount == 0 {
		return
	}
	if _, ok := namedBuckets[name]; !ok {
		namedBuckets[name] = map[int64]counters{}
	}
	current := namedBuckets[name][bucketTs]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.totalLatencyMs += value.totalLatencyMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	namedBuckets[name][bucketTs] = current
}

func recentSuccessSeries(buckets map[int64]counters) []SuccessRatePoint {
	if len(buckets) == 0 {
		return nil
	}
	hourly := map[int64]counters{}
	for ts, value := range buckets {
		hourTs := ts - ts%3600
		merged := hourly[hourTs]
		merged.requestCount += value.requestCount
		merged.successCount += value.successCount
		hourly[hourTs] = merged
	}
	timestamps := make([]int64, 0, len(hourly))
	for hourTs, value := range hourly {
		if value.requestCount == 0 {
			continue
		}
		timestamps = append(timestamps, hourTs)
	}
	if len(timestamps) == 0 {
		return nil
	}
	sort.Slice(timestamps, func(i, j int) bool {
		return timestamps[i] < timestamps[j]
	})
	points := make([]SuccessRatePoint, 0, len(timestamps))
	for _, hourTs := range timestamps {
		points = append(points, SuccessRatePoint{
			Ts:          hourTs,
			SuccessRate: math.Round(successRate(hourly[hourTs])*100) / 100,
		})
	}
	return points
}

func allowedGroupSet(groups []string) map[string]struct{} {
	if groups == nil {
		return nil
	}
	allowed := make(map[string]struct{}, len(groups))
	for _, group := range groups {
		allowed[group] = struct{}{}
	}
	return allowed
}

func bucketStart(ts int64) int64 {
	bucketSeconds := perf_metrics_setting.GetBucketSeconds()
	if bucketSeconds <= 0 {
		bucketSeconds = 3600
	}
	return ts - (ts % bucketSeconds)
}

func mergeCounters(merged map[bucketKey]counters, key bucketKey, value counters) {
	if value.requestCount == 0 {
		return
	}
	current := merged[key]
	current.requestCount += value.requestCount
	current.successCount += value.successCount
	current.totalLatencyMs += value.totalLatencyMs
	current.ttftSumMs += value.ttftSumMs
	current.ttftCount += value.ttftCount
	current.outputTokens += value.outputTokens
	current.generationMs += value.generationMs
	merged[key] = current
}

func buildQueryResult(modelName string, merged map[bucketKey]counters) QueryResult {
	groupBuckets := map[string]map[int64]counters{}
	channelBuckets := map[string]map[int64]counters{}
	tokenBuckets := map[string]map[int64]counters{}
	for key, value := range merged {
		if value.requestCount == 0 {
			continue
		}
		if _, ok := groupBuckets[key.group]; !ok {
			groupBuckets[key.group] = map[int64]counters{}
		}
		mergeNamedBucket(groupBuckets, key.group, key.bucketTs, value)
		if _, ok := channelBuckets[key.channel]; !ok {
			channelBuckets[key.channel] = map[int64]counters{}
		}
		mergeNamedBucket(channelBuckets, key.channel, key.bucketTs, value)
		// token_id 为 0 表示改动前的历史数据，统一归入「未知令牌」。
		// 令牌可能被改名，所以聚合键要带上名称，否则改名前后的行会分成两行。
		tokenKey := strconv.Itoa(key.tokenId) + tokenKeySeparator + key.tokenName
		mergeNamedBucket(tokenBuckets, tokenKey, key.bucketTs, value)
	}

	groups := make([]string, 0, len(groupBuckets))
	for group := range groupBuckets {
		groups = append(groups, group)
	}
	sort.Strings(groups)

	results := make([]GroupResult, 0, len(groups))
	for _, group := range groups {
		total, series := aggregateBuckets(groupBuckets[group])
		results = append(results, GroupResult{
			Group:        group,
			AvgTtftMs:    avg(total.ttftSumMs, total.ttftCount),
			AvgLatencyMs: avg(total.totalLatencyMs, total.requestCount),
			SuccessRate:  successRate(total),
			AvgTps:       avgTps(total),
			Series:       series,
		})
	}

	channels := make([]string, 0, len(channelBuckets))
	for channel := range channelBuckets {
		channels = append(channels, channel)
	}
	sort.Strings(channels)

	channelResults := make([]ChannelResult, 0, len(channels))
	for _, channel := range channels {
		total, series := aggregateBuckets(channelBuckets[channel])
		channelResults = append(channelResults, ChannelResult{
			Channel:      channel,
			AvgTtftMs:    avg(total.ttftSumMs, total.ttftCount),
			AvgLatencyMs: avg(total.totalLatencyMs, total.requestCount),
			SuccessRate:  successRate(total),
			AvgTps:       avgTps(total),
			Series:       series,
		})
	}

	tokenKeys := make([]string, 0, len(tokenBuckets))
	for key := range tokenBuckets {
		tokenKeys = append(tokenKeys, key)
	}
	sort.Slice(tokenKeys, func(i, j int) bool {
		idLeft, _ := splitTokenKey(tokenKeys[i])
		idRight, _ := splitTokenKey(tokenKeys[j])
		if idLeft != idRight {
			return idLeft < idRight
		}
		return tokenKeys[i] < tokenKeys[j]
	})

	tokenResults := make([]TokenResult, 0, len(tokenKeys))
	for _, key := range tokenKeys {
		total, series := aggregateBuckets(tokenBuckets[key])
		tokenId, tokenName := splitTokenKey(key)
		tokenResults = append(tokenResults, TokenResult{
			TokenId:      tokenId,
			TokenName:    tokenName,
			AvgTtftMs:    avg(total.ttftSumMs, total.ttftCount),
			AvgLatencyMs: avg(total.totalLatencyMs, total.requestCount),
			SuccessRate:  successRate(total),
			AvgTps:       avgTps(total),
			Series:       series,
		})
	}

	return QueryResult{
		ModelName:    modelName,
		SeriesSchema: seriesSchema,
		Groups:       results,
		Channels:     channelResults,
		Tokens:       tokenResults,
	}
}

func aggregateBuckets(buckets map[int64]counters) (counters, []BucketPoint) {
	timestamps := make([]int64, 0, len(buckets))
	for ts := range buckets {
		timestamps = append(timestamps, ts)
	}
	sort.Slice(timestamps, func(i, j int) bool {
		return timestamps[i] < timestamps[j]
	})

	total := counters{}
	series := make([]BucketPoint, 0, len(timestamps))
	for _, ts := range timestamps {
		value := buckets[ts]
		total.requestCount += value.requestCount
		total.successCount += value.successCount
		total.totalLatencyMs += value.totalLatencyMs
		total.ttftSumMs += value.ttftSumMs
		total.ttftCount += value.ttftCount
		total.outputTokens += value.outputTokens
		total.generationMs += value.generationMs
		series = append(series, bucketPoint(ts, value))
	}
	return total, series
}

func bucketPoint(ts int64, value counters) BucketPoint {
	return BucketPoint{
		Ts:           ts,
		AvgTtftMs:    avg(value.ttftSumMs, value.ttftCount),
		AvgLatencyMs: avg(value.totalLatencyMs, value.requestCount),
		SuccessRate:  successRate(value),
		AvgTps:       avgTps(value),
	}
}

func avg(sum int64, count int64) int64 {
	if count <= 0 {
		return 0
	}
	return sum / count
}

func successRate(value counters) float64 {
	if value.requestCount <= 0 {
		return 0
	}
	return float64(value.successCount) / float64(value.requestCount) * 100
}

func avgTps(value counters) float64 {
	if value.outputTokens <= 0 || value.generationMs <= 0 {
		return 0
	}
	return float64(value.outputTokens) / (float64(value.generationMs) / 1000)
}

func recordRedis(key bucketKey, sample Sample) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	redisKey := redisBucketKey(key)
	pipe := common.RDB.TxPipeline()
	pipe.HIncrBy(ctx, redisKey, "req", 1)
	if sample.Success {
		pipe.HIncrBy(ctx, redisKey, "ok", 1)
	}
	if sample.LatencyMs > 0 {
		pipe.HIncrBy(ctx, redisKey, "lat", sample.LatencyMs)
	}
	if sample.HasTtft && sample.TtftMs >= 0 {
		pipe.HIncrBy(ctx, redisKey, "ttft", sample.TtftMs)
		pipe.HIncrBy(ctx, redisKey, "ttft_n", 1)
	}
	if sample.OutputTokens > 0 && sample.GenerationMs > 0 {
		pipe.HIncrBy(ctx, redisKey, "out", sample.OutputTokens)
		pipe.HIncrBy(ctx, redisKey, "gen_ms", sample.GenerationMs)
	}
	pipe.Expire(ctx, redisKey, time.Hour)
	_, _ = pipe.Exec(ctx)
}

func redisBucketKey(key bucketKey) string {
	return fmt.Sprintf("perf:%s:%s:%s:%d", key.model, key.group, key.channel, key.bucketTs)
}
