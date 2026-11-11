package relaycapture

import (
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestFinalizePersistsRowToDatabase 验证 Finalize 真的把行写进了数据库。
//
// 这是「设置开了但线上看不到任何上下文内容」这一症状的回归测试：它覆盖
// Attach → BeginAttempt → 采集 → Finalize → 落库 的完整链路。
func TestFinalizePersistsRowToDatabase(t *testing.T) {
	db := openSharedSQLite(t)

	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })

	require.NoError(t, model.DB.AutoMigrate(&model.RequestPayload{}))

	recorder := newTestRecorder(t, nil)
	recorder.requestId = "e2e-request"
	recorder.BeginAttempt(0)
	recorder.CaptureStreamFrame(`{"delta":"hello"}`)
	recorder.Finalize()

	// persist 走 gopool 异步落库，需要等待它完成。
	var payloads []*model.RequestPayload
	require.Eventually(t, func() bool {
		// 用局部变量，避免与外层 err 并发读写。
		rows, readErr := model.GetRequestPayloadsByRequestId("e2e-request")
		if readErr != nil || len(rows) != 1 {
			return false
		}
		payloads = rows
		return true
	}, asyncPersistTimeout, asyncPersistInterval,
		"Finalize 必须把载荷行写进数据库 —— 否则线上开了开关也永远看不到内容")

	require.Len(t, payloads, 1)
	assert.Equal(t, "e2e-request", payloads[0].RequestId)
	assert.Equal(t, 0, payloads[0].AttemptIndex)
	assert.Contains(t, payloads[0].UpstreamResponseBody, "hello")
	assert.Equal(t, StatusOK, payloads[0].CaptureStatus)
}

// TestFinalizeWithoutResponseStillPersistsMetadata 验证即使没有采到任何响应帧，
// 客户端请求体与元信息仍然落库（部分成功也必须有记录）。
func TestFinalizeWithoutResponseStillPersistsMetadata(t *testing.T) {
	db := openSharedSQLite(t)

	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })

	require.NoError(t, model.DB.AutoMigrate(&model.RequestPayload{}))

	recorder := newTestRecorder(t, nil)
	recorder.requestId = "e2e-no-response"
	recorder.SetSessionKey(SessionKey{Key: "sess-x", Kind: SessionKeyKindExplicit})

	storage, err := common.CreateBodyStorage(common.StringToByteSlice(`{"model":"gpt-test","messages":[{"role":"user","content":"hi"}]}`))
	require.NoError(t, err)
	t.Cleanup(func() { _ = storage.Close() })

	recorder.CaptureClientRequest(storage)
	recorder.BeginAttempt(0)
	recorder.MarkAttemptFailed()
	recorder.Finalize()

	var payloads []*model.RequestPayload
	require.Eventually(t, func() bool {
		rows, readErr := model.GetRequestPayloadsByRequestId("e2e-no-response")
		if readErr != nil || len(rows) != 1 {
			return false
		}
		payloads = rows
		return true
	}, asyncPersistTimeout, asyncPersistInterval)

	require.Len(t, payloads, 1)
	assert.Contains(t, payloads[0].ClientRequestBody, "gpt-test",
		"即使上游失败，客户端请求体也必须留存")
	assert.Equal(t, "sess-x", payloads[0].SessionKey)
	assert.Equal(t, SessionKeyKindExplicit, payloads[0].SessionKeyKind)
}

// TestEnabledReflectsSettingAndTokenExclusion 验证总开关与按令牌排除都生效。
func TestEnabledReflectsSettingAndTokenExclusion(t *testing.T) {
	setting := operation_setting.GetPayloadCaptureSetting()
	previous := *setting
	t.Cleanup(func() { *setting = previous })

	setting.Enabled = false
	setting.DisabledTokenIds = nil
	assert.False(t, Enabled(7), "总开关关闭时必须不采集")

	setting.Enabled = true
	assert.True(t, Enabled(7), "总开关打开时应采集")

	setting.DisabledTokenIds = []int{7}
	assert.False(t, Enabled(7), "被排除的令牌必须不采集")
	assert.True(t, Enabled(8), "其他令牌不受影响")
}

// openSharedSQLite 返回一个所有连接共享同一份数据的 SQLite。
//
// 不能用 ":memory:"：那种内存库是「每连接一个独立数据库」，而 persist 走
// gopool 异步落库会拿到池中的另一条连接，于是查询报 no such table。
// 用临时文件 + 单连接池才能让异步 goroutine 看到同一张表。
func openSharedSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "payload.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	// 限制为单连接，确保池中不会同时存在指向不同快照的连接。
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}
