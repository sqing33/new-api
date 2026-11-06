package auto_refresh_setting

import (
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/setting/config"
)

// AutoRefreshSetting 管理管理页的自动刷新行为。
//
// 生效范围：清荫日志、使用日志、令牌管理、渠道管理四个页面。
// 这四个页面里后三个对所有登录用户可见，所以配置必须经 /api/status 下发
// （/api/option/ 只有 root 能读），写入侧仍然只有 root。
type AutoRefreshSetting struct {
	// Enabled 是否开启自动刷新（四个页面统一开关）
	Enabled bool `json:"enabled"`
	// IntervalSeconds 刷新间隔（秒）。前端据此设置定时器。
	IntervalSeconds int `json:"interval_seconds"`
}

var autoRefreshSetting = AutoRefreshSetting{
	// 默认开启：用户要求不用手动打开就一直在刷
	Enabled: true,
	// 默认 5 秒
	IntervalSeconds: 5,
}

func init() {
	config.GlobalConfig.Register("auto_refresh_setting", &autoRefreshSetting)
}

// GetAutoRefreshSetting 获取自动刷新配置
func GetAutoRefreshSetting() *AutoRefreshSetting {
	return &autoRefreshSetting
}

// 刷新间隔的取值范围。下限必须是 1：设成 0 会让前端的 setInterval 以 0 毫秒
// 疯狂触发，把后端打满。
const (
	MinIntervalSeconds = 1
	MaxIntervalSeconds = 3600
)

// 配置项的 option key。前端通过 PUT /api/option/ 写入时用它。
const (
	EnabledOptionKey         = "auto_refresh_setting.enabled"
	IntervalSecondsOptionKey = "auto_refresh_setting.interval_seconds"
)

// ValidateIntervalSeconds 校验刷新间隔。
func ValidateIntervalSeconds(value string) error {
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds < MinIntervalSeconds || seconds > MaxIntervalSeconds {
		return fmt.Errorf("auto refresh interval must be between %d and %d seconds", MinIntervalSeconds, MaxIntervalSeconds)
	}
	return nil
}
