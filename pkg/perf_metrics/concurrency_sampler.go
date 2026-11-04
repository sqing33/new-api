package perfmetrics

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/concurrency"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
)

// 并发采样与请求完成后的指标聚合是两件事：RecordRelaySample 在请求结束时
// 触发，而并发是「进行中」的量，只能靠定时抓快照。这里复用 flushLoop 的
// 节奏，不额外起 goroutine，也不新增配置项。
//
// 采样链路：Redis 里当前有并发的渠道 → 每个渠道按 member 里的
// model|group|token 拆分 → 跨渠道按 (model, group, token) 求和（同一令牌可能
// 同时跑在多个渠道上）→ 累加进内存桶 → 桶结束后 upsert 到 perf_concurrency
// （峰值取较大值）。

type concurrencyBucketKey struct {
	model   string
	group   string
	channel string
	tokenId int
	bucket  int64
}

type concurrencyBucket struct {
	mu    sync.Mutex
	max   int
	sum   int
	count int
}

var (
	concurrencyBuckets   sync.Map // concurrencyBucketKey -> *concurrencyBucket
	concurrencySamplerMu sync.Mutex
)

// sampleConcurrency 抓一次全局并发快照并累加到当前时间桶。
func sampleConcurrency() {
	if !perf_metrics_setting.GetSetting().Enabled {
		return
	}
	if !common.RedisEnabled || common.RDB == nil {
		return
	}

	// 串行化采样：两次采样重叠会让同一桶的峰值统计失真。
	concurrencySamplerMu.Lock()
	defer concurrencySamplerMu.Unlock()

	channelIDs, err := concurrency.LiveIDs(concurrency.DimensionChannel)
	if err != nil {
		common.SysError(fmt.Sprintf("perf concurrency: scan live channels failed: %v", err))
		return
	}
	if len(channelIDs) == 0 {
		flushCompletedConcurrencyBuckets()
		return
	}

	bucketTs := bucketStart(time.Now().Unix())
	// tokenId=0 的桶表示没有令牌维度的采样（旧数据或无令牌的请求），
	// 仍然按渠道落一份，保证渠道视图不丢数据。
	perChannel := map[concurrencyBucketKey]int{}
	perToken := map[concurrencyBucketKey]int{}
	for _, channelID := range channelIDs {
		breakdown, countErr := concurrency.CountByDimension(concurrency.DimensionChannel, channelID)
		if countErr != nil {
			common.SysError(fmt.Sprintf("perf concurrency: count channel %d failed: %v", channelID, countErr))
			continue
		}
		channelName := ""
		if ch, chErr := model.CacheGetChannel(channelID); chErr == nil && ch != nil {
			channelName = ch.Name
		}
		for triple, count := range breakdown {
			modelName, group, tokenId := splitModelGroupToken(triple)
			perChannel[concurrencyBucketKey{
				model:   modelName,
				group:   group,
				channel: channelName,
				bucket:  bucketTs,
			}] += count
			// token_id 为 0 的请求（无令牌或旧 member）不参与令牌维度聚合：
			// 它与「渠道名查不到」时的渠道桶键完全相同，混在一起会互相污染。
			if tokenId <= 0 {
				continue
			}
			perToken[concurrencyBucketKey{
				model:   modelName,
				group:   group,
				tokenId: tokenId,
				bucket:  bucketTs,
			}] += count
		}
	}
	addConcurrencySamples(perChannel)
	addConcurrencySamples(perToken)

	flushCompletedConcurrencyBuckets()
}

// addConcurrencySamples 把一次快照的计数累加进对应的内存桶。
func addConcurrencySamples(snapshot map[concurrencyBucketKey]int) {
	for key, count := range snapshot {
		value, _ := concurrencyBuckets.LoadOrStore(key, &concurrencyBucket{})
		bucket := value.(*concurrencyBucket)
		bucket.mu.Lock()
		if count > bucket.max {
			bucket.max = count
		}
		bucket.sum += count
		bucket.count++
		bucket.mu.Unlock()
	}
}

// splitModelGroupToken 还原 CountByDimension 拼出的 "model|group|tokenId" 键。
// 模型名和分组名本身可能含 '|'，所以从右往左切：最后一个 '|' 后一定是
// tokenId，倒数第二个 '|' 后一定是分组。
func splitModelGroupToken(triple string) (string, string, int) {
	groupIdx := strings.LastIndex(triple, "|")
	if groupIdx < 0 {
		return triple, "", 0
	}
	modelIdx := strings.LastIndex(triple[:groupIdx], "|")
	if modelIdx < 0 {
		return triple[:groupIdx], triple[groupIdx+1:], 0
	}
	tokenId, _ := strconv.Atoi(triple[groupIdx+1:])
	return triple[:modelIdx], triple[modelIdx+1 : groupIdx], tokenId
}

// flushCompletedConcurrencyBuckets 把已经结束的时间桶落库。
func flushCompletedConcurrencyBuckets() {
	currentBucket := bucketStart(time.Now().Unix())
	concurrencyBuckets.Range(func(key, value any) bool {
		k := key.(concurrencyBucketKey)
		if k.bucket >= currentBucket {
			return true
		}
		bucket := value.(*concurrencyBucket)
		bucket.mu.Lock()
		maxValue, sumValue, countValue := bucket.max, bucket.sum, bucket.count
		bucket.mu.Unlock()

		concurrencyBuckets.Delete(key)
		if countValue == 0 {
			return true
		}
		if err := model.UpsertPerfConcurrency(&model.PerfConcurrency{
			ModelName:      k.model,
			Group:          k.group,
			ChannelName:    k.channel,
			TokenId:        k.tokenId,
			BucketTs:       k.bucket,
			MaxConcurrency: maxValue,
			SumConcurrency: sumValue,
			SampleCount:    countValue,
		}); err != nil {
			common.SysError(fmt.Sprintf("perf concurrency: upsert failed: %v", err))
		}
		return true
	})
}

// concurrencySeriesForModel 汇总某模型在时间范围内的并发序列。
// 按渠道/分组求和，得到「该模型的总并发」曲线，与性能指标表的模型粒度一致。
//
// 只统计渠道粒度的行（token_id = 0）：同一张表里还有令牌粒度的行，
// 两者描述的是同一批在途请求，一起求和会把并发算成两倍。
func concurrencySeriesForModel(modelName string, startTs int64, endTs int64) []ConcurrencyPoint {
	rows, err := model.GetPerfConcurrencies(modelName, "", startTs, endTs)
	if err != nil {
		common.SysError(fmt.Sprintf("perf concurrency: query failed: %v", err))
		return nil
	}
	if len(rows) == 0 {
		return nil
	}

	type agg struct {
		max int
		sum int
		cnt int
	}
	byBucket := make(map[int64]*agg)
	for _, row := range rows {
		if row.TokenId > 0 {
			continue
		}
		item, ok := byBucket[row.BucketTs]
		if !ok {
			item = &agg{}
			byBucket[row.BucketTs] = item
		}
		item.max += row.MaxConcurrency
		item.sum += row.SumConcurrency
		item.cnt += row.SampleCount
	}

	timestamps := make([]int64, 0, len(byBucket))
	for ts := range byBucket {
		timestamps = append(timestamps, ts)
	}
	sort.Slice(timestamps, func(i, j int) bool { return timestamps[i] < timestamps[j] })

	series := make([]ConcurrencyPoint, 0, len(timestamps))
	for _, ts := range timestamps {
		item := byBucket[ts]
		avg := float64(item.max)
		if item.cnt > 0 {
			avg = float64(item.sum) / float64(item.cnt)
		}
		series = append(series, ConcurrencyPoint{
			Ts:             ts,
			MaxConcurrency: item.max,
			AvgConcurrency: avg,
		})
	}
	return series
}
