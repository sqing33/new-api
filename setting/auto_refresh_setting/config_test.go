package auto_refresh_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 自动刷新默认开启、默认 5 秒：这是产品约定的默认值，改动会让所有已部署的
// 实例在升级后突然开始轮询。
func TestDefaultSettings(t *testing.T) {
	setting := GetAutoRefreshSetting()
	require.NotNil(t, setting)
	assert.True(t, setting.Enabled, "自动刷新默认开启")
	assert.Equal(t, 5, setting.IntervalSeconds, "默认刷新间隔 5 秒")
}

// 间隔校验：0 会让前端的 setInterval 以 0 毫秒疯狂触发，必须拒绝。
func TestValidateIntervalSeconds(t *testing.T) {
	assert.NoError(t, ValidateIntervalSeconds("1"))
	assert.NoError(t, ValidateIntervalSeconds("5"))
	assert.NoError(t, ValidateIntervalSeconds("300"))
	assert.NoError(t, ValidateIntervalSeconds("3600"))

	assert.Error(t, ValidateIntervalSeconds("0"), "0 会导致定时器疯狂触发")
	assert.Error(t, ValidateIntervalSeconds("-1"))
	assert.Error(t, ValidateIntervalSeconds("3601"), "超过上限")
	assert.Error(t, ValidateIntervalSeconds("abc"))
	assert.Error(t, ValidateIntervalSeconds(""))
}

// 配置键与 option key 的映射必须一致：option key 是
// "auto_refresh_setting.<字段的 json tag>"，写入与从数据库加载都靠这个映射。
// 字段的 json tag 一旦改动，配置就会静默失效（写进去但读不出来）。
func TestOptionKeyMapping(t *testing.T) {
	setting := GetAutoRefreshSetting()
	t.Cleanup(func() {
		require.NoError(t, config.UpdateConfigFromMap(setting, map[string]string{
			"enabled":          "true",
			"interval_seconds": "5",
		}))
	})

	require.NoError(t, config.UpdateConfigFromMap(setting, map[string]string{
		"enabled":          "false",
		"interval_seconds": "30",
	}))
	assert.False(t, setting.Enabled, "字符串 \"false\" 应被解析成布尔 false")
	assert.Equal(t, 30, setting.IntervalSeconds, "字符串 \"30\" 应被解析成整数 30")
}
