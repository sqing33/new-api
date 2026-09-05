package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// quotaQuerySetupDB wires a fresh in-memory SQLite DB with the channel table
// so the endpoints can load channels. The controller suite's TestMain closes
// the shared DB between tests, so every test gets its own handle.
func quotaQuerySetupDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	prev, prevLog := model.DB, model.LOG_DB
	model.DB = db
	model.LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.Channel{}))
	t.Cleanup(func() {
		model.DB, model.LOG_DB = prev, prevLog
		_ = sqlDB.Close()
	})
	return db
}

func TestGetChannelQuotaUsageKeyIndexParamValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := quotaQuerySetupDB(t)

	channel := &model.Channel{
		Key:           "k1",
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan"}`,
	}
	require.NoError(t, db.Create(channel).Error)

	cases := []struct {
		name     string
		keyIndex string
		status   int
	}{
		{"missing param falls through to query", "", http.StatusOK},
		{"invalid alpha", "abc", http.StatusBadRequest},
		{"negative", "-1", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			url := "/api/channel/" + itoaInt(channel.Id) + "/usage"
			if tc.keyIndex != "" {
				url += "?key_index=" + tc.keyIndex
			}
			ctx.Request = httptest.NewRequest(http.MethodGet, url, nil)
			ctx.Params = gin.Params{{Key: "id", Value: itoaInt(channel.Id)}}
			GetChannelQuotaUsage(ctx)
			assert.Equal(t, tc.status, recorder.Code)
			if tc.status == http.StatusBadRequest {
				assert.Contains(t, recorder.Body.String(), "invalid key_index")
			}
		})
	}
}

// quotaQueryRequest runs a handler against a fresh test context.
func quotaQueryRequest(t *testing.T, method, path string, handler gin.HandlerFunc, channelID int) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, path, nil)
	ctx.Params = gin.Params{{Key: "id", Value: itoaInt(channelID)}}
	handler(ctx)
	return recorder
}

func TestQuotaQueryKeyIndexMalformedRejectedOnAllEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := quotaQuerySetupDB(t)

	channel := &model.Channel{
		Key:           "k1\nk2",
		ChannelInfo:   model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2},
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan","quota_query_key_index":0}`,
	}
	require.NoError(t, db.Create(channel).Error)

	// Malformed (non-numeric) and negative values are rejected by the
	// parameter parser with HTTP 400 on every endpoint carrying key_index.
	badValues := []string{"abc", "-1", "1.5", "99999999999999999999"}
	endpoints := []struct {
		method  string
		path    string
		handler gin.HandlerFunc
	}{
		{http.MethodGet, "/usage", GetChannelQuotaUsage},
		{http.MethodGet, "/usage/config", GetChannelQuotaQueryConfig},
		{http.MethodGet, "/usage/capabilities", GetChannelQuotaQueryCapabilities},
	}
	for _, ep := range endpoints {
		for _, bad := range badValues {
			rec := quotaQueryRequest(t, ep.method, "/api/channel/"+itoaInt(channel.Id)+ep.path+"?key_index="+bad, ep.handler, channel.Id)
			assert.Equal(t, http.StatusBadRequest, rec.Code, "endpoint %s value %q: body=%s", ep.path, bad, rec.Body.String())
			assert.Contains(t, rec.Body.String(), "invalid key_index")
		}
	}
}

func TestQuotaQueryKeyIndexOutOfRangeRejectedOnAllEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := quotaQuerySetupDB(t)

	// Two keys: valid indices are 0 and 1; anything >= 2 is out of range and
	// must be an HTTP 400 (query range error), not a 200 status body.
	channel := &model.Channel{
		Key:           "k1\nk2",
		ChannelInfo:   model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2},
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan","quota_query_key_index":0}`,
	}
	require.NoError(t, db.Create(channel).Error)

	endpoints := []struct {
		method  string
		path    string
		handler gin.HandlerFunc
	}{
		{http.MethodGet, "/usage", GetChannelQuotaUsage},
		{http.MethodGet, "/usage/config", GetChannelQuotaQueryConfig},
		{http.MethodGet, "/usage/capabilities", GetChannelQuotaQueryCapabilities},
	}
	for _, ep := range endpoints {
		rec := quotaQueryRequest(t, ep.method, "/api/channel/"+itoaInt(channel.Id)+ep.path+"?key_index=2", ep.handler, channel.Id)
		assert.Equal(t, http.StatusBadRequest, rec.Code, "endpoint %s: body=%s", ep.path, rec.Body.String())
		assert.Contains(t, rec.Body.String(), "key index out of bounds")
	}
}

func TestQuotaQueryConfigValidMultiKeyOverrideReportsReady(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := quotaQuerySetupDB(t)

	// No stored key_index: without an override the config would report a
	// missing key_index. A valid per-request override must yield status
	// ready and key_index=1, without mutating the stored settings.
	channel := &model.Channel{
		Key:           "k1\nk2",
		ChannelInfo:   model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2},
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan"}`,
	}
	require.NoError(t, db.Create(channel).Error)

	rec := quotaQueryRequest(t, http.MethodGet, "/api/channel/"+itoaInt(channel.Id)+"/usage/config?key_index=1", GetChannelQuotaQueryConfig, channel.Id)
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()
	assert.Contains(t, body, `"status":"ready"`)
	assert.Contains(t, body, `"can_query":true`)
	assert.Contains(t, body, `"key_index":1`)
	assert.NotContains(t, body, `"missing_fields":["key_index"`)

	var stored model.Channel
	require.NoError(t, db.First(&stored, channel.Id).Error)
	assert.Equal(t, `{"quota_query_preset_id":"kimi_coding_plan"}`, stored.OtherSettings, "override must not persist")
}

func TestQuotaQueryCapabilitiesValidOverrideReportsReady(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := quotaQuerySetupDB(t)

	channel := &model.Channel{
		Key:           "k1\nk2",
		ChannelInfo:   model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2},
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan"}`,
	}
	require.NoError(t, db.Create(channel).Error)

	rec := quotaQueryRequest(t, http.MethodGet, "/api/channel/"+itoaInt(channel.Id)+"/usage/capabilities?key_index=0", GetChannelQuotaQueryCapabilities, channel.Id)
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()
	assert.Contains(t, body, `"status":"ready"`)
	assert.Contains(t, body, `"can_query":true`)
	assert.Contains(t, body, `"key_index":0`)
}

func TestGetChannelQuotaUsageMultiKeyNoSelectionNeedsConfiguration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := quotaQuerySetupDB(t)

	// Multi-key channel without any key selection: the usage endpoint must
	// still answer 200 with a needs_configuration status payload (the query
	// cannot proceed, but the request itself is well-formed).
	channel := &model.Channel{
		Key:           "k1\nk2",
		ChannelInfo:   model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2},
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan"}`,
	}
	require.NoError(t, db.Create(channel).Error)

	rec := quotaQueryRequest(t, http.MethodGet, "/api/channel/"+itoaInt(channel.Id)+"/usage", GetChannelQuotaUsage, channel.Id)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"status":"needs_configuration"`)
}

func TestGetChannelQuotaUsageSingleKeyValid(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := quotaQuerySetupDB(t)

	channel := &model.Channel{
		Key:           "single-key",
		OtherSettings: `{"quota_query_preset_id":"kimi_coding_plan"}`,
	}
	require.NoError(t, db.Create(channel).Error)

	rec := quotaQueryRequest(t, http.MethodGet, "/api/channel/"+itoaInt(channel.Id)+"/usage", GetChannelQuotaUsage, channel.Id)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"success":true`)
}

func itoaInt(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
