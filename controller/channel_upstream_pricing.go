package controller

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

const (
	upstreamPricingMonitorDefaultIntervalMinutes      = 60
	upstreamPricingMonitorBatchSize                   = 100
	upstreamPricingMonitorMinCheckIntervalSeconds     = 600
	upstreamPricingMonitorNotifySuppressWindowSeconds = 86400
	upstreamPricingMonitorNotifyMaxChangeDetails      = 20
	upstreamPricingMonitorNotifyMaxFailedChannelIDs   = 10
	upstreamPricingMonitorDefaultTimeout              = 10
	upstreamPricingMonitorDefaultEndpoint             = "/api/pricing"
)

var upstreamPricingMonitorNumericFields = []string{
	"model_ratio",
	"completion_ratio",
	"cache_ratio",
	"create_cache_ratio",
	"image_ratio",
	"audio_ratio",
	"audio_completion_ratio",
	"model_price",
}

var (
	upstreamPricingMonitorTaskOnce    sync.Once
	upstreamPricingMonitorTaskRunning atomic.Bool
	upstreamPricingMonitorNotifyState = struct {
		sync.Mutex
		lastNotifiedAt  int64
		lastChangeCount int
		lastFailedCount int
	}{}
)

type UpstreamPricingChange struct {
	ModelName     string  `json:"model_name"`
	Field         string  `json:"field"`
	OldValue      float64 `json:"old_value"`
	NewValue      float64 `json:"new_value"`
	ChangePercent float64 `json:"change_percent"`
}

type upstreamPricingChannelChange struct {
	ChannelName string
	Change      UpstreamPricingChange
}

func pivotUpstreamDataToSnapshot(data map[string]any) map[string]map[string]interface{} {
	snapshot := make(map[string]map[string]interface{})
	for _, field := range upstreamPricingMonitorNumericFields {
		fieldMap := valueMap(data[field])
		if fieldMap == nil {
			continue
		}
		for modelName, val := range fieldMap {
			if _, ok := snapshot[modelName]; !ok {
				snapshot[modelName] = make(map[string]interface{})
			}
			snapshot[modelName][field] = val
		}
	}
	return snapshot
}

func comparePricingSnapshots(oldSnapshot map[string]map[string]interface{}, newSnapshot map[string]map[string]interface{}) []UpstreamPricingChange {
	var changes []UpstreamPricingChange

	for modelName, newFields := range newSnapshot {
		oldFields := oldSnapshot[modelName]
		if oldFields == nil {
			continue
		}
		for _, field := range upstreamPricingMonitorNumericFields {
			newVal, newOK := newFields[field]
			oldVal, oldOK := oldFields[field]
			if !newOK || !oldOK {
				continue
			}
			newFloat, newFloatOK := asFloat64(newVal)
			oldFloat, oldFloatOK := asFloat64(oldVal)
			if !newFloatOK || !oldFloatOK {
				continue
			}
			if nearlyEqual(newFloat, oldFloat) {
				continue
			}
			var changePct float64
			if oldFloat != 0 {
				changePct = (newFloat - oldFloat) / oldFloat * 100
				changePct = roundRatioValue(changePct)
			}
			changes = append(changes, UpstreamPricingChange{
				ModelName:     modelName,
				Field:         field,
				OldValue:      oldFloat,
				NewValue:      newFloat,
				ChangePercent: changePct,
			})
		}
	}
	return changes
}

func checkChannelUpstreamPricing(channel *model.Channel, settings *dto.ChannelOtherSettings, force bool) ([]UpstreamPricingChange, error) {
	now := common.GetTimestamp()
	if !force {
		minInterval := int64(common.GetEnvOrDefault("UPSTREAM_PRICING_MONITOR_MIN_CHECK_INTERVAL_SECONDS", upstreamPricingMonitorMinCheckIntervalSeconds))
		if settings.UpstreamPricingLastCheckTime > 0 && now-settings.UpstreamPricingLastCheckTime < minInterval {
			return nil, nil
		}
	}

	baseURL := channel.GetBaseURL()
	if baseURL == "" {
		baseURL = channel.GetBaseURL()
	}
	endpoint := settings.UpstreamPricingEndpoint
	if endpoint == "" {
		endpoint = upstreamPricingMonitorDefaultEndpoint
	}

	data, err := fetchSingleUpstreamPricing(context.Background(), baseURL, endpoint, channel.Id, upstreamPricingMonitorDefaultTimeout)
	settings.UpstreamPricingLastCheckTime = now
	if err != nil {
		updateChannelUpstreamPricingSettings(channel, *settings)
		return nil, err
	}

	newSnapshot := pivotUpstreamDataToSnapshot(data)

	var changes []UpstreamPricingChange
	if settings.UpstreamPricingLastSnapshot != nil {
		changes = comparePricingSnapshots(settings.UpstreamPricingLastSnapshot, newSnapshot)
	}

	settings.UpstreamPricingLastSnapshot = newSnapshot
	updateChannelUpstreamPricingSettings(channel, *settings)

	return changes, nil
}

func updateChannelUpstreamPricingSettings(channel *model.Channel, settings dto.ChannelOtherSettings) {
	channel.SetOtherSettings(settings)
	model.DB.Model(&model.Channel{}).Where("id = ?", channel.Id).Updates(map[string]interface{}{
		"settings": channel.OtherSettings,
	})
}

func shouldSendUpstreamPricingMonitorNotification(now int64, changeCount int, failedCount int) bool {
	if changeCount <= 0 && failedCount <= 0 {
		return true
	}
	upstreamPricingMonitorNotifyState.Lock()
	defer upstreamPricingMonitorNotifyState.Unlock()

	if upstreamPricingMonitorNotifyState.lastNotifiedAt > 0 &&
		now-upstreamPricingMonitorNotifyState.lastNotifiedAt < upstreamPricingMonitorNotifySuppressWindowSeconds &&
		upstreamPricingMonitorNotifyState.lastChangeCount == changeCount &&
		upstreamPricingMonitorNotifyState.lastFailedCount == failedCount {
		return false
	}
	upstreamPricingMonitorNotifyState.lastNotifiedAt = now
	upstreamPricingMonitorNotifyState.lastChangeCount = changeCount
	upstreamPricingMonitorNotifyState.lastFailedCount = failedCount
	return true
}

func buildUpstreamPricingMonitorNotificationContent(
	checkedChannels int,
	changedChannels int,
	increases []upstreamPricingChannelChange,
	decreases []upstreamPricingChannelChange,
	failedChannelIDs []int,
) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("检测渠道 %d 个，发现变动 %d 个，涨价 %d 项，降价 %d 项。",
		checkedChannels, changedChannels, len(increases), len(decreases)))

	if len(increases) > 0 {
		displayCount := min(len(increases), upstreamPricingMonitorNotifyMaxChangeDetails)
		b.WriteString(fmt.Sprintf("\n\n涨价明细（展示 %d/%d）：", displayCount, len(increases)))
		for _, item := range increases[:displayCount] {
			b.WriteString(fmt.Sprintf("\n- %s %s: %g → %g (%+.1f%%) [渠道: %s]",
				item.Change.ModelName, item.Change.Field,
				item.Change.OldValue, item.Change.NewValue,
				item.Change.ChangePercent, item.ChannelName))
		}
		if len(increases) > displayCount {
			b.WriteString(fmt.Sprintf("\n- 其余 %d 项已省略", len(increases)-displayCount))
		}
	}

	if len(decreases) > 0 {
		displayCount := min(len(decreases), upstreamPricingMonitorNotifyMaxChangeDetails)
		b.WriteString(fmt.Sprintf("\n\n降价明细（展示 %d/%d）：", displayCount, len(decreases)))
		for _, item := range decreases[:displayCount] {
			b.WriteString(fmt.Sprintf("\n- %s %s: %g → %g (%.1f%%) [渠道: %s]",
				item.Change.ModelName, item.Change.Field,
				item.Change.OldValue, item.Change.NewValue,
				item.Change.ChangePercent, item.ChannelName))
		}
		if len(decreases) > displayCount {
			b.WriteString(fmt.Sprintf("\n- 其余 %d 项已省略", len(decreases)-displayCount))
		}
	}

	if len(failedChannelIDs) > 0 {
		displayCount := min(len(failedChannelIDs), upstreamPricingMonitorNotifyMaxFailedChannelIDs)
		ids := make([]string, displayCount)
		for i := 0; i < displayCount; i++ {
			ids[i] = fmt.Sprintf("%d", failedChannelIDs[i])
		}
		b.WriteString(fmt.Sprintf("\n\n失败渠道 ID（展示 %d/%d）：%s",
			displayCount, len(failedChannelIDs), strings.Join(ids, ", ")))
		if len(failedChannelIDs) > displayCount {
			b.WriteString(fmt.Sprintf("（其余 %d 个已省略）", len(failedChannelIDs)-displayCount))
		}
	}

	return b.String()
}

func upstreamPricingMonitorInterval() time.Duration {
	intervalMinutes := operation_setting.GetMonitorSetting().UpstreamPricingMonitorIntervalMinutes
	if intervalMinutes < 1 {
		intervalMinutes = common.GetEnvOrDefault(
			"UPSTREAM_PRICING_MONITOR_TASK_INTERVAL_MINUTES",
			upstreamPricingMonitorDefaultIntervalMinutes,
		)
	}
	if intervalMinutes < 1 {
		intervalMinutes = upstreamPricingMonitorDefaultIntervalMinutes
	}
	return time.Duration(intervalMinutes) * time.Minute
}

func waitUpstreamPricingMonitorInterval(startedAt time.Time) {
	for {
		remaining := upstreamPricingMonitorInterval() - time.Since(startedAt)
		if remaining <= 0 {
			return
		}
		sleepFor := remaining
		if sleepFor > 30*time.Second {
			sleepFor = 30 * time.Second
		}
		time.Sleep(sleepFor)
	}
}

func runUpstreamPricingMonitorTaskOnce() {
	if !upstreamPricingMonitorTaskRunning.CompareAndSwap(false, true) {
		return
	}
	defer upstreamPricingMonitorTaskRunning.Store(false)

	checkedChannels := 0
	changedChannels := 0
	failedChannelIDs := make([]int, 0)
	allIncreases := make([]upstreamPricingChannelChange, 0)
	allDecreases := make([]upstreamPricingChannelChange, 0)

	lastID := 0
	for {
		var channels []*model.Channel
		query := model.DB.
			Select(channelUpstreamModelUpdateSelectFields).
			Where("status = ?", common.ChannelStatusEnabled).
			Order("id asc").
			Limit(upstreamPricingMonitorBatchSize)
		if lastID > 0 {
			query = query.Where("id > ?", lastID)
		}
		if err := query.Find(&channels).Error; err != nil {
			common.SysLog(fmt.Sprintf("upstream pricing monitor query failed: %v", err))
			break
		}
		if len(channels) == 0 {
			break
		}
		lastID = channels[len(channels)-1].Id

		for _, channel := range channels {
			if channel == nil {
				continue
			}
			settings := channel.GetOtherSettings()
			if !settings.UpstreamPricingCheckEnabled {
				continue
			}
			if channel.GetBaseURL() == "" {
				continue
			}

			checkedChannels++
			changes, err := checkChannelUpstreamPricing(channel, &settings, false)
			if err != nil {
				failedChannelIDs = append(failedChannelIDs, channel.Id)
				common.SysLog(fmt.Sprintf("upstream pricing check failed: channel_id=%d channel_name=%s err=%v", channel.Id, channel.Name, err))
				continue
			}
			if len(changes) > 0 {
				changedChannels++
				for _, c := range changes {
					item := upstreamPricingChannelChange{ChannelName: channel.Name, Change: c}
					if c.ChangePercent > 0 {
						allIncreases = append(allIncreases, item)
					} else {
						allDecreases = append(allDecreases, item)
					}
				}
			}

			if common.RequestInterval > 0 {
				time.Sleep(common.RequestInterval)
			}
		}

		if len(channels) < upstreamPricingMonitorBatchSize {
			break
		}
	}

	totalChanges := len(allIncreases) + len(allDecreases)

	if checkedChannels > 0 || common.DebugEnabled {
		common.SysLog(fmt.Sprintf(
			"upstream pricing monitor done: checked=%d changed=%d increases=%d decreases=%d failed=%d",
			checkedChannels, changedChannels, len(allIncreases), len(allDecreases), len(failedChannelIDs)))
	}

	if totalChanges > 0 || len(failedChannelIDs) > 0 {
		now := common.GetTimestamp()
		if !shouldSendUpstreamPricingMonitorNotification(now, totalChanges, len(failedChannelIDs)) {
			common.SysLog(fmt.Sprintf("upstream pricing monitor notification skipped in 24h window: changes=%d failed=%d", totalChanges, len(failedChannelIDs)))
			return
		}
		service.NotifyUpstreamPricingChangeWatchers(
			"上游定价变动通知",
			buildUpstreamPricingMonitorNotificationContent(
				checkedChannels, changedChannels, allIncreases, allDecreases, failedChannelIDs,
			),
		)
	}
}

func StartUpstreamPricingMonitorTask() {
	upstreamPricingMonitorTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		if !common.GetEnvOrDefaultBool("UPSTREAM_PRICING_MONITOR_TASK_ENABLED", true) {
			common.SysLog("upstream pricing monitor task disabled by UPSTREAM_PRICING_MONITOR_TASK_ENABLED")
			return
		}
		go func() {
			common.SysLog("upstream pricing monitor task started")
			for {
				startedAt := time.Now()
				runUpstreamPricingMonitorTaskOnce()
				common.SysLog(fmt.Sprintf("upstream pricing monitor next run in %s", upstreamPricingMonitorInterval()))
				waitUpstreamPricingMonitorInterval(startedAt)
			}
		}()
	})
}

func DetectChannelUpstreamPricingChanges(c *gin.Context) {
	var req struct {
		ID int `json:"id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ID <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid channel id"})
		return
	}

	channel, err := model.GetChannelById(req.ID, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	settings := channel.GetOtherSettings()
	changes, err := checkChannelUpstreamPricing(channel, &settings, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"channel_id":      channel.Id,
			"channel_name":    channel.Name,
			"changes":         changes,
			"last_check_time": settings.UpstreamPricingLastCheckTime,
		},
	})
}

func DetectAllChannelUpstreamPricingChanges(c *gin.Context) {
	type channelResult struct {
		ChannelID     int                     `json:"channel_id"`
		ChannelName   string                  `json:"channel_name"`
		Changes       []UpstreamPricingChange `json:"changes"`
		LastCheckTime int64                   `json:"last_check_time"`
	}

	results := make([]channelResult, 0)
	failedIDs := make([]int, 0)
	totalIncreases := 0
	totalDecreases := 0

	lastID := 0
	for {
		var channels []*model.Channel
		query := model.DB.
			Select(channelUpstreamModelUpdateSelectFields).
			Where("status = ?", common.ChannelStatusEnabled).
			Order("id asc").
			Limit(upstreamPricingMonitorBatchSize)
		if lastID > 0 {
			query = query.Where("id > ?", lastID)
		}
		if err := query.Find(&channels).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if len(channels) == 0 {
			break
		}
		lastID = channels[len(channels)-1].Id

		for _, channel := range channels {
			if channel == nil {
				continue
			}
			settings := channel.GetOtherSettings()
			if !settings.UpstreamPricingCheckEnabled {
				continue
			}
			if channel.GetBaseURL() == "" {
				continue
			}

			changes, err := checkChannelUpstreamPricing(channel, &settings, true)
			if err != nil {
				failedIDs = append(failedIDs, channel.Id)
				continue
			}
			for _, ch := range changes {
				if ch.ChangePercent > 0 {
					totalIncreases++
				} else {
					totalDecreases++
				}
			}
			results = append(results, channelResult{
				ChannelID:     channel.Id,
				ChannelName:   channel.Name,
				Changes:       changes,
				LastCheckTime: settings.UpstreamPricingLastCheckTime,
			})
		}

		if len(channels) < upstreamPricingMonitorBatchSize {
			break
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"processed_channels": len(results),
			"total_increases":    totalIncreases,
			"total_decreases":    totalDecreases,
			"failed_channel_ids": failedIDs,
			"results":            results,
		},
	})
}
