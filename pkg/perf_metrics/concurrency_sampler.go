package perfmetrics

import (
	"fmt"
	"sort"
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
// 采样链路：Redis 里当前有并发的渠道 → 每个渠道按 member 里的 model|group
// 拆分 → 累加进内存桶 → 桶结束后 upsert 到 perf_concurrency（峰值取较大值）。

type concurrencyBucketKey struct {
	model   string
	group   string
	channel string
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
		for pair, count := range breakdown {
			modelName, group := splitModelGroup(pair)
			key := concurrencyBucketKey{
				model:   modelName,
				group:   group,
				channel: channelName,
				bucket:  bucketTs,
			}
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

	flushCompletedConcurrencyBuckets()
}

// splitModelGroup 还原 CountByDimension 拼出的 "model|group" 键。
func splitModelGroup(pair string) (string, string) {
	for i := 0; i < len(pair); i++ {
		if pair[i] == '|' {
			return pair[:i], pair[i+1:]
		}
	}
	return pair, ""
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
