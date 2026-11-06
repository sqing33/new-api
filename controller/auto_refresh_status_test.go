package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/auto_refresh_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 自动刷新配置要经 /api/status 下发：令牌管理与两个日志页所有登录用户可见，
// 而 /api/option/ 只有 root 能读，配置走那条路普通用户就拿不到了。
func TestGetStatusAdvertisesAutoRefreshSettings(t *testing.T) {
	previousMap := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = previousMap })

	setting := auto_refresh_setting.GetAutoRefreshSetting()
	previousEnabled, previousInterval := setting.Enabled, setting.IntervalSeconds
	t.Cleanup(func() {
		setting.Enabled = previousEnabled
		setting.IntervalSeconds = previousInterval
	})
	setting.Enabled = true
	setting.IntervalSeconds = 5

	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

	GetStatus(context)

	var payload struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	require.True(t, payload.Success)

	assert.Equal(t, true, payload.Data["auto_refresh_enabled"])
	assert.Equal(t, float64(5), payload.Data["auto_refresh_interval_seconds"],
		"JSON 里的数字会被解成 float64")
}
