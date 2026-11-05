package model

import (
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PerfMetric stores aggregated relay performance metrics for the model square.
type PerfMetric struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	ModelName   string `json:"model_name" gorm:"size:128;uniqueIndex:idx_perf_model_group_channel_bucket,priority:1"`
	Group       string `json:"group" gorm:"column:group;size:64;uniqueIndex:idx_perf_model_group_channel_bucket,priority:2"`
	ChannelName string `json:"channel_name" gorm:"column:channel_name;size:255;uniqueIndex:idx_perf_model_group_channel_bucket,priority:3"`
	BucketTs    int64  `json:"bucket_ts" gorm:"uniqueIndex:idx_perf_model_group_channel_bucket,priority:4;index:idx_perf_bucket_ts"`
	// TokenId/TokenName 把指标细化到令牌维度。历史行 token_id 为 0，
	// 查询时归入「未知令牌」，不影响新数据。
	TokenId        int    `json:"token_id" gorm:"default:0;uniqueIndex:idx_perf_model_group_channel_bucket,priority:5"`
	TokenName      string `json:"token_name" gorm:"size:128;default:''"`
	RequestCount   int64  `json:"-" gorm:"default:0"`
	SuccessCount   int64  `json:"-" gorm:"default:0"`
	TotalLatencyMs int64  `json:"-" gorm:"default:0"`
	TtftSumMs      int64  `json:"-" gorm:"default:0"`
	TtftCount      int64  `json:"-" gorm:"default:0"`
	OutputTokens   int64  `json:"-" gorm:"default:0"`
	GenerationMs   int64  `json:"-" gorm:"default:0"`
}

func (PerfMetric) TableName() string {
	return "perf_metrics"
}

// perfMetricUniqueIndexColumns 是当前唯一索引必须覆盖的列集（顺序无关）。
// 列集一旦与它不符，upsert 的 ON CONFLICT 就找不到匹配约束（PostgreSQL 报
// SQLSTATE 42P10，MySQL 报 3106），整条 flush 链路会静默失败。
var perfMetricUniqueIndexColumns = []string{"model_name", "group", "channel_name", "bucket_ts", "token_id"}

// perfMetricLegacyUniqueIndexes lists unique indexes left by previous schema
// versions whose names differ from the current one. They must be dropped before
// AutoMigrate creates the current index.
// perfMetricLegacyUniqueIndexes 只列出「名字与当前定义不同」的旧索引名；
// 同名但列集不同的由 ensurePerfMetricUniqueIndex 负责重建。
var perfMetricLegacyUniqueIndexes = []string{"idx_perf_model_group_bucket"}

func migratePerfMetricUniqueIndex(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("migrate perf metric unique index: database is nil")
	}
	migrator := db.Migrator()
	if migrator.HasTable(&PerfMetric{}) {
		for _, indexName := range perfMetricLegacyUniqueIndexes {
			if !migrator.HasIndex(&PerfMetric{}, indexName) {
				continue
			}
			common.SysLog(fmt.Sprintf("dropping legacy perf_metrics unique index %q (%s)", indexName, db.Dialector.Name()))
			if err := migrator.DropIndex(&PerfMetric{}, indexName); err != nil {
				return fmt.Errorf("drop legacy perf metric index %q: %w", indexName, err)
			}
		}
	}
	return ensurePerfMetricUniqueIndex(db, "perf_metrics", "idx_perf_model_group_channel_bucket",
		&PerfMetric{}, perfMetricUniqueIndexColumns)
}

// ensurePerfMetricUniqueIndex 保证唯一索引覆盖当前列集。
//
// 不能依赖 GORM AutoMigrate：索引名不变、只有列集变化时，PostgreSQL 与 MySQL
// 都只新增列而保留旧索引（SQLite 因为重建整张表才碰巧正确），结果 upsert 的
// ON CONFLICT 匹配不到约束，写入全部失败。这里显式比对列集并重建。
func ensurePerfMetricUniqueIndex(db *gorm.DB, table string, indexName string, model any, wantColumns []string) error {
	migrator := db.Migrator()
	if !migrator.HasTable(model) {
		return nil
	}
	if migrator.HasIndex(model, indexName) {
		matched, err := indexCoversColumns(db, table, indexName, wantColumns)
		if err != nil {
			return err
		}
		if matched {
			return nil
		}
		common.SysLog(fmt.Sprintf("rebuilding %s unique index %q: column set changed (%s)", table, indexName, db.Dialector.Name()))
		if err := migrator.DropIndex(model, indexName); err != nil {
			return fmt.Errorf("drop outdated %s index %q: %w", table, indexName, err)
		}
	}
	if err := migrator.CreateIndex(model, indexName); err != nil {
		return fmt.Errorf("create %s index %q: %w", table, indexName, err)
	}
	return nil
}

// indexCoversColumns 判断已存在的索引是否覆盖期望的列集（顺序无关）。
// 只在索引确实存在时调用；任何解析失败都按「不匹配」处理，触发重建，
// 因为重建一个已经正确的索引是安全的（先删后建），而漏建会导致写入全挂。
func indexCoversColumns(db *gorm.DB, table string, indexName string, wantColumns []string) (bool, error) {
	columns, err := indexColumnNames(db, table, indexName)
	if err != nil {
		return false, err
	}
	if len(columns) != len(wantColumns) {
		return false, nil
	}
	want := make(map[string]struct{}, len(wantColumns))
	for _, column := range wantColumns {
		want[normalizeIndexColumn(column)] = struct{}{}
	}
	for _, column := range columns {
		if _, ok := want[normalizeIndexColumn(column)]; !ok {
			return false, nil
		}
	}
	return true, nil
}

// normalizeIndexColumn 去掉各数据库返回的列名引号与限定符，便于跨库比较。
func normalizeIndexColumn(column string) string {
	column = strings.TrimSpace(column)
	column = strings.Trim(column, "\"`")
	if idx := strings.LastIndex(column, "."); idx >= 0 {
		column = column[idx+1:]
	}
	return strings.ToLower(strings.Trim(column, "\"`"))
}

func UpsertPerfMetric(metric *PerfMetric) error {
	if metric == nil || metric.RequestCount == 0 {
		return nil
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "model_name"},
			{Name: "group"},
			{Name: "channel_name"},
			{Name: "bucket_ts"},
			{Name: "token_id"},
		},
		DoUpdates: clause.Assignments(map[string]any{
			"request_count":    gorm.Expr("perf_metrics.request_count + ?", metric.RequestCount),
			"success_count":    gorm.Expr("perf_metrics.success_count + ?", metric.SuccessCount),
			"total_latency_ms": gorm.Expr("perf_metrics.total_latency_ms + ?", metric.TotalLatencyMs),
			"ttft_sum_ms":      gorm.Expr("perf_metrics.ttft_sum_ms + ?", metric.TtftSumMs),
			"ttft_count":       gorm.Expr("perf_metrics.ttft_count + ?", metric.TtftCount),
			"output_tokens":    gorm.Expr("perf_metrics.output_tokens + ?", metric.OutputTokens),
			"generation_ms":    gorm.Expr("perf_metrics.generation_ms + ?", metric.GenerationMs),
		}),
	}).Create(metric).Error
}

func GetPerfMetrics(modelName string, group string, startTs int64, endTs int64) ([]PerfMetric, error) {
	var metrics []PerfMetric
	query := DB.Model(&PerfMetric{}).
		Where("model_name = ? AND bucket_ts >= ? AND bucket_ts <= ?", modelName, startTs, endTs)
	if group != "" {
		query = query.Where(commonGroupCol+" = ?", group)
	}
	err := query.Order("bucket_ts ASC").Find(&metrics).Error
	return metrics, err
}

type PerfMetricSummary struct {
	ModelName      string `json:"model_name"`
	RequestCount   int64  `json:"request_count"`
	SuccessCount   int64  `json:"success_count"`
	TotalLatencyMs int64  `json:"total_latency_ms"`
	OutputTokens   int64  `json:"output_tokens"`
	GenerationMs   int64  `json:"generation_ms"`
}

type PerfMetricSummaryBucket struct {
	ModelName      string `json:"model_name"`
	BucketTs       int64  `json:"bucket_ts"`
	RequestCount   int64  `json:"request_count"`
	SuccessCount   int64  `json:"success_count"`
	TotalLatencyMs int64  `json:"total_latency_ms"`
	OutputTokens   int64  `json:"output_tokens"`
	GenerationMs   int64  `json:"generation_ms"`
}

func GetPerfMetricsSummaryAll(startTs int64, endTs int64, groups []string) ([]PerfMetricSummary, error) {
	var summaries []PerfMetricSummary
	query := DB.Model(&PerfMetric{}).
		Select("model_name, SUM(request_count) as request_count, SUM(success_count) as success_count, SUM(total_latency_ms) as total_latency_ms, SUM(output_tokens) as output_tokens, SUM(generation_ms) as generation_ms").
		Where("bucket_ts >= ? AND bucket_ts <= ?", startTs, endTs)
	if groups != nil {
		if len(groups) == 0 {
			return summaries, nil
		}
		query = query.Where(commonGroupCol+" IN ?", groups)
	}
	err := query.
		Group("model_name").
		Having("SUM(request_count) > 0").
		Find(&summaries).Error
	return summaries, err
}

func GetPerfMetricsSummaryBucketsAll(startTs int64, endTs int64, groups []string) ([]PerfMetricSummaryBucket, error) {
	var summaries []PerfMetricSummaryBucket
	query := DB.Model(&PerfMetric{}).
		Select("model_name, bucket_ts, SUM(request_count) as request_count, SUM(success_count) as success_count, SUM(total_latency_ms) as total_latency_ms, SUM(output_tokens) as output_tokens, SUM(generation_ms) as generation_ms").
		Where("bucket_ts >= ? AND bucket_ts <= ?", startTs, endTs)
	if groups != nil {
		if len(groups) == 0 {
			return summaries, nil
		}
		query = query.Where(commonGroupCol+" IN ?", groups)
	}
	err := query.
		Group("model_name, bucket_ts").
		Having("SUM(request_count) > 0").
		Order("bucket_ts ASC").
		Find(&summaries).Error
	return summaries, err
}

func DeletePerfMetricsBefore(cutoffTs int64) error {
	if cutoffTs <= 0 {
		return nil
	}
	return DB.Where("bucket_ts < ?", cutoffTs).Delete(&PerfMetric{}).Error
}

func PerfMetricStartTime(hours int) int64 {
	if hours <= 0 {
		hours = 24
	}
	return time.Now().Add(-time.Duration(hours) * time.Hour).Unix()
}

// indexColumnNames 读取一个已存在索引覆盖的列名，按方言分支查询。
// 只在迁移期调用，不在请求路径上。
func indexColumnNames(db *gorm.DB, table string, indexName string) ([]string, error) {
	var columns []string
	switch {
	case common.UsingMainDatabase(common.DatabaseTypePostgreSQL):
		// pg_index.indkey 是 int2vector，用 generate_subscripts 展开成行。
		err := db.Raw(`SELECT a.attname
			FROM pg_class t
			JOIN pg_index i ON i.indrelid = t.oid
			JOIN pg_class ic ON ic.oid = i.indexrelid
			JOIN generate_subscripts(i.indkey, 1) AS s(k) ON true
			JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[s.k]
			WHERE t.relname = ? AND ic.relname = ?`, table, indexName).Scan(&columns).Error
		return columns, err
	case common.UsingMainDatabase(common.DatabaseTypeMySQL):
		err := db.Raw(`SELECT column_name FROM information_schema.statistics
			WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
			ORDER BY seq_in_index`, table, indexName).Scan(&columns).Error
		return columns, err
	default:
		// SQLite 的 PRAGMA index_info 返回 (seqno, cid, name) 三列，必须显式选
		// name，否则 Scan 到 []string 会因多余列报错。PRAGMA 不接受绑定参数，
		// 只能拼接；table/index 名来自代码常量而非用户输入。
		err := db.Raw(fmt.Sprintf("SELECT name FROM pragma_index_info(%q)", indexName)).Scan(&columns).Error
		return columns, err
	}
}
