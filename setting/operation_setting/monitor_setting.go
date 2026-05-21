package operation_setting

import (
	"os"
	"strconv"

	"github.com/QuantumNous/new-api/setting/config"
)

type MonitorSetting struct {
	AutoTestChannelEnabled                bool    `json:"auto_test_channel_enabled"`
	AutoTestChannelMinutes                float64 `json:"auto_test_channel_minutes"`
	UpstreamPricingMonitorIntervalMinutes int     `json:"upstream_pricing_monitor_interval_minutes"`
}

func defaultUpstreamPricingMonitorIntervalMinutes() int {
	if raw := os.Getenv("UPSTREAM_PRICING_MONITOR_TASK_INTERVAL_MINUTES"); raw != "" {
		if interval, err := strconv.Atoi(raw); err == nil && interval > 0 {
			return interval
		}
	}
	return 60
}

// 默认配置
var monitorSetting = MonitorSetting{
	AutoTestChannelEnabled:                false,
	AutoTestChannelMinutes:                10,
	UpstreamPricingMonitorIntervalMinutes: defaultUpstreamPricingMonitorIntervalMinutes(),
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("monitor_setting", &monitorSetting)
}

func GetMonitorSetting() *MonitorSetting {
	if os.Getenv("CHANNEL_TEST_FREQUENCY") != "" {
		frequency, err := strconv.Atoi(os.Getenv("CHANNEL_TEST_FREQUENCY"))
		if err == nil && frequency > 0 {
			monitorSetting.AutoTestChannelEnabled = true
			monitorSetting.AutoTestChannelMinutes = float64(frequency)
		}
	}
	if monitorSetting.UpstreamPricingMonitorIntervalMinutes < 1 {
		monitorSetting.UpstreamPricingMonitorIntervalMinutes = 60
	}
	return &monitorSetting
}
