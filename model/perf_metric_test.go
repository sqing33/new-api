package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// perfMetrics 依赖唯一索引 (model_name, group, channel_name, bucket_ts) 做按渠道
// 聚合 upsert。旧版本的三列唯一索引 (model_name, group, bucket_ts) 会拦截带渠道
// 的插入,这里锁定"先删旧索引再重建新索引"的迁移路径。
func TestMigratePerfMetricUniqueIndexSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	require.NoError(t, db.AutoMigrate(&PerfMetric{}))
	// 模拟旧版本库:三列唯一索引仍然存在
	require.NoError(t, db.Exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_perf_model_group_bucket ON perf_metrics (model_name, `group`, bucket_ts)",
	).Error)
	require.True(t, db.Migrator().HasIndex(&PerfMetric{}, "idx_perf_model_group_bucket"))

	for range 2 {
		require.NoError(t, migratePerfMetricUniqueIndex(db))
	}
	require.False(t, db.Migrator().HasIndex(&PerfMetric{}, "idx_perf_model_group_bucket"))
	require.True(t, db.Migrator().HasIndex(&PerfMetric{}, "idx_perf_model_group_channel_bucket"))
	// 当前索引必须覆盖 token_id，否则 upsert 的 ON CONFLICT 匹配不到约束
	assert.True(t, indexCoversExactly(t, db, "perf_metrics", "idx_perf_model_group_channel_bucket", perfMetricUniqueIndexColumns))
}

// indexCoversExactly 是 indexCoversColumns 的测试包装。
func indexCoversExactly(t *testing.T, db *gorm.DB, table string, indexName string, want []string) bool {
	t.Helper()
	ok, err := indexCoversColumns(db, table, indexName, want)
	require.NoError(t, err)
	return ok
}

// TestEnsureUniqueIndexRebuildsSameNameIndex 锁定本次线上故障的根因：
// 索引名不变、只有列集变化时，GORM AutoMigrate 在 PostgreSQL/MySQL 上只新增列
// 而保留旧索引，导致 upsert 的 ON CONFLICT 报 SQLSTATE 42P10、落库全部失败。
// SQLite 上 AutoMigrate 会重建整张表，所以这个用例必须显式造出「旧索引仍在」
// 的状态来验证重建逻辑本身。
func TestEnsureUniqueIndexRebuildsSameNameIndex(t *testing.T) {
	previousDB, previousLOGDB := DB, LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	LOG_DB = db
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLOGDB
	})
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	initCol()

	// 造出「列已加、但唯一索引仍是旧四列」的库，正是线上 PostgreSQL 的状态
	require.NoError(t, db.Exec("CREATE TABLE perf_metrics ("+
		"id integer PRIMARY KEY AUTOINCREMENT, model_name text, `group` text, "+
		"channel_name text, bucket_ts integer, token_id integer DEFAULT 0, token_name text, "+
		"request_count integer DEFAULT 0, success_count integer DEFAULT 0, "+
		"total_latency_ms integer DEFAULT 0, ttft_sum_ms integer DEFAULT 0, ttft_count integer DEFAULT 0, "+
		"output_tokens integer DEFAULT 0, generation_ms integer DEFAULT 0)").Error)
	require.NoError(t, db.Exec(
		"CREATE UNIQUE INDEX idx_perf_model_group_channel_bucket ON perf_metrics (model_name, `group`, channel_name, bucket_ts)",
	).Error)

	// 迁移前：索引列集不含 token_id
	require.False(t, indexCoversExactly(t, db, "perf_metrics", "idx_perf_model_group_channel_bucket", perfMetricUniqueIndexColumns))

	require.NoError(t, migratePerfMetricUniqueIndex(db))
	require.True(t, indexCoversExactly(t, db, "perf_metrics", "idx_perf_model_group_channel_bucket", perfMetricUniqueIndexColumns),
		"迁移后索引必须覆盖 token_id")

	// 修好之后，跨令牌的 upsert 才能各占一行
	for _, tokenID := range []int{5, 6} {
		require.NoError(t, UpsertPerfMetric(&PerfMetric{
			ModelName: "gpt-test", Group: "default", ChannelName: "channel-a",
			BucketTs: 1000, TokenId: tokenID, TokenName: "tok", RequestCount: 1,
		}))
	}
	var count int64
	require.NoError(t, db.Model(&PerfMetric{}).Where("token_id > 0").Count(&count).Error)
	assert.Equal(t, int64(2), count)

	// 幂等：重复迁移不再重建
	require.NoError(t, migratePerfMetricUniqueIndex(db))
	require.True(t, indexCoversExactly(t, db, "perf_metrics", "idx_perf_model_group_channel_bucket", perfMetricUniqueIndexColumns))
}

func TestUpsertPerfMetricAggregatesPerChannel(t *testing.T) {
	previousDB, previousLOGDB := DB, LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	LOG_DB = db
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLOGDB
	})
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	initCol()

	require.NoError(t, db.AutoMigrate(&PerfMetric{}))
	require.NoError(t, migratePerfMetricUniqueIndex(db))

	first := &PerfMetric{
		ModelName:    "gpt-test",
		Group:        "default",
		ChannelName:  "channel-a",
		BucketTs:     1000,
		RequestCount: 2,
		SuccessCount: 1,
		TtftCount:    2,
		TtftSumMs:    200,
	}
	require.NoError(t, UpsertPerfMetric(first))
	// 同渠道同桶累加
	require.NoError(t, UpsertPerfMetric(&PerfMetric{
		ModelName:    "gpt-test",
		Group:        "default",
		ChannelName:  "channel-a",
		BucketTs:     1000,
		RequestCount: 1,
		SuccessCount: 1,
		TtftCount:    1,
		TtftSumMs:    100,
	}))
	// 同模型同组同桶但不同渠道,不能被旧语义合并
	require.NoError(t, UpsertPerfMetric(&PerfMetric{
		ModelName:    "gpt-test",
		Group:        "default",
		ChannelName:  "channel-b",
		BucketTs:     1000,
		RequestCount: 3,
		SuccessCount: 3,
	}))
	// 重复迁移 + 重复 AutoMigrate 后仍可继续 upsert(幂等)
	require.NoError(t, migratePerfMetricUniqueIndex(db))
	require.NoError(t, db.AutoMigrate(&PerfMetric{}))
	require.NoError(t, UpsertPerfMetric(&PerfMetric{
		ModelName:    "gpt-test",
		Group:        "default",
		ChannelName:  "channel-a",
		BucketTs:     1000,
		RequestCount: 1,
		SuccessCount: 0,
	}))

	rows, err := GetPerfMetrics("gpt-test", "default", 0, 2000)
	require.NoError(t, err)
	require.Len(t, rows, 2)

	byChannel := map[string]PerfMetric{}
	for _, row := range rows {
		byChannel[row.ChannelName] = row
	}
	channelA, ok := byChannel["channel-a"]
	require.True(t, ok)
	assert.Equal(t, int64(4), channelA.RequestCount)
	assert.Equal(t, int64(2), channelA.SuccessCount)
	assert.Equal(t, int64(3), channelA.TtftCount)
	assert.Equal(t, int64(300), channelA.TtftSumMs)

	channelB, ok := byChannel["channel-b"]
	require.True(t, ok)
	assert.Equal(t, int64(3), channelB.RequestCount)
	assert.Equal(t, int64(3), channelB.SuccessCount)
}

// perf_concurrency 的唯一键从四列扩到五列（加入 token_id）后，旧库里的同名
// 四列唯一索引必须先被删掉，否则同一 (模型, 分组, 渠道, 桶) 下不同令牌的采样行
// 会互相冲突，令牌维度的并发永远写不进去。这里锁定「删旧索引 → 加列 → 重建」
// 的迁移路径，并确认历史行不丢、新行可共存、迁移可重复执行。
func TestMigratePerfConcurrencyUniqueIndexSQLite(t *testing.T) {
	previousDB, previousLOGDB := DB, LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	LOG_DB = db
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLOGDB
	})
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	initCol()

	// 模拟旧版本库：四列唯一索引，没有 token_id 列
	require.NoError(t, db.Exec("CREATE TABLE perf_concurrency ("+
		"id integer PRIMARY KEY AUTOINCREMENT, model_name text, `group` text, "+
		"channel_name text, bucket_ts integer, max_concurrency integer DEFAULT 0, "+
		"sum_concurrency integer DEFAULT 0, sample_count integer DEFAULT 0)").Error)
	require.NoError(t, db.Exec(
		"CREATE UNIQUE INDEX idx_perf_conc_bucket ON perf_concurrency (model_name, `group`, channel_name, bucket_ts)",
	).Error)
	require.NoError(t, db.Exec(
		"INSERT INTO perf_concurrency (model_name, `group`, channel_name, bucket_ts, max_concurrency, sum_concurrency, sample_count) "+
			"VALUES ('gpt-test','default','channel-a',1000,3,6,2)").Error)

	// 顺序必须是 AutoMigrate（加 token_id 列）在前、重建索引在后：
	// 列还不存在时建索引会直接失败。
	require.NoError(t, db.AutoMigrate(&PerfConcurrency{}))
	require.True(t, db.Migrator().HasColumn(&PerfConcurrency{}, "token_id"))
	require.NoError(t, migratePerfConcurrencyUniqueIndex(db))
	require.True(t, indexCoversExactly(t, db, "perf_concurrency", "idx_perf_conc_bucket", perfConcurrencyUniqueIndexColumns))

	// 迁移可重复执行，且历史行仍在
	require.NoError(t, db.AutoMigrate(&PerfConcurrency{}))
	require.NoError(t, migratePerfConcurrencyUniqueIndex(db))

	// 同一 (模型, 分组, 渠道, 桶) 下两个不同令牌必须各占一行
	for _, tokenID := range []int{5, 6} {
		require.NoError(t, UpsertPerfConcurrency(&PerfConcurrency{
			ModelName:      "gpt-test",
			Group:          "default",
			ChannelName:    "channel-a",
			BucketTs:       1000,
			TokenId:        tokenID,
			MaxConcurrency: 2,
			SumConcurrency: 4,
			SampleCount:    2,
		}))
	}
	// 同令牌同桶再次采样：峰值取较大值，均值相关列累加
	require.NoError(t, UpsertPerfConcurrency(&PerfConcurrency{
		ModelName:      "gpt-test",
		Group:          "default",
		ChannelName:    "channel-a",
		BucketTs:       1000,
		TokenId:        5,
		MaxConcurrency: 4,
		SumConcurrency: 6,
		SampleCount:    2,
	}))

	rows, err := GetPerfConcurrencies("gpt-test", "", 0, 2000)
	require.NoError(t, err)
	require.Len(t, rows, 3, "历史渠道行 + 两个令牌行")

	byToken := map[int]PerfConcurrency{}
	for _, row := range rows {
		byToken[row.TokenId] = row
	}
	legacy, ok := byToken[0]
	require.True(t, ok, "历史行必须保留")
	assert.Equal(t, "channel-a", legacy.ChannelName)
	assert.Equal(t, 3, legacy.MaxConcurrency)

	token5, ok := byToken[5]
	require.True(t, ok)
	assert.Equal(t, 4, token5.MaxConcurrency, "峰值取较大值")
	assert.Equal(t, 10, token5.SumConcurrency, "均值相关列累加")
	assert.Equal(t, 4, token5.SampleCount)

	token6, ok := byToken[6]
	require.True(t, ok)
	assert.Equal(t, 2, token6.MaxConcurrency)
}
