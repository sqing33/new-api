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
