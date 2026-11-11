package model

import (
	"os"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// requestPayloadDialects 返回三库验证矩阵。MySQL / PostgreSQL 通过环境变量提供
// DSN，未配置时跳过该方言（与 model 包既有测试保持一致）。
func requestPayloadDialects(t *testing.T) []struct {
	name string
	open func(t *testing.T) *gorm.DB
} {
	t.Helper()
	return []struct {
		name string
		open func(t *testing.T) *gorm.DB
	}{
		{
			name: "sqlite",
			open: func(t *testing.T) *gorm.DB {
				t.Helper()
				db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
				require.NoError(t, err)
				return db
			},
		},
		{
			name: "mysql",
			open: func(t *testing.T) *gorm.DB {
				t.Helper()
				dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
				require.NoError(t, err)
				sqlDB, err := db.DB()
				require.NoError(t, err)
				t.Cleanup(func() { _ = sqlDB.Close() })
				return db
			},
		},
		{
			name: "postgres",
			open: func(t *testing.T) *gorm.DB {
				t.Helper()
				dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				db, err := gorm.Open(postgres.New(postgres.Config{
					DSN:                  dsn,
					PreferSimpleProtocol: true,
				}), &gorm.Config{})
				require.NoError(t, err)
				sqlDB, err := db.DB()
				require.NoError(t, err)
				t.Cleanup(func() { _ = sqlDB.Close() })
				return db
			},
		},
	}
}

// TestRequestPayloadMigrationAcrossDialects 验证新表在三库都能建成、唯一索引生效，
// 且重复执行 AutoMigrate 是幂等的。
func TestRequestPayloadMigrationAcrossDialects(t *testing.T) {
	for _, dialect := range requestPayloadDialects(t) {
		t.Run(dialect.name, func(t *testing.T) {
			db := dialect.open(t)
			require.NoError(t, db.Migrator().DropTable(&RequestPayload{}))

			// 首次迁移建表
			require.NoError(t, db.AutoMigrate(&RequestPayload{}))
			assert.True(t, db.Migrator().HasTable(&RequestPayload{}))

			// 幂等：重复迁移不得报错
			require.NoError(t, db.AutoMigrate(&RequestPayload{}))

			// 唯一索引 (request_id, attempt_index) 必须存在，否则 upsert 的
			// ON CONFLICT 匹配不到约束，整条落库链路会静默失败。
			assert.True(t,
				db.Migrator().HasIndex(&RequestPayload{}, "idx_rp_request_attempt"),
				"唯一索引必须建成，否则 upsert 会静默失败")

			// 列类型：三库都应容纳 48KB 正文而不触及 MySQL TEXT 上限。
			assert.True(t, db.Migrator().HasColumn(&RequestPayload{}, "client_request_body"))
			assert.True(t, db.Migrator().HasColumn(&RequestPayload{}, "upstream_request_body"))
			assert.True(t, db.Migrator().HasColumn(&RequestPayload{}, "upstream_response_body"))

			require.NoError(t, db.Migrator().DropTable(&RequestPayload{}))
		})
	}
}

// TestRequestPayloadUpsertAndQueryAcrossDialects 验证 upsert、attempt 隔离、
// 会话聚合与清理在三库行为一致。
func TestRequestPayloadUpsertAndQueryAcrossDialects(t *testing.T) {
	for _, dialect := range requestPayloadDialects(t) {
		t.Run(dialect.name, func(t *testing.T) {
			db := dialect.open(t)
			require.NoError(t, db.Migrator().DropTable(&RequestPayload{}))
			require.NoError(t, db.AutoMigrate(&RequestPayload{}))
			t.Cleanup(func() { _ = db.Migrator().DropTable(&RequestPayload{}) })

			previousDB := DB
			DB = db
			t.Cleanup(func() { DB = previousDB })

			// 48KB 正文：MySQL TEXT 上限是 65535 字节，这里刻意贴近默认上限，
			// 确认不会被静默截断或报错。
			largeBody := strings.Repeat("a", 48*1024)

			// 同一 request_id 的三个 attempt
			for attempt := range 3 {
				require.NoError(t, SaveRequestPayload(&RequestPayload{
					RequestId:           "req-multi",
					AttemptIndex:        attempt,
					CreatedAt:           int64(1000 + attempt),
					UserId:              7,
					TokenId:             9,
					TokenName:           "token-a",
					ModelName:           "gpt-test",
					SessionKey:          "sess-1",
					SessionKeyKind:      "explicit",
					ClientRequestBody:   largeBody,
					UpstreamRequestBody: `{"model":"gpt-test"}`,
					CaptureStatus:       "ok",
				}))
			}

			payloads, err := GetRequestPayloadsByRequestId("req-multi")
			require.NoError(t, err)
			require.Len(t, payloads, 3, "三个 attempt 必须各自成行")
			assert.Equal(t, 0, payloads[0].AttemptIndex)
			assert.Equal(t, 2, payloads[2].AttemptIndex)
			assert.Equal(t, largeBody, payloads[0].ClientRequestBody,
				"48KB 正文必须完整存取，不得被截断")

			// upsert：同 (request_id, attempt_index) 再写一次应更新而非插入新行。
			// 注意 UpdateAll 会覆盖所有列，因此这里必须补齐 session_key，
			// 否则该行会被移出所属会话（这也是下面会话聚合断言的前提）。
			require.NoError(t, SaveRequestPayload(&RequestPayload{
				RequestId:           "req-multi",
				AttemptIndex:        1,
				CreatedAt:           1001,
				ModelName:           "gpt-test",
				SessionKey:          "sess-1",
				SessionKeyKind:      "explicit",
				UpstreamRequestBody: `{"updated":true}`,
				CaptureStatus:       "ok",
			}))
			payloads, err = GetRequestPayloadsByRequestId("req-multi")
			require.NoError(t, err)
			assert.Len(t, payloads, 3, "upsert 不得产生重复行")
			assert.Contains(t, payloads[1].UpstreamRequestBody, "updated")

			// 会话列表：正文绝不能出现在会话聚合里
			sessions, total, err := ListRequestPayloadSessions(0, "", 0, 0, 1800, 0, 20)
			require.NoError(t, err)
			assert.Equal(t, 1, total, "相同 session_key 且间隔在窗口内应聚合为一个会话")
			require.Len(t, sessions, 1)
			assert.Equal(t, "sess-1", sessions[0].SessionKey)
			assert.Equal(t, 3, sessions[0].RequestCount)

			// 会话内的轻量行：不应包含正文
			rows, err := ListRequestPayloadsBySession("sess-1", 0, 0)
			require.NoError(t, err)
			require.Len(t, rows, 3)
			for _, row := range rows {
				assert.Empty(t, row.ClientRequestBody, "会话列表查询不得返回正文")
				assert.Empty(t, row.UpstreamRequestBody)
				assert.Empty(t, row.UpstreamResponseBody)
			}

			// 清理
			deleted, err := PurgeRequestPayloadsBefore(1002)
			require.NoError(t, err)
			assert.EqualValues(t, 2, deleted, "应只删除 created_at < 1002 的两行")

			remaining, err := GetRequestPayloadsByRequestId("req-multi")
			require.NoError(t, err)
			assert.Len(t, remaining, 1)
		})
	}
}

// TestRequestPayloadSessionGapSplit 验证时间窗口切分：同一 session_key 下间隔超过
// 窗口的请求应分成多个会话。
func TestRequestPayloadSessionGapSplit(t *testing.T) {
	for _, dialect := range requestPayloadDialects(t) {
		t.Run(dialect.name, func(t *testing.T) {
			db := dialect.open(t)
			require.NoError(t, db.Migrator().DropTable(&RequestPayload{}))
			require.NoError(t, db.AutoMigrate(&RequestPayload{}))
			t.Cleanup(func() { _ = db.Migrator().DropTable(&RequestPayload{}) })

			previousDB := DB
			DB = db
			t.Cleanup(func() { DB = previousDB })

			// 前两条相隔 60 秒，第三条与第二条相隔 2 小时
			for i, createdAt := range []int64{1000, 1060, 1060 + 7200} {
				require.NoError(t, SaveRequestPayload(&RequestPayload{
					RequestId:      "req-gap-" + string(rune('a'+i)),
					AttemptIndex:   0,
					CreatedAt:      createdAt,
					SessionKey:     "sess-gap",
					SessionKeyKind: "heuristic",
					ModelName:      "gpt-test",
					CaptureStatus:  "ok",
				}))
			}

			// 窗口 30 分钟 → 应切成两个会话：前两条相隔 60 秒属同一会话，
			// 第三条与第二条相隔 2 小时故另起一个。
			sessions, total, err := ListRequestPayloadSessions(0, "", 0, 0, 1800, 0, 20)
			require.NoError(t, err)
			assert.Equal(t, 2, total, "超过窗口间隔应切分为新会话")
			require.Len(t, sessions, 2)
			// 结果按时间倒序，因此 sessions[0] 是较新的那个（只含最后一条）
			assert.Equal(t, 1, sessions[0].RequestCount, "较新的会话只含最后一条")
			assert.Equal(t, 2, sessions[1].RequestCount, "较早的会话含前两条")

			// 窗口足够大 → 合并为一个会话
			sessions, total, err = ListRequestPayloadSessions(0, "", 0, 0, 0, 0, 20)
			require.NoError(t, err)
			assert.Equal(t, 1, total, "窗口为 0 时不按时间切分")
			require.Len(t, sessions, 1)
			assert.Equal(t, 3, sessions[0].RequestCount)
		})
	}
}
