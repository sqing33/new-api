package model

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PerfConcurrency 记录按 (模型, 分组, 渠道, 时间桶) 聚合的并发采样。
//
// 它与 PerfMetric 分开存放：PerfMetric 的数值列在 upsert 时做累加，语义是
// 「请求完成后的增量聚合」，而并发采样需要保留桶内峰值，累加会算错。
type PerfConcurrency struct {
	Id             int    `json:"id" gorm:"primaryKey"`
	ModelName      string `json:"model_name" gorm:"size:128;uniqueIndex:idx_perf_conc_bucket,priority:1"`
	Group          string `json:"group" gorm:"column:group;size:64;uniqueIndex:idx_perf_conc_bucket,priority:2"`
	ChannelName    string `json:"channel_name" gorm:"column:channel_name;size:255;uniqueIndex:idx_perf_conc_bucket,priority:3"`
	BucketTs       int64  `json:"bucket_ts" gorm:"uniqueIndex:idx_perf_conc_bucket,priority:4;index:idx_perf_conc_ts"`
	MaxConcurrency int    `json:"max_concurrency" gorm:"default:0"`
	SumConcurrency int    `json:"-" gorm:"default:0"`
	SampleCount    int    `json:"-" gorm:"default:0"`
}

func (PerfConcurrency) TableName() string {
	return "perf_concurrency"
}

// AvgConcurrency 返回桶内采样均值；没有采样时回退到峰值，避免除零。
func (p PerfConcurrency) AvgConcurrency() float64 {
	if p.SampleCount <= 0 {
		return float64(p.MaxConcurrency)
	}
	return float64(p.SumConcurrency) / float64(p.SampleCount)
}

// UpsertPerfConcurrency 写入一次采样：峰值取较大值，均值相关列做累加。
func UpsertPerfConcurrency(sample *PerfConcurrency) error {
	if sample == nil {
		return nil
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "model_name"},
			{Name: "group"},
			{Name: "channel_name"},
			{Name: "bucket_ts"},
		},
		DoUpdates: clause.Assignments(map[string]any{
			// MAX(a, b) 是标量函数，各数据库函数名不一致（SQLite/MySQL 用 MAX，
			// PostgreSQL 用 GREATEST），这里用 CASE WHEN 保证三库通用。
			"max_concurrency": gorm.Expr(
				"CASE WHEN perf_concurrency.max_concurrency > ? THEN perf_concurrency.max_concurrency ELSE ? END",
				sample.MaxConcurrency, sample.MaxConcurrency),
			"sum_concurrency": gorm.Expr("perf_concurrency.sum_concurrency + ?", sample.SumConcurrency),
			"sample_count":    gorm.Expr("perf_concurrency.sample_count + ?", sample.SampleCount),
		}),
	}).Create(sample).Error
}

// GetPerfConcurrencies 读取指定模型在时间范围内的并发采样，按时间升序。
func GetPerfConcurrencies(modelName string, group string, startTs int64, endTs int64) ([]PerfConcurrency, error) {
	var rows []PerfConcurrency
	query := DB.Model(&PerfConcurrency{}).
		Where("model_name = ? AND bucket_ts >= ? AND bucket_ts <= ?", modelName, startTs, endTs)
	if group != "" {
		query = query.Where(commonGroupCol+" = ?", group)
	}
	err := query.Order("bucket_ts ASC").Find(&rows).Error
	return rows, err
}
